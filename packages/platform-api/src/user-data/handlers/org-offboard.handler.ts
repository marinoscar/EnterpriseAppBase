// =============================================================================
// `org.offboard`: delete one organization with its data (#743, PP-9.1)
// =============================================================================
//
// "Export, then purge the org" (platform-packages spec, Per-slice impact).
// Multi-organization mode only; the API refuses single mode and the default
// organization, and checks the registered preconditions before it enqueues.
// Steps, each idempotent, counts committed with their rows:
//
//   1. Pending jobs of the organization (`jobs.org_id`), except this one;
//   2. The members left without any other membership are recorded in the
//      payload (once: a retry must not lose them when step 4 removed the
//      memberships);
//   3. Every `org` model's rows of the organization, children first, one
//      transaction per model (the storage-object model excluded);
//   4. Storage objects of the organization: bytes, then the row. A provider
//      failure keeps the row and FAILS the job after the step, because the
//      organization row cannot go while an object still references it (a
//      retry finishes the media);
//   5. Invites and memberships (`OrgCredential` and the org-bound sessions
//      and tokens cascade with the organization);
//   6. The users of step 2: kept (`keep`: they cannot sign in until invited),
//      or purged and deleted (`purge`: the `everything` purge, the removal
//      hooks, then the user row);
//   7. The organization row.
//
// Every statement runs on the bypass client: row-level security must not
// hide a row from the purge. SERVER-ONLY, PERMANENTLY.
// =============================================================================

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { OFFBOARDING_USER_DISPOSITIONS, ORG_OFFBOARD_JOB_TYPE } from '@marinoscar/platform-contract/user-data';
import { z } from 'zod';

import { AUDIT_SINK, type AuditSink } from '../../core/index';
import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { MetricsHostService } from '../../otel-core/index';
import { STORAGE_PROVIDER, type StorageProvider } from '../../storage/index';
import { USER_DATA_DB, type UserDataDbPort } from '../ports';
import { addCounts, deleteStorageObjects, readCounts, USER_DATA_CHUNK_SIZE } from '../purge/user-purge';
import { UserDataPlanService } from '../user-data-plan.service';
import { ORG_OFFBOARDINGS_METRIC, USER_DATA_AUDIT_ACTIONS } from '../user-data.metrics';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from '../user-data.options';
import { UserPurgeRunner, payloadOf } from '../user-purge.runner';

/**
 * The profile of `org.offboard`: 60 minutes, 3 attempts.
 *
 * @stability experimental
 */
export const ORG_OFFBOARD_PROFILE: JobExecutionProfile = Object.freeze({ maxRuntimeMs: 60 * 60_000, maxAttempts: 3 });

/**
 * The subject type of an `org.offboard` job (one active offboarding per organization).
 *
 * @stability experimental
 */
export const ORG_OFFBOARD_SUBJECT_TYPE = 'organization';

const payloadSchema = z.object({
  orgId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  userDisposition: z.enum(OFFBOARDING_USER_DISPOSITIONS).default('keep'),
});

/**
 * The `org.offboard` job handler. Server-only.
 *
 * @stability experimental
 */
@Injectable()
export class OrgOffboardHandler implements JobHandler, OnModuleInit {
  readonly type = ORG_OFFBOARD_JOB_TYPE;
  readonly label = 'Organization offboarding';
  readonly profile = ORG_OFFBOARD_PROFILE;
  private readonly logger = new Logger(OrgOffboardHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly plans: UserDataPlanService,
    private readonly runner: UserPurgeRunner,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Inject(USER_DATA_OPTIONS) private readonly options: ResolvedUserDataModuleOptions,
    @Optional() private readonly metrics?: MetricsHostService,
  ) {}

  /** Self-registration: the only wiring a handler needs. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Runs the seven steps. Throws on a database error (or a kept storage
   * object) so the queue retries.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    const parsed = payloadSchema.safeParse(payloadOf(job));
    if (!parsed.success) throw new Error(`org.offboard job ${job.id}: payload must carry { orgId, actorUserId, userDisposition }`);
    try {
      await this.run(job, parsed.data);
      this.metrics?.add(ORG_OFFBOARDINGS_METRIC, 1, { outcome: 'succeeded', user_disposition: parsed.data.userDisposition });
    } catch (error) {
      this.metrics?.add(ORG_OFFBOARDINGS_METRIC, 1, { outcome: 'failed', user_disposition: parsed.data.userDisposition });
      throw error;
    }
  }

  private async run(job: Job, input: z.infer<typeof payloadSchema>): Promise<void> {
    const { orgId, actorUserId, userDisposition } = input;
    const system = this.db.system('purge');
    trace.getActiveSpan()?.setAttributes({ 'org.id': orgId, 'offboarding.user_disposition': userDisposition });
    const base = payloadOf(job);
    let counts = readCounts(base.deleted);
    let orphanUserIds = Array.isArray(base.orphanUserIds) ? (base.orphanUserIds as unknown[]).filter((id): id is string => typeof id === 'string') : null;
    const write = (db: any) =>
      db.job.update({ where: { id: job.id }, data: { payload: { ...base, ...input, deleted: counts, ...(orphanUserIds ? { orphanUserIds } : {}) } } });
    const commit = async (tx: any, add: Record<string, number>) => {
      counts = addCounts(counts, add);
      await write(tx);
    };
    const inTx = <R>(fn: (tx: any) => Promise<R>) => this.db.runAsSystem('purge', fn, { timeout: this.options.txTimeoutMs });

    const org = await system.organization.findUnique({ where: { id: orgId }, select: { id: true, isDefault: true } });
    if (!org && !(counts.organizations > 0)) throw new Error(`org.offboard job ${job.id}: organization ${orgId} does not exist`);
    if (org?.isDefault) throw new Error(`org.offboard job ${job.id}: the default organization is never offboarded`);

    if (org) {
      // 1. Pending jobs of the organization.
      await inTx(async (tx) => {
        const { count } = await tx.job.deleteMany({ where: { orgId, status: 'pending', id: { not: job.id } } });
        await commit(tx, { jobs: count });
      });

      // 2. Members left with no other membership (recorded once).
      if (!orphanUserIds) {
        const members: { userId: string }[] = await system.membership.findMany({ where: { orgId }, select: { userId: true } });
        const orphans: string[] = [];
        for (const { userId } of members) {
          const elsewhere = await system.membership.count({ where: { userId, orgId: { not: orgId } } });
          if (elsewhere === 0) orphans.push(userId);
        }
        orphanUserIds = orphans;
        await write(system);
      }

      // 3. Org-owned rows, children first, one transaction per model.
      for (const step of this.plans.org().steps) {
        await inTx(async (tx) => {
          const { count } = await tx[step.delegate].deleteMany({ where: { [step.orgField]: orgId } });
          await commit(tx, { [step.model]: count });
        });
      }

      // 4. Storage objects of the organization: bytes, then the row.
      const storage = this.plans.org().storage;
      if (storage) {
        let cursor: string | undefined;
        let deleted = 0;
        let failed = 0;
        for (;;) {
          const page: { id: string }[] = await system[storage.delegate].findMany({
            where: { [storage.orgField]: orgId, ...(cursor ? { id: { gt: cursor } } : {}) },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: USER_DATA_CHUNK_SIZE,
          });
          if (page.length === 0) break;
          cursor = page[page.length - 1]!.id;
          const media = await deleteStorageObjects(system, this.storage, this.logger, `org.offboard job ${job.id}`, page.map((row) => row.id), storage.delegate);
          deleted += media.storageObjectsDeleted;
          failed += media.storageObjectsFailed;
        }
        await commit(system, { storageObjectsDeleted: deleted });
        if (failed > 0) {
          throw new Error(
            `org.offboard job ${job.id}: ${failed} storage object(s) could not be deleted; the organization is kept so a retry can finish them`,
          );
        }
      }

      // 5. Invites and memberships.
      await inTx(async (tx) => {
        const invites = tx.invite ? (await tx.invite.deleteMany({ where: { orgId } })).count : 0;
        const memberships = (await tx.membership.deleteMany({ where: { orgId } })).count;
        await commit(tx, { invites, memberships });
      });
    }

    // 6. Users left without an organization.
    let kept = 0;
    for (const userId of orphanUserIds ?? []) {
      const remaining = await system.membership.count({ where: { userId } });
      if (remaining > 0) continue; // joined another organization meanwhile
      if (userDisposition === 'purge') {
        const exists = await system.user.count({ where: { id: userId } });
        if (exists === 0) continue;
        const done = await this.runner.purgeAndRemoveUser(userId, job.id);
        counts = addCounts(counts, { usersPurged: done.usersDeleted ?? 0, storageObjectsFailed: done.storageObjectsFailed ?? 0 });
        await write(system);
      } else {
        kept += 1;
      }
    }
    if (userDisposition === 'keep') counts = { ...counts, usersKept: kept };

    // 7. The organization.
    if (org) {
      await inTx(async (tx) => {
        const { count } = await tx.organization.deleteMany({ where: { id: orgId, isDefault: false } });
        await commit(tx, { organizations: count });
      });
    }

    const result = { counts };
    await system.job.update({
      where: { id: job.id },
      data: { payload: { ...base, ...input, deleted: counts, orphanUserIds: orphanUserIds ?? [], result } },
    });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.OFFBOARD_COMPLETED,
      actorUserId,
      targetType: 'organization',
      targetId: orgId,
      meta: {
        orgId,
        jobId: job.id,
        userDisposition,
        memberships: counts.memberships ?? 0,
        usersPurged: counts.usersPurged ?? 0,
        usersKept: counts.usersKept ?? 0,
        storageObjectsDeleted: counts.storageObjectsDeleted ?? 0,
      },
    });
  }
}

// =============================================================================
// `admin.factory_reset`: the deployment back to a fresh install (#743, PP-9.1)
// =============================================================================
//
// Generalised from EvoPath's seven steps. Each step is idempotent and commits
// on its own (storage is its own provider calls); its counts are added to
// `payload.deleted` IN THE SAME TRANSACTION as the rows they count, so a retry
// adds to them and never loses them. A retry from any step re-evaluates every
// condition and deletes what is left.
//
//   1. Jobs           every non-running job except this one and the jobs a
//                     `keepJobsReferencedBy` row links to (the backups'), in chunks;
//   2. Users' data    the `everything` purge rows of every user, the actor
//                     included, one transaction per user;
//   3. Steps          registered `FactoryResetStep`s, phase `before-users`;
//   4. Nodes          other users' worker nodes and node credentials move to the
//                     actor; a node whose name the actor already uses is
//                     deleted and counted `workerNodesRemoved`;
//   5. Org data, users  every `org` model's rows (except those hinted
//                     `factoryReset: 'keep'`), then the user removal hooks and
//                     every user but the actor, in chunks;
//   6. Leftovers      user-less rows of the purged owner models, then the
//                     registered steps of phase `deployment` (broadcasts, device
//                     codes, the job rollup, the allowlist but the actor's);
//   7. Storage        every object outside the `survivesFactoryReset` prefixes,
//                     bytes then row, paging forward by id; a provider failure
//                     keeps the row and is counted;
//   8. Organizations  every organization but the default one (multi-org); the
//                     actor stays an `org_admin` member of the default one.
//
// Kept: the actor, roles and permissions, configuration (system settings,
// credentials, AI models, org settings and credentials), backups (their runs,
// archives and linked jobs), the audit log, running jobs and this job.
//
// SERVER-ONLY, PERMANENTLY. Disabled in `DEPLOYMENT_MODE=saas` by the API.
// =============================================================================

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { FACTORY_RESET_JOB_TYPE } from '@marinoscar/platform-contract/user-data';
import { z } from 'zod';

import { AUDIT_SINK, type AuditSink } from '../../core/index';
import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { MetricsHostService } from '../../otel-core/index';
import { STORAGE_PROVIDER, survivingKeyPrefixes, type StorageProvider } from '../../storage/index';
import { USER_DATA_DB, type UserDataDbPort } from '../ports';
import { addCounts, deleteStorageObjects, readCounts, USER_DATA_CHUNK_SIZE } from '../purge/user-purge';
import { UserDataPlanService } from '../user-data-plan.service';
import { FACTORY_RESET_RUNS_METRIC, USER_DATA_AUDIT_ACTIONS } from '../user-data.metrics';
import { USER_DATA_OPTIONS, type ResolvedUserDataModuleOptions } from '../user-data.options';
import { factoryResetStepRegistry } from '../user-data.registries';
import { UserPurgeRunner, payloadOf } from '../user-purge.runner';

/**
 * The profile of `admin.factory_reset`: 30 minutes, 3 attempts.
 *
 * @stability experimental
 */
export const FACTORY_RESET_PROFILE: JobExecutionProfile = Object.freeze({ maxRuntimeMs: 30 * 60_000, maxAttempts: 3 });

/**
 * The org role the actor keeps in the default organization.
 *
 * @stability experimental
 */
export const FACTORY_RESET_ACTOR_ORG_ROLE = 'org_admin';

const payloadSchema = z.object({ actorUserId: z.string().uuid() });

/**
 * The `admin.factory_reset` job handler. Server-only.
 *
 * @stability experimental
 */
@Injectable()
export class FactoryResetHandler implements JobHandler, OnModuleInit {
  readonly type = FACTORY_RESET_JOB_TYPE;
  readonly label = 'Factory reset';
  readonly profile = FACTORY_RESET_PROFILE;
  private readonly logger = new Logger(FactoryResetHandler.name);

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
   * Runs the eight steps. Throws on a database error so the queue retries.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    try {
      await this.run(job);
      this.metrics?.add(FACTORY_RESET_RUNS_METRIC, 1, { outcome: 'succeeded' });
    } catch (error) {
      this.metrics?.add(FACTORY_RESET_RUNS_METRIC, 1, { outcome: 'failed' });
      throw error;
    }
  }

  private async run(job: Job): Promise<void> {
    const parsed = payloadSchema.safeParse(payloadOf(job));
    if (!parsed.success) throw new Error(`admin.factory_reset job ${job.id}: payload must carry { actorUserId (uuid) }`);
    const { actorUserId } = parsed.data;
    const system = this.db.system('purge');
    const actor = await system.user.findUnique({ where: { id: actorUserId }, select: { id: true } });
    if (!actor) throw new Error(`admin.factory_reset job ${job.id}: the actor ${actorUserId} does not exist; nothing was deleted`);

    const base = payloadOf(job);
    let counts = readCounts(base.deleted);
    const commit = async (tx: any, add: Record<string, number>) => {
      counts = addCounts(counts, add);
      await tx.job.update({ where: { id: job.id }, data: { payload: { ...base, actorUserId, deleted: counts } } });
    };
    const inTx = <R>(fn: (tx: any) => Promise<R>) => this.db.runAsSystem('purge', fn, { timeout: this.options.txTimeoutMs });
    const ctx = { actorUserId, jobId: job.id };

    // 1. Jobs.
    const keepJobIds = new Set<string>([job.id]);
    for (const ref of this.options.keepJobsReferencedBy) {
      const delegate = system[ref.model.charAt(0).toLowerCase() + ref.model.slice(1)];
      if (!delegate) continue;
      const rows: Record<string, unknown>[] = await delegate.findMany({ where: { [ref.field]: { not: null } }, select: { [ref.field]: true } });
      for (const row of rows) if (typeof row[ref.field] === 'string') keepJobIds.add(row[ref.field] as string);
    }
    for (;;) {
      const batch: { id: string }[] = await system.job.findMany({
        where: { status: { not: 'running' }, id: { notIn: [...keepJobIds] } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: USER_DATA_CHUNK_SIZE,
      });
      if (batch.length === 0) break;
      await inTx(async (tx) => {
        const { count } = await tx.job.deleteMany({ where: { id: { in: batch.map((row) => row.id) }, status: { not: 'running' } } });
        await commit(tx, { jobs: count });
      });
    }

    // 2. Every user's data, the actor included.
    for await (const ids of this.userIdPages(system, {})) {
      for (const userId of ids) {
        await inTx(async (tx) => {
          const rows = await this.runner.deleteEverythingRows(tx, userId, job.id);
          await commit(tx, prefixed('category', rows.categories));
        });
      }
    }

    // 3. Registered steps, phase before-users.
    await this.runSteps('before-users', inTx, commit, ctx);

    // 4. Nodes.
    await inTx(async (tx) => {
      if (!tx.workerNode) return;
      const taken = new Set<string>(
        ((await tx.workerNode.findMany({ where: { createdById: actorUserId }, select: { name: true } })) as { name: string }[]).map((row) => row.name),
      );
      const others: { id: string; name: string }[] = await tx.workerNode.findMany({
        where: { createdById: { not: actorUserId } },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      let reassigned = 0;
      const clashing: string[] = [];
      for (const node of others) {
        if (taken.has(node.name)) {
          clashing.push(node.id);
          continue;
        }
        taken.add(node.name);
        reassigned += (await tx.workerNode.updateMany({ where: { id: node.id }, data: { createdById: actorUserId } })).count;
      }
      const removed = clashing.length > 0 ? (await tx.workerNode.deleteMany({ where: { id: { in: clashing } } })).count : 0;
      const credentials = tx.nodeCredential
        ? (await tx.nodeCredential.updateMany({ where: { userId: { not: actorUserId } }, data: { userId: actorUserId } })).count
        : 0;
      await commit(tx, { workerNodesReassigned: reassigned, workerNodesRemoved: removed, nodeCredentialsReassigned: credentials });
    });

    // 5. Org data (every organization), then every other user.
    for (const step of this.plans.org().steps) {
      if (step.factoryReset === 'keep') continue;
      await inTx(async (tx) => {
        const { count } = await tx[step.delegate].deleteMany({});
        await commit(tx, { [`model.${step.model}`]: count });
      });
    }
    for await (const ids of this.userIdPages(system, { id: { not: actorUserId } })) {
      let hooks: Record<string, number> = {};
      for (const userId of ids) hooks = addCounts(hooks, await this.runner.runRemovalHooks(userId));
      await inTx(async (tx) => {
        const { count } = await tx.user.deleteMany({ where: { id: { in: ids, not: actorUserId } } });
        await commit(tx, addCounts({ users: count }, prefixed('hook', hooks)));
      });
    }

    // 6. Deployment-wide leftovers: user-less rows, then the deployment steps.
    await inTx(async (tx) => {
      const add: Record<string, number> = {};
      for (const step of this.plans.user().steps) {
        if (!step.ownerOptional) continue;
        const { count } = await tx[step.delegate].deleteMany({ where: { [step.ownerField]: null } });
        add[`orphans.${step.model}`] = count;
      }
      await commit(tx, add);
    });
    await this.runSteps('deployment', inTx, commit, ctx);

    // 7. Storage, outside the surviving prefixes.
    const storagePlan = this.plans.user().storage;
    if (storagePlan) {
      const surviving = survivingKeyPrefixes();
      const notSurviving = surviving.length > 0 ? { NOT: { OR: surviving.map((prefix) => ({ storageKey: { startsWith: prefix } })) } } : {};
      let cursor: string | undefined;
      let deleted = 0;
      let failed = 0;
      for (;;) {
        const page: { id: string }[] = await system[storagePlan.delegate].findMany({
          where: { ...notSurviving, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: USER_DATA_CHUNK_SIZE,
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1]!.id;
        const media = await deleteStorageObjects(
          system,
          this.storage,
          this.logger,
          `admin.factory_reset job ${job.id}`,
          page.map((row) => row.id),
          storagePlan.delegate,
        );
        deleted += media.storageObjectsDeleted;
        failed += media.storageObjectsFailed;
      }
      await commit(system, { storageObjectsDeleted: deleted });
      counts.storageObjectsFailed = failed;
    }

    // 8. Organizations: only the default one stays, with the actor as its org admin.
    await inTx(async (tx) => {
      if (!tx.organization) return;
      const defaultOrg = await tx.organization.findFirst({ where: { isDefault: true }, select: { id: true } });
      if (!defaultOrg) return;
      const orgPlan = this.plans.org();
      if (orgPlan.storage) {
        // A surviving object of another organization moves to the default one, so its organization can go.
        await tx[orgPlan.storage.delegate].updateMany({
          where: { [orgPlan.storage.orgField]: { not: defaultOrg.id } },
          data: { [orgPlan.storage.orgField]: defaultOrg.id },
        });
      }
      const { count } = await tx.organization.deleteMany({ where: { id: { not: defaultOrg.id } } });
      const role = tx.role ? await tx.role.findFirst({ where: { name: FACTORY_RESET_ACTOR_ORG_ROLE }, select: { id: true } }) : null;
      if (role && tx.membership) {
        await tx.membership.upsert({
          where: { orgId_userId: { orgId: defaultOrg.id, userId: actorUserId } },
          create: { orgId: defaultOrg.id, userId: actorUserId, roleId: role.id },
          update: { roleId: role.id, status: 'active' },
        });
      }
      await commit(tx, { organizations: count });
    });

    const result = { counts };
    await system.job.update({ where: { id: job.id }, data: { payload: { ...base, actorUserId, deleted: counts, result } } });
    trace.getActiveSpan()?.setAttributes({
      'factory_reset.users_deleted': counts.users ?? 0,
      'factory_reset.storage_objects_failed': counts.storageObjectsFailed ?? 0,
    });
    await this.audit.record({
      action: USER_DATA_AUDIT_ACTIONS.FACTORY_RESET_COMPLETED,
      actorUserId,
      targetType: 'deployment',
      targetId: 'factory-reset',
      meta: {
        jobId: job.id,
        users: counts.users ?? 0,
        jobs: counts.jobs ?? 0,
        organizations: counts.organizations ?? 0,
        storageObjectsDeleted: counts.storageObjectsDeleted ?? 0,
        storageObjectsFailed: counts.storageObjectsFailed ?? 0,
      },
    });
  }

  private async runSteps(
    phase: 'before-users' | 'deployment',
    inTx: <R>(fn: (tx: any) => Promise<R>) => Promise<R>,
    commit: (tx: any, add: Record<string, number>) => Promise<void>,
    ctx: { actorUserId: string; jobId: string },
  ): Promise<void> {
    for (const step of factoryResetStepRegistry.list()) {
      if (step.phase !== phase) continue;
      await inTx(async (tx) => {
        const counts = await step.run(tx, ctx);
        await commit(tx, prefixed(`step.${step.id}`, counts ?? {}));
      });
    }
  }

  /** User ids in pages of the chunk size, by id. */
  private async *userIdPages(system: any, where: Record<string, unknown>): AsyncGenerator<string[]> {
    let cursor: string | undefined;
    for (;;) {
      const page: { id: string }[] = await system.user.findMany({
        where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: USER_DATA_CHUNK_SIZE,
      });
      if (page.length === 0) return;
      cursor = page[page.length - 1]!.id;
      yield page.map((row) => row.id);
    }
  }
}

/** `{ a: 1 }` → `{ '<prefix>.a': 1 }`. */
function prefixed(prefix: string, counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${prefix}.${key}`, value]));
}


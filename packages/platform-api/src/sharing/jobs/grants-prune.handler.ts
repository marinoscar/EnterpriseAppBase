// =============================================================================
// `sharing.grants.prune` job handler (issue #729, PP-7.2)
// =============================================================================
//
// Grant hygiene, in CHUNKS, each chunk its own short system transaction:
//
//   1. RETENTION. Deletes grants revoked, or expired, more than
//      `grants.retentionDays` ago (forRoot option, default 90). A revoked grant
//      is kept until then for the audit trail and the owner's history.
//   2. DANGLING GRANTS. A grant names its record polymorphically, with no
//      foreign key, so a record an app deleted without calling
//      `GrantsService.deleteForResources()` leaves its grants behind. For every
//      registered resource type, the job walks the distinct record ids of its
//      grants (keyset, `GRANTS_PRUNE_CHUNK` at a time), asks the type's
//      `loadOwners` which still exist, and deletes the grants of the others.
//      Grants of a type nobody registers any more are left alone: the type may
//      come back, and its id is permanent.
//
// SYSTEM WORK (reason `retention`): it crosses organizations, so it runs on
// the system bypass client, where `loadOwners` sees every organization too.
//
// SERVER-ONLY, PERMANENTLY: no `nodeResultSchema`/`persistNodeResult`. It
// reads the app's tables mid-computation (`loadOwners`), one of the reasons
// CLAUDE.md gives for a server-only job.
//
// IDEMPOTENT: a retry or a duplicate run deletes what is still due and
// nothing else. Enqueued daily by `GrantsPruneTask` (enqueue only).
//
// THE TYPE STRING IS PERMANENT once jobs of it exist.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { requireResourceType, resourceTypeRegistry } from '../access/resource-types';
import { asSharingTx } from '../data/sharing-tx';
import { SHARING_DATA, SHARING_JOBS, type SharingDataPort, type SharingJobHandler, type SharingJobRecord, type SharingJobsPort } from '../ports';
import { SHARING_OPTIONS, type ResolvedSharingModuleOptions } from '../sharing.options';

/**
 * The job type. PERMANENT once rows of it exist.
 *
 * @stability stable
 */
export const GRANTS_PRUNE_JOB_TYPE = 'sharing.grants.prune';

/**
 * How many grants (retention) or record ids (dangling) one chunk handles.
 *
 * @stability experimental
 */
export const GRANTS_PRUNE_CHUNK = 500;

/**
 * Optional injection token of the prune job's clock (ms since epoch).
 *
 * @stability experimental
 */
export const GRANTS_PRUNE_CLOCK: unique symbol = Symbol.for('@marinoscar/platform/sharing/GRANTS_PRUNE_CLOCK');

/**
 * What one prune run deleted.
 *
 * @stability experimental
 */
export interface GrantsPruneSummary {
  /** Grants revoked or expired before the retention cut-off. */
  expiredOrRevoked: number;
  /** Grants whose record no longer exists, per resource type. */
  dangling: Record<string, number>;
  /** Chunks (system transactions) used. */
  chunks: number;
}

/**
 * Deletes old revoked or expired grants and dangling grants, in chunks.
 *
 * @stability experimental
 */
@Injectable()
export class GrantsPruneHandler implements SharingJobHandler, OnModuleInit {
  /** The job type. */
  readonly type = GRANTS_PRUNE_JOB_TYPE;
  private readonly logger = new Logger(GrantsPruneHandler.name);

  constructor(
    @Inject(SHARING_DATA) private readonly data: SharingDataPort,
    @Inject(SHARING_OPTIONS) private readonly options: ResolvedSharingModuleOptions,
    @Optional() @Inject(SHARING_JOBS) private readonly jobs?: SharingJobsPort,
    @Optional() @Inject(GRANTS_PRUNE_CLOCK) private readonly now: () => number = Date.now,
  ) {}

  /** Registers the handler with the app's queue, when the app bound one. */
  onModuleInit(): void {
    this.jobs?.registerHandler(this);
  }

  /**
   * Runs one prune.
   *
   * @param job - the claimed job (its payload is unused: the job is global).
   */
  async process(job: SharingJobRecord): Promise<void> {
    const summary = await this.prune();
    const dangling = Object.values(summary.dangling).reduce((sum, n) => sum + n, 0);
    this.logger.log(
      `Job ${job.id}: pruned ${summary.expiredOrRevoked} revoked or expired grant(s) and ${dangling} dangling grant(s) in ${summary.chunks} chunk(s).`,
    );
  }

  /**
   * The prune itself (also callable directly, e.g. from a test).
   *
   * @returns what it deleted.
   */
  async prune(): Promise<GrantsPruneSummary> {
    const summary: GrantsPruneSummary = { expiredOrRevoked: 0, dangling: {}, chunks: 0 };
    const cutoff = new Date(this.now() - this.options.grants.retentionDays * 86_400_000);

    // 1. Retention.
    for (;;) {
      const { found, deleted } = await this.data.runAsSystem('retention', async (raw) => {
        const tx = asSharingTx(raw);
        const rows = await tx.grant.findMany<{ id: string }>({
          where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: GRANTS_PRUNE_CHUNK,
        });
        if (rows.length === 0) return { found: 0, deleted: 0 };
        const { count } = await tx.grant.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
        return { found: rows.length, deleted: count };
      });
      if (found > 0) summary.chunks += 1;
      summary.expiredOrRevoked += deleted;
      if (found < GRANTS_PRUNE_CHUNK) break;
    }

    // 2. Dangling grants, per registered type.
    for (const type of resourceTypeRegistry.ids()) {
      const rt = requireResourceType(type);
      let cursor: string | null = null;
      let deletedForType = 0;
      for (;;) {
        const after: string | null = cursor;
        const step: { ids: string[]; deleted: number } = await this.data.runAsSystem('retention', async (raw) => {
          const tx = asSharingTx(raw);
          const rows = await tx.grant.groupBy<{ resourceId: string }>({
            by: ['resourceId'],
            where: { resourceType: type, ...(after ? { resourceId: { gt: after } } : {}) },
            orderBy: { resourceId: 'asc' },
            take: GRANTS_PRUNE_CHUNK,
          });
          const ids = rows.map((row) => row.resourceId);
          if (ids.length === 0) return { ids, deleted: 0 };
          const owners = await rt.def.loadOwners(ids, raw);
          const missing = ids.filter((id) => !owners.has(id));
          if (missing.length === 0) return { ids, deleted: 0 };
          const { count } = await tx.grant.deleteMany({ where: { resourceType: type, resourceId: { in: missing } } });
          return { ids, deleted: count };
        });
        if (step.ids.length > 0) summary.chunks += 1;
        deletedForType += step.deleted;
        if (step.ids.length < GRANTS_PRUNE_CHUNK) break;
        cursor = step.ids[step.ids.length - 1]!;
      }
      if (deletedForType > 0) summary.dangling[type] = deletedForType;
    }
    return summary;
  }
}

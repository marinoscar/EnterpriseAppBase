// =============================================================================
// StorageMigrationService: start, list, read and cancel copy-only provider
// migrations, and the run bookkeeping both job handlers share (issue #1093)
// =============================================================================
//
// THE MODEL
//
//   * A RUN copies every `ready` object recorded on `sourceProvider` to
//     `targetProvider`. It is deployment-wide (storage configuration is system
//     scope), so its `org_id` is NULL and every read or write of it goes through
//     the bypass client with the `storage-migration` reason.
//   * The planner job (`storage.migrate_plan`) lists the objects, creates one
//     ITEM per object (carrying the object's org_id) and queues one
//     `storage.migrate_object` job per item. Retried, it resumes: items are
//     created with `skipDuplicates` against `@@unique([runId, objectId])`, and
//     only items without a `jobId` are queued.
//   * Each object job copies, verifies and repoints (see
//     `storage-migrate-object.handler.ts`).
//
// ONE RUN AT A TIME is the raw-SQL partial unique index
// `storage_migration_runs_active_uniq_idx`: the database decides who wins a
// concurrent start, and the loser's P2002 becomes a 409 carrying the winner at
// `details.activeRunId` (under `details`, because the exception filter rebuilds
// the body from a fixed key allowlist). There is deliberately no findFirst
// pre-check: it would race.
//
// COUNTS ARE DERIVED. Every read recomputes migrated / failed / skipped /
// pending from the items (one `groupBy`), so a crash between an item write and
// a counter write never shows a wrong figure. The run's own counter columns are
// snapshots written when it finalizes or is cancelled.
//
// FINALIZATION IS RACE-SAFE. Whoever writes an item's terminal status then calls
// `finalizeIfDone`: one conditional `updateMany` (`status = 'running' AND
// planned_at IS NOT NULL`), so exactly one caller flips the run however many
// finish together, and the last item to commit always sees every other.
// =============================================================================

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobReason, JobsService } from '../../jobs/index';
import { StorageConfigService } from '../config/storage-config.service';
import type { ResolvedStorageConfig } from '../config/storage-config';
import {
  StorageMigrationItemStatus,
  StorageMigrationRunStatus,
  type StorageMigrationRunRow,
  type StoragePrisma,
} from '../data/storage-db';
import { getStorageDriver } from '../drivers/storage-driver';
import { STORAGE_SYSTEM_DATA, type StorageSystemData } from '../ports';
import {
  STORAGE_MIGRATE_PLAN_TYPE,
  STORAGE_MIGRATION_ACTIVE_INDEX,
  STORAGE_MIGRATION_AUDIT_ACTIONS,
  STORAGE_MIGRATION_PRIORITY,
  STORAGE_MIGRATION_RUN_SUBJECT_TYPE,
  STORAGE_MIGRATION_SYSTEM_ACCESS_REASON,
  registerStorageMigrationSystemAccessReason,
} from './storage-migration.constants';

/**
 * A run as the admin routes return it (the contract's `StorageMigrationRun`).
 *
 * @stability experimental
 */
export interface StorageMigrationRunView {
  /** The run id. */
  id: string;
  /** The driver copied from. */
  sourceProvider: string;
  /** The driver copied to. */
  targetProvider: string;
  /** Lifecycle status. */
  status: StorageMigrationRunStatus;
  /** Items the run holds. */
  totalCount: number;
  /** Migrated items. */
  migratedCount: number;
  /** Failed items. */
  failedCount: number;
  /** Skipped items. */
  skippedCount: number;
  /** Queued or copying items. */
  pendingCount: number;
  /** Who started it. */
  startedById: string | null;
  /** ISO 8601 or null. */
  startedAt: string | null;
  /** ISO 8601 or null. */
  plannedAt: string | null;
  /** ISO 8601 or null. */
  finishedAt: string | null;
  /** ISO 8601 or null. */
  cancelledAt: string | null;
  /** The last error recorded. */
  lastError: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * The per-status item counts of one run.
 *
 * @stability experimental
 */
export interface StorageMigrationItemCounts {
  /** Every item. */
  total: number;
  /** `migrated`. */
  migrated: number;
  /** `failed`. */
  failed: number;
  /** `skipped`. */
  skipped: number;
  /** `pending` or `copying`. */
  pending: number;
}

/**
 * One page of runs, newest first.
 *
 * @stability experimental
 */
export interface StorageMigrationRunPage {
  /** The page's runs. */
  items: StorageMigrationRunView[];
  /** The page's position in the list. */
  meta: {
    /** The page, 1-based. */
    page: number;
    /** Runs per page. */
    pageSize: number;
    /** Runs across pages. */
    totalItems: number;
    /** How many pages there are. */
    totalPages: number;
  };
}

type ItemCounts = StorageMigrationItemCounts;

const EMPTY_COUNTS: ItemCounts = { total: 0, migrated: 0, failed: 0, skipped: 0, pending: 0 };

const ACTIVE_STATUSES: readonly StorageMigrationRunStatus[] = [
  StorageMigrationRunStatus.pending,
  StorageMigrationRunStatus.running,
];

/** The longest error kept on a row (the column is VARCHAR(1000)). */
const MAX_ERROR_LENGTH = 1000;

/**
 * Truncates an error message to fit `last_error`.
 *
 * @param error - anything thrown.
 * @returns at most 1000 characters.
 *
 * @internal
 */
export function storageMigrationErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= MAX_ERROR_LENGTH ? text : `${text.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

function isActiveRunConflict(error: unknown): boolean {
  const candidate = error as { code?: unknown; meta?: Record<string, unknown>; message?: unknown } | null;
  if (!candidate || candidate.code !== 'P2002') return false;
  const meta = candidate.meta ?? {};
  const cause = (meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined)?.cause;
  const index = (cause?.constraint as { index?: unknown } | undefined)?.index;
  if (index === STORAGE_MIGRATION_ACTIVE_INDEX) return true;
  if (typeof cause?.originalMessage === 'string' && cause.originalMessage.includes(STORAGE_MIGRATION_ACTIVE_INDEX)) return true;
  const target = meta.target;
  if (target === STORAGE_MIGRATION_ACTIVE_INDEX) return true;
  if (Array.isArray(target) && target.some((entry) => String(entry) === STORAGE_MIGRATION_ACTIVE_INDEX)) return true;
  // A run has no other unique constraint than its primary key (a fresh UUID),
  // so any P2002 on create is the active-run index whatever the driver reports.
  return true;
}

/**
 * Whether two resolved configurations name the same physical bucket: copying
 * onto the object being read would destroy it.
 */
function sameLocation(a: ResolvedStorageConfig, b: ResolvedStorageConfig): boolean {
  return a.bucket === b.bucket && (a.endpoint ?? '') === (b.endpoint ?? '') && (a.region ?? '') === (b.region ?? '');
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Starts, lists, reads and cancels copy-only storage provider migrations, and owns the run bookkeeping (item counts, race-safe finalization) the two migration job handlers share.
 *
 * @stability experimental
 */
@Injectable()
export class StorageMigrationService {
  private readonly logger = new Logger(StorageMigrationService.name);

  constructor(
    @Inject(STORAGE_SYSTEM_DATA) private readonly system: StorageSystemData,
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    private readonly storageConfig: StorageConfigService,
    private readonly jobs: JobsService,
  ) {
    registerStorageMigrationSystemAccessReason();
  }

  /** The bypass client, with this slice's reason. */
  db(): ReturnType<StorageSystemData['asSystem']> {
    return this.system.asSystem(STORAGE_MIGRATION_SYSTEM_ACCESS_REASON);
  }

  // ---------------------------------------------------------------------------
  // Admin routes
  // ---------------------------------------------------------------------------

  /**
   * Starts a run: validates both drivers, claims the one active slot and queues the planner.
   *
   * @param input - the source and target driver ids (they differ; the DTO checks it).
   * @param userId - the administrator.
   * @returns the new run.
   * @throws BadRequestException (`details.reason`: `UNKNOWN_DRIVER`, `SOURCE_NOT_CONFIGURED`, `TARGET_NOT_CONFIGURED`, `SAME_LOCATION`).
   * @throws ConflictException when a run is already pending or running (`details.activeRunId`).
   */
  async start(input: { sourceProvider: string; targetProvider: string }, userId: string): Promise<StorageMigrationRunView> {
    const { sourceProvider, targetProvider } = input;
    if (sourceProvider === targetProvider) {
      throw new BadRequestException({ message: 'sourceProvider and targetProvider must differ', details: { reason: 'SAME_PROVIDER' } });
    }

    for (const provider of [sourceProvider, targetProvider]) {
      if (!getStorageDriver(provider)) {
        throw new BadRequestException({
          message: `No storage driver "${provider}" is registered`,
          details: { reason: 'UNKNOWN_DRIVER', provider },
        });
      }
    }

    // Both must be buildable: the router would otherwise serve an unbuildable
    // source with the ACTIVE provider, and the copy would read the wrong bytes.
    const source = await this.storageConfig.resolveDriver(sourceProvider, { fresh: true });
    if (!source.configured) {
      throw new BadRequestException({
        message: `The source driver "${sourceProvider}" is not configured`,
        details: { reason: 'SOURCE_NOT_CONFIGURED', provider: sourceProvider, missing: source.missing },
      });
    }
    const target = await this.storageConfig.resolveDriver(targetProvider, { fresh: true });
    if (!target.configured) {
      throw new BadRequestException({
        message: `The target driver "${targetProvider}" is not configured`,
        details: { reason: 'TARGET_NOT_CONFIGURED', provider: targetProvider, missing: target.missing },
      });
    }
    if (sameLocation(source.config, target.config)) {
      throw new BadRequestException({
        message: 'The source and target drivers point at the same bucket; there is nothing to copy',
        details: { reason: 'SAME_LOCATION', bucket: target.config.bucket },
      });
    }

    let run: StorageMigrationRunRow;
    try {
      run = await this.db().storageMigrationRun.create({
        data: {
          sourceProvider,
          targetProvider,
          status: StorageMigrationRunStatus.pending,
          startedById: userId,
        },
      });
    } catch (error) {
      if (!isActiveRunConflict(error)) throw error;
      const active = await this.db().storageMigrationRun.findFirst({
        where: { status: { in: ACTIVE_STATUSES } },
        select: { id: true },
      });
      throw new ConflictException({
        message: 'A storage migration is already in progress',
        details: { activeRunId: active?.id ?? null },
      });
    }

    try {
      await this.jobs.enqueue({
        type: STORAGE_MIGRATE_PLAN_TYPE,
        reason: JobReason.backfill,
        subjectType: STORAGE_MIGRATION_RUN_SUBJECT_TYPE,
        subjectId: run.id,
        payload: { runId: run.id },
        priority: STORAGE_MIGRATION_PRIORITY,
        orgId: null,
        skipDedup: true,
      });
    } catch (error) {
      // Free the active slot: a run nobody will ever plan must not block the next.
      await this.failRun(run.id, `Could not queue the planner: ${storageMigrationErrorText(error)}`);
      throw error;
    }

    await this.audit(userId, STORAGE_MIGRATION_AUDIT_ACTIONS.START, run.id, { sourceProvider, targetProvider });
    this.logger.log(`Storage migration ${run.id} started: ${sourceProvider} -> ${targetProvider}`);

    return this.view(run, EMPTY_COUNTS);
  }

  /**
   * One page of runs, newest first, with live counts.
   *
   * @param query - page (1-based) and page size.
   * @returns the page and its position.
   */
  async list(query: { page: number; pageSize: number }): Promise<StorageMigrationRunPage> {
    const db = this.db();
    const [rows, totalItems] = await Promise.all([
      db.storageMigrationRun.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.storageMigrationRun.count(),
    ]);
    const counts = await this.countsFor(rows.map((row) => row.id));

    return {
      items: rows.map((row) => this.view(row, counts.get(row.id) ?? EMPTY_COUNTS)),
      meta: { page: query.page, pageSize: query.pageSize, totalItems, totalPages: Math.ceil(totalItems / query.pageSize) },
    };
  }

  /**
   * One run, with live counts.
   *
   * @param runId - the run.
   * @returns the run.
   * @throws NotFoundException when there is no such run.
   */
  async get(runId: string): Promise<StorageMigrationRunView> {
    const run = await this.db().storageMigrationRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Storage migration ${runId} not found`);
    const counts = await this.countsFor([run.id]);
    return this.view(run, counts.get(run.id) ?? EMPTY_COUNTS);
  }

  /**
   * Cancels a pending or running run. Queued items become `skipped` at once, so
   * the run stops before its next unclaimed object; an object being copied right
   * now finishes (its copy is verified and harmless) and the source of every
   * object is untouched either way.
   *
   * @param runId - the run.
   * @param userId - the administrator.
   * @returns the cancelled run.
   * @throws NotFoundException when there is no such run.
   * @throws ConflictException when it already finished.
   */
  async cancel(runId: string, userId: string): Promise<StorageMigrationRunView> {
    const db = this.db();
    const now = new Date();
    const flipped = await db.storageMigrationRun.updateMany({
      where: { id: runId, status: { in: ACTIVE_STATUSES } },
      data: {
        status: StorageMigrationRunStatus.cancelled,
        cancelledAt: now,
        cancelledById: userId,
        finishedAt: now,
      },
    });

    if (flipped.count === 0) {
      const existing = await db.storageMigrationRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (!existing) throw new NotFoundException(`Storage migration ${runId} not found`);
      throw new ConflictException({
        message: `Storage migration ${runId} is already ${existing.status}`,
        details: { status: existing.status },
      });
    }

    await db.storageMigrationItem.updateMany({
      where: { runId, status: StorageMigrationItemStatus.pending },
      data: { status: StorageMigrationItemStatus.skipped, lastError: 'Run cancelled' },
    });
    await this.writeCounterSnapshot(runId);
    await this.audit(userId, STORAGE_MIGRATION_AUDIT_ACTIONS.CANCEL, runId, {});
    this.logger.log(`Storage migration ${runId} cancelled`);

    return this.get(runId);
  }

  // ---------------------------------------------------------------------------
  // Run bookkeeping, shared by the two handlers
  // ---------------------------------------------------------------------------

  /**
   * Item counts per run, by status, in one `groupBy`.
   *
   * @param runIds - the runs.
   * @returns a map from run id to its counts (absent: no items).
   */
  async countsFor(runIds: readonly string[]): Promise<Map<string, StorageMigrationItemCounts>> {
    const result = new Map<string, ItemCounts>();
    if (runIds.length === 0) return result;

    const groups: Array<{ runId: string; status: StorageMigrationItemStatus; _count: { _all: number } }> =
      await this.db().storageMigrationItem.groupBy({
        by: ['runId', 'status'],
        where: { runId: { in: [...runIds] } },
        _count: { _all: true },
      });

    for (const group of groups) {
      const counts = result.get(group.runId) ?? { ...EMPTY_COUNTS };
      const n = group._count._all;
      counts.total += n;
      if (group.status === StorageMigrationItemStatus.migrated) counts.migrated += n;
      else if (group.status === StorageMigrationItemStatus.failed) counts.failed += n;
      else if (group.status === StorageMigrationItemStatus.skipped) counts.skipped += n;
      else counts.pending += n;
      result.set(group.runId, counts);
    }

    return result;
  }

  /**
   * Finalizes a running, fully planned run whose items are all terminal:
   * `failed` when any item failed, `completed` otherwise. Safe to call from any
   * number of finishing jobs at once (one conditional update wins).
   *
   * @param runId - the run.
   * @returns the final status when this call finalized it, otherwise `null`.
   */
  async finalizeIfDone(runId: string): Promise<StorageMigrationRunStatus | null> {
    const counts = (await this.countsFor([runId])).get(runId) ?? EMPTY_COUNTS;
    if (counts.pending > 0) return null;

    const status = counts.failed > 0 ? StorageMigrationRunStatus.failed : StorageMigrationRunStatus.completed;
    const flipped = await this.db().storageMigrationRun.updateMany({
      where: { id: runId, status: StorageMigrationRunStatus.running, plannedAt: { not: null } },
      data: {
        status,
        finishedAt: new Date(),
        totalCount: counts.total,
        migratedCount: counts.migrated,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
      },
    });

    if (flipped.count === 0) return null;
    this.logger.log(
      `Storage migration ${runId} ${status}: ${counts.migrated} migrated, ${counts.failed} failed, ${counts.skipped} skipped`,
    );
    return status;
  }

  /**
   * Marks an active run `failed` with a reason (the planner gave up, or could not be queued).
   *
   * @param runId - the run.
   * @param reason - why.
   */
  async failRun(runId: string, reason: string): Promise<void> {
    await this.db().storageMigrationRun.updateMany({
      where: { id: runId, status: { in: ACTIVE_STATUSES } },
      data: { status: StorageMigrationRunStatus.failed, finishedAt: new Date(), lastError: reason.slice(0, MAX_ERROR_LENGTH) },
    });
    await this.db().storageMigrationItem.updateMany({
      where: { runId, status: StorageMigrationItemStatus.pending },
      data: { status: StorageMigrationItemStatus.skipped, lastError: 'Run failed' },
    });
    await this.writeCounterSnapshot(runId);
  }

  /**
   * Records an error on the run (the most recent item failure), without changing its status.
   *
   * @param runId - the run.
   * @param message - the error.
   */
  async recordRunError(runId: string, message: string): Promise<void> {
    await this.db().storageMigrationRun.updateMany({
      where: { id: runId },
      data: { lastError: message.slice(0, MAX_ERROR_LENGTH) },
    });
  }

  private async writeCounterSnapshot(runId: string): Promise<void> {
    const counts = (await this.countsFor([runId])).get(runId) ?? EMPTY_COUNTS;
    await this.db().storageMigrationRun.updateMany({
      where: { id: runId },
      data: {
        totalCount: counts.total,
        migratedCount: counts.migrated,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
      },
    });
  }

  private view(run: StorageMigrationRunRow, counts: ItemCounts): StorageMigrationRunView {
    return {
      id: run.id,
      sourceProvider: run.sourceProvider,
      targetProvider: run.targetProvider,
      status: run.status,
      totalCount: counts.total,
      migratedCount: counts.migrated,
      failedCount: counts.failed,
      skippedCount: counts.skipped,
      pendingCount: counts.pending,
      startedById: run.startedById,
      startedAt: iso(run.startedAt),
      plannedAt: iso(run.plannedAt),
      finishedAt: iso(run.finishedAt),
      cancelledAt: iso(run.cancelledAt),
      lastError: run.lastError,
      createdAt: run.createdAt.toISOString(),
    };
  }

  private async audit(userId: string, action: string, runId: string, meta: Record<string, string>): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: { actorUserId: userId, action, targetType: 'storage_migration_run', targetId: runId, meta },
      });
    } catch (error) {
      // The run is real either way; a lost audit row must not fail the request.
      this.logger.warn(`Could not audit ${action} for storage migration ${runId}: ${storageMigrationErrorText(error)}`);
    }
  }
}

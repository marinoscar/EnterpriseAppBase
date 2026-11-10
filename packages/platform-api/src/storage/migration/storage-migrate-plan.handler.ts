// =============================================================================
// `storage.migrate_plan` — list a migration run's objects and queue them
// (issue #1093)
// =============================================================================
//
// One job per run, a system job (`orgId: null`): the run is deployment-wide and
// its objects belong to every organization, so it works through the bypass
// client with the `storage-migration` reason.
//
// RESUMABLE. Items are created page by page (keyset on the object id) with
// `skipDuplicates` against `@@unique([runId, objectId])`, and only items with no
// `jobId` are queued, so a planner that died half way and was retried continues
// where it stopped without a duplicate item or a duplicate job.
//
// WHAT IS COPIED: every `ready` object whose recorded `storage_provider` is the
// run's source. An object already repointed to the target is not on the source
// any more, so a re-run after a completed or cancelled run skips it for free.
//
// CANCELLATION is checked before every page; a cancelled run stops planning.
//
// SERVER-ONLY BY DERIVATION: no `nodeResultSchema` / `persistNodeResult`.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  JobHandlerRegistry,
  JobReason,
  JobsService,
  type Job,
  type JobExecutionProfile,
  type JobHandler,
} from '../../jobs/index';
import { StorageMigrationItemStatus, StorageMigrationRunStatus, StorageObjectStatus } from '../data/storage-db';
import {
  STORAGE_MIGRATE_OBJECT_TYPE,
  STORAGE_MIGRATE_PLAN_TYPE,
  STORAGE_MIGRATION_ITEM_SUBJECT_TYPE,
  STORAGE_MIGRATION_PRIORITY,
} from './storage-migration.constants';
import { StorageMigrationService } from './storage-migration.service';

/** Objects listed, and items queued, per page. */
const PAGE_SIZE = 500;

/**
 * The planner job's payload.
 *
 * @stability experimental
 */
export interface StorageMigratePlanPayload {
  /** The run to plan. */
  runId: string;
}

function readRunId(job: Job): string {
  const payload = job.payload as Partial<StorageMigratePlanPayload> | null;
  if (!payload || typeof payload.runId !== 'string') {
    throw new Error(`${STORAGE_MIGRATE_PLAN_TYPE} job ${job.id} has no runId in its payload`);
  }
  return payload.runId;
}

/**
 * The server-only `storage.migrate_plan` job: creates one item per `ready` object on the run's source driver and queues one `storage.migrate_object` job per item, resumably; a planner that gives up fails its run.
 *
 * @stability experimental
 */
@Injectable()
export class StorageMigratePlanHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(StorageMigratePlanHandler.name);

  readonly type = STORAGE_MIGRATE_PLAN_TYPE;

  readonly label = 'Storage migration (plan)';

  /** Listing and queueing a large deployment's objects is long but bounded work. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 60 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly migrations: StorageMigrationService,
    private readonly jobs: JobsService,
  ) {}

  /** Self-registration. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Plans the run named in the payload. */
  async process(job: Job): Promise<void> {
    const runId = readRunId(job);
    const db = this.migrations.db();

    const run = await db.storageMigrationRun.findUnique({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`${this.type} job ${job.id}: run ${runId} no longer exists; nothing to plan`);
      return;
    }
    if (run.status !== StorageMigrationRunStatus.pending && run.status !== StorageMigrationRunStatus.running) {
      this.logger.log(`${this.type} job ${job.id}: run ${runId} is ${run.status}; nothing to plan`);
      return;
    }

    await db.storageMigrationRun.updateMany({
      where: { id: runId, status: StorageMigrationRunStatus.pending },
      data: { status: StorageMigrationRunStatus.running, startedAt: new Date() },
    });

    // 1. One item per object on the source, keyset-paged.
    let cursor: string | undefined;
    for (;;) {
      if (await this.cancelled(runId)) return;
      const objects: Array<{ id: string; orgId: string; size: bigint }> = await db.storageObject.findMany({
        where: {
          storageProvider: run.sourceProvider,
          status: StorageObjectStatus.ready,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, orgId: true, size: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
      });
      if (objects.length === 0) break;
      await db.storageMigrationItem.createMany({
        data: objects.map((object) => ({
          runId,
          objectId: object.id,
          orgId: object.orgId,
          sizeBytes: object.size,
          status: StorageMigrationItemStatus.pending,
        })),
        skipDuplicates: true,
      });
      cursor = objects[objects.length - 1]!.id;
      if (objects.length < PAGE_SIZE) break;
    }

    // 2. One job per item that has none yet.
    for (;;) {
      if (await this.cancelled(runId)) return;
      const items: Array<{ id: string; objectId: string; orgId: string }> = await db.storageMigrationItem.findMany({
        where: { runId, jobId: null, status: StorageMigrationItemStatus.pending },
        select: { id: true, objectId: true, orgId: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
      });
      if (items.length === 0) break;
      for (const item of items) {
        const queued = await this.jobs.enqueue({
          type: STORAGE_MIGRATE_OBJECT_TYPE,
          reason: JobReason.backfill,
          subjectType: STORAGE_MIGRATION_ITEM_SUBJECT_TYPE,
          subjectId: item.id,
          payload: { runId, itemId: item.id },
          priority: STORAGE_MIGRATION_PRIORITY,
          orgId: item.orgId,
          skipDedup: true,
        });
        await db.storageMigrationItem.updateMany({ where: { id: item.id, jobId: null }, data: { jobId: queued.id } });
      }
    }

    const total = await db.storageMigrationItem.count({ where: { runId } });
    await db.storageMigrationRun.updateMany({
      where: { id: runId, status: StorageMigrationRunStatus.running },
      data: { plannedAt: new Date(), totalCount: total },
    });
    this.logger.log(`Storage migration ${runId}: ${total} object(s) queued (${run.sourceProvider} -> ${run.targetProvider})`);

    // Every item may already be done (or there were none): finalize now.
    await this.migrations.finalizeIfDone(runId);
  }

  private async cancelled(runId: string): Promise<boolean> {
    const current = await this.migrations.db().storageMigrationRun.findUnique({ where: { id: runId }, select: { status: true } });
    return !current || current.status !== StorageMigrationRunStatus.running;
  }
}

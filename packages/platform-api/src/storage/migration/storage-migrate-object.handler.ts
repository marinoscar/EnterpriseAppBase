// =============================================================================
// `storage.migrate_object` — copy one object to the run's target driver,
// verify it, repoint its row, leave the source (issue #1093)
// =============================================================================
//
// ORDER, AND WHY IT IS THE WHOLE DESIGN
//
//   1. The run must still be running. A cancelled (or finished) run's item is
//      marked `skipped` and nothing is copied: a cancelled run stops before its
//      next unclaimed object.
//   2. The item and its object are read in the object's organization
//      (`JobScope.run`, the job carries the object's `orgId`). An object that is
//      gone, not `ready`, or no longer recorded on the source (repointed by an
//      earlier run, re-uploaded elsewhere) is `skipped`: a re-run never copies
//      an already-migrated object twice.
//   3. The bytes are STREAMED from the source into the target and read back
//      (`copyAndVerify`): the byte count and the sha256 must agree on both sides
//      and with the row's size. Nothing is buffered.
//   4. Only then is the row repointed, in one org-scoped transaction, guarded by
//      `storage_provider = source AND storage_key = key`: an object changed while
//      it was being copied is not repointed (it is `skipped`), so the row never
//      points at bytes that are not its own.
//   5. The source object is NEVER deleted: it is the fallback.
//
// FAILURE. A thrown error (a network glitch, throttling, a verification
// mismatch) is retried by the queue with backoff; the item stays `copying`.
// When the job gives up, `StorageMigrationSettledListener` marks a still-open item `failed` — a
// listener rather than an "is this my last attempt?" check, because a timeout
// or a dead executor never returns into `process`.
//
// SERVER-ONLY BY DERIVATION: neither `nodeResultSchema` nor `persistNodeResult`.
// The copy needs BOTH drivers' secrets, which are never brokered to a worker
// node.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  JobHandlerRegistry,
  JobScope,
  type Job,
  type JobExecutionProfile,
  type JobHandler,
} from '../../jobs/index';
import { StorageConfigService } from '../config/storage-config.service';
import {
  StorageMigrationItemStatus,
  StorageMigrationRunStatus,
  StorageObjectStatus,
  type StorageMigrationItemRow,
  type StorageObject,
  type StorageTx,
} from '../data/storage-db';
import { StorageProviderRouter } from '../providers/storage-provider-router';
import { copyAndVerify } from './copy-and-verify';
import { STORAGE_MIGRATE_OBJECT_TYPE } from './storage-migration.constants';
import { StorageMigrationService } from './storage-migration.service';

/**
 * The per-object job's payload.
 *
 * @stability experimental
 */
export interface StorageMigrateObjectPayload {
  /** The run. */
  runId: string;
  /** The item (one object of the run). */
  itemId: string;
}

function readPayload(job: Job): StorageMigrateObjectPayload {
  const payload = job.payload as Partial<StorageMigrateObjectPayload> | null;
  if (!payload || typeof payload.runId !== 'string' || typeof payload.itemId !== 'string') {
    throw new Error(`${STORAGE_MIGRATE_OBJECT_TYPE} job ${job.id} has an invalid payload`);
  }
  return { runId: payload.runId, itemId: payload.itemId };
}

type Tx = StorageTx & { [model: string]: any };

/**
 * The server-only `storage.migrate_object` job: streams one object from the run's source driver to its target, verifies size and sha256 by reading it back, repoints the row and leaves the source in place.
 *
 * @stability experimental
 */
@Injectable()
export class StorageMigrateObjectHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(StorageMigrateObjectHandler.name);

  readonly type = STORAGE_MIGRATE_OBJECT_TYPE;

  readonly label = 'Storage migration (copy object)';

  /** One object can be several gigabytes, copied and then read back. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 60 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly migrations: StorageMigrationService,
    private readonly jobScope: JobScope,
    private readonly router: StorageProviderRouter,
    private readonly storageConfig: StorageConfigService,
  ) {}

  /** Self-registration. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Copies, verifies and repoints the job's object; see the file header. */
  async process(job: Job): Promise<void> {
    const { runId, itemId } = readPayload(job);

    const run = await this.migrations.db().storageMigrationRun.findUnique({ where: { id: runId } });
    if (!run) return;

    const claim = await this.jobScope.run(job, async (tx: Tx) => {
      const item: StorageMigrationItemRow | null = await tx.storageMigrationItem.findUnique({ where: { id: itemId } });
      if (!item || (item.status !== StorageMigrationItemStatus.pending && item.status !== StorageMigrationItemStatus.copying)) {
        return { kind: 'done' as const };
      }
      if (run.status !== StorageMigrationRunStatus.running) {
        await this.skip(tx, itemId, `Run ${run.status}`);
        return { kind: 'skipped' as const };
      }
      const object: StorageObject | null = await tx.storageObject.findUnique({ where: { id: item.objectId } });
      if (!object || object.status !== StorageObjectStatus.ready) {
        await this.skip(tx, itemId, 'The object is gone or not ready');
        return { kind: 'skipped' as const };
      }
      if (object.storageProvider !== run.sourceProvider) {
        await this.skip(tx, itemId, `The object is recorded on "${object.storageProvider}", not on the source`);
        return { kind: 'skipped' as const };
      }
      await tx.storageMigrationItem.update({ where: { id: itemId }, data: { status: StorageMigrationItemStatus.copying } });
      return { kind: 'copy' as const, object };
    });

    if (claim.kind === 'done') return;
    if (claim.kind === 'skipped') {
      await this.migrations.finalizeIfDone(runId);
      return;
    }

    const { object } = claim;
    // Both drivers must be buildable: the router would serve an unbuildable one
    // with the ACTIVE provider, which is the wrong place to read or write.
    for (const provider of [run.sourceProvider, run.targetProvider]) {
      const resolution = await this.storageConfig.resolveDriver(provider);
      if (!resolution.configured) {
        throw new Error(`Storage driver "${provider}" is not configured (missing ${resolution.missing.join(', ')})`);
      }
    }
    const source = await this.router.forObject(object);
    const target = await this.router.forLocation({ provider: run.targetProvider, bucket: '' });

    const verified = await copyAndVerify(source, target, object);
    const targetBucket = target.getBucket();

    const repointed = await this.jobScope.run(job, async (tx: Tx) => {
      const moved = await tx.storageObject.updateMany({
        where: { id: object.id, storageProvider: run.sourceProvider, storageKey: object.storageKey },
        data: { storageProvider: run.targetProvider, bucket: targetBucket },
      });
      if (moved.count === 0) {
        await this.skip(tx, itemId, 'The object changed while it was being copied; not repointed');
        return false;
      }
      await tx.storageMigrationItem.update({
        where: { id: itemId },
        data: {
          status: StorageMigrationItemStatus.migrated,
          sizeBytes: verified.bytes,
          checksumSha256: verified.sha256,
          lastError: null,
        },
      });
      return true;
    });

    if (repointed) {
      this.logger.log(
        `Storage migration ${runId}: object ${object.id} copied ${run.sourceProvider} -> ${run.targetProvider} (${verified.bytes} bytes, verified)`,
      );
    }
    await this.migrations.finalizeIfDone(runId);
  }

  private async skip(tx: Tx, itemId: string, reason: string): Promise<void> {
    await tx.storageMigrationItem.update({
      where: { id: itemId },
      data: { status: StorageMigrationItemStatus.skipped, lastError: reason },
    });
  }
}

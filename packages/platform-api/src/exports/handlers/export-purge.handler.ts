// =============================================================================
// `export.purge`: deletes export files older than the retention period
// (issue #744; EvoPath `health.export.purge`, H7 #191)
// =============================================================================
//
// Queued once a day by `ExportPurgeTask` (a `@Cron` that only enqueues,
// through `enqueueHousekeepingJob`). One run deletes every `storage_objects`
// row under `exports/` created more than `retentionDays` ago: the provider's
// bytes first, then the row. A provider failure keeps that row (so the next
// run retries it), is counted, and fails the run after the rest were
// processed, so the queue retries. Once the row is gone the export reads
// `expired`.
//
// Rows, not a bucket listing: the storage interface has no list operation,
// and the row is what makes the file findable. Across organizations, through
// the bypass client (reason `purge`).
//
// SERVER-ONLY: deleting objects from this deployment's storage is a privilege
// a worker node must never hold.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { STORAGE_PROVIDER, type StorageProvider } from '../../storage/index';
import { EXPORT_PURGE_BATCH, EXPORT_PURGE_JOB_TYPE, EXPORTS_STORAGE_ROOT } from '../exports.constants';
import { EXPORTS_OPTIONS, type ResolvedExportsModuleOptions } from '../exports.options';
import { EXPORTS_SYSTEM_DATA, type ExportsSystemData } from '../ports';

/**
 * What one purge did.
 *
 * @stability experimental
 */
export interface ExportPurgeResult {
  /** Files deleted (bytes and row). */
  deleted: number;
  /** Files whose bytes could not be deleted; their rows are kept. */
  failed: number;
}

/**
 * The server-only `export.purge` job. See the file header.
 *
 * @stability experimental
 */
@Injectable()
export class ExportPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(ExportPurgeHandler.name);

  /** PERMANENT once jobs of this type exist. */
  readonly type = EXPORT_PURGE_JOB_TYPE;

  /** Its name in the jobs console. */
  readonly label = 'Export expiry';

  /** `ExportsModule.forRoot({ purgeProfile })`; default 30 minutes, 3 attempts. */
  readonly profile: JobExecutionProfile;

  /** Overridable clock, for tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(EXPORTS_OPTIONS) private readonly options: ResolvedExportsModuleOptions,
    @Inject(EXPORTS_SYSTEM_DATA) private readonly system: ExportsSystemData,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    this.profile = options.purgeProfile;
  }

  /** Self-registration, plus one alias per legacy `purge` type. */
  onModuleInit(): void {
    this.registry.register(this);
    for (const legacy of this.options.legacyJobTypes) {
      if (legacy.handles !== 'purge') continue;
      this.registry.register({ type: legacy.type, label: legacy.label ?? this.label, profile: this.profile, process: (job) => this.process(job) });
    }
  }

  /**
   * Runs the purge; throws when any file could not be deleted.
   *
   * @param job - the claimed job.
   */
  async process(job: Job): Promise<void> {
    const { deleted, failed } = await this.purge();
    this.logger.log(`Export purge ${job.id}: ${deleted} file(s) deleted, ${failed} failed`);
    if (failed > 0) throw new Error(`${failed} expired export file(s) could not be deleted; the run will be retried`);
  }

  /**
   * The purge itself, exposed so a test reads the split without the throw.
   *
   * @returns what it did.
   */
  async purge(): Promise<ExportPurgeResult> {
    const cutoff = new Date(this.now().getTime() - this.options.retentionDays * 24 * 60 * 60 * 1000);
    const db = this.system.asSystem('purge');
    const failedIds: string[] = [];
    let deleted = 0;

    for (;;) {
      const batch = (await db.storageObject.findMany({
        where: {
          storageKey: { startsWith: EXPORTS_STORAGE_ROOT },
          createdAt: { lt: cutoff },
          ...(failedIds.length > 0 ? { id: { notIn: failedIds } } : {}),
        },
        select: { id: true, storageKey: true },
        orderBy: { createdAt: 'asc' },
        take: EXPORT_PURGE_BATCH,
      })) as Array<{ id: string; storageKey: string }>;
      if (batch.length === 0) break;

      for (const object of batch) {
        try {
          await this.storage.delete(object.storageKey);
          await db.storageObject.deleteMany({ where: { id: object.id } });
          deleted += 1;
        } catch (error) {
          failedIds.push(object.id);
          this.logger.warn(`Could not delete expired export object ${object.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return { deleted, failed: failedIds.length };
  }
}

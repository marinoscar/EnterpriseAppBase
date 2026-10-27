// =============================================================================
// The nightly stale-upload scheduler (issue #353, epic #345)
// =============================================================================
//
// ⚠ THIS TASK ABORTS AND DELETES NOTHING. It enqueues a job, and
// `storage/handlers/storage-cleanup.handler.ts` does the work on a worker slot.
// See that handler's header for why the loop moved, and
// `jobs/housekeeping.enqueue.ts` for the two guards in front of the enqueue.
//
// 4am, unchanged from before the conversion.
// =============================================================================

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { enqueueHousekeepingJob, type JobsPrisma } from '../../jobs/index';
import { JobsService } from '../../jobs/index';
import { STORAGE_CLEANUP_TYPE } from '../handlers/storage-cleanup.handler';
import { PLATFORM_PRISMA } from '../../core/index';

/**
 * The daily `@Cron` that enqueues the `storage.cleanup.stale-uploads` job (enqueue only).
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class StorageCleanupTask {
  private readonly logger = new Logger(StorageCleanupTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleCleanup(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: STORAGE_CLEANUP_TYPE,
      what: 'stale upload cleanup',
    });
  }
}

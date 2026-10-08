// =============================================================================
// ExportPurgeTask: queues the daily expiry of export files (issue #744)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. A `@Cron` decides and enqueues, nothing more
// (CLAUDE.md queue rule 1; `apps/api/test/jobs/cron-enqueue-only.spec.ts`).
// The deleting is `export.purge`'s work, on a worker slot, retried by the
// queue. 3am, EvoPath's schedule.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobsService, enqueueHousekeepingJob, type JobsPrisma } from '../../jobs/index';
import { EXPORT_PURGE_JOB_TYPE } from '../exports.constants';

/**
 * The daily `@Cron` that enqueues `export.purge` (enqueue only).
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class ExportPurgeTask {
  private readonly logger = new Logger(ExportPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
  ) {}

  /** Enqueues today's purge, unless one is already pending. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: EXPORT_PURGE_JOB_TYPE,
      what: 'export expiry',
    });
  }
}

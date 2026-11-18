// =============================================================================
// WebhookPurgeTask: queues the daily delivery purge (issue #1046)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. A `@Cron` decides and enqueues, nothing more
// (the `cron-enqueue-only` conformance suite). The deleting is
// `webhooks.deliveries_purge`'s work, on a worker slot, retried by the queue.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobsService, enqueueHousekeepingJob, type JobsPrisma } from '../../jobs/index';
import { WEBHOOK_PURGE_JOB_TYPE } from '../webhooks.constants';

/**
 * The daily `@Cron` that enqueues `webhooks.deliveries_purge` (enqueue only).
 *
 * @internal
 *
 * @stability experimental
 */
@Injectable()
export class WebhookPurgeTask {
  private readonly logger = new Logger(WebhookPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
  ) {}

  /** Enqueues today's purge, unless one is already pending. 04:17 UTC, off the hour. */
  @Cron('17 4 * * *')
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: this.logger,
      type: WEBHOOK_PURGE_JOB_TYPE,
      what: 'webhook delivery purge',
    });
  }
}

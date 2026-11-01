import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobsService, enqueueHousekeepingJob, type JobsPrisma } from '../../jobs/index';
import { ALERTS_INCIDENTS_PURGE_TYPE } from '../alerts.constants';

/**
 * Queues `alerts.incidents_purge` daily. Enqueue only.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsPurgeTask {
  private readonly logger = new Logger(AlertsPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: unknown,
  ) {}

  /** The cron tick (03:17 UTC). */
  @Cron('17 3 * * *')
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma as JobsPrisma,
      logger: this.logger,
      type: ALERTS_INCIDENTS_PURGE_TYPE,
      what: 'alert incident purge',
    });
  }
}

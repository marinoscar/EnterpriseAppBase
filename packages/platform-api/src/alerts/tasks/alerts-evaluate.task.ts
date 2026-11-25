import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { JobsService, enqueueHousekeepingJob, type JobsPrisma } from '../../jobs/index';
import { ALERTS_EVALUATE_TYPE } from '../alerts.constants';

/**
 * Queues `alerts.evaluate` every minute. It DECIDES nothing and DOES nothing
 * else: the evaluation is the handler's, on a worker slot, observable as a job.
 * The housekeeping helper keeps one in flight, so a slow evaluation never
 * stacks a second behind it.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsEvaluateTask {
  private readonly logger = new Logger(AlertsEvaluateTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: unknown,
  ) {}

  /** The cron tick. */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma as JobsPrisma,
      logger: this.logger,
      type: ALERTS_EVALUATE_TYPE,
      what: 'alert evaluation',
    });
  }
}

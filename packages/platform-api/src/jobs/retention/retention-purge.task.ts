// =============================================================================
// Daily retention scheduler (#681, platform-packages PP-1.10; jobs slice since #898)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. For each ENABLED `retention.*` policy it
// enqueues one global purge job through the shared housekeeping helper, and
// the handler does the deleting on a worker slot. Pinned by
// the `cron-enqueue-only` conformance suite, which needs no exemption for
// this file.
//
// WHICH PURGES EXIST is not this file's business: each purge handler declares
// its own entry in `RetentionPurgeRegistry` (#898), so the scheduler enqueues
// the purges whose handler is mounted, and nothing for a slice the app left out.
//
// One job per table rather than one job for all four: four rows in the admin
// job list, independent retries and independent failure — a failing audit
// purge must not hold up notification retention.
//
// 01:00: after `job.history.purge` (midnight), before the 02:00–05:00
// housekeeping crons, so the purges do not queue up behind each other.
//
// IT NEVER THROWS. `enqueueHousekeepingJob` swallows its own errors; the
// settings read is wrapped here too, as `job-history-purge.task.ts` does,
// because a throw out of a `@Cron` is an unhandled rejection.
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { SystemSettingsService } from '../../settings/index';
import type { JobsPrisma } from '../data/jobs-db';
import { enqueueHousekeepingJob } from '../housekeeping.enqueue';
import { JobsService } from '../jobs.service';
import { RetentionPurgeRegistry } from './retention-purge.registry';

/**
 * The nightly retention scheduler: for each ENABLED `retention.*` policy whose
 * purge handler is mounted, enqueues one global purge job. It deletes nothing.
 *
 * @stability experimental
 */
@Injectable()
export class RetentionPurgeTask {
  private readonly logger = new Logger(RetentionPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: JobsPrisma,
    private readonly systemSettings: SystemSettingsService,
    private readonly purges: RetentionPurgeRegistry,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron(): Promise<void> {
    try {
      const policy = await this.systemSettings.getRetentionPolicy();

      for (const purge of this.purges.list()) {
        if (!policy[purge.policy].enabled) {
          this.logger.debug(
            `Retention for ${purge.policy} is disabled (retention.${purge.policy}.enabled); nothing queued`,
          );
          continue;
        }

        await enqueueHousekeepingJob({
          jobs: this.jobs,
          prisma: this.prisma,
          logger: this.logger,
          type: purge.type,
          what: purge.what,
        });
      }
    } catch (error) {
      // SWALLOWED — tomorrow's tick would have run anyway.
      this.logger.error(
        `Could not queue the retention purges: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

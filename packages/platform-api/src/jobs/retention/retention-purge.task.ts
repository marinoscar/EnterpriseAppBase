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
// its own entry in `RetentionPurgeRegistry` (#898), or, for a policy an app
// added with `registerRetentionPolicy`, simply mounts a handler of the type the
// policy names. Either way the scheduler enqueues the purges whose handler is
// mounted, and nothing for a slice the app left out.
//
// One job per table rather than one job for all of them: a row per policy in
// the admin job list, independent retries and independent failure — a failing
// audit purge must not hold up notification retention.
//
// 01:00: after `job.history.purge` (midnight), before the 02:00–05:00
// housekeeping crons, so the purges do not queue up behind each other.
//
// IT NEVER THROWS. `enqueueHousekeepingJob` swallows its own errors; the
// settings read is wrapped here too, as `job-history-purge.task.ts` does,
// because a throw out of a `@Cron` is an unhandled rejection.
// =============================================================================

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PLATFORM_PRISMA } from '../../core/index';
import { SystemSettingsService } from '../../settings/index';
import type { JobsPrisma } from '../data/jobs-db';
import { enqueueHousekeepingJob } from '../housekeeping.enqueue';
import { JobHandlerRegistry } from '../job-handler.registry';
import { JobsService } from '../jobs.service';
import { RetentionPurgeRegistry } from './retention-purge.registry';
import { retentionPolicyRegistry } from './retention-policy.registry';

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
    @Optional() private readonly handlers?: JobHandlerRegistry,
  ) {}

  /** The 01:00 tick: decide, then enqueue. Never throws. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron(): Promise<void> {
    try {
      const policy = (await this.systemSettings.getRetentionPolicy()) as Record<string, { enabled: boolean } | undefined>;

      for (const definition of retentionPolicyRegistry.list()) {
        // A purge is due only when its handler is mounted in this process: the
        // handler's own declaration wins, else the type the policy names.
        const purge =
          this.purges.get(definition.key) ??
          (this.handlers?.get(definition.purge.type)
            ? { policy: definition.key, type: definition.purge.type, what: definition.purge.what }
            : undefined);
        if (purge === undefined) continue;

        // A policy missing from the stored value (the settings read fills it
        // from its default, so this is a double check) is not due.
        if (!(policy[purge.policy]?.enabled ?? false)) {
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

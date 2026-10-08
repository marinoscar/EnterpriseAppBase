// =============================================================================
// Daily retention scheduler (#681, platform-packages PP-1.10)
// =============================================================================
//
// ⚠ THIS TASK DELETES NOTHING. For each ENABLED `retention.*` policy it
// enqueues one global purge job through the shared housekeeping helper, and
// the handler does the deleting on a worker slot. Pinned by
// `apps/api/test/conformance.spec.ts`, which needs no exemption for
// this file.
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

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AI_RUNS_PURGE_TYPE } from '@marinoscar/platform-api/ai';
import { enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { NOTIFICATION_DELIVERIES_PURGE_TYPE } from './notification-deliveries-purge.handler';
import { NOTIFICATION_INBOX_PURGE_TYPE } from './notification-inbox-purge.handler';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import type { RetentionPolicyKey } from '../schemas/settings.schema';
import { AUDIT_EVENTS_PURGE_TYPE } from './audit-events-purge.handler';

/**
 * Which job type enforces which `retention.*` policy, and what to call it in a
 * log line. The type strings are imported from the handlers, never re-typed.
 */
export const RETENTION_PURGES: ReadonlyArray<{
  policy: RetentionPolicyKey;
  type: string;
  what: string;
}> = [
  { policy: 'notifications', type: NOTIFICATION_INBOX_PURGE_TYPE, what: 'notification inbox purge' },
  {
    policy: 'notificationDeliveries',
    type: NOTIFICATION_DELIVERIES_PURGE_TYPE,
    what: 'delivery log purge',
  },
  { policy: 'auditEvents', type: AUDIT_EVENTS_PURGE_TYPE, what: 'audit log purge' },
  { policy: 'aiRuns', type: AI_RUNS_PURGE_TYPE, what: 'AI run purge' },
];

@Injectable()
export class RetentionPurgeTask {
  private readonly logger = new Logger(RetentionPurgeTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron(): Promise<void> {
    try {
      const policy = await this.systemSettings.getRetentionPolicy();

      for (const purge of RETENTION_PURGES) {
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

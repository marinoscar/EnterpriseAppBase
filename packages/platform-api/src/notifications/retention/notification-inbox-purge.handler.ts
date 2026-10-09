// =============================================================================
// `notifications.inbox.purge` job handler (#681, platform-packages PP-1.10; notifications slice since #898)
// =============================================================================
//
// Deletes `notifications` rows (the in-app inbox) created before
// `retention.notifications.days` ago (default 180), read or unread, in bounded
// batches. Enqueued once a day by `RetentionPurgeTask` (the jobs slice), which only enqueues
// (CLAUDE.md, "Every Long-Running Activity Is a Queue Job").
//
// A logged no-op while `retention.notifications.enabled` is false — checked
// here as well as in the task; see `runRetentionPolicyPurge`.
//
// SERVER-ONLY: no `nodeResultSchema`/`persistNodeResult`. The job is a
// sequence of database statements, so a worker node has nothing to compute.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import {
  JobHandlerRegistry,
  RetentionPurgeRegistry,
  runRetentionPolicyPurge,
  type Job,
  type JobExecutionProfile,
  type JobHandler,
} from '../../jobs/index';
import { SystemSettingsService } from '../../settings/index';
import type { NotificationsPrisma } from '../data/notifications-db';

/**
 * The job type. PERMANENT once rows of it exist.
 *
 * @stability experimental
 */
export const NOTIFICATION_INBOX_PURGE_TYPE = 'notifications.inbox.purge';

/**
 * Deletes `notifications` inbox rows past `retention.notifications.days`, in batches.
 *
 * @stability experimental
 */
@Injectable()
export class NotificationInboxPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(NotificationInboxPurgeHandler.name);

  readonly type = NOTIFICATION_INBOX_PURGE_TYPE;

  readonly label = 'Notification inbox purge';

  /** Deletes only; thirty minutes covers millions of rows. Retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: NotificationsPrisma,
    private readonly systemSettings: SystemSettingsService,
    private readonly retention: RetentionPurgeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.retention.register({ policy: 'notifications', type: this.type, what: 'notification inbox purge' });
  }

  /** Throws to fail (a database error), so the queue's retry applies. */
  async process(job: Job): Promise<void> {
    const { notifications: policy } = await this.systemSettings.getRetentionPolicy();

    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: 'retention.notifications',
      what: 'notification inbox purge',
      rows: 'notification(s)',
      selectIds: async (cutoff, take) => {
        const rows = await this.prisma.notification.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        });

        return rows.map((row) => row.id);
      },
      deleteIds: async (ids) =>
        (await this.prisma.notification.deleteMany({ where: { id: { in: ids } } })).count,
    });
  }
}

// =============================================================================
// `notifications.inbox.purge` job handler (#681, platform-packages PP-1.10)
// =============================================================================
//
// Deletes `notifications` rows (the in-app inbox) created before
// `retention.notifications.days` ago (default 180), read or unread, in bounded
// batches. Enqueued once a day by `RetentionPurgeTask`, which only enqueues
// (CLAUDE.md, "Every Long-Running Activity Is a Queue Job").
//
// A logged no-op while `retention.notifications.enabled` is false — checked
// here as well as in the task; see `runRetentionPolicyPurge`.
//
// SERVER-ONLY: no `nodeResultSchema`/`persistNodeResult`. The job is a
// sequence of database statements, so a worker node has nothing to compute.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from '@prisma/client';

import { runRetentionPolicyPurge } from '../../common/retention/batched-purge';
import { JobExecutionProfile } from '@marinoscar/platform-api/jobs';
import { JobHandler } from '@marinoscar/platform-api/jobs';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

/** The job type. PERMANENT once rows of it exist. */
export const NOTIFICATION_INBOX_PURGE_TYPE = 'notifications.inbox.purge';

@Injectable()
export class NotificationInboxPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(NotificationInboxPurgeHandler.name);

  readonly type = NOTIFICATION_INBOX_PURGE_TYPE;

  /** Deletes only; thirty minutes covers millions of rows. Retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
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

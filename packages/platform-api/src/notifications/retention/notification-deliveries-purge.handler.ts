// =============================================================================
// `notifications.deliveries.purge` job handler (#681, platform-packages PP-1.10; notifications slice since #898)
// =============================================================================
//
// Deletes `notification_deliveries` rows (the per-channel delivery log)
// created before `retention.notificationDeliveries.days` ago (default 90), in
// bounded batches. Enqueued once a day by `RetentionPurgeTask`, which only
// enqueues.
//
// SETTLED ROWS ONLY: `sent` and `failed`. A `queued` row is never deleted at
// any age — it is a delivery still in flight (or stuck, which an operator needs
// to see), the same rule `job-history-purge.handler.ts` applies to pending
// jobs.
//
// A logged no-op while `retention.notificationDeliveries.enabled` is false —
// checked here as well as in the task; see `runRetentionPolicyPurge`.
//
// SERVER-ONLY: no `nodeResultSchema`/`persistNodeResult`.
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
import type { NotificationDeliveryStatus, NotificationsPrisma } from '../data/notifications-db';

/**
 * The job type. PERMANENT once rows of it exist.
 *
 * @stability experimental
 */
export const NOTIFICATION_DELIVERIES_PURGE_TYPE = 'notifications.deliveries.purge';

/**
 * The statuses this purge may delete. `queued` is deliberately absent.
 *
 * @stability experimental
 */
export const PURGEABLE_DELIVERY_STATUSES: readonly NotificationDeliveryStatus[] = ['sent', 'failed'];

/**
 * Deletes settled `notification_deliveries` past `retention.notificationDeliveries.days`, in batches.
 *
 * @stability experimental
 */
@Injectable()
export class NotificationDeliveriesPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveriesPurgeHandler.name);

  readonly type = NOTIFICATION_DELIVERIES_PURGE_TYPE;

  readonly label = 'Delivery log purge';

  /** Deletes only; thirty minutes covers millions of rows. Retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: NotificationsPrisma,
    private readonly systemSettings: SystemSettingsService,
    private readonly retention: RetentionPurgeRegistry,
  ) {}

  /** Registers with the job registry and declares the retention policy. */
  onModuleInit(): void {
    this.registry.register(this);
    this.retention.register({ policy: 'notificationDeliveries', type: this.type, what: 'delivery log purge' });
  }

  /** Throws to fail (a database error), so the queue's retry applies. */
  async process(job: Job): Promise<void> {
    const { notificationDeliveries: policy } = await this.systemSettings.getRetentionPolicy();

    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: 'retention.notificationDeliveries',
      what: 'delivery log purge',
      rows: 'delivery record(s)',
      selectIds: async (cutoff, take) => {
        const rows = await this.prisma.notificationDelivery.findMany({
          where: {
            createdAt: { lt: cutoff },
            status: { in: [...PURGEABLE_DELIVERY_STATUSES] },
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        });

        return rows.map((row) => row.id);
      },
      // By the exact ids read. A settled delivery never returns to `queued`,
      // so the ids read are still settled when they are deleted.
      deleteIds: async (ids) =>
        (await this.prisma.notificationDelivery.deleteMany({ where: { id: { in: ids } } })).count,
    });
  }
}

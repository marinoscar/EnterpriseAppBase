// =============================================================================
// `audit.events.purge` job handler (#681, platform-packages PP-1.10)
// =============================================================================
//
// Deletes `audit_events` rows created before `retention.auditEvents.days` ago
// (default 365), in bounded batches, using the existing `created_at` index.
// Enqueued once a day by `RetentionPurgeTask`, which only enqueues.
//
// ⚠ OFF BY DEFAULT (`retention.auditEvents.enabled: false`). The audit trail
// is a compliance record, so deleting any of it is an explicit operator
// decision. While disabled this handler is a logged no-op — checked here as
// well as in the task, so an admin rerun of an old row cannot delete history
// an operator never agreed to delete; see `runRetentionPolicyPurge`.
//
// Provided by `RetentionModule` rather than a feature module: many modules
// WRITE audit events (`grep -rn "auditEvent.create" apps/api/src`), none owns
// the table.
//
// SERVER-ONLY: no `nodeResultSchema`/`persistNodeResult`.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from '@prisma/client';

import { JobExecutionProfile } from '../../jobs/job-execution-profile';
import { JobHandler } from '../../jobs/job-handler.interface';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { runRetentionPolicyPurge } from './batched-purge';

/** The job type. PERMANENT once rows of it exist. */
export const AUDIT_EVENTS_PURGE_TYPE = 'audit.events.purge';

@Injectable()
export class AuditEventsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AuditEventsPurgeHandler.name);

  readonly type = AUDIT_EVENTS_PURGE_TYPE;

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
    const { auditEvents: policy } = await this.systemSettings.getRetentionPolicy();

    await runRetentionPolicyPurge({
      job,
      logger: this.logger,
      policy,
      setting: 'retention.auditEvents',
      what: 'audit log purge',
      rows: 'audit event(s)',
      selectIds: async (cutoff, take) => {
        const rows = await this.prisma.auditEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take,
        });

        return rows.map((row) => row.id);
      },
      deleteIds: async (ids) =>
        (await this.prisma.auditEvent.deleteMany({ where: { id: { in: ids } } })).count,
    });
  }
}

// =============================================================================
// `audit.events.purge` job handler (#681, platform-packages PP-1.10; jobs slice since #898)
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
// Provided by `JobsModule` rather than a feature module: many slices WRITE
// audit events (identity, ai, notifications), and the table is the identity
// slice's, but identity cannot import jobs (the dependency graph runs the other
// way, `platform-slices.json`), so the purge lives with the retention engine
// that schedules it. It sees the table through the two-method structural view
// below, which any app's generated client satisfies as it is.
//
// SERVER-ONLY: no `nodeResultSchema`/`persistNodeResult`.
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import { SystemSettingsService } from '../../settings/index';
import type { Job } from '../data/jobs-db';
import type { JobExecutionProfile } from '../job-execution-profile';
import type { JobHandler } from '../job-handler.interface';
import { JobHandlerRegistry } from '../job-handler.registry';
import { runRetentionPolicyPurge } from './batched-purge';
import { RetentionPurgeRegistry } from './retention-purge.registry';

/**
 * The job type. PERMANENT once rows of it exist.
 *
 * @stability experimental
 */
export const AUDIT_EVENTS_PURGE_TYPE = 'audit.events.purge';

/**
 * The part of the database client this purge uses: `audit_events`, two calls.
 * Structural, so an app's generated client satisfies it unchanged.
 *
 * @stability experimental
 */
export interface AuditEventsPurgePrisma {
  /** `audit_events`. */
  auditEvent: {
    /** Prisma `findMany`. */
    findMany(args: any): Promise<Array<{ id: string }>>;
    /** Prisma `deleteMany`. */
    deleteMany(args: any): Promise<{ count: number }>;
  };
}

/**
 * Deletes `audit_events` past `retention.auditEvents.days`, in batches; a
 * logged no-op while the policy is off (the default).
 *
 * @stability experimental
 */
@Injectable()
export class AuditEventsPurgeHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AuditEventsPurgeHandler.name);

  readonly type = AUDIT_EVENTS_PURGE_TYPE;

  readonly label = 'Audit log purge';

  /** Deletes only; thirty minutes covers millions of rows. Retried like any housekeeping job. */
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 3 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(PLATFORM_PRISMA) private readonly prisma: AuditEventsPurgePrisma,
    private readonly systemSettings: SystemSettingsService,
    private readonly retention: RetentionPurgeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.retention.register({ policy: 'auditEvents', type: this.type, what: 'audit log purge' });
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

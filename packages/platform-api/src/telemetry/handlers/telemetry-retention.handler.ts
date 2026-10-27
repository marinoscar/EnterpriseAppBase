// =============================================================================
// `telemetry.retention.apply` job handler (issue #534, epic #528; PP-14.11)
// =============================================================================
//
// Makes the telemetry store's retention match `telemetry.retentionDays` through
// the store's retention control (`TelemetryStore.retention`). For the built-in
// GreptimeDB store that is
//
//     ALTER DATABASE <database> SET 'ttl'='<N>d'
//
// (`stores/greptime/greptime.retention.ts` owns the statement and its
// identifier rule). GreptimeDB enforces the TTL itself during compaction; this
// job only states the policy, it deletes nothing directly.
//
// IDEMPOTENT: setting the retention to the value it already has is a no-op, so
// a retry, a duplicate run, or the daily re-assertion (`TelemetryRetentionTask`)
// are all harmless. Enqueued by that cron and by every successful
// `PUT /api/admin/telemetry/config`.
//
// NOT GATED ON `telemetry.enabled`. Retention is a data-hygiene policy: a
// deployment that switched collection off still wants what it already
// collected to age out.
//
// A DEPLOYMENT WITHOUT A STORE (or whose store cannot change retention right
// now, e.g. the GreptimeDB admin credential is missing, or a store with no
// retention control) completes as a NO-OP with a log line rather than failing:
// that is a supported configuration, and failing would put a red row in the
// jobs dashboard every night for a feature the operator never deployed.
//
// SERVER-ONLY, PERMANENTLY: no `nodeResultSchema`/`persistNodeResult`. The
// built-in statement needs the GreptimeDB ADMIN credential — one able to change
// retention and drop telemetry — and a worker node must never hold it
// (CLAUDE.md, queue rule 3).
// =============================================================================

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { TELEMETRY_STORE, type TelemetryStore } from '../stores/telemetry-store';
import {
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_STORE,
  type TelemetryJobExecutionProfile,
  type TelemetryJobHandler,
  type TelemetryJobRecord as Job,
  type TelemetryJobsPort,
  type TelemetrySettingsStore,
} from '../ports';

/**
 * The job type. PERMANENT once rows of it exist.
 *
 * @stability stable
 */
export const TELEMETRY_RETENTION_TYPE = 'telemetry.retention.apply';

/** Client-side ceiling on the ALTER. It is a metadata change; seconds, not minutes. */
export const TELEMETRY_RETENTION_STATEMENT_TIMEOUT_MS = 30_000;

// The statement lives with the built-in store; re-exported for the callers
// (and the tests) that pinned its text here.
export { retentionStatement } from '../stores/greptime/greptime.retention';

@Injectable()
export class TelemetryRetentionHandler implements TelemetryJobHandler, OnModuleInit {
  private readonly logger = new Logger(TelemetryRetentionHandler.name);

  readonly type = TELEMETRY_RETENTION_TYPE;

  readonly label = 'Telemetry retention';

  /** One metadata statement; a minute is generous. Retried like any housekeeping job. */
  readonly profile: TelemetryJobExecutionProfile = { maxRuntimeMs: 60_000, maxAttempts: 3 };

  // Deliberately NO `nodeResultSchema` / `persistNodeResult` — see the header.

  constructor(
    @Inject(TELEMETRY_JOBS) private readonly jobs: TelemetryJobsPort,
    @Inject(TELEMETRY_SETTINGS_STORE) private readonly systemSettings: TelemetrySettingsStore,
    @Inject(TELEMETRY_STORE) private readonly store: TelemetryStore,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  /** Throws to fail (the store unreachable or refusing), so the queue's retry applies. */
  async process(job: Job): Promise<void> {
    if (!this.store.isConfigured()) {
      this.logger.log(
        `Telemetry retention skipped: no telemetry store is configured (see /admin/settings/telemetry) (job ${job.id})`,
      );
      return;
    }

    const retention = this.store.retention;

    if (!retention) {
      this.logger.log(
        `Telemetry retention skipped: the "${this.store.id}" store has no retention control (job ${job.id})`,
      );
      return;
    }

    if (!retention.isApplicable()) {
      this.logger.warn(
        'Telemetry retention skipped: the telemetry store cannot change retention right now ' +
          '(for GreptimeDB, the admin login is not configured: set it at /admin/settings/telemetry), ' +
          `so the database TTL cannot be changed (job ${job.id})`,
      );
      return;
    }

    const { retentionDays } = await this.systemSettings.getTelemetryPolicy();

    await retention.apply(retentionDays, { timeoutMs: TELEMETRY_RETENTION_STATEMENT_TIMEOUT_MS });

    this.logger.log(
      `Telemetry retention applied: database "${this.store.database}" retention is ${retentionDays} day(s) (job ${job.id})`,
    );
  }
}

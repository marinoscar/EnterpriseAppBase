// =============================================================================
// What the db-backup slice registers with the other registries (issue #740)
// =============================================================================
//
// Pure data, no side effect on import. Each list is the slice's own, declared
// beside the code that uses it, and the app registers it where its registry
// lives:
//
//   - DB_BACKUP_APP_METRICS        -> the otel-core metric-name registry
//                                     (`registerAppMetrics`, #700), spliced
//                                     into the app's platform list at its
//                                     historical position;
//   - DB_BACKUP_NOTIFICATION_EVENTS -> the app's notification registry (the
//                                     event definitions and browser templates
//                                     stay app-side until the notifications
//                                     slice, #738, packages the registry);
//   - DB_BACKUP_EMAIL_TEMPLATES    -> the email slice's template registry,
//                                     which already ships both templates;
//   - DB_BACKUP_JOB_TYPES          -> the jobs slice's handler registry, which
//                                     each handler joins on `onModuleInit`
//                                     (with its own `label`).
//
// The key-prefix registration is `db-backup-key-prefix.ts`; the permissions
// `db-backup.permissions.ts`; the settings namespace
// `db-backup.system-settings.ts`.
// =============================================================================

import type { AppMetricAttribute, AppMetricDef } from '../otel-core/index';

const outcome: AppMetricAttribute = { kind: 'enum', values: ['completed', 'failed'] };

/**
 * One backup instrument's declaration: an {@link AppMetricDef} whose `key` is
 * a literal, so the app's metric-key union keeps every backup key.
 *
 * @typeParam Key - the metric's code key.
 * @stability stable
 */
export interface DbBackupAppMetricDef<Key extends string> extends AppMetricDef {
  /** The metric's code key. */
  readonly key: Key;
}

/**
 * The `app.backup.*` instruments, exactly as the reference app exported them
 * before the move (a name or unit is a GreptimeDB table name: changing one
 * orphans every dashboard query that reads it). The duration buckets are in
 * seconds, the size buckets in bytes.
 *
 * @example
 * ```ts
 * registerAppMetrics([...JOBS_METRICS, ...DB_BACKUP_APP_METRICS, ...AUTH_METRICS]);
 * ```
 *
 * @stability stable
 */
export const DB_BACKUP_APP_METRICS: readonly [
  DbBackupAppMetricDef<'backupRuns'>,
  DbBackupAppMetricDef<'backupDuration'>,
  DbBackupAppMetricDef<'backupSize'>,
  DbBackupAppMetricDef<'backupLastSuccessTimestamp'>,
  DbBackupAppMetricDef<'backupLastSuccessSize'>,
] = [
  {
    key: 'backupRuns',
    name: 'app.backup.runs',
    kind: 'counter',
    unit: '{run}',
    description: 'Database backup runs settled, by outcome.',
    attributes: { outcome },
  },
  {
    key: 'backupDuration',
    name: 'app.backup.duration',
    kind: 'histogram',
    unit: 's',
    description: 'Wall time of a settled database backup run.',
    buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400],
    attributes: { outcome },
  },
  {
    key: 'backupSize',
    name: 'app.backup.size',
    kind: 'histogram',
    unit: 'By',
    description: 'Size of a completed, verified database backup archive.',
    buckets: [1e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10, 5e10, 1e11],
    attributes: { outcome },
  },
  {
    key: 'backupLastSuccessTimestamp',
    name: 'app.backup.last_success.timestamp',
    kind: 'gauge',
    unit: 's',
    description: 'When the most recent completed database backup finished (unix seconds).',
  },
  {
    key: 'backupLastSuccessSize',
    name: 'app.backup.last_success.size',
    kind: 'gauge',
    unit: 'By',
    description: 'Size of the most recent completed database backup archive.',
  },
];

/**
 * The notification event keys the slice raises. Persisted (preferences,
 * delivery rows): never rename one. `db_backup.restore_completed` is
 * mandatory (cannot be turned off).
 *
 * @stability stable
 */
export const DB_BACKUP_NOTIFICATION_EVENTS = Object.freeze({
  /** A backup run failed or went stale. */
  BACKUP_FAILED: 'db_backup.backup_failed',
  /** A restore swapped the restored copy in. */
  RESTORE_COMPLETED: 'db_backup.restore_completed',
} as const);

/**
 * The email templates those events render (shipped by the email slice's
 * template registry).
 *
 * @stability stable
 */
export const DB_BACKUP_EMAIL_TEMPLATES = Object.freeze({
  /** For `db_backup.backup_failed`. */
  BACKUP_FAILED: 'backup-failed',
  /** For `db_backup.restore_completed`. */
  RESTORE_COMPLETED: 'restore-completed',
} as const);

/**
 * The four job types the slice registers. PERMANENT once jobs of a type exist
 * (`apps/api/test/jobs/job-type-snapshot.spec.ts` pins them). `db.backup.run`
 * is node-eligible (profile `{ maxRuntimeMs: 6 h, maxAttempts: 1 }`, its
 * credential brokered per job); `db.restore.run` is server-only, permanently.
 *
 * @stability stable
 */
export const DB_BACKUP_JOB_TYPES = Object.freeze({
  /** The dump. */
  BACKUP_RUN: 'db.backup.run',
  /** Stale-run release and retention, enqueued by the schedule tick. */
  BACKUP_SWEEP: 'db.backup.sweep',
  /** The restore. Server-only. */
  RESTORE_RUN: 'db.restore.run',
  /** Drops retained `<live>_old_<ts>` databases past their window. */
  RESTORE_OLD_DB_DROP: 'db.restore.old-db-drop',
} as const);

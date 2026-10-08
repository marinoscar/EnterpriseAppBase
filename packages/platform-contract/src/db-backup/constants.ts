// =============================================================================
// Database backup and restore: plain values of the slice's wire shapes
// (issue #740, PP-8.7)
// =============================================================================
//
// Zod-free, so a consumer that needs only a status list or a confirmation word
// (the web app) never bundles the schemas or zod. Moved from the API's
// `db-backup/dto/*.dto.ts`, `db-backup/restore-preflight.service.ts` and
// `common/schemas/settings.schema.ts` with their comments; the API re-exports
// them.
// =============================================================================

/**
 * The five `DatabaseBackupStatus` values, as a tuple Zod can build an enum
 * from.
 *
 * A hand-copied list guarded in BOTH directions, exactly as
 * `jobs/dto/job-response.dto.ts` guards its own: `satisfies` catches a value
 * listed here that the schema does not have, and `BackupStatusesAreExhaustive` (in the API)
 * catches a value the schema has that this file forgot — the direction that
 * would otherwise fail silently, publishing a filter enum that cannot express a
 * real row's status.
 *
 * @stability stable
 */
export const BACKUP_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'stale',
] as const;

/**
 * One {@link BACKUP_STATUSES} value.
 *
 * @stability stable
 */
export type BackupStatusName = (typeof BACKUP_STATUSES)[number];

/**
 * The three `DatabaseBackupTrigger` values, with the same two guards.
 *
 * @stability stable
 */
export const BACKUP_TRIGGERS = [
  'manual',
  'scheduled',
  'pre_restore',
] as const;

/**
 * One {@link BACKUP_TRIGGERS} value.
 *
 * @stability stable
 */
export type BackupTriggerName = (typeof BACKUP_TRIGGERS)[number];

/**
 * The six values `database_backup_runs.restore_status` can hold.
 *
 * ⚠ NO `satisfies` GUARD IS POSSIBLE HERE, and that is a property of the
 * column rather than an oversight: `restore_status` is a plain `text` in
 * `schema.prisma`, not a Postgres enum, precisely so that adding `rolled_back`
 * cost no migration. There is therefore no generated union for the compiler to
 * check this tuple against.
 *
 * Re-derived rather than imported from `database-restore.service.ts` so that a
 * DTO file does not depend on a service — the same discipline
 * {@link ACTIVE_BACKUP_STATUSES} follows — and `db-backup-restore.dto.spec.ts`
 * asserts the two lists agree, so they cannot drift apart in silence.
 *
 * @stability stable
 */
export const RESTORE_STATUSES = [
  'restoring',
  'verifying',
  'swapping',
  'completed',
  'failed',
  'rolled_back',
] as const;

/**
 * One {@link RESTORE_STATUSES} value.
 *
 * @stability stable
 */
export type RestoreStatusName = (typeof RESTORE_STATUSES)[number];

/**
 * The statuses that hold the single-active-run slot.
 *
 * Re-derived from {@link BACKUP_STATUSES} rather than imported from
 * `db-backup-runner.service.ts` so that a DTO file does not depend on a service
 * — but it is the same pair, and `db-backup-admin.service.spec.ts` asserts the
 * two lists agree, so they cannot drift apart in silence.
 *
 * @stability stable
 */
export const ACTIVE_BACKUP_STATUSES = ['pending', 'running'] as const satisfies readonly BackupStatusName[];

/**
 * The two outcomes `CancelBackupResultDto` can report.
 *
 * Mirrors `CancelBackupResult` in `db-backup-runner.service.ts` one-for-one and
 * on purpose: this is that type on the wire, not a summary of it.
 *
 * @stability stable
 */
export const CANCEL_OUTCOMES = ['signalled', 'not_running_here'] as const;

/**
 * The two normal answers. There is deliberately no third, and no error one.
 *
 * @stability stable
 */
export const NODE_CREDENTIAL_PREFLIGHT_OUTCOMES = ['ok', 'guided'] as const;

/**
 * Why `restore.available` is false. One today; the enum is the contract.
 *
 * @stability stable
 */
export const RESTORE_UNAVAILABLE_REASONS = ['deployment_mode_saas'] as const;

/**
 * The word `POST runs/:id/restore` requires. See this file's header.
 *
 * @stability stable
 */
export const RESTORE_CONFIRMATION = 'RESTORE';

/**
 * The word `POST runs/:id/rollback` requires. Deliberately not the same word.
 *
 * @stability stable
 */
export const ROLLBACK_CONFIRMATION = 'ROLLBACK';

/**
 * The three normal answers. `mode`, not the status code, is the discriminator.
 *
 * @stability stable
 */
export const RESTORE_MODES = ['running', 'guided', 'blocked'] as const;

/**
 * One {@link RESTORE_MODES} value.
 *
 * @stability stable
 */
export type RestoreMode = (typeof RESTORE_MODES)[number];

/**
 * The three normal answers.
 *
 * Mirrors `RestoreRollbackResult` in `database-restore.service.ts` one-for-one
 * and on purpose: this is that type on the wire, not a summary of it — the same
 * discipline `CANCEL_OUTCOMES` follows.
 *
 * @stability stable
 */
export const ROLLBACK_MODES = ['renamed', 'restore_started', 'unavailable'] as const;

/**
 * One {@link ROLLBACK_MODES} value.
 *
 * @stability stable
 */
export type RollbackMode = (typeof ROLLBACK_MODES)[number];

/**
 * The name of the `POST runs/:id/restore` body field that overrides the
 * `schema_compatibility` gate.
 *
 * ⚠ IT IS THE API'S FIELD NAME, NOT THE PRE-FLIGHT SERVICE'S OPTION NAME, and
 * the difference is the whole point. A `blocked` restore's `overrideParameter`
 * exists to tell a CLIENT which field to set on its next request, so publishing
 * the internal option name (`overrideSchemaMismatch`) would hand an operator a
 * parameter the endpoint rejects.
 *
 * The API's restore DTO ties its own schema to it at compile time
 * (`RestoreOverrideFieldIsReal`) and at run time in its spec.
 *
 * @stability stable
 */
export const RESTORE_SCHEMA_OVERRIDE_FIELD = 'overrideSchemaCheck';

/**
 * The restore pre-flight's gates, in the order they are evaluated and reported.
 *
 * @stability stable
 */
export const RESTORE_GATE_IDS = [
  'pg_client_version',
  'admin_connection',
  'createdb_privilege',
  'extensions',
  'disk_space',
  'replicas',
  'schema_compatibility',
] as const;

/**
 * One {@link RESTORE_GATE_IDS} value.
 *
 * @stability stable
 */
export type RestoreGateId = (typeof RESTORE_GATE_IDS)[number];

/**
 * `databaseBackup.timeOfDay`: 24-hour `HH:MM`, zero-padded.
 *
 * A string rather than two numbers because it is one field on one form and one
 * value in one cron-ish schedule; the regex is what stops `"2:00"`, `"25:00"`
 * and `"02:60"` from reaching a scheduler that would have to guess.
 *
 * @stability stable
 */
export const BACKUP_TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * How often a scheduled backup runs (`databaseBackup.frequency`).
 *
 * @stability stable
 */
export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

/**
 * What a restore does with the database it displaced
 * (`databaseBackup.restoreRollbackMode`).
 *
 * @stability stable
 */
export const RESTORE_ROLLBACK_MODES = ['retain_database', 'drop_database'] as const;

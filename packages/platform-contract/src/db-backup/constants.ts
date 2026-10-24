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
 * `ACTIVE_BACKUP_STATUSES` follows — and `db-backup-restore.dto.spec.ts`
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
 * The restore pre-flight's BUILT-IN gates, in the order they are evaluated and
 * reported. `rls_bypass` (#740) reports how the restore session gets past
 * row-level security, on pass as well as on failure.
 *
 * Not a closed list of every gate: an app registers its own with
 * `registerRestoreGate` (`@marinoscar/platform-api/db-backup`), which run after
 * these and report under their own ids (see `restoreGateIdSchema`). This
 * list names the eight the platform ships, for labels and defaults.
 *
 * @stability stable
 */
export const BUILTIN_RESTORE_GATE_IDS = [
  'pg_client_version',
  'admin_connection',
  'createdb_privilege',
  'extensions',
  'rls_bypass',
  'disk_space',
  'replicas',
  'schema_compatibility',
] as const;

/**
 * The same eight ids under their former name.
 *
 * @deprecated Renamed {@link BUILTIN_RESTORE_GATE_IDS}: the gate id is an open
 * vocabulary now, so this is no longer "every gate id". Kept as an alias for
 * one release.
 * @stability stable
 */
export const RESTORE_GATE_IDS = BUILTIN_RESTORE_GATE_IDS;

/**
 * One built-in restore gate id.
 *
 * @stability stable
 */
export type BuiltinRestoreGateId = (typeof BUILTIN_RESTORE_GATE_IDS)[number];

/**
 * A restore gate id: one of the built-ins, or an id an app registered.
 * Widened to `string` (an open vocabulary); narrow with
 * {@link BuiltinRestoreGateId} where only the platform's own gates matter.
 *
 * @stability stable
 */
export type RestoreGateId = BuiltinRestoreGateId | (string & {});

/**
 * The shape of a restore gate id: lowercase letters, digits, `_` and `-`,
 * starting with a letter. Every built-in id matches, and so does an app's
 * `cdn-quiesced`.
 *
 * @stability experimental
 */
export const RESTORE_GATE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

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
export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly', 'cron'] as const;

/**
 * The shortest gap, in minutes, a `frequency: 'cron'` expression may leave
 * between two fires (one hour). The scheduler ticks every ten minutes and a
 * dump is a whole-database read, so a finer cadence would stack dumps rather
 * than protect anything.
 *
 * @stability experimental
 */
export const BACKUP_CRON_MIN_INTERVAL_MINUTES = 60;

/**
 * The characters a `cron` expression may contain: digits, `*`, `/`, `,`, `-`
 * and spaces. A shape check only; the API validates the expression with the
 * scheduler's own parser (and the minimum interval) when it is written.
 *
 * @stability experimental
 */
export const BACKUP_CRON_PATTERN = /^[0-9*/,\-\s]+$/;

/**
 * What a restore does with the database it displaced
 * (`databaseBackup.restoreRollbackMode`).
 *
 * @stability stable
 */
export const RESTORE_ROLLBACK_MODES = ['retain_database', 'drop_database'] as const;

/**
 * The entries of a zod enum built from a value list (`{ manual: 'manual', ... }`):
 * the schemas cast `z.enum(list)` to `z.ZodEnum<DbBackupEnum<typeof list>>`
 * so the declarations name the list instead of spelling every entry.
 *
 * @typeParam T - the value list.
 *
 * @stability experimental
 */
export type DbBackupEnum<T extends readonly string[]> = { [K in T[number]]: K };

/**
 * The event emitted once a backup run settles (`completed`, `failed`,
 * `stale`), after the row is written and outside any transaction. The payload
 * is {@link DbBackupRunCompletedEvent}. Permanent: a listener subscribes by
 * this string.
 *
 * @extensionPoint event
 * @stability experimental
 */
export const DB_BACKUP_RUN_COMPLETED_EVENT = 'db_backup.run.completed';

/**
 * The event emitted once a restore settles (`completed` after the swap,
 * `failed`), after the audit write and outside any transaction. The payload is
 * {@link DbBackupRestoreCompletedEvent}. Permanent.
 *
 * @extensionPoint event
 * @stability experimental
 */
export const DB_BACKUP_RESTORE_COMPLETED_EVENT = 'db_backup.restore.completed';

/**
 * What `db_backup.run.completed` carries. JSON-safe (it also travels the
 * cross-replica event bus), and free of secrets.
 *
 * @stability experimental
 */
export interface DbBackupRunCompletedEvent {
  /** The `database_backup_runs` row. */
  runId: string;
  /** How the run ended: `completed`, `failed` or `stale`. */
  status: BackupStatusName;
  /** The id of the target the archive was written to (the run's `storageProvider`). */
  targetId: string;
  /** The archive's size in bytes (`0` when none was written). A JSON number: exact up to 2^53. */
  sizeBytes: number;
  /** Wall-clock milliseconds from start to settle (`0` when the run never started). */
  durationMs: number;
}

/**
 * What `db_backup.restore.completed` carries: the same shape as
 * {@link DbBackupRunCompletedEvent}, for the restore of the archive `runId`.
 * `status` is `completed` or `failed`; `sizeBytes` is the archive's size and
 * `durationMs` the restore's own duration.
 *
 * @stability experimental
 */
export interface DbBackupRestoreCompletedEvent {
  /** The backup run whose archive was restored. */
  runId: string;
  /** `completed` (the swap landed) or `failed`. */
  status: 'completed' | 'failed';
  /** The id of the target the archive was read from. */
  targetId: string;
  /** The archive's size in bytes. */
  sizeBytes: number;
  /** Milliseconds from the restore's start to its end. */
  durationMs: number;
}

/**
 * How one mirror target fared for one run (the `meta` of its
 * `db_backup.mirror.*` audit row, and what the `backup.mirrors` Doctor check
 * reads).
 *
 * @stability experimental
 */
export interface BackupMirrorResult {
  /** The mirror target's id. */
  targetId: string;
  /** `ok` when the copy landed and was read back; `failed` otherwise. */
  status: 'ok' | 'failed';
  /** Bytes written to the mirror (`0` on failure). */
  sizeBytes: number;
  /** Why it failed; absent on success. Never carries a credential. */
  error?: string;
}

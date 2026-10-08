// `@marinoscar/platform-api/db-backup`: the database backup and restore slice
// (issue #740, PP-8.7; engine #280-#288, epic #254; node offload #350-#353,
// epic #345; row-level security #725; deployment mode #685). The streaming
// `pg_dump` into object storage, the schedule and retention, the restore
// (pre-flight, swap, rollback) and its carry-over registry, the four job
// types, the `/api/admin/db-backup` routes, the job-scoped database role
// broker and three Doctor checks. Documented in ./README.md. Explicit named
// exports only; anything not listed here is internal.

// ---- the module and its options (rung 1) -----------------------------------------------
export { DbBackupModule } from './db-backup.module';
export {
  DB_BACKUP_OPTIONS,
  DEFAULT_DB_BACKUP_APP_NAME,
  defaultAppVersion,
  resolveDbBackupModuleOptions,
  resolveRestoreEnabled,
} from './options';
export type { DbBackupModuleOptions, ResolvedDbBackupModuleOptions } from './options';
export { DbBackupRestoreGate, restoreGateFor } from './restore-gate';

// ---- host ports (rung 3) ---------------------------------------------------------------
export {
  DB_BACKUP_DEPLOYMENT_MODE,
  DB_BACKUP_MAINTENANCE,
  DB_BACKUP_METRICS,
  DB_BACKUP_NOTIFIER,
  DB_BACKUP_SYSTEM_DATA,
  NOOP_DB_BACKUP_METRICS,
} from './ports';
export type {
  DbBackupDeploymentMode,
  DbBackupMaintenance,
  DbBackupMaintenanceOverride,
  DbBackupMetrics,
  DbBackupNotifier,
  DbBackupNotifyOptions,
  DbBackupSystemData,
  DbBackupSystemTx,
} from './ports';

// ---- the restore carry-over registry (rung 2) -------------------------------------------
export { registerRestoreCarryOver, registerRestoreCarryOvers, restoreCarryOverRegistry } from './carry-over.registry';
export type { RestoreCarryOver } from './carry-over.registry';

// ---- data -------------------------------------------------------------------------------
export { DatabaseBackupStatus, DatabaseBackupTrigger } from './data/db-backup-db';
export type {
  DatabaseBackupRun,
  DatabaseBackupRunCreateData,
  DatabaseBackupRunDelegate,
  DatabaseBackupRunUpdateData,
  DatabaseBackupRunWhere,
  DbBackupPrisma,
  DbBackupTx,
  DbBackupUserRow,
} from './data/db-backup-db';

// ---- registrations the app makes ----------------------------------------------------------
export { DB_BACKUP_PERMISSIONS } from './db-backup.permissions';
export type { DbBackupPermissionDeclaration } from './db-backup.permissions';
export { DATABASE_BACKUP_SYSTEM_SETTINGS, mergeDatabaseBackupSettings } from './db-backup.system-settings';
export { DATABASE_BACKUPS_KEY_PREFIX, DB_BACKUP_KEY_PREFIX, registerDbBackupKeyPrefix } from './db-backup-key-prefix';
export {
  DB_BACKUP_APP_METRICS,
  DB_BACKUP_EMAIL_TEMPLATES,
  DB_BACKUP_NOTIFICATION_EVENTS,
  DB_BACKUP_JOB_TYPES,
} from './db-backup.registrations';
export type { DbBackupAppMetricDef } from './db-backup.registrations';

// ---- the services an app may drive ----------------------------------------------------
export { DatabaseBackupRunnerService, BACKUP_JOB_TYPE } from './db-backup-runner.service';
export { DatabaseBackupRetentionService } from './db-backup-retention.service';
export { DB_RESTORE_RUN_TYPE } from './database-restore.service';
export { DB_BACKUP_SWEEP_TYPE } from './handlers/db-backup-sweep.handler';
export { DB_RESTORE_OLD_DB_DROP_TYPE } from './handlers/db-restore-old-db-drop.handler';

// ---- errors ----------------------------------------------------------------------------
export {
  DatabaseBackupAlreadyRunningError,
  DatabaseBackupCancelledError,
  DatabaseBackupClientVersionError,
  DatabaseBackupStorageProviderError,
  DatabaseBackupVerificationError,
  DatabaseRestoreArchiveError,
  DatabaseRestoreDisabledError,
  DatabaseRestoreNotAllowedError,
  DatabaseRestoreRunNotFoundError,
  DatabaseRestoreSwapError,
  DatabaseRestoreVerificationError,
} from './db-backup.errors';

// ---- the row-level-security pair of every dump and restore (#725) -------------------------
export { RLS_BYPASS_PGOPTIONS, rlsBypassEnv } from './pg-dump.util';

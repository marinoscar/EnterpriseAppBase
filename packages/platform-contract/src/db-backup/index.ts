// `@marinoscar/platform-contract/db-backup`: the database backup and restore
// slice's wire shapes, shared by `@marinoscar/platform-api/db-backup` (its DTOs
// wrap these schemas) and `@marinoscar/platform-web/db-backup` (types) (issue
// #740, PP-8.7): the admin routes under `/api/admin/db-backup`, the
// `databaseBackup` system-settings namespace and the `db.backup.run` node
// result. Documented in ./README.md. Explicit named exports only.
// constants.ts is zod-free.

export {
  ACTIVE_BACKUP_STATUSES,
  BACKUP_FREQUENCIES,
  BACKUP_STATUSES,
  BACKUP_TIME_OF_DAY_PATTERN,
  BACKUP_TRIGGERS,
  CANCEL_OUTCOMES,
  NODE_CREDENTIAL_PREFLIGHT_OUTCOMES,
  RESTORE_CONFIRMATION,
  RESTORE_GATE_IDS,
  RESTORE_MODES,
  RESTORE_ROLLBACK_MODES,
  RESTORE_SCHEMA_OVERRIDE_FIELD,
  RESTORE_STATUSES,
  RESTORE_UNAVAILABLE_REASONS,
  ROLLBACK_CONFIRMATION,
  ROLLBACK_MODES,
} from './constants.js';
export type { BackupStatusName, BackupTriggerName, DbBackupEnum, RestoreGateId, RestoreMode, RestoreStatusName, RollbackMode } from './constants.js';

// ---- ./settings-schemas.ts
export { databaseBackupResponseSchema, databaseBackupSettingsPatchSchema, databaseBackupSettingsSchema, systemDatabaseBackupPatchSchema, systemDatabaseBackupSchema } from './schemas.js';
export type { DatabaseBackupSettingsPatchInput, SystemDatabaseBackupValue } from './schemas.js';

// ---- ./config.ts
export { databaseBackupConfigSchema, updateDatabaseBackupConfigSchema } from './schemas.js';
export type { DatabaseBackupConfigResponse, UpdateDatabaseBackupConfig } from './schemas.js';

// ---- ./runs.ts
export { backupRunSchema } from './schemas.js';
export type { BackupRunResponse } from './schemas.js';

// ---- ./runs-list-query.ts
export { backupRunListQuerySchema } from './schemas.js';
export type { BackupRunListQuery } from './schemas.js';

// ---- ./run-actions.ts
export { backupDownloadUrlSchema, cancelBackupResultSchema, deleteBackupResultSchema } from './schemas.js';
export type { BackupDownloadUrl, CancelBackupResult, DeleteBackupResult } from './schemas.js';

// ---- ./restore.ts
export { restoreGateSchema, restorePreflightSchema, restoreRollbackPlanSchema, rollbackRenamedSchema, rollbackRestoreRequestSchema, rollbackRestoreResponseSchema, rollbackRestoreStartedSchema, rollbackUnavailableSchema, startRestoreBlockedSchema, startRestoreGuidedSchema, startRestoreRequestSchema, startRestoreResponseSchema, startRestoreRunningSchema } from './schemas.js';
export type { RestorePreflightView, RollbackRestoreRequest, RollbackRestoreResponse, StartRestoreRequest, StartRestoreResponse } from './schemas.js';

// ---- ./node-credential.ts
export { guidedJobRoleInstructionsSchema, nodeCredentialPreflightSchema } from './schemas.js';
export type { NodeCredentialPreflight } from './schemas.js';

// ---- ./node-result.ts
export { dbBackupRunResultSchema } from './schemas.js';
export type { DbBackupRunResult } from './schemas.js';

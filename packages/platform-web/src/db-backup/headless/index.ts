// `@marinoscar/platform-web/db-backup/headless`: the db-backup slice's client
// and hooks, with no component (issue #740, PP-8.7): `createDbBackupApi` over
// the platform host's transport, the wire types, the predicates the page's
// actions share with the API's refusals, and `useDbBackupConfig`,
// `useDbBackupRuns` and `useDbBackupActions`. Documented in ../README.md.

export {
  DB_BACKUP_FREQUENCIES,
  DB_BACKUP_RUN_STATUSES,
  DB_BACKUP_TRIGGERS,
  OVERRIDE_SCHEMA_CHECK_PARAMETER,
  RESTORE_CONFIRMATION,
  RESTORE_GATE_IDS,
  RESTORE_ROLLBACK_MODES,
  RESTORE_STATUSES,
  ROLLBACK_CONFIRMATION,
  createDbBackupApi,
  isBackupCancelable,
  isBackupDeletable,
  isBackupDownloadable,
  isBackupRestorable,
  isBackupRunActive,
  isRestoreInFlight,
  isRollbackAvailable,
  parseByteCount,
} from './db-backup-client.js';
/** @stability experimental */
export type {
  BackupDownloadUrl,
  CancelBackupResult,
  DbBackupApi,
  DbBackupConfig,
  DbBackupFrequency,
  DbBackupRestoreAvailability,
  DbBackupRestoreUnavailableReason,
  DbBackupRun,
  DbBackupRunListParams,
  DbBackupRunListResponse,
  DbBackupRunStatus,
  DbBackupTrigger,
  DeleteBackupResult,
  EffectiveRollbackMode,
  GuidedRestoreInstructions,
  RestoreBlock,
  RestoreGate,
  RestoreGateId,
  RestoreGateKind,
  RestoreGateVerdict,
  RestorePreflight,
  RestoreRollbackMode,
  RestoreRollbackPlan,
  RestoreStatus,
  RollbackRestoreResult,
  StartRestoreResult,
  UpdateDbBackupConfigInput,
} from './db-backup-client.js';
export {
  DB_BACKUP_POLL_INTERVAL_MS,
  useDbBackupActions,
  useDbBackupApi,
  useDbBackupConfig,
  useDbBackupRuns,
  useVisiblePolling,
} from './use-db-backup.js';
/** @stability experimental */
export type {
  UseDbBackupActionsResult,
  UseDbBackupConfigResult,
  UseDbBackupOptions,
  UseDbBackupRunsResult,
} from './use-db-backup.js';

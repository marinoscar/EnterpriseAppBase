// `@marinoscar/platform-api/db-backup/testing`: the db-backup slice's test
// seams (issue #740): the conformance suite (importing this entry registers it
// with `runPlatformConformance`) and the engine's internals the reference
// app's integration and real-database suites drive directly (the services,
// the handlers, the cluster utilities and the deliberately UNBOUND seams).
// Never import it from production code: binding a seam in production is the
// danger `db-backup.module.ts`'s header describes. Documented in ../README.md.

// ---- the conformance suite ---------------------------------------------------------------
export {
  checkBackupKeyPrefix,
  checkCarryOvers,
  checkJobTypes,
  checkRlsPair,
  checkSystemScopePermissions,
  dbBackupConformanceSuite,
} from './conformance';
/** @stability experimental */
export type { DbBackupConformanceOptions } from './conformance';

// ---- services, handlers and the controller ------------------------------------------------
export { DatabaseBackupAdminService, BACKUP_DOWNLOAD_URL_EXPIRY_SECONDS } from '../db-backup-admin.service';
/** @stability experimental */
export type { BackupRunListResult } from '../db-backup-admin.service';
export { DatabaseBackupController } from '../db-backup.controller';
export {
  ACTIVE_RUN_INDEX_NAME,
  DB_BACKUP_ENGINE,
  DB_BACKUP_TIMERS,
  systemBackupTimers,
  systemDatabaseBackupEngine,
} from '../db-backup-runner.service';
/** @stability experimental */
export type { BackupTimers, DatabaseBackupEngine } from '../db-backup-runner.service';
export {
  DATABASE_RESTORE_SEAM,
  DatabaseRestoreService,
  defaultDatabaseRestoreSeam,
} from '../database-restore.service';
/** @stability experimental */
export type { DatabaseRestoreSeam, RestoreRollbackResult, StartRestoreOptions, StartRestoreResult } from '../database-restore.service';
export {
  DatabaseRestorePreflightService,
  RESTORE_PREFLIGHT_SEAM,
  RESTORE_SCHEMA_OVERRIDE_FIELD,
  defaultRestorePreflightSeam,
} from '../restore-preflight.service';
/** @stability experimental */
export type {
  EffectiveRollbackMode,
  GuidedRestoreInstructions,
  RestoreBlock,
  RestoreGateKind,
  RestoreGateResult,
  RestoreGateVerdict,
  RestorePreflightBase,
  RestorePreflightOptions,
  RestorePreflightResult,
  RestorePreflightSeam,
  RestoreRollbackPlan,
} from '../restore-preflight.service';
export { DatabaseBackupRunHandler } from '../handlers/db-backup-run.handler';
export { DatabaseRestoreRunHandler } from '../handlers/db-restore-run.handler';
export {
  NODE_JOB_SECRETS_RUNBOOK_PATH,
  PG_JOB_ROLE_KIND,
  PG_JOB_ROLE_SEAM,
  PgJobRoleBroker,
  generateRolePassword,
  jobRolePattern,
} from '../pg-job-role.broker';
/** @stability experimental */
export type { GuidedJobRoleInstructions, JobRolePreflightResult, PgJobRoleSeam } from '../pg-job-role.broker';
export { BACKUP_ARCHIVE_FORMAT, BACKUP_KEY_PREFIX } from '../db-backup-storage';
export { startRestoreRequestSchema, RollbackRestoreRequestDto, StartRestoreRequestDto } from '../dto/db-backup-restore.dto';
export { BackupRunListQueryDto } from '../dto/db-backup-list-query.dto';
export { UpdateDatabaseBackupConfigDto } from '../dto/db-backup-config.dto';

// ---- the cluster utilities (outside the Prisma pool, on the maintenance database) ----------
export {
  buildScratchDatabaseName,
  createDatabase,
  databaseExists,
  dropDatabase,
  quoteIdentifier,
  quoteLiteral,
  renameDatabase,
  resolveAdminConnection,
  withAdminConnection,
} from '../admin-connection.util';
export { InvalidSqlLiteralError } from '../admin-connection.util';
/** @stability experimental */
export type { AdminClientFactory, AdminConnection, AdminQueryClient, WithAdminConnectionOptions } from '../admin-connection.util';
export {
  PG_DUMP_COMMAND,
  buildPgDumpArgs,
  pgClientEnv,
  resolvePgConnection,
  spawnPgDump,
  spawnPgProcess,
} from '../pg-dump.util';
export { PgProcessError } from '../pg-dump.util';
/** @stability experimental */
export type { PgConnection, PgDumpArgsOptions, PgProcess, PgSpawnFn, SpawnPgDumpOptions, SpawnPgProcessOptions } from '../pg-dump.util';
export { readTocEntryCount, spawnPgRestore } from '../pg-restore.util';
/** @stability experimental */
export type { ReadTocEntryCountOptions, SpawnPgRestoreOptions } from '../pg-restore.util';
export { MIN_PG_CLIENT_MAJOR, checkPgClientVersion, readServerVersionNumWithPgClient } from '../pg-version.util';
/** @stability experimental */
export type {
  CheckPgClientVersionOptions,
  ClientVersionReader,
  PgClientFactory,
  PgQueryClient,
  PgVersionCheck,
  PgVersionStatus,
  ServerVersionNumReader,
} from '../pg-version.util';

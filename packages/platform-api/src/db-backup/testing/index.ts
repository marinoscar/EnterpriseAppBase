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
export type { DbBackupConformanceOptions } from './conformance';

// ---- services, handlers and the controller ------------------------------------------------
export { DatabaseBackupAdminService, BACKUP_DOWNLOAD_URL_EXPIRY_SECONDS } from '../db-backup-admin.service';
export { DatabaseBackupController } from '../db-backup.controller';
export {
  ACTIVE_RUN_INDEX_NAME,
  DB_BACKUP_ENGINE,
  DB_BACKUP_TIMERS,
  systemBackupTimers,
  systemDatabaseBackupEngine,
} from '../db-backup-runner.service';
export type { BackupTimers, DatabaseBackupEngine } from '../db-backup-runner.service';
export {
  DATABASE_RESTORE_SEAM,
  DatabaseRestoreService,
  defaultDatabaseRestoreSeam,
} from '../database-restore.service';
export type { DatabaseRestoreSeam } from '../database-restore.service';
export {
  DatabaseRestorePreflightService,
  RESTORE_PREFLIGHT_SEAM,
  RESTORE_SCHEMA_OVERRIDE_FIELD,
  defaultRestorePreflightSeam,
} from '../restore-preflight.service';
export type { RestorePreflightSeam } from '../restore-preflight.service';
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
export type { PgJobRoleSeam } from '../pg-job-role.broker';
export { BACKUP_ARCHIVE_FORMAT, BACKUP_KEY_PREFIX } from '../db-backup-storage';
export { startRestoreRequestSchema } from '../dto/db-backup-restore.dto';

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
export type { AdminConnection, AdminQueryClient } from '../admin-connection.util';
export {
  PG_DUMP_COMMAND,
  buildPgDumpArgs,
  pgClientEnv,
  resolvePgConnection,
  spawnPgDump,
  spawnPgProcess,
} from '../pg-dump.util';
export type { PgConnection, PgProcess, PgSpawnFn } from '../pg-dump.util';
export { readTocEntryCount, spawnPgRestore } from '../pg-restore.util';
export { MIN_PG_CLIENT_MAJOR, checkPgClientVersion, readServerVersionNumWithPgClient } from '../pg-version.util';

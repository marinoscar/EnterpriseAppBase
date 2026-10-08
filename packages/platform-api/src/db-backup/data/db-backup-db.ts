// =============================================================================
// The data the db-backup slice reads and writes, structurally (issue #740)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types (the
// rule of identity, settings, sharing, jobs and storage): the package is
// built, type-checked and tested before any app's `prisma generate`, and works
// with any app that composed the `db-backup` fragment of
// `@marinoscar/platform-db` (`DatabaseBackupRun`, `DatabaseBackupStatus`,
// `DatabaseBackupTrigger`) beside the jobs and identity fragments.
//
// ONE CLIENT, THE CORE PORT. `database_backup_runs`, `jobs`, `users` and
// `audit_events` carry no row-level security (a backup run is a deployment
// fact; `jobs` is org-optional without RLS, #734), so the slice reads and
// writes them through the core port `PLATFORM_PRISMA`, seen as
// {@link DbBackupPrisma}. The org-owned tables are reached only by `pg_dump`
// and `pg_restore` (with `--enable-row-security` and `app.rls_bypass=on`) and
// by the Doctor's `backup.rls-bypass` check, through the bypass port
// `DB_BACKUP_SYSTEM_DATA` (`ports.ts`).
//
// The row mirrors the fragment column for column. A column added to the
// fragment is added here in the same change.
// =============================================================================

import type { Job, JobsDelegate, JobsQueryArgs, JobsTx } from '../../jobs/index';

export { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';

/**
 * `DatabaseBackupStatus`: where a backup run is in its lifecycle.
 *
 * @stability stable
 */
export const DatabaseBackupStatus: {
  readonly [K in 'pending' | 'running' | 'completed' | 'failed' | 'stale']: K;
} = Object.freeze({
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  stale: 'stale',
} as const);

/**
 * A {@link DatabaseBackupStatus} value.
 *
 * @stability stable
 */
export type DatabaseBackupStatus = (typeof DatabaseBackupStatus)[keyof typeof DatabaseBackupStatus];

/**
 * `DatabaseBackupTrigger`: why a backup run exists.
 *
 * @stability stable
 */
export const DatabaseBackupTrigger: { readonly [K in 'manual' | 'scheduled' | 'pre_restore']: K } = Object.freeze({
  manual: 'manual',
  scheduled: 'scheduled',
  pre_restore: 'pre_restore',
} as const);

/**
 * A {@link DatabaseBackupTrigger} value.
 *
 * @stability stable
 */
export type DatabaseBackupTrigger = (typeof DatabaseBackupTrigger)[keyof typeof DatabaseBackupTrigger];

/**
 * One `database_backup_runs` row (the `db-backup` fragment's `DatabaseBackupRun`).
 *
 * @stability stable
 */
export interface DatabaseBackupRun {
  /** The run id (UUID). */
  id: string;
  /** The `jobs` row that ran it, when the queue did. */
  jobId: string | null;
  /** Lifecycle status. */
  status: DatabaseBackupStatus;
  /** Why it exists. */
  trigger: DatabaseBackupTrigger;
  /** When the dump started. */
  startedAt: Date | null;
  /** When it settled. */
  finishedAt: Date | null;
  /** The last progress heartbeat. */
  lastHeartbeatAt: Date | null;
  /** Bytes streamed so far (a `BigInt` column). */
  bytesWritten: bigint;
  /** The verified archive's size (a `BigInt` column). */
  sizeBytes: bigint;
  /** The storage provider registration it was written through. */
  storageProvider: string;
  /** The object key under `database-backups/`. */
  storageKey: string;
  /** The bucket. */
  bucket: string;
  /** The `pg_dump` format (`custom`). */
  format: string;
  /** SHA-256 of the archive as streamed. */
  checksumSha256: string | null;
  /** The server version the dump was taken from. */
  dbVersion: string | null;
  /** The application version that took it. */
  appVersion: string | null;
  /** The newest applied migration at dump time. */
  migrationName: string | null;
  /** The `pg_dump` client version. */
  pgDumpVersion: string | null;
  /** When the archive was verified. */
  verifiedAt: Date | null;
  /** The last failure's message. */
  lastError: string | null;
  /** Who asked for it, for a manual run. */
  createdById: string | null;
  /** The restore lifecycle of this archive, a plain string column. */
  restoreStatus: string | null;
  /** The last restore failure's message. */
  restoreError: string | null;
  /** When this archive was restored. */
  restoredAt: Date | null;
  /** Who restored it. */
  restoredById: string | null;
  /** The scratch database a restore used. */
  restoreScratchDb: string | null;
  /** The displaced database a restore kept. */
  restoreOldDb: string | null;
  /** When the swap happened. */
  swappedAt: Date | null;
  /** The safety dump taken before this restore. */
  preRestoreBackupId: string | null;
  /** When the row was created. */
  createdAt: Date;
  /** When the row last changed. */
  updatedAt: Date;
}

/**
 * The delegate of `database_backup_runs`, as the slice calls it.
 *
 * @stability experimental
 */
export interface DatabaseBackupRunDelegate extends JobsDelegate<DatabaseBackupRun> {
  /** `findUniqueOrThrow`. */
  findUniqueOrThrow(args: JobsQueryArgs): Promise<DatabaseBackupRun>;
}

/**
 * The few `users` columns the slice reads (an actor's e-mail).
 *
 * @stability experimental
 */
export interface DbBackupUserRow {
  /** The user id. */
  id: string;
  /** The e-mail. */
  email: string;
}

/**
 * The app's Prisma client inside one interactive transaction, as the slice
 * sees it: the jobs slice's tables (the runner enqueues through `JobsService`
 * inside its own transaction) plus the backup run, user and audit tables.
 *
 * @stability experimental
 */
export interface DbBackupTx extends JobsTx {
  /** `database_backup_runs`. */
  databaseBackupRun: DatabaseBackupRunDelegate;
  /** `jobs`. */
  job: JobsDelegate<Job> & {
    /** `findUniqueOrThrow`. */
    findUniqueOrThrow(args: JobsQueryArgs): Promise<Job>;
  };
  /** `users`; `findUnique` only. */
  user: {
    /** `findUnique`. */
    findUnique(args: JobsQueryArgs): Promise<DbBackupUserRow | null>;
  };
  /** `audit_events`; `create` only. */
  auditEvent: {
    /** `create`. */
    create(args: JobsQueryArgs): Promise<unknown>;
  };
}

/**
 * The app's Prisma client as the db-backup slice sees it: the backup run, the
 * job, the user and the audit tables plus an interactive transaction. The
 * value is the app's own client, injected through the core port
 * `PLATFORM_PRISMA`.
 *
 * @stability experimental
 */
export interface DbBackupPrisma extends DbBackupTx {
  /**
   * Closes the pool. Called only by the restore, immediately before the
   * process exits after a swap (the pool points at a renamed database).
   */
  $disconnect(): Promise<void>;
  /** Runs `fn` in one interactive transaction. */
  $transaction<T>(fn: (tx: DbBackupTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

/**
 * The `data` of a `create` on `database_backup_runs`, as Prisma accepts it
 * (`Prisma.DatabaseBackupRunUncheckedCreateInput`, untyped like every delegate
 * argument here).
 *
 * @stability experimental
 */
export type DatabaseBackupRunCreateData = { [field: string]: any };

/**
 * The `data` of an update on `database_backup_runs`, as Prisma accepts it.
 *
 * @stability experimental
 */
export type DatabaseBackupRunUpdateData = { [field: string]: any };

/**
 * A `where` filter on `database_backup_runs`, as Prisma accepts it.
 *
 * @stability experimental
 */
export type DatabaseBackupRunWhere = { [field: string]: any };

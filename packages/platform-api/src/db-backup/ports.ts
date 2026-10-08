// =============================================================================
// The db-backup slice's host ports (issue #740, PP-8.7)
// =============================================================================
//
// Every capability the backup and restore engine needs from the application,
// as ONE injection token per capability. The slice injects these and never
// imports an app service; the app binds each token in a `@Global()` module of
// its own (the reference app: `apps/api/src/platform/db-backup/
// db-backup-host.module.ts`), passed to `DbBackupModule.forRoot({ imports })`.
// Each interface is derived from the exact calls the slice makes; nothing
// wider.
//
// The database is the core port `PLATFORM_PRISMA`, seen as `DbBackupPrisma`
// (`data/db-backup-db.ts`). `DB_BACKUP_NOTIFIER` and `DB_BACKUP_MAINTENANCE`
// are REQUIRED (a restore must announce itself and must close the gate while
// it swaps); the others are optional.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

// ---- notifications ----------------------------------------------------------------------

/**
 * Injection token of the app's {@link DbBackupNotifier}. Required.
 *
 * @example
 * ```ts
 * // DbBackupHostModule: { provide: DB_BACKUP_NOTIFIER, useExisting: NotificationsService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_NOTIFIER: unique symbol = Symbol.for('@marinoscar/platform/db-backup/NOTIFIER');

/**
 * Options of {@link DbBackupNotifier.notifyPermissionHoldersNow}.
 *
 * @stability experimental
 */
export interface DbBackupNotifyOptions {
  /** Users notified besides the permission holders (the restore's actor), de-duplicated. */
  alsoNotifyUserIds?: readonly string[];
}

/**
 * The app's notification dispatcher, as the slice raises its two events
 * (`db_backup.backup_failed`, `db_backup.restore_completed`). The reference
 * app binds its `NotificationsService`; the events and their templates are
 * declared by the app's notification registry.
 *
 * Both are called AFTER the triggering write committed and outside any
 * transaction (CLAUDE.md, `notify()` rule).
 *
 * @stability experimental
 */
export interface DbBackupNotifier {
  /**
   * Fire-and-forget: notifies every holder of `permission`. Must never reject
   * (the slice still attaches a `.catch`).
   *
   * @param event - the event key.
   * @param permission - the permission whose holders are notified (`db_backup:read`).
   * @param payload - the template data.
   */
  notifyPermissionHolders(event: string, permission: string, payload: object): Promise<unknown>;
  /**
   * Awaited dispatch: resolves once every channel has been attempted. The
   * restore calls it immediately before `process.exit(0)`, so a detached form
   * would lose the one notification that cannot be turned off.
   *
   * @param event - the event key.
   * @param permission - the permission whose holders are notified.
   * @param payload - the template data.
   * @param options - extra recipients.
   */
  notifyPermissionHoldersNow(
    event: string,
    permission: string,
    payload: object,
    options?: DbBackupNotifyOptions,
  ): Promise<unknown>;
}

// ---- maintenance mode -----------------------------------------------------------------

/**
 * Injection token of the app's {@link DbBackupMaintenance}. Required.
 *
 * @example
 * ```ts
 * // DbBackupHostModule: { provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_MAINTENANCE: unique symbol = Symbol.for('@marinoscar/platform/db-backup/MAINTENANCE');

/**
 * An in-memory maintenance override, as the restore sets it for its swap.
 *
 * @stability experimental
 */
export interface DbBackupMaintenanceOverride {
  /** Whether the gate is closed. */
  enabled: boolean;
  /** The banner text. */
  message?: string;
  /** Whether administrators pass the gate. */
  allowAdmins?: boolean;
}

/**
 * The app's maintenance mode, as the restore uses it: an in-memory override
 * for the swap window (the settings row is about to be replaced by the
 * archive's, so it cannot carry the gate). The reference app binds its
 * `MaintenanceModeService`.
 *
 * @stability experimental
 */
export interface DbBackupMaintenance {
  /**
   * Sets (or, with `null`, clears) this process's in-memory override.
   *
   * @param override - the override, or `null`.
   */
  setInMemoryOverride(override: DbBackupMaintenanceOverride | null): void;
}

// ---- metrics ----------------------------------------------------------------------------

/**
 * Injection token of the app's {@link DbBackupMetrics}. Optional: without it
 * the slice records nothing.
 *
 * @example
 * ```ts
 * // DbBackupHostModule: { provide: DB_BACKUP_METRICS, useExisting: AppMetricsService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_METRICS: unique symbol = Symbol.for('@marinoscar/platform/db-backup/METRICS');

/**
 * The app's backup instruments (`app.backup.*`, declared by
 * `DB_BACKUP_APP_METRICS`). The reference app binds its `AppMetricsService`
 * (same instruments, same labels as before the move).
 *
 * @stability experimental
 */
export interface DbBackupMetrics {
  /**
   * A backup run settled.
   *
   * @param outcome - `'completed'` or `'failed'`.
   * @param durationMs - start to settlement, or `null` when unknown.
   * @param sizeBytes - the archive size, recorded for a completed run only.
   */
  backupSettled(outcome: 'completed' | 'failed', durationMs: number | null, sizeBytes?: number | bigint | null): void;
}

/**
 * The metrics used when the app binds none: every call is a no-op.
 *
 * @stability experimental
 */
export const NOOP_DB_BACKUP_METRICS: DbBackupMetrics = Object.freeze({
  backupSettled: () => undefined,
});

// ---- deployment mode -------------------------------------------------------------------

/**
 * Injection token of the app's {@link DbBackupDeploymentMode}. Optional:
 * without it (and without the `deploymentMode` / `restoreEnabled` options) the
 * deployment is `self-hosted` and in-app restore is on.
 *
 * @example
 * ```ts
 * // DbBackupHostModule: { provide: DB_BACKUP_DEPLOYMENT_MODE, useExisting: DeploymentModeService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_DEPLOYMENT_MODE: unique symbol = Symbol.for('@marinoscar/platform/db-backup/DEPLOYMENT_MODE');

/**
 * The deployment mode, as the slice reads it once at boot (`DEPLOYMENT_MODE`,
 * #685). `saas` turns in-app restore off; backups keep working.
 *
 * @stability experimental
 */
export interface DbBackupDeploymentMode {
  /** `'self-hosted'` or `'saas'`. */
  readonly mode: 'self-hosted' | 'saas';
}

// ---- the bypass client -------------------------------------------------------------------

/**
 * Injection token of the app's {@link DbBackupSystemData}: the bypass client.
 * Required by the `backup.rls-bypass` Doctor check only.
 *
 * @example
 * ```ts
 * // DbBackupHostModule: { provide: DB_BACKUP_SYSTEM_DATA, useExisting: PrismaSystemService }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_SYSTEM_DATA: unique symbol = Symbol.for('@marinoscar/platform/db-backup/SYSTEM_DATA');

/**
 * The transaction client the bypass client hands its callback.
 *
 * @stability experimental
 */
export interface DbBackupSystemTx {
  /**
   * An unsafe raw query (the check's table names come from a closed list).
   *
   * @param query - the SQL.
   */
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

/**
 * The app's bypass client (`PrismaSystemService`), as the Doctor's
 * `backup.rls-bypass` check uses it: one transaction with `app.rls_bypass`
 * set transaction-locally, under a named reason.
 *
 * @stability experimental
 */
export interface DbBackupSystemData {
  /**
   * Runs `fn` in one transaction that bypasses row-level security.
   *
   * @param reason - the `SystemAccessReason` (`'doctor'`).
   * @param fn - the unit of work.
   */
  runAsSystem<T>(reason: 'doctor', fn: (tx: DbBackupSystemTx) => Promise<T>): Promise<T>;
}

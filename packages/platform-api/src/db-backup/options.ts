// =============================================================================
// `DbBackupModule.forRoot()` options (issue #740, PP-8.7)
// =============================================================================
//
// Rung 1 of the extension ladder: every option defaults to the behaviour the
// reference app had before the move. NO OPTION ADDS AN ENVIRONMENT VARIABLE:
// the deployment mode comes from `DEPLOYMENT_MODE` (#685) through the
// `DB_BACKUP_DEPLOYMENT_MODE` port, the scheduler switch from the existing
// `DB_BACKUP_SCHEDULE_ENABLED` (the app's `dbBackup.scheduleEnabled` config
// key), and the bypass connection is the `POSTGRES_*` connection itself with
// the `app.rls_bypass` startup option (#725).
// =============================================================================

import type { ModuleMetadata } from '@nestjs/common';

import type { PortBinding } from '../core/index';
import type { BackupTarget } from './backup-target';
import type { RestoreCarryOver } from './carry-over.registry';

/**
 * Injection token of the resolved {@link DbBackupModuleOptions}. Optional to
 * every consumer: without it the shipped defaults apply.
 *
 * @stability experimental
 */
export const DB_BACKUP_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/db-backup/OPTIONS');

/**
 * The application name a backup key is derived from when the app passes none.
 *
 * @stability stable
 */
export const DEFAULT_DB_BACKUP_APP_NAME = 'app';

/**
 * Options of `DbBackupModule.forRoot()`. Every field is optional.
 *
 * @stability experimental
 */
export interface DbBackupModuleOptions {
  /**
   * The application name in every archive's key and file name
   * (`database-backups/<slug>/YYYY/MM/<slug>-<ts>-<runId>.dump`), slugified.
   * Default {@link DEFAULT_DB_BACKUP_APP_NAME}; the reference app passes its
   * `APP_NAME`. Changing it changes where NEW archives land; existing runs
   * keep the key they recorded.
   */
  appName?: string;
  /**
   * The application version recorded on every run (`app_version`). Default:
   * `APP_VERSION`, else `npm_package_version`, else `'0.0.0'`.
   */
  appVersion?: string | (() => string);
  /**
   * The deployment mode. Default: the `DB_BACKUP_DEPLOYMENT_MODE` port when
   * the app binds it, else `'self-hosted'`. `'saas'` turns in-app restore off
   * (spec, Scaling posture, red flag 7: use the provider's point-in-time
   * recovery instead); backups keep working.
   */
  deploymentMode?: 'self-hosted' | 'saas' | (string & {});
  /**
   * An explicit override of the restore surface (the restore and rollback
   * routes, `db.restore.run`, the restore pre-flight and the page's restore
   * actions). Default: `deploymentMode !== 'saas'`.
   */
  restoreEnabled?: boolean;
  /**
   * The process-level scheduler switch. Default: the app's
   * `dbBackup.scheduleEnabled` config key (
   * `DB_BACKUP_SCHEDULE_ENABLED !== 'false'`), else on.
   */
  scheduleEnabled?: boolean;
  /**
   * Tables whose rows must survive a restore, besides the four built-in
   * carries (the backup catalog, its self-links, the restore's own job row and
   * the completion audit row). Registered into the `RestoreCarryOver`
   * registry at `forRoot` time; an app can also call
   * `registerRestoreCarryOver` from its own file before bootstrap.
   */
  extraCarryOver?: readonly RestoreCarryOver[];
  /**
   * Where archives live: the primary backup target (PP-14.12). Default: an
   * adapter over the active `STORAGE_PROVIDER`, which is what the engine did
   * before the port existed. An app target replaces it (its `id` is recorded on
   * every run and must equal `databaseBackup.storageProvider` when that is set);
   * a worker node can take a backup only for the default target, so with an app
   * target node offload is never offered. The binding is resolved in the
   * slice's own module: its dependencies come from `imports` and global
   * modules. See `backup-target.ts`.
   *
   * @example
   * ```ts
   * DbBackupModule.forRoot({ target: { useClass: VaultBackupTarget }, imports: [VaultModule] });
   * ```
   *
   * @extensionPoint option
   */
  target?: PortBinding<BackupTarget>;
  /**
   * Targets that receive a copy of every archive after the primary's write was
   * verified (PP-14.12). A failed mirror never fails the run: it is recorded and
   * the `backup.mirrors` Doctor check warns. Retention and the admin delete
   * remove the copies with the original (best effort). Each id must be unique
   * and different from the primary's.
   *
   * @example
   * ```ts
   * DbBackupModule.forRoot({ mirrorTargets: [{ useClass: LocalDirBackupTarget }] });
   * ```
   *
   * @extensionPoint option
   */
  mirrorTargets?: readonly PortBinding<BackupTarget>[];
  /**
   * Modules to import next to the slice: typically the app's `@Global()` host
   * module binding `DB_BACKUP_NOTIFIER`, `DB_BACKUP_MAINTENANCE`,
   * `DB_BACKUP_METRICS`, `DB_BACKUP_DEPLOYMENT_MODE` and `DB_BACKUP_SYSTEM_DATA`.
   */
  imports?: ModuleMetadata['imports'];
}

/**
 * {@link DbBackupModuleOptions} with every default applied. `restoreEnabled`
 * and `scheduleEnabled` stay optional: absent means "decide from the port /
 * the config key at boot".
 *
 * @stability experimental
 */
export interface ResolvedDbBackupModuleOptions {
  /** The application name. */
  readonly appName: string;
  /** The application version resolver. */
  readonly appVersion: () => string;
  /** The deployment mode, when the app passed one. */
  readonly deploymentMode?: 'self-hosted' | 'saas' | (string & {});
  /** The restore override, when the app passed one. */
  readonly restoreEnabled?: boolean;
  /** The scheduler override, when the app passed one. */
  readonly scheduleEnabled?: boolean;
  /** The primary target's binding, or `undefined` for the default adapter over `STORAGE_PROVIDER`. */
  readonly target?: PortBinding<BackupTarget>;
  /** The mirror targets' bindings (empty when none). */
  readonly mirrorTargets: readonly PortBinding<BackupTarget>[];
  /** The modules imported next to the slice. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
}

/**
 * The application version recorded on a run when the app passes none:
 * `APP_VERSION`, else `npm_package_version`, else `'0.0.0'`.
 *
 * @returns the version string.
 * @stability experimental
 */
export function defaultAppVersion(): string {
  return process.env.APP_VERSION || process.env.npm_package_version || '0.0.0';
}

/**
 * Applies the defaults and refuses an invalid option at `forRoot()` time.
 *
 * @param options - what the app passed.
 * @returns the resolved options.
 * @throws Error when `deploymentMode` is not `'self-hosted'` or `'saas'`.
 *
 * @stability experimental
 */
export function resolveDbBackupModuleOptions(options: DbBackupModuleOptions = {}): ResolvedDbBackupModuleOptions {
  if (options.deploymentMode !== undefined && options.deploymentMode !== 'self-hosted' && options.deploymentMode !== 'saas') {
    throw new Error(
      `DbBackupModule.forRoot(): deploymentMode must be 'self-hosted' or 'saas' (got ${String(options.deploymentMode)})`,
    );
  }
  const checkBinding = (binding: unknown, where: string): void => {
    const kinds =
      binding !== null && typeof binding === 'object'
        ? ['useExisting', 'useClass', 'useFactory'].filter((kind) => kind in (binding as object))
        : [];
    if (kinds.length !== 1) {
      throw new Error(`DbBackupModule.forRoot(): ${where} needs exactly one of useExisting, useClass or useFactory`);
    }
  };
  if (options.target !== undefined) checkBinding(options.target, '`target`');
  const mirrorTargets = options.mirrorTargets ?? [];
  if (!Array.isArray(mirrorTargets)) throw new Error('DbBackupModule.forRoot(): `mirrorTargets` must be an array of bindings');
  mirrorTargets.forEach((binding, index) => checkBinding(binding, `\`mirrorTargets[${index}]\``));
  const version = options.appVersion;
  return Object.freeze({
    appName: options.appName && options.appName.trim() !== '' ? options.appName : DEFAULT_DB_BACKUP_APP_NAME,
    appVersion: typeof version === 'function' ? version : version !== undefined ? () => version : defaultAppVersion,
    ...(options.deploymentMode !== undefined ? { deploymentMode: options.deploymentMode } : {}),
    ...(options.restoreEnabled !== undefined ? { restoreEnabled: options.restoreEnabled } : {}),
    ...(options.scheduleEnabled !== undefined ? { scheduleEnabled: options.scheduleEnabled } : {}),
    ...(options.target !== undefined ? { target: options.target } : {}),
    mirrorTargets: Object.freeze([...mirrorTargets]),
    imports: options.imports ?? [],
  });
}

/**
 * Whether in-app restore is on for these options and the deployment mode the
 * app reported: an explicit `restoreEnabled` wins, then an explicit
 * `deploymentMode`, then the port's mode; nothing at all means self-hosted.
 *
 * @param options - the resolved options.
 * @param portMode - the `DB_BACKUP_DEPLOYMENT_MODE` port's mode, when bound.
 * @param portInAppRestore - the port's `inAppRestoreEnabled`, when it reports one.
 * @returns `true` when restore is available.
 *
 * @stability experimental
 */
export function resolveRestoreEnabled(
  options: Pick<ResolvedDbBackupModuleOptions, 'deploymentMode' | 'restoreEnabled'>,
  portMode?: 'self-hosted' | 'saas' | (string & {}),
  portInAppRestore?: boolean,
): boolean {
  if (options.restoreEnabled !== undefined) return options.restoreEnabled;
  // The port's own answer (the host's `inAppRestore` capability, which an app
  // mode may set) decides when no option named a mode.
  if (options.deploymentMode === undefined && portInAppRestore !== undefined) return portInAppRestore;
  const mode = options.deploymentMode ?? portMode ?? 'self-hosted';
  return mode !== 'saas';
}

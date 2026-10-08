// =============================================================================
// The deployment-mode restore gate (issue #740; the mode is #685's)
// =============================================================================
//
// One provider answers "may this deployment restore its own database?", read
// ONCE at boot from the `forRoot()` options and the `DB_BACKUP_DEPLOYMENT_MODE`
// port (see `resolveRestoreEnabled`). It replaces the reference app's
// `DeploymentModeService` inside the slice, with the same two members, so the
// three layers that enforce the gate (the admin service, the restore service
// and the `db.restore.run` handler) read exactly as they did.
// =============================================================================

import { Inject, Injectable, Optional } from '@nestjs/common';

import { DatabaseRestoreDisabledError } from './db-backup.errors';
import { DB_BACKUP_OPTIONS, resolveRestoreEnabled, type ResolvedDbBackupModuleOptions } from './options';
import { DB_BACKUP_DEPLOYMENT_MODE, type DbBackupDeploymentMode } from './ports';

/**
 * Whether in-app restore is on, decided once at boot.
 *
 * @stability experimental
 */
@Injectable()
export class DbBackupRestoreGate {
  /** The deployment mode the gate was decided from (the option, else the port, else `self-hosted`). */
  readonly mode: 'self-hosted' | 'saas';

  /** Whether the application may restore its own database here. */
  readonly inAppRestoreEnabled: boolean;

  /**
   * @param options - the resolved `forRoot()` options, when the module provides them.
   * @param deployment - the app's deployment mode, when bound.
   */
  constructor(
    @Optional() @Inject(DB_BACKUP_OPTIONS) options?: ResolvedDbBackupModuleOptions,
    @Optional() @Inject(DB_BACKUP_DEPLOYMENT_MODE) deployment?: DbBackupDeploymentMode,
  ) {
    this.mode = options?.deploymentMode ?? deployment?.mode ?? 'self-hosted';
    this.inAppRestoreEnabled = resolveRestoreEnabled(options ?? {}, deployment?.mode);
  }

  /**
   * The restore path's first statement.
   *
   * @throws {@link DatabaseRestoreDisabledError} when in-app restore is off (`saas`).
   */
  assertInAppRestoreEnabled(): void {
    if (!this.inAppRestoreEnabled) throw new DatabaseRestoreDisabledError();
  }
}

/**
 * A gate for a fixed answer, for a test or a script that builds the services
 * by hand.
 *
 * @param mode - the deployment mode.
 * @returns the gate.
 * @stability experimental
 */
export function restoreGateFor(mode: 'self-hosted' | 'saas' = 'self-hosted'): DbBackupRestoreGate {
  return new DbBackupRestoreGate({ deploymentMode: mode } as ResolvedDbBackupModuleOptions);
}

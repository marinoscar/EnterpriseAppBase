import { Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { DEPLOYMENT_MODE_ENV_VAR, capabilitiesFor, type DeploymentMode } from '../deployment-mode';
import { DeploymentModeService } from '../deployment-mode.service';

const BACKUP_SETTINGS_PATH = '/admin/settings/db-backup';

export interface DeploymentModeFacts {
  /**
   * `databaseBackup.enabled` — whether in-app scheduled backups are on.
   * `null` when the policy could not be read.
   */
  backupsEnabled: boolean | null;
}

/**
 * Pure: reports the mode, and whether a SaaS deployment is leaning on provider
 * backups with nothing of its own.
 *
 * ⚠ NEVER `fail`. An invalid `DEPLOYMENT_MODE` never boots (see
 * `deployment-mode.ts`), so whatever mode this sees is a valid one an operator
 * chose. The only thing worth flagging is SaaS with in-app backups off: then the
 * provider's backups and PITR are the ONLY way back, and this application cannot
 * see whether they are configured.
 */
export function decideDeploymentMode(
  mode: DeploymentMode,
  facts: DeploymentModeFacts
): DoctorCheckOutcome {
  const data = {
    mode,
    inAppRestore: capabilitiesFor(mode).inAppRestore,
    inAppBackups: facts.backupsEnabled,
  };

  if (mode === 'self-hosted') {
    return {
      status: 'pass',
      detail: 'Self-hosted: in-app backup and restore available',
      data,
    };
  }

  if (facts.backupsEnabled !== true) {
    return {
      status: 'warn',
      detail:
        facts.backupsEnabled === false
          ? 'No in-app backups in SaaS mode; confirm provider backups/PITR are configured'
          : 'SaaS mode, and the backup policy could not be read; confirm provider backups/PITR are configured',
      remedy:
        "Confirm automated backups and point-in-time recovery are on for the managed database " +
        '(on RDS: a backup retention period above 0 days), or turn on in-app backups at ' +
        `${BACKUP_SETTINGS_PATH}. In-app restore stays off while ${DEPLOYMENT_MODE_ENV_VAR}=saas.`,
      data,
    };
  }

  return {
    status: 'pass',
    detail: 'SaaS: in-app restore disabled; rely on provider PITR',
    data,
  };
}

/** `core` / `core.deployment-mode` — which deployment mode is running, and what it turns off. */
@Injectable()
export class DeploymentModeDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'core.deployment-mode';
  readonly category = 'core';
  readonly label = 'Deployment mode';
  readonly settingsPath = BACKUP_SETTINGS_PATH;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly deployment: DeploymentModeService,
    private readonly settings: SystemSettingsService
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Read-only: the parsed mode (memory) and one settings read. */
  async run(): Promise<DoctorCheckOutcome> {
    let backupsEnabled: boolean | null;

    try {
      backupsEnabled = (await this.settings.getDatabaseBackupPolicy()).enabled;
    } catch {
      // Not this check's failure to report: `db.connection` says the database
      // is down far better. The mode is still known, so report it.
      backupsEnabled = null;
    }

    return decideDeploymentMode(this.deployment.mode, { backupsEnabled });
  }
}

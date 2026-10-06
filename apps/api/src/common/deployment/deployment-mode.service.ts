import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseRestoreDisabledError } from '../../db-backup/db-backup.errors';
import {
  capabilitiesFor,
  parseDeploymentMode,
  type DeploymentCapabilities,
  type DeploymentMode,
} from './deployment-mode';

/**
 * The parsed `DEPLOYMENT_MODE` and what it permits (#685).
 *
 * Provided by the `@Global()` `DeploymentModule`, so any feature injects it
 * without an import edge. Parsed ONCE, in the constructor, from the raw string
 * `configuration.ts` publishes as `deployment.mode`, through the same pure
 * `parseDeploymentMode` `main.ts` already ran at bootstrap — so an invalid value
 * fails the container build too (a test module, a script that boots Nest
 * without `main.ts`), and the two can never disagree.
 *
 * Read-only for the life of the process: the mode is a fact about the
 * deployment, changed by its operator and a restart, never at runtime.
 */
@Injectable()
export class DeploymentModeService {
  readonly mode: DeploymentMode;

  readonly capabilities: Readonly<DeploymentCapabilities>;

  constructor(config: ConfigService) {
    this.mode = parseDeploymentMode(config.get<string>('deployment.mode'));
    this.capabilities = Object.freeze(capabilitiesFor(this.mode));
  }

  /** Whether the application may restore its own database here. */
  get inAppRestoreEnabled(): boolean {
    return this.capabilities.inAppRestore;
  }

  /**
   * The restore path's first statement.
   *
   * @throws {DatabaseRestoreDisabledError} when this deployment's mode turns
   * in-app restore off (`saas`).
   */
  assertInAppRestoreEnabled(): void {
    if (!this.capabilities.inAppRestore) throw new DatabaseRestoreDisabledError();
  }
}

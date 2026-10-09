import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseRestoreDisabledError } from '../../db-backup/index';
import {
  DEPLOYMENT_MODE_ENV_VAR,
  capabilitiesFor,
  parseDeploymentMode,
  type DeploymentCapabilities,
  type DeploymentMode,
} from './deployment-mode';

/**
 * The configuration key the app publishes the raw `DEPLOYMENT_MODE` string
 * under (`config/configuration.ts`: `deployment.mode`). An app that publishes
 * none is read from the environment variable directly.
 *
 * @stability experimental
 */
export const DEPLOYMENT_MODE_CONFIG_KEY = 'deployment.mode';

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
 *
 * @stability experimental
 */
@Injectable()
export class DeploymentModeService {
  /** The parsed mode. */
  readonly mode: DeploymentMode;

  /** What the mode permits. */
  readonly capabilities: Readonly<DeploymentCapabilities>;

  constructor(config: ConfigService) {
    this.mode = parseDeploymentMode(config.get<string>(DEPLOYMENT_MODE_CONFIG_KEY) ?? process.env[DEPLOYMENT_MODE_ENV_VAR]);
    this.capabilities = Object.freeze(capabilitiesFor(this.mode));
  }

  /** Whether the application may restore its own database here. */
  get inAppRestoreEnabled(): boolean {
    return this.capabilities.inAppRestore;
  }

  /**
   * The restore path's first statement.
   *
   * @throws DatabaseRestoreDisabledError when this deployment's mode turns
   * in-app restore off (`saas`).
   */
  assertInAppRestoreEnabled(): void {
    if (!this.capabilities.inAppRestore) throw new DatabaseRestoreDisabledError();
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { DeploymentNetworkSource } from '../../doctor/index';

import { DEPLOYMENT_NETWORK_ENV_VAR, parseDeploymentNetwork, type DeploymentNetwork } from './deployment-network';

/**
 * The configuration key the app publishes the raw `DEPLOYMENT_NETWORK` string
 * under (`deployment.network`). An app that publishes none is read from the
 * environment variable directly.
 *
 * @stability experimental
 */
export const DEPLOYMENT_NETWORK_CONFIG_KEY = 'deployment.network';

/**
 * The parsed `DEPLOYMENT_NETWORK` (#773), bound globally as the doctor slice's
 * `DEPLOYMENT_NETWORK_SOURCE` so `network.egress` knows whether to grade.
 *
 * Parsed ONCE, in the constructor, from the raw string `configuration.ts`
 * publishes as `deployment.network`, through the same pure parser `main.ts`
 * already ran at bootstrap: an invalid value fails the container build too.
 *
 * @stability experimental
 */
@Injectable()
export class DeploymentNetworkService implements DeploymentNetworkSource {
  readonly network: DeploymentNetwork;

  constructor(config: ConfigService) {
    this.network = parseDeploymentNetwork(
      config.get<string>(DEPLOYMENT_NETWORK_CONFIG_KEY) ?? process.env[DEPLOYMENT_NETWORK_ENV_VAR],
    );
  }

  /** Whether the deployment declared it has no internet egress. */
  get airGapped(): boolean {
    return this.network === 'air-gapped';
  }
}

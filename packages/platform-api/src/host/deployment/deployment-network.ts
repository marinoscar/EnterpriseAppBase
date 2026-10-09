// =============================================================================
// DEPLOYMENT_NETWORK — does this deployment have internet egress? (#773)
// =============================================================================
//
// On-prem and customer-cloud installs may run with no route to the internet.
// This variable is the operator's declaration of that fact: `online` (the
// default) or `air-gapped`. It changes one thing today: the `network.egress`
// doctor check stops merely listing the outbound dependencies and GRADES them
// (a required public dependency is `fail`, optional ones `warn`). See
// docs/runbooks/air-gapped.md.
//
// A DEPLOYMENT-LEVEL FACT, AND THEREFORE AN ENVIRONMENT VARIABLE, exactly like
// `DEPLOYMENT_MODE` (./deployment-mode.ts, read its header): the network
// topology is chosen at install time by whoever runs the infrastructure, not
// by an administrator at runtime.
//
// ⚠ AN INVALID VALUE FAILS STARTUP, like `DEPLOYMENT_MODE`. Guessing `online`
// would silently hide every air-gap problem the operator asked to be shown.
// Only unset (or empty) has a default, `online`.
//
// The vocabulary (`DEPLOYMENT_NETWORKS`) is the doctor slice's, so the check
// and this parser cannot disagree about what the values are. This module is
// PURE: no Nest, no `process.env`.
// =============================================================================

import { DEPLOYMENT_NETWORKS, type DeploymentNetwork } from '../../doctor/index';

export { DEPLOYMENT_NETWORKS, type DeploymentNetwork };

/** The environment variable this module parses.
 *
 * @stability experimental
 */
export const DEPLOYMENT_NETWORK_ENV_VAR = 'DEPLOYMENT_NETWORK';

/** What an unset or empty `DEPLOYMENT_NETWORK` means.
 *
 * @stability experimental
 */
export const DEFAULT_DEPLOYMENT_NETWORK: DeploymentNetwork = 'online';

/**
 * Parses `DEPLOYMENT_NETWORK`.
 *
 * - `undefined`, `''` or whitespace only → `'online'`.
 * - Surrounding whitespace is trimmed.
 * - ⚠ CASE-SENSITIVE, matching the CLI wizard's validator (`Air-Gapped` is refused).
 * - Anything else throws, naming the variable and the allowed values.
 *
 * @throws Error on any value that is not a deployment network.
 *
 * @stability experimental
 */
export function parseDeploymentNetwork(raw: string | undefined): DeploymentNetwork {
  const value = (raw ?? '').trim();

  if (value === '') return DEFAULT_DEPLOYMENT_NETWORK;

  if ((DEPLOYMENT_NETWORKS as readonly string[]).includes(value)) {
    return value as DeploymentNetwork;
  }

  throw new Error(
    `${DEPLOYMENT_NETWORK_ENV_VAR}=${JSON.stringify(raw)} is not a valid deployment network. ` +
      `Allowed values: ${DEPLOYMENT_NETWORKS.join(', ')} (unset means ${DEFAULT_DEPLOYMENT_NETWORK}). ` +
      'The API refuses to start rather than guess, because guessing online would hide every ' +
      'air-gap problem the Doctor is meant to show. Fix the value in the deployment environment ' +
      '(infra/compose/.env) and restart.'
  );
}

/** One line for the startup log.
 *
 * @stability experimental
 */
export function describeDeploymentNetwork(network: DeploymentNetwork): string {
  return network === 'air-gapped'
    ? `Deployment network: air-gapped (${DEPLOYMENT_NETWORK_ENV_VAR}). The Doctor grades outbound dependencies (network.egress).`
    : `Deployment network: online (${DEPLOYMENT_NETWORK_ENV_VAR}).`;
}

/**
 * The bootstrap check: parse the variable, log the network once, return it.
 * Called from `main.ts` beside `verifyDeploymentModeAtStartup`, before the Nest
 * application exists, so a typo never opens a database connection.
 *
 * @stability experimental
 */
export function verifyDeploymentNetworkAtStartup(
  env: Record<string, string | undefined>,
  logger: { log(message: string): void }
): DeploymentNetwork {
  const network = parseDeploymentNetwork(env[DEPLOYMENT_NETWORK_ENV_VAR]);

  logger.log(describeDeploymentNetwork(network));

  return network;
}

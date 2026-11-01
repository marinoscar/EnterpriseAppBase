import { join } from 'node:path';

import { composeFileArgs } from './compose-files.js';

// =============================================================================
// The `docker compose` argv of a deployment
// =============================================================================
//
// A leaf under install.ts (which re-exports both functions) and the
// `stack-ports-free` check: the check must render the stack with EXACTLY the
// project and files `up -d` will use, and importing the install pipeline from
// a check would put the check registry inside a module cycle with it.
// =============================================================================

/**
 * Where compose runs for a deployment: the checkout's compose directory.
 *
 * @param deployRoot - The deployment folder.
 * @returns the directory every compose call uses as its working directory.
 */
export function composeCwd(deployRoot: string): string {
  // The relative build contexts in base.compose.yml (`../..`, `../nginx`)
  // resolve against the COMPOSE FILE's directory, so this is not incidental.
  return join(deployRoot, 'repo', 'infra', 'compose');
}

/**
 * The full `docker compose` argv for this deployment.
 *
 * `groups` are the deployment's groups -- this run's flag, else what install
 * recorded -- and decide which compose files take part; see compose-files.ts.
 * The always-on telemetry files are included whatever is passed (#567).
 */
export function composeArgv(
  extra: readonly string[],
  project?: string,
  groups?: readonly string[] | undefined,
  composeDir?: string,
): string[] {
  return [
    'docker',
    'compose',
    ...(project === undefined ? [] : ['-p', project]),
    // With the checkout's compose dir, the app's overlays come last (#714).
    ...composeFileArgs(groups, composeDir),
    ...extra,
  ];
}

// =============================================================================
// Which compose files make up this deployment  (issue #531, epic #528)
// =============================================================================
//
// ONE list, read by every compose invocation: install, update, uninstall and
// the health gate. It used to be two hard-coded copies (install.ts and
// health.ts), which is how a stack ends up started with one set of files and
// inspected -- or torn down -- with another.
//
// The list depends on the deployment's opt-in groups, and those come from the
// flag on this run or from `state.groups` -- NEVER from reading the `.env`,
// for the reason `DeployState.groups` gives.
//
// ORDER IS LOAD-BEARING:
//
//   base, prod, [telemetry], vps, [vps.telemetry]
//
//   - The VPS files come LAST. Their `ports: !override` only replaces what the
//     files BEFORE them published; applied earlier, a later file's ports would
//     merge back in and the service would be reachable on 0.0.0.0.
//   - telemetry.compose.yml adds services, so it sits before the VPS files and
//     inherits their hardening.
//   - vps.telemetry.compose.yml is separate from vps.compose.yml because a
//     service block for `greptimedb` in vps.compose.yml would be a service
//     with no image on every deployment WITHOUT telemetry, and compose rejects
//     the whole project for it.
// =============================================================================

/** The opt-in group whose presence adds the telemetry stack. */
export const TELEMETRY_GROUP = 'observability';

/**
 * The compose files for a deployment with these opt-in groups, in the order
 * compose must apply them. File names only; callers join the directory.
 */
export function composeFilesFor(groups?: readonly string[] | undefined): string[] {
  const telemetry = groups?.includes(TELEMETRY_GROUP) === true;
  return [
    'base.compose.yml',
    'prod.compose.yml',
    ...(telemetry ? ['telemetry.compose.yml'] : []),
    'vps.compose.yml',
    ...(telemetry ? ['vps.telemetry.compose.yml'] : []),
  ];
}

/** `-f <file>` for each file, in order. */
export function composeFileArgs(groups?: readonly string[] | undefined): string[] {
  return composeFilesFor(groups).flatMap((file) => ['-f', file]);
}

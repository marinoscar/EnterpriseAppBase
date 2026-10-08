// =============================================================================
// Which compose files make up this deployment  (issue #531, epic #528)
// =============================================================================
//
// ONE list, read by every compose invocation: install, update, uninstall and
// the health gate. It used to be two hard-coded copies (install.ts and
// health.ts), which is how a stack ends up started with one set of files and
// inspected -- or torn down -- with another.
//
// The list depends on the deployment's groups, and those come from the flag
// on this run or from `state.groups` -- NEVER from reading the `.env`, for the
// reason `DeployState.groups` gives -- always widened by `effectiveGroups`.
//
// TELEMETRY IS ALWAYS ON for a VPS deployment (issue #567). `observability`
// used to be opt-in, and a deployment installed without it had no
// `greptimedb` container, so the admin telemetry page failed with "host
// greptimedb could not be resolved" and could only be fixed from a shell.
// Everything telemetry-related must be doable from the admin UI, so the stack
// ships with every deployment. Deploying it does not force export on:
// collection stays gated at runtime by the admin UI's telemetry toggle.
// `--group observability` is still accepted, as a harmless no-op.
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
//
// THE ORDER COMES FROM THE PACKAGE (issues #705, #714). Every file above is
// generated into infra/compose/ by @marinoscar/platform-infra (`npm run
// platform:infra:sync`), and the package's `composeFilesForMode('vps')` owns
// the order, so the deploy and every other consumer apply the same list.
//
// APP OVERLAYS COME LAST (#714). An app changes the stack with
// `infra/compose/app.*.compose.yml` files, never by editing a generated one.
// Given the checkout's compose directory, the list ends with the overlays
// that apply to a VPS deployment (`app.<name>`, `app.prod.<name>`,
// `app.vps.<name>`), sorted by file name, so they win:
//
//   base, prod, [telemetry], vps, [vps.telemetry], app.*.compose.yml
//
// A name ending in `.example.compose.yml` is documentation and never applied.
// Without a directory (or when it cannot be read) the list has no overlays.
// =============================================================================

import { readdirSync } from 'node:fs';

import { composeFilesForMode } from '@marinoscar/platform-infra';
import { telemetryInfraFragment } from '@marinoscar/platform-infra/telemetry';

import type { EnvGroup } from './env-metadata.js';

/** The group whose presence adds the telemetry stack. Always on; see above. */
export const TELEMETRY_GROUP = telemetryInfraFragment.envGroup satisfies EnvGroup;

/**
 * The file names in the checkout's compose directory, where the app's
 * overlays live. Empty when no directory is given or it cannot be read: a
 * missing checkout must not turn into a thrown error here, the compose call
 * that follows reports it with the right context.
 */
function composeDirListing(composeDir: string | undefined): string[] {
  if (composeDir === undefined) return [];
  try {
    return readdirSync(composeDir);
  } catch {
    return [];
  }
}

/** Groups every VPS deployment has, whatever was passed or recorded. */
export const ALWAYS_ON_GROUPS: readonly EnvGroup[] = [TELEMETRY_GROUP];

/**
 * The groups a deployment actually runs with: the requested or recorded ones,
 * plus every always-on group. Order is kept and duplicates dropped.
 *
 * THE ONE PLACE this is decided. Install, update, uninstall, health, the
 * compose file list, the environment wizard and the update's drift check all
 * route through it, so an existing deployment whose `state.groups` predates
 * #567 gets the telemetry stack -- files and keys -- on its next update.
 */
export function effectiveGroups(groups?: readonly string[] | undefined): EnvGroup[] {
  const result: EnvGroup[] = [];
  for (const group of [...(groups ?? []), ...ALWAYS_ON_GROUPS]) {
    if (!result.includes(group as EnvGroup)) result.push(group as EnvGroup);
  }
  return result;
}

/**
 * The compose files for a deployment with these groups, in the order compose
 * must apply them. File names only; callers join the directory. The telemetry
 * files are always included (`effectiveGroups`). With `composeDir` (the
 * checkout's infra/compose), the app's overlays found there come last.
 */
export function composeFilesFor(groups?: readonly string[] | undefined, composeDir?: string): string[] {
  const telemetry = effectiveGroups(groups).includes(TELEMETRY_GROUP);
  return composeFilesForMode('vps', { telemetry, overlays: composeDirListing(composeDir) });
}

/** `-f <file>` for each file, in order. */
export function composeFileArgs(groups?: readonly string[] | undefined, composeDir?: string): string[] {
  return composeFilesFor(groups, composeDir).flatMap((file) => ['-f', file]);
}

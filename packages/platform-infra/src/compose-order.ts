// =============================================================================
// Compose file order per mode, with the app's overlays last
// =============================================================================
//
// ORDER IS LOAD-BEARING. Compose merges `-f` files left to right, and a later
// file wins. For every mode the order is:
//
//   platform fragments in the documented order  ->  app overlays, by filename
//
//   dev      base, dev, [telemetry]
//   devdb    base, dev, devdb, [telemetry]
//   prod     base, prod, [telemetry]
//   vps      base, prod, [telemetry], vps, [vps.telemetry]
//   worker   worker, [worker.build]
//
// - The VPS files come after every file whose `ports:` they override:
//   `ports: !override` only replaces what the files BEFORE it published.
// - telemetry.compose.yml adds services, so it sits before the VPS files and
//   inherits their hardening; vps.telemetry.compose.yml hardens those services
//   and comes last among the platform files.
// - App overlays come after ALL platform files, so an overlay always wins: it
//   can change a platform service (memory limits), add a service, or switch
//   one off (`profiles: ["disabled"]`).
//
// OVERLAY NAMES. `app.<name>.compose.yml` applies to every mode built on
// base.compose.yml (dev, devdb, prod, vps). `app.<scope>.<name>.compose.yml`,
// where <scope> is dev, devdb, prod, vps or worker, applies only to the modes
// whose platform list contains `<scope>.compose.yml`: `app.prod.*` to prod
// and vps, `app.dev.*` to dev and devdb, `app.vps.*` to vps alone. A file
// ending in `.example.compose.yml` is documentation and is never applied.
// (`app.vps.compose.yml`, a scope with no name, is scoped to vps too.)
// =============================================================================

import { telemetryInfraFragment, type ComposeSlot } from './telemetry/index.js';

/**
 * A stack the platform's compose files describe.
 *
 * @stability experimental
 */
export type ComposeMode = 'dev' | 'devdb' | 'prod' | 'vps' | 'worker';

/**
 * Every {@link ComposeMode}, in the order the README's table lists them.
 *
 * @stability experimental
 */
export const COMPOSE_MODES: readonly ComposeMode[] = Object.freeze(['dev', 'devdb', 'prod', 'vps', 'worker'] as const);

/**
 * Options of {@link composeFilesForMode}.
 *
 * @stability experimental
 */
export interface ComposeFilesOptions {
  /** Add the telemetry fragment's files (OTel collector, GreptimeDB). Ignored for `worker`. */
  readonly telemetry?: boolean;
  /** `worker` only: add `worker.build.compose.yml` to build the image from source. */
  readonly build?: boolean;
  /**
   * File names found in the app's `infra/compose/` directory (or just its
   * overlays). Only names that are app overlays for this mode are used; the
   * rest are ignored, so a directory listing can be passed as is.
   */
  readonly overlays?: readonly string[];
}

const OVERLAY = /^app\.(.+)\.compose\.ya?ml$/;
const EXAMPLE = /\.example\.compose\.ya?ml$/;
const SCOPES: readonly ComposeMode[] = ['dev', 'devdb', 'prod', 'vps', 'worker'];

function telemetryFiles(slot: ComposeSlot): string[] {
  return telemetryInfraFragment.composeFiles.filter((entry) => entry.slot === slot).map((entry) => entry.file);
}

/** The platform files of a mode, in order. */
function platformFiles(mode: ComposeMode, options: ComposeFilesOptions): string[] {
  const telemetry = options.telemetry === true;
  switch (mode) {
    case 'dev':
      return ['base.compose.yml', 'dev.compose.yml', ...(telemetry ? telemetryFiles('after-prod') : [])];
    case 'devdb':
      return ['base.compose.yml', 'dev.compose.yml', 'devdb.compose.yml', ...(telemetry ? telemetryFiles('after-prod') : [])];
    case 'prod':
      return ['base.compose.yml', 'prod.compose.yml', ...(telemetry ? telemetryFiles('after-prod') : [])];
    case 'vps':
      return [
        'base.compose.yml',
        'prod.compose.yml',
        ...(telemetry ? telemetryFiles('after-prod') : []),
        'vps.compose.yml',
        ...(telemetry ? telemetryFiles('after-vps') : []),
      ];
    case 'worker':
      return ['worker.compose.yml', ...(options.build === true ? ['worker.build.compose.yml'] : [])];
  }
}

/**
 * The app overlays among `names` that apply to `mode`, sorted by file name
 * (code-point order, so the result does not depend on the locale).
 *
 * @param names - File names (not paths), typically a listing of `infra/compose/`.
 * @param mode - The stack being built.
 * @returns The overlay file names, in the order they are applied.
 * @stability experimental
 * @extensionPoint overlay
 * @example
 * ```ts
 * appComposeOverlays(readdirSync('infra/compose'), 'vps'); // ['app.prod.memory.compose.yml', 'app.vps.no-agent.compose.yml']
 * ```
 */
export function appComposeOverlays(names: readonly string[], mode: ComposeMode): string[] {
  const platform = new Set(platformFiles(mode, { telemetry: false, build: false }));
  const applies = (name: string): boolean => {
    const match = OVERLAY.exec(name);
    if (match === null || EXAMPLE.test(name)) return false;
    const [first] = (match[1] ?? '').split('.');
    const scope = SCOPES.find((candidate) => candidate === first);
    if (scope === undefined) return platform.has('base.compose.yml');
    return platform.has(`${scope}.compose.yml`);
  };
  return [...new Set(names)].filter(applies).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The `-f` files of a mode, in the order Compose must apply them: the
 * platform's files in their documented order, then the app's overlays sorted
 * by file name.
 *
 * @param mode - The stack being built.
 * @param options - Telemetry, the worker build file, and the names in the app's `infra/compose/`.
 * @returns File names relative to `infra/compose/`.
 * @stability experimental
 * @extensionPoint overlay
 * @example
 * ```ts
 * composeFilesForMode('vps', { telemetry: true, overlays: readdirSync('infra/compose') });
 * // ['base.compose.yml', 'prod.compose.yml', 'telemetry.compose.yml', 'vps.compose.yml',
 * //  'vps.telemetry.compose.yml', ...app overlays]
 * ```
 */
export function composeFilesForMode(mode: ComposeMode, options: ComposeFilesOptions = {}): string[] {
  return [...platformFiles(mode, options), ...appComposeOverlays(options.overlays ?? [], mode)];
}

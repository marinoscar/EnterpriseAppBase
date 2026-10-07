import { registerEnvSpecFragment, resetCommandRegistryForTests, resetEnvSpecRegistryForTests } from '../core/index.js';
import { telemetryEnvSpecFragment } from '../telemetry/index.js';

import { ENV_METADATA } from './deploy/env-metadata.js';

// =============================================================================
// The platform's built-in registrations  (PP-4.5 #706, PP-8.9 #715)
// =============================================================================
//
// The env-spec fragments every app gets, in the order they contribute:
//
//   1. the platform base (`ENV_METADATA`, the keys of
//      @marinoscar/platform-infra's env/base.env.example);
//   2. each enabled slice (`telemetry`).
//
// The app's own fragments (`createCli({ envSpecFragments })`) come after
// them, for the keys of its `infra/compose/app.env.example`, which sync
// appends after the platform's in `.env.example`: one order, three layers.
//
// LAZY, NEVER ON IMPORT: this runs from the places that read the registries,
// `metadataFor()` (deploy/env-metadata.ts) and `buildProgram()`, and from
// `createCli`. IDEMPOTENT: the first call registers, later calls return at
// once. A first call that THROWS (a key owned twice) is remembered and
// rethrown: a half-registered CLI must not start working on a second try.
// =============================================================================

/**
 * The fragment id of the platform's own env-key map. It is a fragment like any
 * other so that "one owner per key" is one rule: a key in this map AND in an
 * app's fragment throws, naming both.
 */
export const PLATFORM_ENV_FRAGMENT_ID = 'platform';

let registered = false;
let failure: unknown;

function registerAll(): void {
  // The platform base first, so a collision always names it as the owner.
  registerEnvSpecFragment({ id: PLATFORM_ENV_FRAGMENT_ID, metadata: ENV_METADATA });
  // Slice fragments, in slice order.
  registerEnvSpecFragment(telemetryEnvSpecFragment);
}

/**
 * Registers the platform's env-spec fragments exactly once per process. Safe
 * to call any number of times.
 */
export function ensurePlatformRegistrations(): void {
  if (registered) return;
  if (failure !== undefined) throw failure;
  try {
    registerAll();
    registered = true;
  } catch (error) {
    failure = error;
    throw error;
  }
}

/** Empties both core registries and forgets the registration. Tests only. */
export function resetPlatformRegistrationsForTests(): void {
  resetEnvSpecRegistryForTests();
  resetCommandRegistryForTests();
  registered = false;
  failure = undefined;
}

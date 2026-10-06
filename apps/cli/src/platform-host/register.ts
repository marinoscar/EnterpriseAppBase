import { registerEnvSpecFragment, resetCommandRegistryForTests, resetEnvSpecRegistryForTests } from '@marinoscar/platform-cli/core';
import { telemetryEnvSpecFragment } from '@marinoscar/platform-cli/telemetry';

import { ENV_METADATA } from '../deploy/env-metadata.js';

// =============================================================================
// Where this CLI plugs into the platform registries  (PP-4.5, #706)
// =============================================================================
//
// The ONE place this app registers anything with `@marinoscar/platform-cli`:
// its own env-key map, the slices' env-spec fragments and its own commands.
// A fork adds its fragments and `registerCliCommand(...)` calls HERE, so what
// the CLI can do stays grep-able from one file.
//
// LAZY, NEVER ON IMPORT. `cli.ts` is "the ONLY module in this package with
// side effects at import time" and `program.ts` "runs nothing on import", so
// this runs from the two places that read the registries: `metadataFor()` in
// deploy/env-metadata.ts and `buildProgram()` in program.ts. Every existing
// test that calls either one therefore sees the fragments with no setup.
//
// IDEMPOTENT. The first call registers; later calls return at once. A first
// call that THROWS (a key owned twice, a command name taken) is remembered and
// rethrown by every later call: a half-registered CLI must not start working
// on the second attempt.
// =============================================================================

/**
 * The fragment id this CLI's own `ENV_METADATA` map is registered under. It
 * is a fragment like any other so that "one owner per key" is one rule: a key
 * in this map AND in a slice's fragment throws, naming both.
 */
export const APP_ENV_FRAGMENT_ID = 'apps/cli ENV_METADATA';

let registered = false;
let failure: unknown;

function registerAll(): void {
  // This CLI's own map first, so a collision always names it as the owner.
  registerEnvSpecFragment({ id: APP_ENV_FRAGMENT_ID, metadata: ENV_METADATA });

  // Slice fragments. A fork appends its own here.
  registerEnvSpecFragment(telemetryEnvSpecFragment);

  // App commands, added after the built-ins by `buildProgram()`. This
  // reference CLI has none of its own; a fork registers one like this:
  //
  //   registerCliCommand((program) =>
  //     program.command('coach-seed').description('Seed coach data').action(seedCoachData),
  //   );
}

/**
 * Registers this CLI's env-key metadata, the slices' fragments and its app
 * commands, exactly once per process. Safe to call any number of times.
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

/** Empties both platform registries and forgets the registration. Tests only. */
export function resetPlatformRegistrationsForTests(): void {
  resetEnvSpecRegistryForTests();
  resetCommandRegistryForTests();
  registered = false;
  failure = undefined;
}

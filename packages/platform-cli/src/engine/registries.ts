import { freezeCommandRegistry, freezeEnvSpecRegistry } from '../core/index.js';

import { resetPlatformRegistrationsForTests } from './builtin-registrations.js';
import { freezeDeployStepRegistry, resetDeployStepRegistryForTests } from './deploy/steps/registry.js';
import { freezeNodeExecutorRegistry, resetNodeExecutorRegistryForTests } from './node/executors/registry.js';
import { freezeTuiScreenRegistry, resetTuiScreenRegistryForTests } from './tui/screen-registry.js';

// =============================================================================
// The CLI's registries, together  (PP-8.9, #715)
// =============================================================================
//
// Five registries make a CLI an app's own: commands and env-spec fragments
// (`/core`, #706), TUI screens, deploy steps and node executors. Each has
// string ids, a duplicate-id error and a deterministic order (built-ins
// first, then registration order). `createCli` FREEZES all five once the CLI
// is built: a registration that arrives later would be missing from the CLI
// that is already running, so it throws instead of being silently ignored.
// =============================================================================

/** Freezes every CLI registry; `createCli` calls it last. */
export function freezeCliRegistries(by: string): void {
  freezeCommandRegistry(by);
  freezeEnvSpecRegistry(by);
  freezeTuiScreenRegistry(by);
  freezeDeployStepRegistry(by);
  freezeNodeExecutorRegistry(by);
}

/** Empties and unfreezes every CLI registry. Tests only. */
export function resetCliRegistriesForTests(): void {
  resetPlatformRegistrationsForTests();
  resetTuiScreenRegistryForTests();
  resetDeployStepRegistryForTests();
  resetNodeExecutorRegistryForTests();
}

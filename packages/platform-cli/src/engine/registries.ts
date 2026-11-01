import {
  freezeCommandRegistry,
  freezeEnvAnnotationRegistry,
  freezeEnvGeneratorRegistry,
  freezeEnvGroupRegistry,
  freezeEnvSpecRegistry,
  resetEnvAnnotationRegistryForTests,
  resetEnvGeneratorRegistryForTests,
} from '../core/index.js';

import { resetPlatformRegistrationsForTests } from './builtin-registrations.js';
import { resetVersionedManifestsForTests } from './deploy/app-version.js';
import { freezeDeployCheckRegistry, resetDeployCheckRegistryForTests } from './deploy/checks/registry.js';
import { freezeEdgeConfigRegistry, resetEdgeConfigRegistryForTests } from './deploy/edge-config.js';
import { freezeProxyStreamRegistry, resetProxyStreamRegistryForTests } from './deploy/proxy-streams.js';
import { freezeDeployStepRegistry, resetDeployStepRegistryForTests } from './deploy/steps/registry.js';
import { resetCapabilityRegistriesForTests } from './node/capabilities.js';
import { freezeNodeExecutorRegistry, resetNodeExecutorRegistryForTests } from './node/executors/registry.js';
import { freezeTuiSectionRegistry, resetTuiSectionRegistryForTests } from './tui/section-registry.js';
import { freezeTuiScreenRegistry, resetTuiScreenRegistryForTests } from './tui/screen-registry.js';
import { resetUpdateNoticeForTests } from './update-notice-options.js';

// =============================================================================
// The CLI's registries, together  (PP-8.9, #715)
// =============================================================================
//
// Registries make a CLI an app's own: commands and env-spec fragments
// (`/core`, #706), TUI screens, deploy steps, node executors and (PP-14.22)
// proxy stream paths and the other deploy extension points. Each has
// string ids, a duplicate-id error and a deterministic order (built-ins
// first, then registration order). `createCli` FREEZES all five once the CLI
// is built: a registration that arrives later would be missing from the CLI
// that is already running, so it throws instead of being silently ignored.
// =============================================================================

/** Freezes every CLI registry; `createCli` calls it last. */
export function freezeCliRegistries(by: string): void {
  freezeCommandRegistry(by);
  freezeEnvSpecRegistry(by);
  freezeEnvGroupRegistry(by);
  freezeEnvGeneratorRegistry(by);
  freezeEnvAnnotationRegistry(by);
  freezeTuiScreenRegistry(by);
  freezeDeployStepRegistry(by);
  freezeNodeExecutorRegistry(by);
  freezeTuiSectionRegistry(by);
  freezeProxyStreamRegistry(by);
  freezeDeployCheckRegistry(by);
  freezeEdgeConfigRegistry(by);
}

/** Empties and unfreezes every CLI registry. Tests only. */
export function resetCliRegistriesForTests(): void {
  resetPlatformRegistrationsForTests();
  resetTuiScreenRegistryForTests();
  resetTuiSectionRegistryForTests();
  resetDeployStepRegistryForTests();
  resetNodeExecutorRegistryForTests();
  resetCapabilityRegistriesForTests();
  resetProxyStreamRegistryForTests();
  resetEnvGeneratorRegistryForTests();
  resetEnvAnnotationRegistryForTests();
  resetDeployCheckRegistryForTests();
  resetEdgeConfigRegistryForTests();
  resetVersionedManifestsForTests();
  resetUpdateNoticeForTests();
}

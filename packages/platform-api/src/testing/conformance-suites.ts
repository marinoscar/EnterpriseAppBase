import { defineRegistry } from '../core/index';

import type { ConformanceAppSuite, ConformanceSuite } from './conformance-suite';
import { cronEnqueueOnlySuite } from './suites/cron-enqueue-only';
import { userOwnedDataSuite } from './suites/user-owned-data';

/**
 * Every conformance suite `runPlatformConformance` can run, keyed by suite id.
 *
 * A static registry (`defineRegistry`), filled here at import time and frozen
 * by the harness on its first run: test processes never bootstrap Nest, so
 * `RegistryFreezeService` does not run there. A later suite registers by adding
 * itself to this file; the runner is not edited.
 *
 * @extensionPoint registry
 * @stability experimental
 */
// `any` only at the registry boundary: each entry has its own options type, and
// the runner narrows through the typed `PlatformConformanceOptions.suites` map.
export const conformanceSuites = defineRegistry<ConformanceSuite<any> | ConformanceAppSuite<any>>({
  name: 'platform-conformance-suites',
  idOf: (suite) => suite.id,
  order: 'registration',
});

conformanceSuites.register(cronEnqueueOnlySuite);
conformanceSuites.register(userOwnedDataSuite);

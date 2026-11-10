// =============================================================================
// RegistryFreezeService (issue #675, PP-1.3)
// =============================================================================
//
// Static registries (`defineRegistry`) fill at import time, from their
// manifests, so every entry is present before Nest instantiates a single
// provider. Once the application has bootstrapped, a late `register()` can only
// be a mistake: some consumer may already have read the list (a DTO built its
// enum, the seed ran, a guard cached a lookup). Freezing turns that mistake into
// a loud `FROZEN` error instead of a list that differs depending on timing.
//
// `onApplicationBootstrap`, not `onModuleInit`, so the freeze runs after every
// module's init hook, the same lifecycle point `jobs/job.worker.ts` starts work
// at. Not `main.ts`: integration specs bootstrap through
// `Test.createTestingModule({ imports: [AppModule] })` and would never exercise
// it. `npm run openapi:dump` (Nest preview mode) never bootstraps, so nothing
// freezes there, which is fine: nothing registers there either.
//
// Freezing is idempotent, so the second Nest application a Jest worker creates
// simply finds the registries already frozen.
// =============================================================================

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { freezeDefinedRegistries, listDefinedRegistries } from './registry';

/**
 * Freezes every registry made with `defineRegistry` once the Nest application
 * has bootstrapped. Provide it in a module of the app (the base provides it in
 * `CommonModule`).
 *
 * @stability stable
 */
@Injectable()
export class RegistryFreezeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegistryFreezeService.name);

  /** Freezes every registry created with `defineRegistry` and logs their sizes. */
  onApplicationBootstrap(): void {
    freezeDefinedRegistries();

    const registries = listDefinedRegistries();
    const summary = registries.map((r) => `${r.name}(${r.size})`).join(', ');
    this.logger.debug(`Froze ${registries.length} static registries: ${summary || '(none)'}`);
  }
}

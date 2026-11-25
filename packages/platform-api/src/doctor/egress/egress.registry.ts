// =============================================================================
// Egress dependency registry (issue #773, PP-13.2)
// =============================================================================
//
// The one place that knows which modules describe outbound dependencies. It
// mirrors `DoctorCheckRegistry` exactly, for the same reasons (read that
// file's header): explicit self-registration from each contributor's own
// `onModuleInit`, duplicate ids throw, frozen in `onApplicationBootstrap`.
//
// Provided (globally) by `DoctorModule.forRoot()`, so a feature module
// contributes by providing its contributor, without importing the Doctor.
// =============================================================================

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { Registry } from '../../core/index';
import type { EgressContributor } from './egress.types';

/**
 * The modules that describe the deployment's outbound dependencies. The
 * `network.egress` doctor check reads every contributor; a support bundle may
 * read the same inventory.
 *
 * @stability experimental
 */
@Injectable()
export class EgressRegistry implements OnApplicationBootstrap {
  private readonly contributors = new Registry<EgressContributor>({
    name: 'egress-contributors',
    idOf: (contributor) => contributor.id,
    describeDuplicate: (existing, incoming) =>
      `Duplicate egress contributor id "${incoming.id}": ${existing.constructor.name} and ` +
      `${incoming.constructor.name} both register it. Contributor ids must be unique.`,
  });

  /**
   * Adds `contributor`. Call it from the contributor's own `onModuleInit`.
   *
   * @param contributor - its `id` must be unique across the application.
   * @throws RegistryError `DUPLICATE_ID` when another contributor already uses
   *   its id, `FROZEN` after the application has bootstrapped.
   *
   * @example
   * ```ts
   * onModuleInit(): void {
   *   this.egress.register(this);
   * }
   * ```
   *
   * @extensionPoint registry
   */
  register(contributor: EgressContributor): void {
    this.contributors.register(contributor);
  }

  /** Every registered contributor, in registration order (a copy). */
  list(): EgressContributor[] {
    return this.contributors.list();
  }

  /** Refuses further registrations once every module's `onModuleInit` has run. */
  onApplicationBootstrap(): void {
    this.contributors.freeze();
  }
}

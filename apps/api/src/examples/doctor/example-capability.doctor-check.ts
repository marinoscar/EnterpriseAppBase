// =============================================================================
// Worked example: an app-owned Doctor check (issue #879)
// =============================================================================
//
// The generic checks (database, migrations, RLS role, encryption key, deployment
// mode, network egress) ship in `@marinoscar/platform-api/host` and register
// themselves; every slice registers its own. What an app adds is a check for a
// capability only it owns: one read-only provider that registers itself with
// `DoctorCheckRegistry` from its own `onModuleInit`.
//
// NOT mounted by `ExamplesModule`: the reference app's registered check ids are
// pinned by `test/doctor/registered-checks.integration.spec.ts`. The spec beside
// this file registers it into a throwaway registry.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';

/** What the example reads: any cheap, read-only fact about the app's own capability. */
export interface ExampleCapabilityFacts {
  /** Whether the capability's configuration is present. */
  configured: boolean;
  /** Whether the capability is switched on. */
  enabled: boolean;
}

/** Pure: the verdict, with a remedy on every `warn` and `fail`. */
export function decideExampleCapability(facts: ExampleCapabilityFacts): DoctorCheckOutcome {
  if (!facts.enabled) return { status: 'skip', detail: 'The capability is switched off (intentional)' };
  if (!facts.configured) {
    return {
      status: 'fail',
      detail: 'The capability is on but has no configuration',
      remedy: 'Open the capability settings page and fill in the missing fields.',
    };
  }
  return { status: 'pass', detail: 'The capability is configured' };
}

/** `example` / `example.capability`: the shape of an app-owned check. */
@Injectable()
export class ExampleCapabilityDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'example.capability';
  readonly category = 'example';
  readonly label = 'Example capability';
  /** Runs after, and is skipped with, the database check. */
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly read: () => Promise<ExampleCapabilityFacts> = async () => ({ configured: true, enabled: false }),
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideExampleCapability(await this.read());
  }
}

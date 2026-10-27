// Two Doctor checks contributed by the consumer's own feature module, the way
// an app registers a check (DoctorCheckRegistry.register from onModuleInit).
// Constructor injection of DoctorCheckRegistry only works when decorator
// metadata survives the build AND the consumer's import of the class is the
// same instance DoctorModule provides (one copy of the package).

import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import type { DoctorCheck, DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';

export const SMOKE_CATEGORY = 'smoke';

@Injectable()
export class SmokeConsumerCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'smoke.consumer';
  readonly category = SMOKE_CATEGORY;
  readonly label = 'Consumer smoke check';

  constructor(private readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return { status: 'pass', detail: 'Registered by the consumer app', data: { external: true } };
  }
}

@Injectable()
export class SmokeDependentCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'smoke.dependent';
  readonly category = SMOKE_CATEGORY;
  readonly label = 'Consumer dependent check';
  readonly dependsOn = ['smoke.consumer'] as const;

  constructor(private readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return { status: 'warn', detail: 'A deliberate warning', remedy: 'Nothing to fix: the smoke expects this warning.' };
  }
}

@Module({ providers: [SmokeConsumerCheck, SmokeDependentCheck] })
export class SmokeFeatureModule {}

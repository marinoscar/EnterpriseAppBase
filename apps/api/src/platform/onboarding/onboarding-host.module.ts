import { Module } from '@nestjs/common';
import { ONBOARDING_DATA, ONBOARDING_FEATURES } from '@marinoscar/platform-api/onboarding';

import { AiConfigModule } from '@marinoscar/platform-api/ai';
import { OnboardingDataAdapter } from './onboarding-data.adapter';
import { OnboardingFeaturesAdapter } from './onboarding-features.adapter';

// =============================================================================
// The onboarding slice's host ports, bound to the reference app (issue #745)
// =============================================================================
//
// Passed to `OnboardingModule.forRoot({ imports: [OnboardingHostModule] })`
// (./onboarding.config.ts). `PrismaService` comes from the global
// `PrismaModule`, `SystemSettingsService` from the global settings module;
// the AI kill switch needs `AiConfigModule`.
// =============================================================================

const PORTS = [
  { provide: ONBOARDING_DATA, useClass: OnboardingDataAdapter },
  { provide: ONBOARDING_FEATURES, useClass: OnboardingFeaturesAdapter },
];

@Module({
  imports: [AiConfigModule],
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class OnboardingHostModule {}

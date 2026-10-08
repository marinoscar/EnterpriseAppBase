// =============================================================================
// The onboarding slice's ONBOARDING_FEATURES gate, bound to the reference app
// (#745)
// =============================================================================
//
// The same switches that hide the web's settings cards: `ai` (the AI kill
// switch), `telemetry` (the telemetry policy) and `orgs` (multi-org mode). A
// feature this app does not know is off, so a step gated on it is omitted.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { currentTenancyMode } from '@marinoscar/platform-api/identity';
import type { OnboardingFeatureGate } from '@marinoscar/platform-api/onboarding';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AiConfigService } from '../../ai/config/ai-config.service';

@Injectable()
export class OnboardingFeaturesAdapter implements OnboardingFeatureGate {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async isEnabled(feature: string): Promise<boolean> {
    switch (feature) {
      case 'ai':
        return this.aiConfig.isEnabled();
      case 'telemetry':
        return (await this.systemSettings.getNamespace('telemetry')).enabled === true;
      case 'orgs':
        return currentTenancyMode() === 'multi';
      default:
        return false;
    }
  }
}

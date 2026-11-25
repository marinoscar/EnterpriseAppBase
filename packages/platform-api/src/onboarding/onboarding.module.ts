// =============================================================================
// OnboardingModule: the onboarding slice's one composition entry point (#745)
// =============================================================================
//
// `OnboardingModule.forRoot(options)` mounts `GET /api/onboarding` and
// `GET /api/admin/onboarding/metrics`. The steps, facts, orderings and
// milestones are static registries the app fills at import time (its
// manifest); the module reads them per request, and checks at bootstrap that
// every fact a step names is registered.
// =============================================================================

import { DynamicModule, Module } from '@nestjs/common';

import { OnboardingMetricsService } from './onboarding-metrics';
import { createOnboardingControllers } from './onboarding.controller';
import {
  ONBOARDING_OPTIONS,
  resolveOnboardingModuleOptions,
  type OnboardingModuleOptions,
} from './onboarding.options';
import { OnboardingService } from './onboarding.service';

/**
 * The onboarding slice: the derived Get started and Setup guide checklists
 * and the aggregate activation metrics.
 *
 * @stability experimental
 */
@Module({})
export class OnboardingModule {
  /**
   * The slice for one app. Call once, after the app's onboarding manifest ran.
   *
   * @param options - see {@link OnboardingModuleOptions}; `imports` must bind `ONBOARDING_DATA`.
   * @returns the dynamic module. It provides and exports `OnboardingService`,
   *   `OnboardingMetricsService` and `ONBOARDING_OPTIONS`.
   * @throws Error when an option is malformed.
   *
   * @example
   * ```ts
   * import '../../onboarding/onboarding.manifest'; // registers the steps and facts
   * export const onboardingModule = OnboardingModule.forRoot({ imports: [OnboardingHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: OnboardingModuleOptions = {}): DynamicModule {
    const resolved = resolveOnboardingModuleOptions(options);
    return {
      module: OnboardingModule,
      imports: [...resolved.imports],
      controllers: createOnboardingControllers(resolved),
      providers: [{ provide: ONBOARDING_OPTIONS, useValue: resolved }, OnboardingService, OnboardingMetricsService],
      exports: [ONBOARDING_OPTIONS, OnboardingService, OnboardingMetricsService],
    };
  }
}

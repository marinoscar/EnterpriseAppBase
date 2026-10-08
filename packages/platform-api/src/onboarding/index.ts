// `@marinoscar/platform-api/onboarding`: the onboarding slice (issue #745,
// PP-9.3). The step, fact, ordering and milestone registries, the derived
// `GET /api/onboarding`, the aggregate `GET /api/admin/onboarding/metrics`
// and the `onboarding` user-settings namespace. Documented in ./README.md.
// Explicit named exports only.

// ---- the module and its options (rung 1) ----------------------------------------------
export { OnboardingModule } from './onboarding.module';
export {
  DEFAULT_ONBOARDING_OPTIONS,
  ONBOARDING_OPTIONS,
  resolveOnboardingModuleOptions,
} from './onboarding.options';
export type { OnboardingModuleOptions, ResolvedOnboardingModuleOptions } from './onboarding.options';

// ---- the host ports (rung 3) ----------------------------------------------------------
export { ONBOARDING_DATA, ONBOARDING_FEATURES } from './ports';
export type { OnboardingDataPort, OnboardingFeatureGate } from './ports';

// ---- the declarations and registries (rung 2) ------------------------------------------
export type {
  ActivationMilestoneDef,
  OnboardingCaller,
  OnboardingDoctorAccess,
  OnboardingEvaluation,
  OnboardingFactDef,
  OnboardingFacts,
  OnboardingOrderableStep,
  OnboardingOrderingDef,
  OnboardingRequestContext,
  OnboardingStepDef,
} from './onboarding.types';
export {
  DOCTOR_FACT_ID,
  activationMilestoneRegistry,
  assertOnboardingRegistries,
  factIdsOf,
  onboardingFactRegistry,
  onboardingOrderingRegistry,
  onboardingStepRegistry,
  registerActivationMilestone,
  registerOnboardingFact,
  registerOnboardingOrdering,
  registerOnboardingStep,
} from './onboarding.registries';
export {
  ONBOARDING_FACTS,
  ONBOARDING_STEP_IDS,
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
} from './onboarding.builtins';
export type { OnboardingPrincipalFact } from './onboarding.builtins';

// ---- the stored namespace --------------------------------------------------------------
export {
  ONBOARDING_USER_SETTINGS,
  extendOnboardingSettings,
  isSkippableStepId,
  mergeOnboardingSettings,
  readOnboardingState,
} from './onboarding.settings';

// ---- the engine, the services and the routes ---------------------------------------------
export { compareSteps, evaluateDoctorChecks, evaluateOnboarding } from './onboarding.engine';
export type { OnboardingEngineInput, OnboardingEngineResult } from './onboarding.engine';
export { OnboardingService } from './onboarding.service';
export type { OnboardingServiceCaller } from './onboarding.service';
export { OnboardingMetricsService, buildOnboardingMetricsSql } from './onboarding-metrics';
export type { OnboardingMetricsQuery } from './onboarding-metrics';
export {
  OnboardingMetricsQueryDto,
  OnboardingMetricsResponseDto,
  OnboardingQueryDto,
  OnboardingResponseDto,
  createOnboardingControllers,
} from './onboarding.controller';

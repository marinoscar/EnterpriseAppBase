// `@marinoscar/platform-web/onboarding/headless`: the onboarding client, the
// provider and its hooks, the feature-notice registry and the "Getting
// started" action, with no component but the provider (issue #745).
// Documented in ../README.md.

export type {
  OnboardingBlock,
  OnboardingFunnelStep,
  OnboardingMetricsResponse,
  OnboardingMilestoneMetric,
  OnboardingResponse,
  OnboardingState,
  OnboardingStep,
} from '@marinoscar/platform-contract/onboarding';
export { createOnboardingClient } from './client.js';
export type { OnboardingClient, OnboardingSettingsWrite } from './client.js';
export { ONBOARDING_INERT, OnboardingProvider, useOnboarding } from './provider.js';
export type { OnboardingProviderProps, UseOnboardingReturn } from './provider.js';
export { useOnboardingMetrics } from './use-onboarding-metrics.js';
export type { UseOnboardingMetricsReturn } from './use-onboarding-metrics.js';
export {
  PLATFORM_FEATURE_NOTICES,
  featureNoticeFor,
  registerFeatureNotice,
  registeredFeatureNotices,
} from './feature-notices.js';
export type { FeatureNoticeDef } from './feature-notices.js';
export { GETTING_STARTED_LABEL, useGettingStartedAction } from './getting-started.js';
export type { GettingStartedAction } from './getting-started.js';

// `@marinoscar/platform-contract/onboarding`: the onboarding slice's wire
// shapes (issue #745, PP-9.3): the stored `onboarding` user-settings
// namespace, `GET /api/onboarding` and `GET /api/admin/onboarding/metrics`.
// Documented in ./README.md. Explicit named exports only.

export {
  ONBOARDING_ADMIN_PERMISSION,
  ONBOARDING_AUDIENCES,
  ONBOARDING_METRICS_DAYS_DEFAULT,
  ONBOARDING_METRICS_DAYS_MAX,
  ONBOARDING_METRICS_PATH,
  ONBOARDING_PATH,
  ONBOARDING_READ_PERMISSION,
  ONBOARDING_SETTINGS_KEY,
  ONBOARDING_SKIPPED_MAX,
  ONBOARDING_STATUSES,
  ONBOARDING_STEP_ID_MAX,
  ONBOARDING_STEP_ID_PATTERN,
  ONBOARDING_TIERS,
} from './constants.js';
export type { OnboardingAudience, OnboardingStatus, OnboardingTier } from './constants.js';
export {
  onboardingAudienceSchema,
  onboardingRefreshSchema,
  onboardingStatusSchema,
  onboardingTierSchema,
  onboardingBlockSchema,
  onboardingFunnelStepSchema,
  onboardingMetricsQuerySchema,
  onboardingMetricsResponseSchema,
  onboardingMilestoneMetricSchema,
  onboardingQuerySchema,
  onboardingResponseSchema,
  onboardingSettingsPatchSchema,
  onboardingSettingsSchema,
  onboardingSettingsShape,
  onboardingStateSchema,
  onboardingStepSchema,
} from './schemas.js';
export type {
  OnboardingAudienceEnum,
  OnboardingRefreshEnum,
  OnboardingStatusEnum,
  OnboardingTierEnum,
  OnboardingBlock,
  OnboardingFunnelStep,
  OnboardingMetricsResponse,
  OnboardingMilestoneMetric,
  OnboardingResponse,
  OnboardingSettings,
  OnboardingSettingsPatch,
  OnboardingState,
  OnboardingStep,
} from './schemas.js';

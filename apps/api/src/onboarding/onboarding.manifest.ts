// =============================================================================
// Onboarding manifest (issue #745)
// =============================================================================
//
// The explicit, grep-able list of what the onboarding checklists are made of:
// the platform's facts and steps first, then the app's
// (`app-registrations/onboarding.ts`), so a collision with a platform id
// names the app's entry. Imported for its side effect by
// `platform/onboarding/onboarding.config.ts`, before `OnboardingModule.forRoot()`.
// =============================================================================

import {
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  registerActivationMilestone,
  registerOnboardingFact,
  registerOnboardingOrdering,
  registerOnboardingStep,
} from '@marinoscar/platform-api/onboarding';

import {
  APP_ACTIVATION_MILESTONES,
  APP_ONBOARDING_FACTS,
  APP_ONBOARDING_ORDERINGS,
  APP_ONBOARDING_STEPS,
} from '../app-registrations/onboarding';

registerOnboardingFact(...PLATFORM_ONBOARDING_FACTS);
registerOnboardingStep(...PLATFORM_ONBOARDING_STEPS);

registerOnboardingFact(...APP_ONBOARDING_FACTS);
registerOnboardingStep(...APP_ONBOARDING_STEPS);
for (const ordering of APP_ONBOARDING_ORDERINGS) registerOnboardingOrdering(ordering);
for (const milestone of APP_ACTIVATION_MILESTONES) registerActivationMilestone(milestone);

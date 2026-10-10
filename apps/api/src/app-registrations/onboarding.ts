// =============================================================================
// App-owned onboarding steps, facts, orderings and milestones (issue #745)
// =============================================================================
//
// This application's own onboarding entries. Upstream keeps every array empty
// forever: the platform's steps (`admin.*`, `user.*`) are registered by
// `onboarding/onboarding.manifest.ts`. A fork adds its activation steps here
// (each id `<app>.<step>`, permanent once users skipped it), the facts they
// read, at most one ordering per audience and its activation milestone, and
// never edits a platform declaration. Worked examples of every kind:
// `platform-extensions/onboarding/examples/`.
//
// Fields an app adds to the stored `onboarding` namespace (a goal question,
// say) go in `APP_USER_SETTINGS_EXTENSIONS` (`app-registrations/settings.ts`)
// with `extendOnboardingSettings({ ... })`.
//
// Pure data: no `register()` calls, no Nest, no Prisma.
// =============================================================================

import type {
  ActivationMilestoneDef,
  OnboardingFactDef,
  OnboardingOrderingDef,
  OnboardingStepDef,
} from '@marinoscar/platform-api/onboarding';

/** This app's own onboarding facts. */
export const APP_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [];

/** This app's own onboarding steps. */
export const APP_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [];

/** This app's ordering hooks (at most one per audience). */
export const APP_ONBOARDING_ORDERINGS: readonly OnboardingOrderingDef[] = [];

/** This app's activation milestones (optional; without one the metrics report the cohort and funnel only). */
export const APP_ACTIVATION_MILESTONES: readonly ActivationMilestoneDef[] = [];

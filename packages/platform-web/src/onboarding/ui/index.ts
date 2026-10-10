// `@marinoscar/platform-web/onboarding/ui`: the welcome dialog, the
// checklist, the Setup guide and Getting started pages, the Activation
// section, the feature notice and the "Getting started" menu item, built on
// `/onboarding/headless` (issue #745). Documented in ../README.md.

export { ACTIVATION_WINDOWS, ActivationMetrics, formatHours, formatRate } from './ActivationMetrics.js';
export {
  ACTIVATION_HEADING,
  DOCTOR_PATH,
  EMPTY_COHORT_TEXT,
  FEATURE_SET_UP_LABEL,
  FEATURE_UNAVAILABLE_BODY,
  GETTING_STARTED_DESCRIPTION,
  GETTING_STARTED_PATH,
  GETTING_STARTED_TITLE,
  SETUP_GUIDE_DESCRIPTION,
  SETUP_GUIDE_PATH,
  SETUP_GUIDE_TITLE,
} from './copy.js';
export { FeatureUnavailableNotice } from './FeatureUnavailableNotice.js';
export type { FeatureUnavailableNoticeProps } from './FeatureUnavailableNotice.js';
export { GettingStartedMenuItem } from './GettingStartedMenuItem.js';
export type { GettingStartedMenuItemProps } from './GettingStartedMenuItem.js';
export { GettingStartedPage } from './GettingStartedPage.js';
export { ONBOARDING_TIER_LABELS, OnboardingChecklist, onboardingStatusWord } from './OnboardingChecklist.js';
export type { OnboardingChecklistProps } from './OnboardingChecklist.js';
export { SetupGuidePage } from './SetupGuidePage.js';
export type { SetupGuidePageProps } from './SetupGuidePage.js';
export { gettingStartedSettingsPage, setupGuideSettingsPage } from './settings-pages.js';
export { WelcomeDialog } from './WelcomeDialog.js';
export type { WelcomeDialogProps, WelcomeDialogSlots, WelcomePaneProps } from './WelcomeDialog.js';

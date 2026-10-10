// =============================================================================
// Reference example: an activation milestone, an ordering hook and an app
// field in the stored namespace (#745)
// =============================================================================
//
//   - The MILESTONE is the event onboarding exists to cause. The metrics count,
//     over eligible users (created at least `windowDays` ago), who reached it
//     within the window, and the median hours to it. One SQL expression for the
//     cohort user `c.id`; no per-user row leaves the database.
//   - The ORDERING puts unfinished user steps first (EvoPath orders by the
//     goal its welcome dialog asks); one per audience.
//   - The EXTENSION adds a field to the strict `onboarding` namespace
//     (EvoPath's `goal`); list it in `APP_USER_SETTINGS_EXTENSIONS`.
// =============================================================================

import {
  extendOnboardingSettings,
  type ActivationMilestoneDef,
  type OnboardingOrderingDef,
} from '@marinoscar/platform-api/onboarding';
import { z } from 'zod';

/** The milestone: the first personal access token, within 7 days of sign-up. */
export const FIRST_TOKEN_MILESTONE: ActivationMilestoneDef = {
  id: 'first_token',
  label: 'First personal access token',
  windowDays: 7,
  firstReachedAtSql: '(SELECT MIN(t.created_at) FROM personal_access_tokens t WHERE t.user_id = c.id)',
};

/** The ordering: unfinished user steps first, otherwise the registered order. */
export const UNFINISHED_FIRST_ORDERING: OnboardingOrderingDef = {
  audience: 'user',
  facts: [],
  order: (steps) => [
    ...steps.filter((step) => step.evaluation.status !== 'done'),
    ...steps.filter((step) => step.evaluation.status === 'done'),
  ],
};

/** The extension: a `role` answer the welcome dialog could ask. */
export const ROLE_QUESTION_EXTENSION = extendOnboardingSettings({
  role: z.enum(['developer', 'operator', 'other']).optional(),
});

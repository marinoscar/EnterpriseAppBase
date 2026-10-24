// =============================================================================
// Reference example: an admin step backed by a reference-app Doctor check (#745)
// =============================================================================
//
// `doctorChecks` is the whole declaration: the step reuses the Doctor's report
// (its cache, its timeouts, its remedies), is `done` only when every mapped
// check passes (a `skip` is not a pass), shows the first non-passing check's
// remedy as its hint, and is omitted when the check is not registered. Here:
// the reference app's `db.rls_role` check (`@marinoscar/platform-api/host`, `doctor/`), "the API runs as
// an ordinary database role".
// =============================================================================

import type { OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

/** The step: a required admin step (never skippable) over one Doctor check. */
export const RLS_ROLE_STEP: OnboardingStepDef = {
  id: 'reference.db-role',
  audience: 'admin',
  tier: 'required',
  order: 15,
  title: 'Run the API as an ordinary database role',
  description: 'Row-level security protects organizations from each other only when the API is not a superuser.',
  actionLabel: 'Open the Doctor',
  href: '/admin/settings/doctor',
  permission: 'system_settings:read',
  skippable: false,
  facts: [],
  doctorChecks: ['db.rls_role'],
};

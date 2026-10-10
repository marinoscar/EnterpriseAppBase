---
"@marinoscar/platform-api": minor
---

Add the `./onboarding` and `./onboarding/testing` subpaths (#745): `OnboardingModule.forRoot({ adminPermission, initialAdminEmailEnv, imports })` with `GET /api/onboarding` (the stored UI state and the derived user and admin checklists, read-only, `refresh` forwarded to the Doctor) and `GET /api/admin/onboarding/metrics` (one aggregate statement: cohort, step funnel and per-milestone activation); the step, fact, ordering and activation-milestone registries with the platform's built-in facts and steps; the `onboarding` user-settings namespace (`ONBOARDING_USER_SETTINGS`, `extendOnboardingSettings`); the host ports `ONBOARDING_DATA` and `ONBOARDING_FEATURES`; and the `onboarding` conformance suite.

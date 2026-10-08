# @marinoscar/platform-contract/onboarding

The wire shapes of the onboarding slice (issue #745, PP-9.3): the stored `onboarding` user-settings namespace and its PATCH branch, the query and response of `GET /api/onboarding`, and the query and response of `GET /api/admin/onboarding/metrics`, as zod schemas plus inferred types and zod-free constants. `@marinoscar/platform-api/onboarding` wraps them as DTOs (so the OpenAPI document is generated from them); `@marinoscar/platform-web/onboarding` takes the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One source for what the onboarding routes accept and return. The namespace stores UI state only (`welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt` and a capped `skipped` list); a step's status (`done`, `todo`, `blocked`) appears only in the response, derived on every request, never stored.

Layout: `constants.ts` (zod-free: audiences, tiers, statuses, the namespace key, the `skipped` cap, the step id pattern, the metrics window bounds, the route paths and the two permissions), `schemas.ts` and `index.ts`.

Not here: the registries, the engine and the routes (`@marinoscar/platform-api/onboarding`), the pages (`@marinoscar/platform-web/onboarding`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { onboardingResponseSchema, ONBOARDING_STEP_ID_PATTERN } from '@marinoscar/platform-contract/onboarding';
import type { OnboardingResponse, OnboardingStep } from '@marinoscar/platform-contract/onboarding';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod` (`constants.ts` imports no zod).

## Quick start

The web slice types its client with the response ([`apps/web/src/App.tsx`](../../../../apps/web/src/App.tsx) mounts the provider that reads it):

```ts
import type { OnboardingResponse } from '@marinoscar/platform-contract/onboarding';
const state: OnboardingResponse = await api.get('/onboarding');
```

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; extending what the namespace holds is `extendOnboardingSettings` in `@marinoscar/platform-api/onboarding`, not a contract change.

Supporting exports (experimental): `ONBOARDING_AUDIENCES`, `ONBOARDING_TIERS`, `ONBOARDING_STATUSES`, `ONBOARDING_SETTINGS_KEY`, `ONBOARDING_SKIPPED_MAX`, `ONBOARDING_STEP_ID_MAX`, `ONBOARDING_STEP_ID_PATTERN`, `ONBOARDING_METRICS_DAYS_DEFAULT`, `ONBOARDING_METRICS_DAYS_MAX`, `ONBOARDING_PATH`, `ONBOARDING_METRICS_PATH`, `ONBOARDING_READ_PERMISSION`, `ONBOARDING_ADMIN_PERMISSION`; the schemas `onboardingSettingsShape`, `onboardingSettingsSchema`, `onboardingSettingsPatchSchema`, `onboardingQuerySchema`, `onboardingStepSchema`, `onboardingBlockSchema`, `onboardingStateSchema`, `onboardingResponseSchema`, `onboardingMetricsQuerySchema`, `onboardingMilestoneMetricSchema`, `onboardingFunnelStepSchema`, `onboardingMetricsResponseSchema`, and their types.

## Data

None. The contract owns no table; the namespace lives in `user_settings.value.onboarding` (the settings fragment of `@marinoscar/platform-db`).

## Permissions and settings

Declares none. `ONBOARDING_READ_PERMISSION` (`user_settings:read`) and `ONBOARDING_ADMIN_PERMISSION` (`system_settings:read`) name the strings the API slice enforces by default, for a client's own checks. The `onboarding` user-settings namespace's stored shape is `onboardingSettingsSchema` (`.strict()`).

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

`skipped` is capped (`ONBOARDING_SKIPPED_MAX`) and each id bounded (`ONBOARDING_STEP_ID_MAX`): the namespace is a JSONB value the user writes themselves. The metrics response carries aggregates only, never an id or an email. `refresh` is a string enum, not a coerced boolean (`Boolean('false')` is `true`).

## Conformance suite

None. `test/onboarding.test.ts` pins the schemas' behaviour and `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

New in #745. No earlier shape to migrate from in this repository; EvoPath's flat `GET /api/onboarding` (`welcomeSeenAt` at the top, `group: required|features`, `label`) maps to `settings.welcomeSeenAt`, `tier: required|recommended`, `title` at adoption.

## Troubleshooting

- **A PATCH of the namespace answers 400.** An unknown key (the namespace is strict: extend it with `extendOnboardingSettings`), a `skipped` id that is not a registered, skippable step, or more than `ONBOARDING_SKIPPED_MAX` of them.

## Links

- API: [`@marinoscar/platform-api/onboarding`](../../../platform-api/src/onboarding/README.md). Web: [`@marinoscar/platform-web/onboarding`](../../../platform-web/src/onboarding/README.md).
- Spec: [onboarding.md](../../../../docs/specs/onboarding.md), [platform-packages.md](../../../../docs/specs/platform-packages.md).

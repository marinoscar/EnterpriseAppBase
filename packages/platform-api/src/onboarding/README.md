# @marinoscar/platform-api/onboarding

The onboarding slice of the API package (issue #745, PP-9.3): the derived first-run checklists (`GET /api/onboarding`: the caller's Get started steps and, for an administrator, the Setup guide), the aggregate activation metrics (`GET /api/admin/onboarding/metrics`), the step, fact, ordering and activation-milestone registries they are built from, and the `onboarding` user-settings namespace. Merged from EvoPath's and kvox's onboarding (zero identical files between them). It depends on `core`, `identity` (the route decorators, the tenancy mode), `doctor` (the admin steps reuse its report), `settings` (the namespace registry) and `testing` (its conformance suite) (`packages/platform-slices.json`).

## Purpose and scope

A fresh deployment is inert on day one (storage blank, AI off, no email, no Web Push, no allowlist entry) and nothing tells an administrator which of the admin cards matter first, or a user what to do next. The slice answers with short checklists whose every step is DERIVED from real state on each request, never stored: a stored completion flag lies after a key rotation; a derived status cannot drift.

What it does:

- **Step registry** (rung 2, kvox's interface extended with EvoPath's Doctor backing, ordering and feature gating): `registerOnboardingStep({ id, audience, tier, order, title, description, actionLabel, href, permission?, feature?, skippable, facts, doctorChecks?, funnelSql?, applies?, evaluate? })`. A `required` step is never skippable (refused at registration). A step the caller cannot act on (permission missing, feature off, Doctor check not registered) is OMITTED, never shown blocked; a step may evaluate to `blocked` with a `blockedReason`.
- **Fact registry** (rung 2): `registerOnboardingFact({ id, resolve(ctx) })`. Facts are the only reads: resolved at most once per request, in parallel, and only when an applicable step (or an ordering) needs them. `evaluate` and `applies` are synchronous functions of the facts, so a step cannot query. A fact that rejects omits the steps that need it and is logged; the response never fails for it.
- **Built-in facts**: `doctor` (one `DoctorService.run` per Doctor category the applicable steps' checks span, `refresh` forwarded), `aiEnabled`, `allowlistNonBootstrapCount` (entries other than `INITIAL_ADMIN_EMAIL`, compared case-insensitively), `principal`, `userSettings` (the caller's raw `user_settings.value`, read once and shared with the stored state), `pushSubscribed`, `orgInvites`.
- **Built-in steps**: `admin.storage`, `admin.email`, `admin.access` (required); `admin.ai`, `admin.push`, `admin.backup`, `admin.org-invite` (multi-org only) (recommended); `user.profile`, `user.notifications` (optional). Apps add their activation steps.
- **Doctor semantics** (EvoPath): a step is `done` only when every mapped check is `pass`; a `skip` is not a pass; `detail` is the first non-passing check's remedy, falling back to its detail.
- **Ordering hook**: `registerOnboardingOrdering({ audience, facts, order })`, at most one per audience (EvoPath orders by goal). Default: `order`, then id.
- **Activation metrics**: `registerActivationMilestone({ id, label, windowDays, firstReachedAtSql })` (optional). One read-only aggregate statement over the cohort (users created in the last `days`, 1 to 365): cohort size, the funnel (user steps with `funnelSql`) and, per milestone, eligible, activated, the rate and the median hours.
- **The stored namespace** `onboarding` (`ONBOARDING_USER_SETTINGS`): `welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt`, `skipped`; `.strict()`, extended by an app with `extendOnboardingSettings`; written through the existing `PATCH /api/user-settings` with `If-Match`.

Not here: product tours, coach marks or tooltips (both source apps rejected them); domain steps and goals (EvoPath's health profile, gym, workout and AI plan, kvox's transcription and BYOK steps: apps register them); per-user analytics; the pages (`@marinoscar/platform-web/onboarding`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { OnboardingModule, registerOnboardingStep } from '@marinoscar/platform-api/onboarding';
```

Peers beyond the package's own: `@nestjs/config` (reads `INITIAL_ADMIN_EMAIL`), `nestjs-zod` and `zod` (the DTOs). The wire shapes come from `@marinoscar/platform-contract/onboarding`.

## Quick start

The reference app registers the platform's facts and steps, then its own, in a manifest ([`onboarding.manifest.ts`](../../../../apps/api/src/onboarding/onboarding.manifest.ts)), then calls `forRoot` once ([`onboarding.config.ts`](../../../../apps/api/src/platform/onboarding/onboarding.config.ts)):

```ts
import '../../onboarding/onboarding.manifest';
import { OnboardingModule } from '@marinoscar/platform-api/onboarding';
import { OnboardingHostModule } from './onboarding-host.module';

export const onboardingModule = OnboardingModule.forRoot({ imports: [OnboardingHostModule] });
```

and appends `ONBOARDING_USER_SETTINGS` to its user-settings manifest. An app step over an app fact ([`user-step-with-fact.example.ts`](../../../../apps/api/src/platform-extensions/onboarding/examples/user-step-with-fact.example.ts)):

```ts
registerOnboardingFact({
  id: 'reference.personalTokenCount',
  resolve: (ctx) => ctx.get(PrismaService).personalAccessToken.count({ where: { userId: ctx.caller.id, revokedAt: null } }),
});
registerOnboardingStep({
  id: 'reference.first-token', audience: 'user', tier: 'recommended', order: 30,
  title: 'Create a personal access token', description: '...', actionLabel: 'Create a token', href: '/settings/tokens',
  skippable: true, facts: ['reference.personalTokenCount'],
  evaluate: (facts) => ({ status: (facts['reference.personalTokenCount'] as number) > 0 ? 'done' : 'todo' }),
});
```

## Configuration

`OnboardingModule.forRoot(options)`; no option is an environment variable of its own.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `adminPermission` | `string` | `'system_settings:read'` | Adds the admin block to `GET /api/onboarding` and gates the metrics route. The Doctor's permission, whose report the admin steps reuse. |
| `initialAdminEmailEnv` | `string` | `'INITIAL_ADMIN_EMAIL'` | The variable (through `ConfigService`) whose address the `admin.access` count excludes. |
| `imports` | `ModuleImport[]` | `[]` | The modules binding `ONBOARDING_DATA` (required) and `ONBOARDING_FEATURES` (optional). |

Call `forRoot` after the app's manifest ran; at bootstrap the service fails the boot when a step or an ordering names an unregistered fact.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `OnboardingModule.forRoot` | option | `forRoot(options?: OnboardingModuleOptions): DynamicModule` | Mount the slice once, after the app's onboarding manifest | experimental | [example](../../../../apps/api/src/platform/onboarding/onboarding.config.ts) |
| `registerOnboardingStep` | registry | `registerOnboardingStep(...steps: OnboardingStepDef[]): void` | Add an activation step (`<app>.<step>`, permanent) | experimental | [example](../../../../apps/api/src/onboarding/onboarding.manifest.ts) |
| `onboardingStepRegistry` | registry | `Registry<OnboardingStepDef>` | List the steps, or extend them temporarily in a test | experimental | [example](../../../../apps/api/test/onboarding/onboarding-examples.spec.ts) |
| `registerOnboardingFact` | registry | `registerOnboardingFact(...facts: OnboardingFactDef[]): void` | Add a read a step needs, resolved once per request | experimental | [example](../../../../apps/api/src/onboarding/onboarding.manifest.ts) |
| `onboardingFactRegistry` | registry | `Registry<OnboardingFactDef>` | List the facts, or extend them temporarily in a test | experimental | [example](../../../../apps/api/test/onboarding/onboarding-examples.spec.ts) |
| `registerOnboardingOrdering` | registry | `registerOnboardingOrdering(ordering: OnboardingOrderingDef): void` | Order an audience's steps from facts (one per audience) | experimental | [example](../../../../apps/api/src/onboarding/onboarding.manifest.ts) |
| `onboardingOrderingRegistry` | registry | `Registry<OnboardingOrderingDef>` | List the orderings, or add one temporarily in a test | experimental | [example](../../../../apps/api/test/onboarding/onboarding-examples.spec.ts) |
| `registerActivationMilestone` | registry | `registerActivationMilestone(milestone: ActivationMilestoneDef): void` | Declare the event onboarding exists to cause, for the metrics | experimental | [example](../../../../apps/api/src/onboarding/onboarding.manifest.ts) |
| `activationMilestoneRegistry` | registry | `Registry<ActivationMilestoneDef>` | List the milestones, or add one temporarily in a test | experimental | [example](../../../../apps/api/test/onboarding/onboarding.db.spec.ts) |
| `ONBOARDING_DATA` | token | `unique symbol` -> `OnboardingDataPort` | Bind the reads (the settings row, the allowlist count, push, org invites, the aggregate) | experimental | [example](../../../../apps/api/src/platform/onboarding/onboarding-data.adapter.ts) |
| `ONBOARDING_FEATURES` | token | `unique symbol` -> `OnboardingFeatureGate` | Bind the feature switches a step's `feature` is gated on | experimental | [example](../../../../apps/api/src/platform/onboarding/onboarding-features.adapter.ts) |
| `extendOnboardingSettings` | schema | `extendOnboardingSettings(shape: z.ZodRawShape): UserSettingsNamespaceExtension` | Add an app field (a goal) to the strict `onboarding` namespace | experimental | [example](../../../../apps/api/src/platform-extensions/onboarding/examples/activation.example.ts) |
| `onboardingConformanceSuite` | registry | `ConformanceSuite<OnboardingConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { onboarding } })` | experimental | [example](../../../../apps/api/test/onboarding/onboarding-conformance.spec.ts) |

Supporting exports (experimental): the declaration types (`OnboardingStepDef`, `OnboardingFactDef`, `OnboardingOrderingDef`, `ActivationMilestoneDef`, `OnboardingEvaluation`, `OnboardingRequestContext`, `OnboardingCaller`, `OnboardingDoctorAccess`, `OnboardingFacts`, `OnboardingOrderableStep`); the built-ins `PLATFORM_ONBOARDING_FACTS`, `PLATFORM_ONBOARDING_STEPS`, `ONBOARDING_FACTS`, `ONBOARDING_STEP_IDS`, `OnboardingPrincipalFact`; `DOCTOR_FACT_ID`, `factIdsOf`, `assertOnboardingRegistries`; the namespace `ONBOARDING_USER_SETTINGS`, `mergeOnboardingSettings`, `readOnboardingState`, `isSkippableStepId`; the engine `evaluateOnboarding`, `evaluateDoctorChecks`, `compareSteps`; the services `OnboardingService`, `OnboardingMetricsService`, `buildOnboardingMetricsSql`; the DTOs and `createOnboardingControllers`; the options.

## Data

None of its own: no table and no migration. The stored state is the `onboarding` namespace of `user_settings.value` (the settings slice's table), registered through the user-settings namespace registry. The metrics read `users`, `user_settings` and whatever the app's registered SQL fragments name (the platform's: `push_subscriptions`), through `ONBOARDING_DATA.queryAggregate`.

## Permissions and settings

Declares no permission.

| Permission | Gates |
|---|---|
| `user_settings:read` | `GET /api/onboarding` (every role holds it) |
| `user_settings:write` | Writing the namespace through `PATCH /api/user-settings` (the settings slice's route) |
| `system_settings:read` (`adminPermission`) | The `admin` block of `GET /api/onboarding` and `GET /api/admin/onboarding/metrics` |
| `storage_config:read`, `system_settings:read`, `allowlist:read`, `ai_config:read`, `push:read`, `db_backup:read`, `org_invites:write` | Whether each built-in admin step is offered (the exact strings of the pages they link to) |

Settings namespace `onboarding` (user): `welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt` (ISO datetimes), `skipped` (at most 32 ids of registered, skippable steps; unknown ids dropped on read, refused on write). `.strict()`; an explicit `null` in a PATCH clears a key. The slice reads no system namespace.

## UI

None in this package. The pages, the slots and the registry descriptors are `@marinoscar/platform-web/onboarding` ([README](../../../platform-web/src/onboarding/README.md)): the admin card `Setup guide` (`/admin/settings/setup`, `system_settings:read`) and the user card `Getting started` (`/settings/getting-started`).

## Infra

None. No environment variable of its own (`INITIAL_ADMIN_EMAIL` is the identity slice's), no container, no Compose fragment.

## Observability

A fact that rejects, a step whose `evaluate` throws or returns an invalid status, and an ordering that throws each log one warning (`Onboarding fact "<id>" failed; ...`) and are omitted. No metric of its own: the request spans cover the routes. The activation metrics are aggregates computed on read, never per-step events, and no metric label ever carries a user id.

## Security notes

- Read-only: `GET /api/onboarding` never writes, and in particular never creates the `user_settings` row `UserSettingsService.getSettings` would (`ONBOARDING_DATA.readUserSettingsValue` selects; `apps/api/test/onboarding/onboarding.db.spec.ts`).
- The admin block is computed only for `adminPermission` holders; for anyone else the Doctor is never run.
- The metrics statement returns one row of counts; no id, email or per-user value leaves the database. Its values are positional parameters; the only spliced SQL is the developer-authored `firstReachedAtSql` / `funnelSql` of registered entries (refused at registration when it contains `;`) and validated integers.
- `skipped` is bounded and validated against the registry; the namespace is strict.

## Conformance suite

`@marinoscar/platform-api/onboarding/testing` registers the `onboarding` suite with `runPlatformConformance()` (the reference app: [`onboarding-conformance.spec.ts`](../../../../apps/api/test/onboarding/onboarding-conformance.spec.ts)):

1. **registry**: every fact a step or an ordering names is registered, no `required` step is skippable, and at least `minSteps` steps are registered.
2. **permissions**: every step's `permission` is exactly a permission of the app's registry.
3. **facts-once**: one derivation, for a caller holding every permission, resolves each fact at most once.
4. **no-io-in-evaluate**: the evaluation phase makes no data-port call (spied); a fact `factSamples` provides is not resolved.

## Upgrade notes

New in #745. Adopting from EvoPath: its `health_profile`, `gym`, `first_workout` and `ai_plan` steps become four `registerOnboardingStep` calls over facts, its goal ordering `registerOnboardingOrdering`, its `goal` field `extendOnboardingSettings({ goal })`, its first-workout metric `registerActivationMilestone({ id: 'first_workout', windowDays: 7, ... })`; the admin ids `storage`, `email`, `allowlist`, `ai`, `push`, `backup` become `admin.*` (`allowlist` is `admin.access`), and `group: features` is `tier: recommended`. From kvox: its admin steps are replaced by the platform's (`admin.access` matches); map its stored `skipped` ids at adoption, and register `admin.transcription`, `admin.smoke_test` and its user steps with facts.

## Troubleshooting

- **The boot fails with "Onboarding registries are inconsistent".** A step or an ordering names a fact nobody registered; register it (or fix the id) in the app's manifest.
- **A step never appears.** The caller lacks its `permission`, its `feature` is off (or `ONBOARDING_FEATURES` is not bound, so every feature reads off), one of its `doctorChecks` is not registered, `applies` returned false, or one of its facts rejected (see the warning in the log).
- **An admin step stays `todo` with AI off.** By design: `ai.enabled` is a `skip` while AI is off, and a skip is not a pass.
- **`Re-check` still shows the old status.** Without `refresh=true` the Doctor serves its 15-second cache.

## Links

- Spec: [onboarding.md](../../../../docs/specs/onboarding.md), [doctor.md](../../../../docs/specs/doctor.md), [platform-packages.md](../../../../docs/specs/platform-packages.md).
- Contract: [`@marinoscar/platform-contract/onboarding`](../../../platform-contract/src/onboarding/README.md). Web: [`@marinoscar/platform-web/onboarding`](../../../platform-web/src/onboarding/README.md). Settings: [`@marinoscar/platform-api/settings`](../settings/README.md).

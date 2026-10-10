# First-run onboarding

> **Status:** shipped (#745, PP-9.3) · **Code:** `@marinoscar/platform-api/onboarding` ([README](../../packages/platform-api/src/onboarding/README.md)), `@marinoscar/platform-web/onboarding/{headless,ui}` ([README](../../packages/platform-web/src/onboarding/README.md)), `@marinoscar/platform-contract/onboarding` ([README](../../packages/platform-contract/src/onboarding/README.md)); the reference app's binding: `apps/api/src/onboarding/onboarding.manifest.ts`, `apps/api/src/platform/onboarding/`, `apps/web/src/App.tsx` · **API:** `GET /api/onboarding`, `GET /api/admin/onboarding/metrics` (tag `Onboarding` in `/api/docs`) · **UI:** `/admin/settings/setup`, `/settings/getting-started` · **Recipe:** [§4](#4-extending-it-in-an-app)

A fresh deployment is inert on day one: storage is blank, AI is off, there is no email delivery, no Web Push key pair and no allowlist entry. Nothing tells an administrator which of the twenty-plus admin cards matter first, and nothing tells a user what to do next. Onboarding gives every new account one next step: a one-time welcome dialog leading into a short checklist, the **Setup guide** for administrators and **Get started** for everyone. Each step is ticked from real state, never by hand.

EvoPath and kvox each built this independently, with zero identical files. This platform version merges them: kvox's open step registry, tiers, `blocked` status, skippable steps and once-per-request context; EvoPath's Doctor reuse, activation metrics and feature notices.

## 1. Purpose

**What it is.** A welcome dialog shown once per user; derived checklists of a few steps per audience; a way back in (**Getting started** in the user menu); aggregate activation metrics for administrators; and notices that say a feature is not set up instead of letting its control fail.

**What it is not.** Not a product tour (no tooltips, spotlights or coach marks: [§6](#6-design-decisions)). Not a second source of truth: a step's status is computed from the data it is about. Not a diagnostic: the admin steps reuse the [Doctor](doctor.md), whose full report stays at `/admin/settings/doctor`. Not a gate: nothing is blocked while a step is open. Not per-user analytics: the metrics are aggregates.

### 1.1 Design principles

| Principle | Evidence (from both source specs) | How it shows up here |
|---|---|---|
| Short checklists beat long tours | Chameleon's tour benchmarks: seven or more steps complete at about 16%, three at about 72% | A handful of steps per audience in tier groups; no tour |
| Derived, not stored | Shopify's onboarding guidelines: reflect what is actually set up; a stored flag lies after a key rotation | `done` comes from a Doctor check, a row, a setting; nothing stores completion |
| One welcome, then a checklist | NN/g: a single orienting moment with one primary action | The dialog has one primary button leading to the audience's checklist |
| Dismissible and resumable | NN/g: onboarding must never trap the user | Every exit marks the welcome seen; checklists can be dismissed; **Getting started** reopens both |
| Never show a step the user cannot do | Shopify and NN/g: an unactionable step is noise | A step whose permission the caller lacks, or whose feature is off, is omitted, not shown blocked |
| Cost independent of the registry's length | kvox: "a per-step query makes the endpoint's cost a function of the registry's length" | Steps read facts; each fact resolves at most once per request, only when an applicable step needs it |
| Accessible dialog | W3C ARIA Authoring Practices, modal dialog | `aria-labelledby`, `aria-describedby`, focus in and out, Escape closes, no motion under `prefers-reduced-motion`, full screen below `sm`; status in words, never colour alone |

## 2. How it works

### 2.1 Stored and derived state

| Kind | Where | Holds |
|---|---|---|
| Stored | `user_settings.value.onboarding` (no new table, no migration) | `welcomeSeenAt`, `checklistDismissedAt`, `adminDismissedAt`, `skipped` (and any app field) |
| Derived | `GET /api/onboarding`, on every request | Every step's `done`, `todo` or `blocked`, the counts, `requiredDone`, `allResolved` |

The namespace is registered through the settings slice's user-namespace registry (`ONBOARDING_USER_SETTINGS`, appended after `ai` in the reference app's manifest), is `.strict()`, and is written through the existing `PATCH /api/user-settings` with `If-Match`. The merge is shallow: provided keys replace, an explicit `null` clears one. `skipped` holds at most 32 ids, each of a registered, skippable step: unknown ids are refused on write and dropped on read. An app adds a field (EvoPath's `goal`) with `extendOnboardingSettings`, which folds into the declaration through the settings slice's extension mechanism, so the namespace stays strict.

### 2.2 The endpoint is read-only

`OnboardingService` never writes. It reads the namespace through `ONBOARDING_DATA.readUserSettingsValue` (a select), never through `UserSettingsService.getSettings`, which creates a default row on first read. An absent or unparseable namespace reads as all `null`. Proven on a real database by `apps/api/test/onboarding/onboarding.db.spec.ts`.

### 2.3 Steps, facts and the cost bound

A **step** (`registerOnboardingStep`) is data plus two synchronous functions: `id` (permanent, `admin.*`, `user.*` or `<app>.*`), `audience` (`admin` or `user`), `tier` (`required`, `recommended`, `optional`), `order`, `title`, `description`, `actionLabel`, `href`, an optional `permission` and `feature`, `skippable` (never for `required`, refused at registration), the `facts` it reads, optional `doctorChecks` and `funnelSql`, `applies(facts)` and `evaluate(facts)`.

A **fact** (`registerOnboardingFact`) is the only thing that reads: `resolve(ctx)` gets the caller, the `refresh` flag, the data port, the Doctor, the feature gate and `ctx.get(token)` for the app's own services. The engine runs in three phases:

1. **Candidates.** Drop every step whose audience the caller does not get (the admin block needs `system_settings:read`), whose `permission` the caller lacks, whose `feature` is off, or one of whose `doctorChecks` is not registered. Omitted, never shown blocked.
2. **Facts.** The union of the candidates' and the orderings' facts, each resolved once, in parallel. A fact that rejects omits the steps that need it (logged); the response never fails for it.
3. **Evaluation**, synchronous: `applies`, then `evaluate` (or the Doctor mapping), then the audience's ordering hook. A `blocked` step must carry `blockedReason`; one without it is omitted and logged.

The conformance suite spies on the data port to prove the evaluation phase makes no call, and counts fact resolutions to prove each happens at most once.

### 2.4 The platform's steps

| Step | Audience, tier | Done when | Offered when |
|---|---|---|---|
| `admin.storage` | admin, required | Doctor `storage.config` and `storage.bucket` pass | `storage_config:read` |
| `admin.email` | admin, required | Doctor `email.config` passes | `system_settings:read` |
| `admin.access` | admin, required | An allowlist entry other than `INITIAL_ADMIN_EMAIL` (case-insensitive) exists | `allowlist:read` |
| `admin.ai` | admin, recommended | Doctor `ai.enabled` and `ai.providers` pass | `ai_config:read` |
| `admin.push` | admin, recommended | Doctor `push.vapid` passes | `push:read` |
| `admin.backup` | admin, recommended | Doctor `backup.schedule` passes | `db_backup:read` |
| `admin.org-invite` | admin, recommended | The active organization has another active member (a pending invite is a hint) | `org_invites:write`, multi-org mode |
| `user.profile` | user, optional | The stored profile has a display name or an uploaded picture | always |
| `user.notifications` | user, optional | Notification preferences were saved, or a Web Push subscription exists | always |

**Doctor semantics** (EvoPath): a step is `done` only when every mapped check is `pass`; a `skip` is not a pass (AI switched off makes `ai.enabled` a skip, so `admin.ai` invites the administrator to turn it on); a `todo` step's `detail` is the first non-passing check's `remedy`, falling back to its `detail`. The Doctor runs once per category the applicable checks span, sharing its 15-second cache; `refresh=true` bypasses it. Built-in facts: `doctor`, `aiEnabled`, `allowlistNonBootstrapCount`, `principal`, `userSettings`, `pushSubscribed`, `orgInvites`.

### 2.5 The response

```
GET /api/onboarding[?refresh=true|false]

{ settings: { welcomeSeenAt, checklistDismissedAt, adminDismissedAt, skipped, ...appFields },
  user:  { steps, completed, total, requiredDone, allResolved },
  admin: { steps, completed, total, requiredDone, allResolved } | null }
Step = { id, audience, tier, status: 'done'|'todo'|'blocked', title, description,
         actionLabel, href, detail, blockedReason, skippable, skipped }
```

`refresh` is a string enum, not a coerced boolean: `Boolean('false')` is `true`.

### 2.6 Activation metrics

`GET /api/admin/onboarding/metrics?days=` (`system_settings:read`, `days` 1 to 365, default 30) runs ONE read-only aggregate statement. Cohort: users created in the last `days`. Funnel: per user step with `funnelSql`, cohort users with it done now. Per registered milestone (`registerActivationMilestone({ id, label, windowDays, firstReachedAtSql })`): eligible (created at least `windowDays` ago), activated (reached it within the window), the rate (`null` with nobody eligible) and the median hours to it over cohort users who reached it (a user who never did is not counted as zero). Without a milestone the response is the cohort and the funnel only. No per-user row, id or email leaves the database. It is an on-demand read bounded by a year of sign-ups, not a queue job.

### 2.7 Web surfaces

| Surface | Where | Behaviour |
|---|---|---|
| `OnboardingProvider` | Around the authenticated shell (`App.tsx`) | One fetch for every consumer; inert without a provider |
| `WelcomeDialog` | Mounted once in `Layout` | Opens while `welcomeSeenAt` is null; every exit marks it seen; the admin variant leads to the Setup guide, the user variant to Get started; app panes come through `slots` |
| Setup guide | `/admin/settings/setup`, card in General (`system_settings:read`) | The admin steps in tier groups, **Re-check** (`refresh=true`), **Open the Doctor**, and the Activation section |
| Getting started | `/settings/getting-started`, card in Account (no permission) | The user steps with **Skip**, and **Show the welcome again** |
| `OnboardingChecklist` | Wherever an app embeds it | Status in words and an icon, "3 of 5 done" |
| Getting started (menu) | The app's user menu | Clears `welcomeSeenAt`, `checklistDismissedAt` and `adminDismissedAt`: the dialog and the checklists return |
| `FeatureUnavailableNotice` | In place of a control whose feature is off | "{Feature} isn't enabled yet"; **Set it up** for holders of the notice's admin permission (`ai_config:read`, `storage_config:read`, `push:read`; the reference app adds `telemetry:read`) |

Both cards are registry entries (the Settings UI Pattern), appended, before any Danger Zone group; the Activation section is a section of the Setup guide, not a card or a tab.

## 3. Configuration and permissions

No environment variable and no system setting of its own; `INITIAL_ADMIN_EMAIL` is read only to exclude the bootstrap administrator from `admin.access`. `OnboardingModule.forRoot({ adminPermission, initialAdminEmailEnv, imports })`. No new permission:

| Permission | Gates |
|---|---|
| `user_settings:read` | `GET /api/onboarding` (every role) |
| `user_settings:write` | Writing the namespace through `PATCH /api/user-settings` |
| `system_settings:read` | The admin block, the Setup guide card and route, the metrics |
| Each step's `permission` | Whether the step is offered (the exact string of the page it links to) |

## 4. Extending it in an app

The reference app keeps its own entries in `apps/api/src/app-registrations/onboarding.ts` (empty upstream); worked examples are in `apps/api/src/platform-extensions/onboarding/examples/` and `apps/web/src/platform-extensions/onboarding/`.

### 4.1 Add a user step with a fact

Register the fact (`resolve` reads through `ctx.get(YourService)` or the data port) and the step naming it; keep the step synchronous. Give it `funnelSql` to count it in the funnel. Keep the checklist short. Example: `user-step-with-fact.example.ts` ("Create a personal access token").

### 4.2 Add an admin step

Prefer a [Doctor check](doctor.md#4-extending-it-in-a-fork) and `doctorChecks: ['<id>']`; the step then follows the check's status and remedy and is omitted where the check is not registered. `required` only when other people cannot succeed without it. Example: `admin-doctor-step.example.ts` (`db.rls_role`).

### 4.3 Order steps, add a milestone, add a stored field

`registerOnboardingOrdering({ audience, facts, order })` (one per audience; EvoPath orders by goal); `registerActivationMilestone(...)` (EvoPath: `first_workout`, 7 days); `extendOnboardingSettings({ goal: z.enum([...]).optional() })` listed in `APP_USER_SETTINGS_EXTENSIONS`, collected by a `WelcomeDialog` pane through `setExtra`. Example: `activation.example.ts` and `RoleWelcomePane.example.tsx`.

### 4.4 Add a feature notice

`registerFeatureNotice({ feature, label, adminPermission, setupHref })` at module scope (the reference app's `apps/web/src/platform/onboarding.ts`), then `<FeatureUnavailableNotice feature="..." />`.

### 4.5 Seams per app at adoption

| App | Platform calls |
|---|---|
| EvoPath | `registerOnboardingStep` ×4 with facts (health profile, gym, first workout, AI plan with its two phases); `registerOnboardingOrdering` by goal; `extendOnboardingSettings({ goal })`; `WelcomeDialog` `slots.userPane`; `registerActivationMilestone({ id: 'first_workout', windowDays: 7 })`; `OnboardingChecklist` on its Today page |
| kvox | Register `admin.transcription`, `admin.smoke_test` and its user steps with facts (`blocked` with a reason before a BYOK key exists); the platform admin steps replace its own (`admin.access` matches); map its stored `skipped` ids; its three welcome panes through slots |
| MemoriaHub | The platform steps, media steps later |

## 5. Guardrails

| Guard | Enforces |
|---|---|
| `packages/platform-api/test/onboarding/*.spec.ts` | Registries (duplicates, required-not-skippable, unknown facts), the engine (Doctor mapping, skip is not pass, omission, ordering, facts once), the namespace merge and `skipped` validation, the metrics SQL builder and arithmetic, the service |
| `apps/api/test/onboarding/onboarding-conformance.spec.ts` | The `onboarding` conformance suite over the app's steps: facts registered, permissions exact, facts once, no I/O in `evaluate` |
| `apps/api/test/onboarding/onboarding.integration.spec.ts` | Routes and permissions, `refresh` enum, no row written, `days` validation, the namespace through `PATCH /api/user-settings` with `If-Match` |
| `apps/api/test/onboarding/onboarding.db.spec.ts` | The read-only GET and the metrics statement on real Postgres |
| `apps/api/test/onboarding/onboarding-examples.spec.ts` | The reference examples |
| `packages/platform-web/test/onboarding/*.test.tsx` | The provider (inert without one, one fetch, writes with `If-Match`), the dialog's exits and slots, the checklist's words, the Setup guide's groups and Re-check, the notice's "Set it up" |
| `apps/web/src/__tests__/config/platformPages.test.ts` | Each card is one registry entry and one route with the exact permission; a Danger Zone group stays last |

## 6. Design decisions

- **Stored completion flags were rejected** by both sources: a flag lies after a key rotation; derived status cannot drift.
- **Per-step queries (EvoPath's shape) were rejected for the platform**: cost would grow with the registry. EvoPath's existence checks become facts.
- **No tours.** A forced sequence of tooltips is the long-tour pattern the completion data argues against, and breaks on every layout change.
- **Reuse the Doctor** rather than re-derive "is storage configured": one probe, one cache, one remedy. The cost is the Doctor's vocabulary (`skip` reads as `todo`).
- **Omitted, not blocked**, for what the caller cannot do; `blocked` is for a step the caller will be able to do once something else happens, and carries the reason.
- **One Doctor run per category, not one run of everything.** `DoctorService.run` filters by category, not by check id; running the categories the applicable checks span keeps the Doctor's cache shared with its own page and avoids probing unrelated capabilities.
- **Aggregates computed on read, not events recorded**: no write path, no migration, no backfill; the metric cannot say when a step was done, only that it is done now.

## 7. Verification

```bash
npm run test:run --workspace=@marinoscar/platform-api -- onboarding
npm test --workspace=api -- onboarding
npm run test:db --workspace=api -- onboarding
npm run test:run --workspace=@marinoscar/platform-web -- onboarding
npm run test:run --workspace=web -- platformPages onboarding
```

By hand: as a fresh Admin the welcome opens; **Start setup** opens `/admin/settings/setup`, where storage, email and access are `todo` with the Doctor's remedies. Configure storage, press **Re-check**: storage reads `done`. As a Viewer, `GET /api/onboarding` returns `"admin": null`. **Getting started** in the user menu brings the dialog back.

## History

- #745 (PP-9.3) added the platform onboarding slice, merged from EvoPath (#203, #204, #212) and kvox.

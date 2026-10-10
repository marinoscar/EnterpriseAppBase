# Extending the platform

> **Audience:** developers of an app built on the `@marinoscar/platform-*` packages, and authors of an extension package an app installs · **Contract:** [The Extension Contract](specs/platform-packages.md#the-extension-contract) · **Audit:** [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md) (what is still closed) · **Catalogs:** the Extension-point catalog of each slice README, indexed in [SLICES.md](SLICES.md)

How to add to a platform slice from your own app, or from a package your app installs, without editing a file under `packages/platform-*`. The page gives the ladder of mechanisms and the rule that decides which one an override uses, then one numbered recipe per common extension. Every recipe names its imports and the file in the reference app that does the same thing. Extensions that need a seam the platform has not opened yet are placeholders headed "Coming in PP-14.n"; [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md) lists each closed point and the story that opens it.

## Contents

1. [Before you start](#before-you-start)
2. [The extension ladder](#the-extension-ladder)
3. [Open an id vocabulary](#open-an-id-vocabulary)
4. [Recipes that work today](#recipes-that-work-today)
5. [Coming in later stories](#coming-in-later-stories)
6. [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package)
7. [Conformance kits](#conformance-kits)
8. [See also](#see-also)

## Before you start

1. **Find the seam.** Open the slice's README and read its Extension-point catalog: every registry, option, token, event and slot, with a link to a working use. [SLICES.md](SLICES.md) lists the slices.
2. **Check what is closed.** [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md) has a section per slice. A closed point names the story that opens it.
3. **If there is no seam, ask for one.** File a seam request (`gh issue create --template seam_request.yml`) with the need, why the rungs below fail and the proposed seam. Do not edit platform code in the app. Eject (rung 6) only while the request is open.
4. **Prove it from the app side.** An extension ships with a test that boots the real package module, not a hand-built module without the package's consumers. The reference app's tests are the model: `apps/api/test/examples/` (storage, host, sharing, notifications, ai).

## The extension ladder

Prefer earlier rungs. Move down only when the earlier rung cannot express the need.

| Rung | Mechanism | Use it to | Example |
|---|---|---|---|
| 1 | **Options** in `forRoot()`, merged over defaults | Tune a value | `TelemetryModule.forRoot({ dashboard: { verdictThresholds } })` |
| 2 | **Registries**: `register…()` calls, additive and typed | Add an entry: a permission, a settings namespace, a job type, a Doctor check, a notification, a metric group | `registerNotification(...)`, `JobHandlerRegistry.register(this)` |
| 3 | **Tokens, bound through `forRoot`** | Replace one provider | `StorageModule.forRoot({ provider })`, `PlatformHostCoreModule.forRoot({ eventBus })`, `TelemetryModule.forRoot({ dashboard: { verdictPolicy } })` |
| 4 | **Events and hooks** | React without replacing | `IDENTITY_EVENTS`, `JobSettledEvent`, `NodeOfflineEvent`, `EVENT_BUS` |
| 5 | **Composition** | Build your own module on exported primitives | `defineRegistry`, `AccessPolicy`, `accessibleWhere`, the headless hooks and `/ui` components |
| 6 | **Eject** | Vendor or patch one piece, temporarily, with a seam request linked | A copied component |

### Overrides go through `forRoot` bindings, never an app-module provider

**To replace what a slice provides, pass a binding to the slice's `forRoot`. A `{ provide: TOKEN, … }` in your own module does not reach the slice.**

NestJS resolves a token from the consuming module's own providers and imports first. Every package module that needs the object store imports `StorageProvidersModule`, which provides `STORAGE_PROVIDER` itself, so a provider of the same token in your module, or in a `@Global()` module, is never seen by the sixteen package modules that consume it. The slice therefore takes the replacement as an option and provides it where the token is bound:

```ts
import { StorageModule } from '@marinoscar/platform-api/storage';
import type { PortBinding } from '@marinoscar/platform-api/core';

// PortBinding<T> is { useClass } | { useExisting } | { useFactory, inject? }: Nest's own provider shapes without `provide`.
StorageModule.forRoot({ provider: { useClass: AzureBlobProvider } });
```

The rule has three consequences:

- **Do not document, and do not rely on, "provide TOKEN in your app module"** for a token the slice provides itself. A token that appears in a slice's catalog as a **host port** (`AI_OBJECT_STORE`, `NODE_OBJECT_STORE`, `JOBS_METRICS`, …) is different: the slice does not provide it, the app does, in a module it passes to the slice's `forRoot({ imports })` (the reference app's `*-host.module.ts` files).
- **A new override ships with a test that boots two real consumers** of the token and asserts both receive the app's instance. [`storage-provider-override.spec.ts`](../apps/api/test/examples/storage/storage-provider-override.spec.ts) boots `StorageModule.forRoot` with the profile-image, exports and database-backup modules; [`event-bus-adapter.spec.ts`](../apps/api/test/examples/host/event-bus-adapter.spec.ts) boots `PlatformHostCoreModule.forRoot` with the identity slice's `PrincipalCache`.
- **A slice that cannot be overridden yet says so** in its README (the email transport: "not supported yet, see PP-14.8") and in the audit, instead of describing an override that does not work.

### Static and Nest-held registries

| Kind | Filled | Frozen | Examples |
|---|---|---|---|
| Static (`defineRegistry` at module scope) | At import time, from the app's registration files under `apps/api/src/app-registrations/` or from a side-effect import | When the application bootstraps (`RegistryFreezeService`); a later `register` throws `FROZEN` | Permissions, settings namespaces, notification events, templates and channels, storage key prefixes, metric groups, credential purposes, event bus adapters, user-owned models |
| Held by Nest (a provider) | By a provider of yours, from its `onModuleInit` | Not frozen | `JobHandlerRegistry`, `DoctorCheckRegistry`, `EgressRegistry`, `NotificationChannelSenderRegistry`, `ObjectProcessorRegistry`, `AiProviderRegistry` |

The app-owned seam of every static registry is a file in [`apps/api/src/app-registrations/`](../apps/api/src/app-registrations/README.md). Upstream keeps those files empty; a fork fills them and never edits a platform declaration or manifest.

### Augmenting a typed id

A registry keyed by a typed id (`MetricGroupIds`, `AppMetricKeys`, `NotificationChannelIds`, `EmailTemplateDataMap`, `SystemSettingsNamespaces`) widens by module augmentation of the **slice's public entry**, never a deeper path:

```ts
declare module '@marinoscar/platform-api/telemetry' {
  interface MetricGroupIds { coach: true }
}
```

## Open an id vocabulary

A list of ids that a package or an app may extend is open. A closed list of implementation ids (a union, a `z.enum`, a `switch`, a `Record<FixedUnion, …>`) forces an edit in the package for every addition, which is the failure the audit records. When a package introduces a pluggable kind or a vocabulary, it follows this shape:

1. **Contract.** The wire id is a string with a pattern, for example `z.string().regex(/^[a-z][a-z0-9-]{1,47}$/)`, not `z.enum(IDS)`. The built-in ids stay as a constant named `BUILTIN_<X>_IDS`, used for defaults and labels.
2. **TypeScript.** `type XId = BuiltinXId | (string & {})`. Where narrowing matters, an augmentable interface declared in the slice's public entry (`interface XIds { … }`).
3. **Lookup.** A registry lookup replaces every `switch` and `Record<XId, …>`. A missing id fails with an error that names the id and how to register it.
4. **Labels.** The web reads labels and icons from the API or a web registry, never a hard-coded record.
5. **Stored settings.** Per-implementation settings are a record keyed by the id. A write rejects an unknown id; a read ignores one with a single warning, so removing a plugin never bricks the row.
6. **Secrets.** A secret is a credential purpose, never a settings field and never an environment variable.

Some vocabularies stay closed on purpose, for security (`AUTH_ERROR_CODES`, the Doctor statuses): they are listed with a reason in [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md). The CI check that stops a new closed list from appearing is PP-14.28.

## Recipes that work today

Each recipe is a checklist. The reference app's own file is linked where one exists.

### Add a metric and a dashboard group

The reference group is [`activity.metric-group.ts`](../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts): one file and one option. The full walk-through, with the metric-name rules, is [the telemetry runbook §8.4](runbooks/telemetry.md#84-adding-an-app-metric-group).

1. **Declare the metric** (skip when the group charts a metric the API already emits). Add an `AppMetricDef` to `APP_METRICS` in `apps/api/src/app-registrations/telemetry.ts`:

   ```ts
   import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

   export const APP_METRICS: readonly AppMetricDef[] = [
     { key: 'coachNudgesSent', name: 'app.coach.nudges.sent', kind: 'counter', unit: '{nudge}',
       description: 'Coach nudges sent.', attributes: { outcome: { kind: 'enum', values: ['sent', 'failed'] } } },
   ];
   ```

   Widen the key type next to it: `declare module '@marinoscar/platform-api/otel-core' { interface AppMetricKeys { coachNudgesSent: true } }`.
2. **Emit it** from the feature through the injected `AppMetricsService` (`import { AppMetricsService } from '@marinoscar/platform-api/host'`): `this.metrics.add('coachNudgesSent', 1, { outcome: 'sent' })`. It never throws; an unknown key is a no-op.
3. **Declare the group** as a `MetricGroupDef` (`import type { MetricGroupDef } from '@marinoscar/platform-api/telemetry'`): an `id` (augment `MetricGroupIds`), `label`, `title`, `order` after the platform's 10 to 60, and `families` whose `table` is the metric's GreptimeDB table (dots become `_`, a counter gains `_total`).
4. **List it** in the `metricGroups` option of `TelemetryModule.forRoot` in `apps/api/src/platform/telemetry/telemetry.config.ts`, or in `APP_METRIC_GROUPS` in `app-registrations/telemetry.ts`, which that file appends.
5. **Check it.** Open `/admin/settings/telemetry/dashboard`: the group renders with default tiles. A table that does not exist yet shows "no data yet", not an error. No web, collector or platform change is needed.

Custom units, colours, top-N tables and dashboard panels are not open yet: PP-14.18.

### Add a job type

Full recipe: [the job handlers README](../packages/platform-api/src/jobs/handlers/README.md). Examples: [`example-echo.handler.ts`](../apps/api/src/examples/jobs/example-echo.handler.ts) (server-only), [`example-checksum.handler.ts`](../apps/api/src/examples/jobs/example-checksum.handler.ts) (node-eligible).

1. **Implement `JobHandler`** (`import { JobHandlerRegistry, type JobHandler } from '@marinoscar/platform-api/jobs'`). The `type` string is permanent once rows of it exist. Throw to fail; be idempotent, because the queue is at-least-once.
2. **Self-register** from the handler's own `onModuleInit`: `this.registry.register(this)`. Set a `label` for the admin job list.
3. **Provide it** in the feature module, which imports the app's configured `JobsModule` (`apps/api/src/platform/jobs/jobs.config.ts`).
4. **Enqueue** through `JobsService` (`@marinoscar/platform-api/jobs`); a payload carries identifiers, and `orgId` when the handler touches an organization table (it then runs under `JobScope.run(job, fn)`).
5. **Declare the execution profile** (`profile: { maxRuntimeMs, maxAttempts }`) or take the global default. Never add a lease or heartbeat field.
6. **Decide node eligibility.** A handler is node-eligible when it carries both `nodeResultSchema` and `persistNodeResult`; one without the other is server-only. `ai.*` types are server-only permanently.
7. **Work inside the queue rules.** A `@Cron` only decides whether work is due and enqueues (`enqueueHousekeepingJob`); an `@OnEvent` body does no I/O. `apps/api/test/conformance.spec.ts` enforces both.
8. **Add the type** and its label to `REGISTERED_JOB_TYPES` in `apps/api/test/jobs/job-type-snapshot.spec.ts`, which pins every registered type.

### Add a doctor check

Full recipe: [the Doctor README](../packages/platform-api/src/doctor/README.md#quick-start); contract: [doctor.md §4](specs/doctor.md#4-extending-it-in-a-fork). Example: [`example-capability.doctor-check.ts`](../apps/api/src/examples/doctor/example-capability.doctor-check.ts).

1. **Implement `DoctorCheck`** (`import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '@marinoscar/platform-api/doctor'`) with a unique `id`, a `category`, a `label` and `run()`. A check is read-only: a `SELECT`, a `HEAD`, a settings read, never a write.
2. **Return an outcome with a remedy** on every `warn` and `fail`; return `skip` with a reason when the capability is intentionally off. Use `dependsOn: ['db.connection']` to run after a check and be skipped with it.
3. **Register from `onModuleInit`**: `this.registry.register(this)`.
4. **Provide it** in the feature module that owns the capability. `DoctorModule` is global; the feature module imports nothing of it.
5. **Add the check id** to the pinned list in `apps/api/test/doctor/registered-checks.integration.spec.ts`.
6. Optionally describe the outbound hosts of the capability with an `EgressContributor` (`EgressRegistry.register` from `onModuleInit`).

### Add a notification event and template

Full recipe: [the notifications README](../packages/platform-api/src/notifications/README.md#quick-start). Example: [`invoice-ready.notification.ts`](../apps/api/src/examples/notifications/invoice-ready.notification.ts).

1. **Write the email template**: a function `(data, ctx?) => RenderedEmail` using `html`, `plainText`, `renderLayout`, `resolveEmailRenderContext` and `TRANSACTIONAL_EMAIL_HEADERS` from `@marinoscar/platform-api/email`. Type its data by augmenting `EmailTemplateDataMap` in that module.
2. **Write the browser renderer**: a `BrowserNotificationTemplate` from `@marinoscar/platform-api/notifications` returning `{ title, body, link }`; `link` is root-relative. Web Push reuses it.
3. **Declare the event**: a `NotificationEventDef` with a stable `key` (`coach.weekly_review`), `label`, `description`, `channels` and `defaultEnabled`.
4. **Register** the template and the notification in `apps/api/src/app-registrations/notifications.ts` (`APP_EMAIL_TEMPLATES`, `APP_NOTIFICATIONS`), or call `registerEmailTemplates` then `registerNotification({ event, emailTemplate, browserTemplate })` at import time. Event keys and template names are persisted: add new ones, never rename.
5. **Raise it** after the triggering write commits, outside any `$transaction`: `await this.notifications.notify('coach.weekly_review', userId, data)` (`NotificationsService`). `notifyNow` is the awaited form for a job handler.

A new channel (Slack, SMS) is in [Coming in PP-14.10](#coming-in-pp-1410-add-a-notification-channel).

### Add a settings namespace

Full recipe: [the reference app's settings registry README](../apps/api/src/settings/registry/README.md#adding-a-namespace) and [settings-ui.md §4](specs/settings-ui.md#4-extending-it-in-a-fork). Example: [`org-overridable.namespaces.ts`](../apps/api/src/platform-extensions/settings/examples/org-overridable.namespaces.ts).

1. **Write the declaration** (`SystemSettingsNamespace` or `UserSettingsNamespace` from `@marinoscar/platform-api/settings`): `key`, the stored, patch, put and wire-patch schemas, `defaults` that satisfy the stored schema, and a `merge`. No `.default()` in a user namespace. No field named `secret`, `password`, `apiKey`, `token`, `privateKey` and the like: the registry refuses it. Secrets are credential purposes.
2. **Add it** to `APP_SYSTEM_SETTINGS_NAMESPACES` or `APP_USER_SETTINGS_NAMESPACES` in `apps/api/src/app-registrations/settings.ts`. The manifests register it after the platform's namespaces; a colliding key fails at import time naming your entry. To add fields inside a platform namespace, list a `SystemSettingsNamespaceExtension` in `APP_SYSTEM_SETTINGS_EXTENSIONS` instead (top-level fields only).
3. **Type it**: `declare module '@marinoscar/platform-api/settings' { interface SystemSettingsNamespaces { coach: CoachSettings } }`.
4. **Regenerate the seed catalog** (system namespaces): `npm run catalog:settings --workspace=api`, and commit `prisma/catalog/system-settings-defaults.json`.
5. **Read it**: `await systemSettings.getNamespace('coach')` (`SystemSettingsService`). A stored row without the namespace reads as `defaults`.
6. **A namespace an organization may override** declares an `org` block and then appears on the Organization settings page without a web change.
7. **Give it a page** with [Add an admin card](#add-an-admin-card).

### Add a credential purpose

Full recipe: [the credentials README](../packages/platform-api/src/credentials/README.md). Examples: [`partner-api-token.purpose.ts`](../apps/api/src/platform-extensions/credentials/examples/partner-api-token.purpose.ts), [`webhook-signing-key.purpose.ts`](../apps/api/src/platform-extensions/credentials/examples/webhook-signing-key.purpose.ts).

1. **Declare the purpose** as a `CredentialPurposeDef` (`import type { CredentialPurposeDef, UserCredentialPurposeDef } from '@marinoscar/platform-api/credentials'`): `purpose` (permanent, no `:`), `owner: 'app'`, `label` and `tiers` (`'system'`, `'org'` or both).
2. **For a key a user may bring**, add a `UserCredentialPurposeDef`: `purpose`, `label`, `description`, the `system` and `org` counterparts and the `fallback` order.
3. **Register** them in `APP_CREDENTIAL_PURPOSES` and `APP_USER_CREDENTIAL_PURPOSES` in `apps/api/src/app-registrations/credentials.ts`. The platform's manifest registers them after its own purposes.
4. **Import the module you need** in the feature module (`CredentialsModule`, `UserCredentialsModule` or `OrgCredentialsModule`; none is global) and inject the service: `await this.credentials.getSecret('partner_api', 'default')`. A user's key is resolved with `UserCredentialResolver` (user, then organization, then deployment).
5. **Present the secret yourself.** There is no generic credentials route. Your page shows only `hint` and presence; the web form uses the write-only `SecretField` (`@marinoscar/platform-web/credentials`).
6. **Never** put a secret in a settings namespace or an environment variable.

### Add an admin card

Full rule: [settings-ui.md §4](specs/settings-ui.md#4-extending-it-in-a-fork) and the Settings UI Pattern in [CLAUDE.md](../CLAUDE.md).

1. **Build the page** and add its route in `apps/web/src/App.tsx`, wrapped in `RequirePermission` with the same permission the card declares.
2. **Add the card** to `ADMIN_SECTIONS` in `apps/web/src/config/adminSections.tsx` (per-user: `USER_SETTINGS_SECTIONS` in `userSettingsSections.tsx`), appended to the end of its group, or as a new group before the pinned `Danger Zone`. A card is `{ title, description, Icon, path, permission }` with `Icon` a component, never a rendered element.
3. **Set `permission`** to the exact read permission the API controller enforces. Gate writes inside the page.
4. **Nest a sub-page's path** under its parent (`/admin/settings/coach/usage`) so the AppBar title resolves.
5. **Set `feature`** when the card depends on a deployment feature; never on the page that switches the feature on.
6. **Add the permission** to `DEFAULT_PERMISSIONS` in `apps/web/visual/main.tsx` if it is new to both registries.
7. **Never add a tab** to an existing settings page for a new destination; a tab is for parallel content inside one page.
8. **Run the registry suites**: `cd apps/web && npx vitest run src/__tests__/config` (`settings-registry-shape`, `settings-card-routes`, `settings-route-ownership`).

### Add a side table with an `extend model` relation

Full reference: [the platform-db README](../packages/platform-db/README.md#extension-point-catalog) and [the app fragments README](../apps/api/prisma/fragments/README.md). Only a model its owner marked `// @extensible` takes a back-relation: `User`, `Organization`, `Job`, `Group` and `StorageObject`. Never add a column to a platform table.

1. **Write the model** in `apps/api/prisma/fragments/<name>.prisma`, keyed by the platform id, and the back-relation beside it:

   ```prisma
   model UserFitnessProfile {
     id     String @id @default(uuid()) @db.Uuid
     userId String @unique @map("user_id") @db.Uuid
     user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

     @@map("user_fitness_profiles")
   }

   extend model User {
     fitnessProfile UserFitnessProfile?
   }
   ```

   An `extend` block holds back-relation fields only: no scalar, no `fields: [...]` relation, no `@@` attribute.
2. **Compose and generate**: `npm run db:compose --workspace=api`, then `npm run prisma:generate`. Never edit `apps/api/prisma/schema/`.
3. **Create the migration**: `cd apps/api && npm run prisma:migrate:dev -- --name add_user_fitness_profiles`. It is an app migration, after the installed ones; it is not promoted.
4. **Register the ownership.** A model with a foreign key to `User` needs an entry in `APP_USER_OWNED_MODELS` (`app-registrations/user-owned-models.ts`: owner field, `purge`, `export`, rationale) or the `userOwnedData` conformance suite fails. Every model also needs a kind in `APP_MODEL_OWNERSHIP` (`app-registrations/model-ownership.ts`).
5. **Decide the data lifecycle.** A table that holds a user's data adds a keep-or-delete hint in `app-registrations/user-data.ts`, so the Danger Zone and factory reset treat it.
6. **Migrate your own queries** to the scoped client (`ScopedPrismaService.forUser(userId)`) for user-owned rows.

A platform model that is not `// @extensible` (a notification, a credential) takes a side table keyed by the platform id, written as a plain column with no Prisma relation (so no database foreign key; the service keeps the integrity), or a seam request. More extensible models and a JSONB `metadata` column on `User` and `Organization` are PP-14.27.

### Add an RLS-protected app table

An app table with an `org_id` is tenant data: row-level security isolates it, and the lock records the policy. Reference: [the platform-db README](../packages/platform-db/README.md#app-tables-with-row-level-security) and [SECURITY-ARCHITECTURE.md §18](SECURITY-ARCHITECTURE.md#18-tenant-isolation-rls).

1. **Model it** in an app fragment with a NOT NULL `orgId` (a `Cascade` relation to `Organization`), the back-relation `extend model Organization { workouts Workout[] }`, and a composite foreign key `(parentId, orgId)` to any other org-owned table (the parent declares `@@unique([id, orgId])`). Compose and generate as in the previous recipe.
2. **Create the migration** with `npm run prisma:migrate:dev -- --create-only --name add_workouts`, and append the standard policy to the SQL (names change, the text does not):

   ```sql
   ALTER TABLE "workouts" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "workouts" FORCE ROW LEVEL SECURITY;
   CREATE POLICY "workouts_org_isolation" ON "workouts"
     USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                 OR current_setting('app.rls_bypass', true) = 'on')
     WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
                 OR current_setting('app.rls_bypass', true) = 'on');
   ```

   A migration that reads or writes rows of an org table wraps itself in `BEGIN; SELECT set_config('app.rls_bypass','on',true); … COMMIT;`. The setting is always transaction-local (`set_config(…, true)`), never a session-level `SET`. Apply it with `npm run prisma:migrate`.
3. **List the policy in `apps/api/prisma/platform.lock`**: `"rlsPolicies": [{ "name": "workouts_org_isolation", "table": "workouts" }]`, an entry of exactly `name` and `table`. A raw-SQL partial or expression index goes under `rawSqlIndexes` with its `pg_indexes.indexdef`; never "fix" either with `@@unique` or a schema change.
4. **Classify the model** in `APP_MODEL_OWNERSHIP` (`app-registrations/model-ownership.ts`) as `{ model: 'Workout', kind: 'org', rationale }`. `test/tenancy/model-ownership.spec.ts` fails for a model with no entry.
5. **Teach the reference app's live coverage spec your policy.** `apps/api/test/tenancy/rls-coverage.db.spec.ts` builds its lists from the package's `RLS_POLICIES`; add your policy names from the lock to the three places that read it, or the exact-match case fails. (Checking app entries offline is PP-14.27.)
6. **Query through the org-scoped client**: `PrismaService.forOrg(orgId)` for a single statement, `runInOrg` for a transaction (never a `forOrg` client inside `$transaction`). Take the organization from `@CurrentOrg()` (`@marinoscar/platform-api/identity`), never from a header, query or body. A job that touches the table carries `orgId` in its payload.
7. **Check it**: `npm run db:check --workspace=api`, `npm run db:drift --workspace=api` (asserts each listed policy in `pg_policies`, enabled and forced) and `npm run test:db --workspace=api`. The application role must be an ordinary `NOSUPERUSER NOBYPASSRLS` role, or no policy applies.

### Replace the object store

Rung 3, available now. Full recipe: [the storage README](../packages/platform-api/src/storage/README.md#the-three-rungs-for-storage). Example: [`in-memory-storage.provider.ts`](../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts), proven by [`storage-provider-override.spec.ts`](../apps/api/test/examples/storage/storage-provider-override.spec.ts).

1. **Implement `StorageProvider`** (`import type { StorageProvider } from '@marinoscar/platform-api/storage'`), the whole interface, including the readonly `kind` (the id written to `storage_objects.storage_provider` and to backup rows; pick a stable lowercase id) and the synchronous `getBucket()`. Uploads of unbounded size stream; a backup archive is never buffered.
2. **Bind it** where the app configures the slice, `apps/api/src/platform/storage/storage.config.ts`:

   ```ts
   export const StorageModule = PlatformStorageModule.forRoot({
     imports: [StorageHostModule],
     provider: { useClass: AzureBlobProvider },
   });
   ```

   Exactly one of `useClass`, `useExisting`, `useFactory` (with `inject`); the binding's own dependencies come from `imports` and global modules. Every package consumer receives it: the objects API, profile images, exports, user-data, database backups, the AI output writer and the nodes data plane.
3. **Do not provide `STORAGE_PROVIDER` in an app module.** It is invisible to the package modules (see [the rule](#overrides-go-through-forroot-bindings-never-an-app-module-provider)).
4. **Configuration stays runtime.** The bundled `/admin/settings/storage` page configures the S3 family only; it does not configure a bound provider. Give the provider its own settings namespace and credential purpose ([above](#add-a-settings-namespace), [above](#add-a-credential-purpose)). Never add a storage environment variable.
5. **Test it with real consumers**: copy `storage-provider-override.spec.ts` and run `storageConformanceSuite` through `runPlatformConformance`.

Per-driver settings, a connection test and an admin form for a new backend are PP-14.7.

### Add an event bus adapter

Available now. Full recipe: [the host README](../packages/platform-api/src/host/README.md#adding-an-event-bus-adapter). Example: [`recording-event-bus.ts`](../apps/api/src/platform-extensions/host/recording-event-bus.ts), registered by [`app-registrations/host.ts`](../apps/api/src/app-registrations/host.ts), proven by [`event-bus-adapter.spec.ts`](../apps/api/test/examples/host/event-bus-adapter.spec.ts).

1. **Implement `EventBus`** (`import type { EventBus } from '@marinoscar/platform-api/host'`): `publish`, `subscribe`, `health`, optional `close`. Honour the rules at the top of `event-bus.interface.ts` (local delivery in a microtask, a JSON round trip, isolated handlers, a `publish` that never rejects, an oversize payload refused locally). Never put a secret on the bus.
2. **Register it at import time** in `apps/api/src/app-registrations/host.ts`:

   ```ts
   import { registerEventBusAdapter } from '@marinoscar/platform-api/host';

   registerEventBusAdapter({ id: 'redis', label: 'Redis pub/sub', create: ({ config, logger, metrics }) => new RedisEventBus(config, logger) });
   ```

   `platform/host-core.config.ts` imports that file before `PlatformHostCoreModule.forRoot()` builds the bus; the registry freezes at bootstrap, so a later registration fails with `FROZEN`.
3. **Select it by id**: `EVENT_BUS_ADAPTER=redis`, or `PlatformHostCoreModule.forRoot({ eventBusAdapter: 'redis' })`. An unknown id in the `eventBusAdapter` option fails at boot, naming the id and the registered ones; an unknown `EVENT_BUS_ADAPTER` value logs a warning and falls back to `in-process`.
4. **Or hand over a finished bus** with `PlatformHostCoreModule.forRoot({ eventBus: { useClass: RedisEventBus } })` (`useExisting` or `useFactory` also work). It wins over the id and needs no registry entry.
5. **Run the kit**: `describeEventBusConformance(() => new RedisEventBus(...), { describe, it, expect })` from `@marinoscar/platform-api/host/testing`.

### Writing a pluggable implementation

Available now. A **pluggable kind** is the one shape every slice with a swappable part (AI provider, storage driver, email transport, sign-in provider, notification channel, telemetry store, backup target) is moving to, so you learn it once. The primitive is `definePluggableKind` of `@marinoscar/platform-api/core`; the AI providers use it ([Add an AI provider](#add-an-ai-provider-the-assemblyai-case)), the stories PP-14.7 to PP-14.12 apply it to each remaining slice, and until a slice's story lands, its kind is not yet registered there (see the placeholders below). The full reference is [the core README, Pluggable kinds](../packages/platform-api/src/core/README.md#pluggable-kinds). Worked example, with no consumer slice: [`greeter.kind.ts`](../apps/api/src/platform-extensions/core/greeter.kind.ts), registered by [`app-registrations/core.ts`](../apps/api/src/app-registrations/core.ts), proven by [`pluggable-kind.spec.ts`](../apps/api/test/examples/core/pluggable-kind.spec.ts) on the API side and [`pluggable-config-form.test.tsx`](../apps/web/src/__tests__/examples/settings/pluggable-config-form.test.tsx) on the web side.

1. **Pick the kind.** Import the kind a slice exposes. For a swappable part of your own, define one once, at module scope, in the file that owns it (`import { definePluggableKind } from '@marinoscar/platform-api/core'`):

   ```ts
   export const greeterKind = definePluggableKind<Greeter>({ kind: 'greeter', label: 'Greeter' });
   ```

   The first type argument is what `build` returns; an optional second is the context the consuming slice passes to `build` besides the settings. The kind id matches `^[a-z][a-z0-9-]{1,47}$` and names a registry, `pluggable.greeter`.
2. **Define the implementation** (`PluggableImplementation`, `PluggableSecretSpec` from the same entry):
   - **`id`**: matches `^[a-z][a-z0-9-]{1,47}$` (`PLUGGABLE_ID_PATTERN` of `@marinoscar/platform-contract/settings`). It is the key the settings are stored under, so it is permanent once a row exists: never rename it.
   - **`label`**, optional **`description`**: what the admin form shows.
   - **`settingsSchema`**: a `z.object` of the **non-secret** fields only. `.describe('help')` becomes the field's help text and `.meta({ label })` its label (else the field name, humanised). Use `boolean`, `z.enum`, `number` and `string` fields: those render as a switch, a select and inputs; any other type (an object, an array, a record) is described as `other`, which the generated form shows as a note.
   - **`defaults`**: the settings of a fresh install. They must parse with `settingsSchema`.
   - **`secrets`**: `{ name, label, required, help? }[]` for each key or token the implementation needs. A secret is declared here, never a settings field (`apiKey` is in `secrets`, not in `settingsSchema`) and never an environment variable. The kind stores nothing: the consuming slice keeps each secret in the encrypted credential store under a credential purpose ([Add a credential purpose](#add-a-credential-purpose)) and tells the kind only whether one exists.
   - **`build({ settings, secret })`**: returns the instance, or a promise of it. `settings` is parsed with `settingsSchema` and has the defaults filled. `await secret('apiKey')` resolves a declared secret for this call and returns `null` when none is stored; throw a clear error for a required one that is missing. The consuming slice's own context is merged into the same object.
   - **`egressHosts(settings)`** (optional): the hosts an instance calls, for an `EgressContributor` ([Add a doctor check](#add-a-doctor-check)).
3. **Register at import time**, in `apps/api/src/app-registrations/core.ts`:

   ```ts
   greeterKind.register(plainGreeter);
   greeterKind.register(signedGreeter);
   ```

   Whatever builds the kind's instances imports that file before the application container is created. A duplicate id throws `DUPLICATE_ID`, a malformed one `INVALID_ID` or `INVALID_ENTRY`, and a registration after the application has bootstrapped `FROZEN`, like every other static registry. Ship an implementation as an npm package by following [the extension package rules](#how-to-ship-an-extension-as-its-own-npm-package): a module-scope side effect behind an entry the app imports.
4. **Store the settings as a record keyed by implementation id**, `{ [id]: that implementation's settings }`. The consuming slice calls the kind for both directions:

   | Direction | Call | Rule |
   |---|---|---|
   | Write | `kind.mergeSettingsRecord(stored, patch)` | An unregistered id throws `PluggableUnknownError`; an entry that does not parse throws `PluggableSettingsError` (zod `issues`). `null` removes an entry; anything else is merged over the stored entry and parsed, defaults filled. Entries the patch does not name are kept. Map both errors to the slice's own 400. |
   | Read | `kind.readSettingsRecord(stored, warn)` | An id that is no longer registered is dropped with **one** warning naming every such id; an entry that no longer parses falls back to the defaults with a warning. It never throws, so removing a plugin never bricks the row. |
   | Parse one | `kind.parseSettings(id, raw)` | Validates and fills defaults before `build`; `undefined` and `null` count as `{}`. |
   | Look up | `kind.get(id)`, `has`, `ids`, `list` | `get` throws `PluggableUnknownError`, whose message names the kind, the id and the registered ids. |

   Never write the secret into this record.
5. **Serve descriptors and render the generic form.**
   - **API.** `kind.describeAll((id) => ({ secrets: { apiKey: true } }))` (or `describe(id, presence)`) returns one `PluggableDescriptor` per implementation: `{ kind, id, label, description?, fields }`. `fields` holds the non-secret settings in declaration order (`describeConfigFields(schema)` does that part alone), then one `secret` field per declared secret, carrying `hasValue` and `required` and **never a value**. The slice computes the presence flags from its credential store and serves the descriptors on its admin route.
   - **Contract.** `pluggableDescriptorSchema` and `configFieldSchema` of `@marinoscar/platform-contract/settings` validate the wire shape; the field kinds are `boolean`, `enum`, `number`, `string`, `other` and `secret`.
   - **Web.** The page holds the state with `usePluggableConfigForm(descriptor, stored)` (`@marinoscar/platform-web/settings/headless`) and renders `<PluggableConfigForm descriptor value onChange secrets onSecretChange disabled />` (`@marinoscar/platform-web/settings/ui`). `form.payload()` returns `{ settings, secrets }`: the settings, and only the secrets the user typed (a blank secret means "keep the stored one"). A secret is a write-only `SecretField`; its stored value never reaches the browser. The form has no save button, fetch or permission check: the page sends `settings` through the slice's settings route and each typed secret to the slice's own route for that credential (there is no generic credentials route), and disables the controls without the write permission. Replace one field's control through the form's `slots` ([the settings web README](../packages/platform-web/src/settings/README.md)). Example: [`GreeterSettings.example.tsx`](../apps/web/src/__tests__/examples/settings/GreeterSettings.example.tsx).
   - **Card.** The page is an admin card: [Add an admin card](#add-an-admin-card).
6. **Run the conformance kit** on every registered implementation (`describePluggableKindConformance` of `@marinoscar/platform-api/core/testing`). Import the file that registers the implementations first, so they exist when the cases are declared:

   ```ts
   import '../../../src/app-registrations/core';
   import { describePluggableKindConformance } from '@marinoscar/platform-api/core/testing';

   describePluggableKindConformance(greeterKind, { describe, it, expect });
   ```

   It checks a valid id and label, defaults that parse with the implementation's own schema, a descriptor that validates with one `secret` field per declared secret and only presence flags, no `settingsSchema` field named like a secret (`/key|secret|token|password/i`), a secret name that is unique and does not collide with a settings field, and a `build` function. A setting that is genuinely not a secret (an S3 `keyPrefix`) is vouched for with `{ allowSecretLikeFields: ['keyPrefix'] }` as the third argument.
7. **Check it.** `npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/core/pluggable-kind` for the API and `cd apps/web && npx vitest run src/__tests__/examples/settings/pluggable-config-form.test.tsx` for the form.

The rules, from the [open id vocabulary](#open-an-id-vocabulary) shape:

- **A secret is never a settings field and never an environment variable.** It is declared in `secrets`, stored encrypted in the credential store, resolved only through `secret(name)` for the call, and described as `hasValue`. No route, log line, error or descriptor carries its value.
- **The id is a string with a pattern, not a union.** Do not add a `z.enum` of ids or a `switch` over them; look the implementation up with `kind.get`.
- **An unknown id is refused on write and ignored with one warning on read.**
- **Runtime configuration is never an environment variable.** The settings are stored at runtime and edited in the admin form.

### Add an AI provider (the AssemblyAI case)

Available now. An app, or an `@acme/ai-assemblyai` package an app installs, adds a provider (here a transcription-only AssemblyAI) that is configured at runtime, keyed by users, organizations and the deployment, and metered, limited and gated like the built-ins, with no edit under `packages/`. It is [a pluggable kind](#writing-a-pluggable-implementation) (`aiProviderKind`, kind id `ai-provider`) behind one function, `registerAiProvider`. The worked example is [`example-transcribe`](../apps/api/src/platform-extensions/ai/example-transcribe/), a stand-in for AssemblyAI over a fake transport (no network); the contract and the rationale are in [the AI platform spec, §4](specs/ai-platform.md#4-extending-it-in-a-fork).

1. **Write the adapter**, one class implementing `AiProviderAdapter` (everything below imports from `@marinoscar/platform-api/ai`): [`example-transcribe.adapter.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-transcribe.adapter.ts).
   - `id` (`example-transcribe`, permanent once a setting, a key or a usage row references it), `displayName`, `defaultBaseUrl` (the host the Doctor's egress inventory lists), `listModels`, `verifyKey` and `classifyModel`.
   - **Only the ports the vendor has.** Presence is the declaration: an `audio` port with `transcribe` and no `speech` gives the capability `audio_transcription` and nothing else, and the gate pipeline refuses every other operation before the adapter is reached. The capabilities are the existing ones (`AI_CAPABILITIES`); a new capability or operation is not open yet (audit: [ai-7](EXTENSIBILITY-AUDIT.md#ai)).
   - The key arrives per call in `AiCallContext.apiKey` and the provider's settings in `AiCallContext.providerSettings`; the class holds neither. Every failure leaves as an `AiError` (`AiError.wrap(err, code, message)`), never the vendor's message.
   - The vendor sits behind an injected transport ([`example-transcribe.transport.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-transcribe.transport.ts)). A real provider puts its SDK or HTTP client behind the same interface, in this folder, and a test swaps in a fake.
2. **Provide it from a Nest module** that imports `AiCoreModule` and registers the adapter in `onModuleInit` ([`example-transcribe.module.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-transcribe.module.ts)):

   ```ts
   onModuleInit(): void {
     this.registry.register(this);
   }
   ```

3. **Describe it with a definition** ([`example-transcribe.provider.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-transcribe.provider.ts)), the part the rest of the slice reads before any adapter runs:

   ```ts
   import type { AiProviderDefinition } from '@marinoscar/platform-api/ai';

   export const exampleTranscribeProvider: AiProviderDefinition = {
     id: 'example-transcribe',
     label: 'Example Transcribe',
     module: ExampleTranscribeModule,
     settingsSchema: z.object({ region: z.enum(['us', 'eu']).default('us').describe('Processing region') }),
     defaults: { region: 'us' },
     requiresKey: true,
     help: { key: 'Where to find the key.' },
     // A provider whose adapter imports an SDK adds: sdkPackages: ['assemblyai'],
   };
   ```

   - **`id`** matches `^[a-z][a-z0-9-]{1,47}$` and equals the adapter's `id`.
   - **`settingsSchema`** is a `z.object` of the **non-secret** fields only. `.describe('help')` is a field's help text and `.meta({ label })` its label. A field named like a secret (`apiKey`, `key`, `token`, `secret`, `password`), `enabled` or `hasKey` is refused at registration.
   - **`defaults`** parse with `settingsSchema` and exclude `enabled`, which starts `false`.
   - **`requiresKey`** is `true` unless the vendor authenticates another way (then calls resolve with `keySource: 'none'`). **`requiresBaseUrl`** (optional) blocks enabling the provider until `settings.baseUrl` is set and requires a `baseUrl` field in the schema. **`help`** is the text under the key and endpoint fields.
   - **`sdkPackages`** (optional) lists the npm packages the adapter imports (step 6). The example imports none, so it omits the field.
4. **Register it at import time**, in [`apps/api/src/app-registrations/ai.ts`](../apps/api/src/app-registrations/ai.ts):

   ```ts
   import { registerAiProvider } from '@marinoscar/platform-api/ai';

   registerAiProvider(exampleTranscribeProvider);
   ```

   [`platform/ai/ai.config.ts`](../apps/api/src/platform/ai/ai.config.ts) imports that file before it calls `AiModule.forRoot()`, which loads the `module` of every registered definition. The registry freezes when the application bootstraps, so a later registration fails with `FROZEN`. `AiModule.forRoot({ providers: ['openai', 'example-transcribe'] })` loads only the ids you name, and an id nobody registered fails at boot, naming the registered ones. A package exposes the same call behind an entry the app imports (`import '@acme/ai-assemblyai/register'`), as in [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package). A malformed definition (a bad id, a secret-looking field, defaults that do not parse) throws at registration.
5. **There is nothing else to wire.** Registering gives the provider:
   - **A settings slot.** `ai.providers` is a record keyed by provider id, `{ enabled } & the provider's settings`, so the stored value is `ai.providers['example-transcribe'] = { enabled, region }`. A fresh install reads it switched off with the defaults. Every write (`PUT /api/admin/ai/config`, `PATCH /api/system-settings`) validates the slot with the `settingsSchema`: an unregistered id is `400 AI_UNKNOWN_PROVIDER`, an undeclared setting `AI_PROVIDER_FIELD_UNSUPPORTED`, an invalid value `AI_PROVIDER_SETTINGS_INVALID`. A read never fails: a slot stored for a provider that is no longer registered is dropped with one warning.
   - **Keys, through the existing routes.** The deployment key at `PUT /api/admin/ai/providers/example-transcribe/key` (the adapter's `verifyKey` accepts it before anything is stored; it is encrypted in the credential store under the existing purpose `ai`, name `example-transcribe`), a user's own key at `PUT /api/ai/keys/example-transcribe` and an organization's at `PUT /api/admin/ai/org-keys/example-transcribe`. No credential purpose, route or table is added, and no environment variable.
   - **The gates.** The kill switches, the provider switch, model enablement, the key policy, rate limits, usage rows and the Doctor check treat it like a built-in. It starts off: an administrator enables it at `/admin/settings/ai`, stores a key, refreshes the catalog and enables a model.
6. **Keep its SDK in its folder.** The vendor's package is imported only under `platform-extensions/ai/<id>/`. Pass that folder to the `ai-no-sdk-leak` conformance suite in [`apps/api/test/conformance.spec.ts`](../apps/api/test/conformance.spec.ts) and list the package in `sdkPackages`:

   ```ts
   aiNoSdkLeak: { /* apiTrees, webTrees, noSdkManifests, ... */ providerDirs: ['platform-extensions/ai/'] },
   ```

   Each directory is relative to the root of an `apiTrees` entry, ends in `/` and must hold a source file, so a typo cannot exempt nothing. The suite then bans every registered `sdkPackages` entry everywhere else (the app, the web, the contract).
7. **The web needs no code.** `GET /api/admin/ai/config` serves a descriptor per provider (`descriptors`, with `settings`, `requiresBaseUrl` and `help` on each provider), and the admin AI page draws a card from it: an Enabled switch, a select for `region`, a write-only key field with Save key, Test and Remove key. The user and organization key pages list providers from the API. To replace the generated card, register your own at module scope (the card is a presentation choice; the API still validates every save):

   ```tsx
   import { AiGenericProviderCard, registerAiProviderCard } from '@marinoscar/platform-web/ai/ui/provider-cards';

   registerAiProviderCard('example-transcribe', (props) => <AiGenericProviderCard {...props} />);
   ```

   Wrap `AiGenericProviderCard` to add to the generated card, or render your own markup from `AiProviderCardProps`.
8. **Prove it with the kit and a test that boots the real app.**
   - **The adapter.** `describeAiProviderConformance` of `@marinoscar/platform-api/ai/testing` over the fake transport: [`example-transcribe.conformance.spec.ts`](../apps/api/test/examples/ai/example-transcribe.conformance.spec.ts). The scenarios of a port the adapter does not carry have nothing to check and pass; the spec adds what the kit cannot know (the capability set is `audio_transcription` alone, the region reaches the transport, no log or error carries the key).
   - **The gates over your provider.** `createAiRuntimeHarness({ extraProviders, extraAdapters, models, extraProviderSettings })` runs the real `AiService`, key resolver, usage recorder and run state machine over in-memory tables, with your provider enabled and a user key for it. [`example-transcribe.e2e.spec.ts`](../apps/api/test/examples/ai/example-transcribe.e2e.spec.ts) drives the admin routes (descriptor, enable with `region: 'eu'`, key verified before it is stored, `403 AI_DISABLED` while off) and the runtime (a user transcribes through the existing route and job, the usage row names the provider, a user's own key wins over the deployment key).
   - **The stored shape.** [`ai-stored-settings.spec.ts`](../apps/api/test/examples/ai/ai-stored-settings.spec.ts): a row stored before the registry existed loads unchanged, and a slot for a removed provider is dropped with one warning.
   - **The web.** [`example-provider-card.test.tsx`](../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx): the admin page draws the provider with no web code, and the typed key goes out once, alone.
9. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/ai
   cd apps/web && npx vitest run src/__tests__/examples/ai/example-provider-card.test.tsx
   ```

What is still closed (audit: [ai](EXTENSIBILITY-AUDIT.md#ai)): a new capability or operation (diarization, moderation, rerank), a transcription result with speakers (it carries `text`, `language`, `durationSeconds`, `segments` and `words`), and slots on the AI pages. The example transcribes only, within what the neutral contract already carries.

## Coming in later stories

Each placeholder names the story that replaces it; each is built on [the pluggable kind](#writing-a-pluggable-implementation). Until then the audit row is the record of what is closed.

### Coming in PP-14.7: add a storage driver

A storage driver (Azure Blob, GCS, local disk) with per-driver settings, a connection test, optional provisioning and key listing, and an admin form. **Not supported yet.** [Replace the object store](#replace-the-object-store) is the interim path for a backend that needs no admin form.

### Coming in PP-14.8: add an email transport

An email transport (SendGrid, Postmark) that notifications and the admin test send use, with settings, credentials and a conformance kit. **Not supported yet.** A provider of `SmtpEmailProvider` in the app module does not reach `EmailNotificationChannel` or `EmailTestSendService`; the selectable transports are `ses` and `smtp` (audit: [email](EXTENSIBILITY-AUDIT.md#email)).

### Coming in PP-14.9: add a sign-in provider

A sign-in provider (GitHub, Entra, a generic OIDC) completed from an app: provider-neutral profile, generic routes, a sign-in policy hook, async enablement with credentials from the credential store, and a conformance kit. **Not supported yet.** `registerAuthProvider` supplies a strategy and a guard but mounts no routes and has no login-completion seam (audit: [identity](EXTENSIBILITY-AUDIT.md#identity)).

### Coming in PP-14.10: add a notification channel

A first-class app channel (Slack, SMS, Teams, webhook) with a per-user handle, a channel template, an admin switch and visibility in the composer and the preference matrix. Today a channel is a registered id (`registerNotificationChannel`) plus a `NotificationChannelSender` that registers itself with `NotificationChannelSenderRegistry` from `onModuleInit` ([the notifications README](../packages/platform-api/src/notifications/README.md#adding-a-channel), [`example-webhook.channel.ts`](../apps/api/src/examples/notifications/example-webhook.channel.ts)); it has no per-user handle other than the email address and no admin switch.

### Coming in PP-14.11: replace the telemetry store

A `TelemetryStore` and SQL dialect so the time-series store behind the dashboard and the explorer is replaceable. **Not supported yet.** The query and dashboard services depend on the concrete GreptimeDB client. Redirecting ingest is possible through the app's collector overlay ([telemetry runbook §2.4](runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay)); querying another store is not.

### Coming in PP-14.12: add a backup target

A backup target port (with mirror targets), a cron schedule, age-based retention, app restore gates and completion events. **Not supported yet.** Backups write through the single `STORAGE_PROVIDER`, so [Replace the object store](#replace-the-object-store) changes where they go, for backups and everything else.

## How to ship an extension as its own npm package

An extension package (`@acme/ai-assemblyai`, `@acme/storage-azure`) is a package that an app installs next to `@marinoscar/platform-*` and that registers or binds its parts through the same seams an app uses. The platform packages are its host, so the package follows the rules that keep one copy of each.

1. **Depend on the platform as a peer, never as a dependency.** List `@marinoscar/platform-api` (or `-web`, `-contract`, `-db`, `-cli`) in `peerDependencies` at the range of the platform version you test against. Two copies of a platform package split module-level singletons (registries, injection tokens, the OpenTelemetry global) and fail at run time with "Nest can't resolve dependencies" or a registry that looks empty. The repository's `npm run check:single-instance` (`node scripts/check-single-instance.mjs --root <app>`) detects a second copy.
2. **Declare the peers of the slices you import.** A slice's peers are listed per slice in [`packages/platform-slice-peers.json`](../packages/platform-slice-peers.json) and printed by `node scripts/check-slice-peers.mjs --table`. Your package lists as peers what the slices it imports need (for a Nest package: `@nestjs/common`, `@nestjs/core`, `zod` and the rest), because the app must have them installed anyway and npm does not install an optional peer for it. The consuming app runs `node scripts/check-slice-peers.mjs --app <dir>`, which scans its `@marinoscar/platform-*` imports and fails for a missing peer. Rules: [PACKAGES.md](PACKAGES.md#peer-dependencies-per-slice).
3. **Import only documented subpaths** (`@marinoscar/platform-api/ai`, `…/host/testing`). A deep import is blocked by the `exports` map and is not part of any promise. Rely on `stable` symbols; an `experimental` one may change in a minor release, so pin the platform range tightly and re-run your conformance kit on each upgrade.
4. **Register at import time.** A static registry freezes when the application bootstraps, so your package registers from a module-scope side effect. Expose it as an entry the app imports before it composes the slice (`import '@acme/storage-azure/register'` in the app's registration file, before `forRoot()`), or as a function the app calls from `app-registrations/`. Registrations held by Nest (a job handler, a Doctor check) come from your Nest module's providers, which register from `onModuleInit`.
5. **Bind through `forRoot`, never a provider.** Export the class and let the app pass it: `StorageModule.forRoot({ provider: { useClass: AzureBlobProvider } })`. If your package ships a Nest module, make it export what the binding needs (the provider's dependencies come from the slice's `imports` option and global modules).
6. **Augment typed ids from your package's public entry**: `declare module '@marinoscar/platform-api/<slice>' { interface … }`, in a file your `types` entry reaches, so the app sees the widened ids without writing the augmentation.
7. **Never read or write secrets outside the credential store.** A provider key is a credential purpose (`registerCredentialPurpose`); your settings hold non-secret fields only. No environment variable for runtime configuration.
8. **Ship the kit's run as your tests.** Run the slice's conformance kit against your implementation in your package's own tests ([below](#conformance-kits)), and document in your README the app's wiring: the registration import, the `forRoot` binding, the credential purpose and the typed augmentation.
9. **Document it the platform's way.** The README states the platform range it supports, the exact lines an app adds, and what is not supported. The app's conformance run (`runPlatformConformance`) then discovers your registrations from the registries it scans.

## Conformance kits

A kit is a function an extension author calls with the implementation and the test runner's `describe`, `it` and `expect`, so it works under Jest and Vitest.

| Kit | Import | Checks | Status |
|---|---|---|---|
| `describeEventBusConformance(bus, { describe, it, expect })` | `@marinoscar/platform-api/host/testing` | Publish and subscribe on a dotted channel, ordering, unsubscribe, publish with no subscriber, `close()` | Available |
| `describeAiProviderConformance(name, factory, options?)` | `@marinoscar/platform-api/ai/testing` | `listModels`, `verifyKey`, `classifyModel`, each port the adapter carries (responses, embeddings, images, audio), every error is an `AiError`; the scenarios of a port it lacks pass | Available |
| `createAiRuntimeHarness({ extraProviders, extraAdapters, models })` | `@marinoscar/platform-api/ai/testing` | Not a kit but the runtime for one: the real gate pipeline (kill switch, provider switch, key policy, limits, usage) over your provider and in-memory tables | Available |
| `runPlatformConformance` | `@marinoscar/platform-api/testing` | The platform's invariants over the app's source and registrations; a slice's suites register by importing its `…/testing` entry | Available |
| `describePluggableKindConformance(kind, { describe, it, expect }, options?)` | `@marinoscar/platform-api/core/testing` | For each registered implementation of a pluggable kind: a valid id and label, defaults that parse, a descriptor that validates with secrets as presence flags only, no secret-looking setting, a `build` function | Available |
| Storage driver, email transport, auth provider, notification sender, telemetry store, backup target | the slice's `…/testing` entry | Each ships with its story (PP-14.7 to PP-14.12) | Coming |
| Doctor check, job handler | `@marinoscar/platform-api/doctor/testing`, `…/jobs/testing` | Read-only checks; handler profile, idempotence and node-eligibility pairing | Coming (PP-14.26) |

An app adds its own suite with `conformanceSuites.register` and a `declare module '@marinoscar/platform-api/testing'` augmentation of `PlatformConformanceSuiteOptions`; the android-app slice's `testing/conformance.ts` is the model. More: [TESTING.md](TESTING.md#platform-conformance).

## See also

- [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md): every closed point, its evidence and the story that opens it.
- [specs/platform-packages.md](specs/platform-packages.md#the-extension-contract): the ladder, the decision rule, the guardrails.
- [SLICES.md](SLICES.md): the slice catalog.
- [PACKAGES.md](PACKAGES.md): the documentation standard and the peer-dependency rules.
- [ADOPTING-THE-PLATFORM.md](ADOPTING-THE-PLATFORM.md): moving an existing app onto the packages.
- [`apps/api/src/app-registrations/README.md`](../apps/api/src/app-registrations/README.md): the app-owned registration files.

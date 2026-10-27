# Extending the platform

> **Audience:** developers of an app built on the `@marinoscar/platform-*` packages, and authors of an extension package an app installs · **Contract:** [The Extension Contract](specs/platform-packages.md#the-extension-contract) · **Audit:** [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md) (what is still closed) · **Catalogs:** the Extension-point catalog of each slice README, indexed in [SLICES.md](SLICES.md)

How to add to a platform slice from your own app, or from a package your app installs, without editing a file under `packages/platform-*`. The page gives the ladder of mechanisms and the rule that decides which one an override uses, then one numbered recipe per common extension. Every recipe names its imports and the file in the reference app that does the same thing. An extension that needs a seam the platform has not opened yet has no recipe here; [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md) lists each closed point and the story that opens it.

## Contents

1. [Before you start](#before-you-start)
2. [The extension ladder](#the-extension-ladder)
3. [Open an id vocabulary](#open-an-id-vocabulary)
4. [Recipes that work today](#recipes-that-work-today)
5. [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package)
6. [Conformance kits](#conformance-kits)
7. [See also](#see-also)

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
- **A slice that cannot be overridden yet says so** in its README (for example the sign-in provider: "not supported yet") and in the audit, instead of describing an override that does not work.

### Static and Nest-held registries

| Kind | Filled | Frozen | Examples |
|---|---|---|---|
| Static (`defineRegistry` at module scope) | At import time, from the app's registration files under `apps/api/src/app-registrations/` or from a side-effect import | When the application bootstraps (`RegistryFreezeService`); a later `register` throws `FROZEN` | Permissions, settings namespaces, notification events, templates and channels, storage key prefixes, metric groups, credential purposes, event bus adapters, storage drivers, user-owned models, system access reasons, principal and credential kinds, error codes |
| Held by Nest (a provider) | By a provider of yours, from its `onModuleInit` | Not frozen | `JobHandlerRegistry`, `DoctorCheckRegistry`, `EgressRegistry`, `NotificationChannelSenderRegistry`, `ObjectProcessorRegistry`, `AiProviderRegistry` |

The app-owned seam of every static registry is a file in [`apps/api/src/app-registrations/`](../apps/api/src/app-registrations/README.md). Upstream keeps those files empty; a fork fills them and never edits a platform declaration or manifest.

### Augmenting a typed id

A registry keyed by a typed id (`MetricGroupIds`, `AppMetricKeys`, `NotificationChannelIds`, `EmailTemplateDataMap`, `SystemSettingsNamespaces`, `CredentialKinds`, `PrincipalKinds`) widens by module augmentation of the **slice's public entry**, never a deeper path:

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

Some vocabularies stay closed on purpose, for security (`AUTH_ERROR_CODES`, the Doctor statuses): they are listed with a reason in [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md).

**The rule is enforced.** `npm run check:closed-lists` fails CI when a package adds a closed list: an exported `as const` array of two or more strings named `*_IDS`, `*_KINDS`, `*_TYPES`, `*_PROVIDERS`, `*_ADAPTERS`, `*_CHANNELS`, `*_ROLES`, `*_MODES`, `*_GROUPS`, `*_UNITS` or `*_NAMES`; an exported union of string literals named `*Id`, `*Kind`, `*Type`, `*Name`, `*Mode` or `*Role` without `(string & {})`; a `z.enum` over such an array in the contract; or a `Record` over such a union in a web `ui/` folder. Open it with the shape above (the built-in ids move to `BUILTIN_<X>_IDS` or `Builtin<X>Id`, which the check skips), or, when it must stay closed, add `{ file, symbol, reason }` to [`packages/closed-lists.allowlist.json`](../packages/closed-lists.allowlist.json). How the check works and what a reason looks like: [PACKAGES.md](PACKAGES.md#closed-id-lists).

## Recipes that work today

Each recipe is a checklist. The reference app's own file is linked where one exists.

### Add a metric, a group and its UI

The reference group is [`activity.metric-group.ts`](../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts): one file and one option, and it also carries the unit and the presentation of steps 6 to 8. The full walk-through, with the metric-name rules, is [the telemetry runbook §8.4](runbooks/telemetry.md#84-adding-an-app-metric-group).

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

6. **Add a unit** when a value is not a count, a size or a duration. Call `registerMetricUnit` at import time, before the group that uses it (`import { registerMetricUnit } from '@marinoscar/platform-api/telemetry'`): `registerMetricUnit({ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 })`, then set `unit: 'usd'` on a family. A unit is a descriptor with one of the fixed formats (`number`, `percent`, `bytes`, `duration-ms`, `duration-s`, `currency`, `text`, `boolean`, `timestamp`), never code; the API serves it with the group and the browser formats the value from it. An unregistered unit fails boot naming the registered ids.
7. **Choose how it looks** with `presentation` on the group, which is data the dashboard renders:

   ```ts
   presentation: {
     tiles: [{ metric: 'authLogins', label: 'Sign-ins' }, { metric: 'aiSpend', color: 'info' }],
     series: [{ title: 'Sign-ins by outcome', metrics: ['authLogins'], colors: { success: 'ok', failed: 'crit' } }],
     tables: [{ metric: 'notificationEvents', topN: 5, sort: 'value-desc' }],
     virtualColumns: [{ id: 'failureRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'attempts'], table: 'notificationEvents' }],
   },
   ```

   A colour is a theme token (`ok`, `warn`, `crit`, `info`, `neutral`, `series-1` to `series-8`), never a CSS value. A part you leave out gets the default (every tile, one chart per series, every table); a part you give is exactly what is drawn. A presentation that names a metric the group does not declare, an unregistered unit, or exceeds a bound fails when the group is registered, naming the path.
8. **Add a card** with a dashboard panel when a number needs its own space. On the API, `registerDashboardPanel({ id, label, order, data })` (from `app-registrations/telemetry.ts`): `data(ctx)` reads the store through `ctx.query` (the guarded query facade: one read-only statement per call, built with `ctx.query.sql.literal` / `between`) and returns JSON, at most 256 KiB. On the web, register the view for the same id at boot: `registerDashboardPanelView('signups', SignupsPanelView)` from `@marinoscar/platform-web/telemetry/ui/dashboard-panels`, called from a module the entry point imports (`main.tsx`). The view receives the `payload`, the window and the layout, never an API client; the dashboard draws the frame around it. Examples: [`signups.dashboard-panel.ts`](../apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts) and [`SignupsPanelView.example.tsx`](../apps/web/src/platform-extensions/telemetry/SignupsPanelView.example.tsx).
9. **Teach the assistant** with `registerTelemetryAssistantTool({ name, description, inputSchema, output, run })` when the AI assistant should answer a question about your data. `run` gets the same facade, so it can read and nothing else; the name must not be one of the platform's eight tools, `output: 'aggregate'` is for numbers only (a default `rows` tool's output is withheld from the model while `assistant.shareResults` is off), and the tool is offered only where the assistant already is (AI on, `ai:use`). `TelemetryModule.forRoot({ assistant: { extraInstructions } })` adds developer notes to the system prompt (at most 4 000 characters of plain text). Example: [`top-features.assistant-tool.ts`](../apps/api/src/platform-extensions/telemetry/top-features.assistant-tool.ts), registered by a fork that wants it (the reference app leaves it unregistered so the assistant's tool set stays the platform's).
10. **Seed the explorer** with your queries: `<TelemetryExplorerPage starterQueries={[...STARTER_QUERIES, mine]} />` ([`starterQueries.example.ts`](../apps/web/src/platform-extensions/telemetry/starterQueries.example.ts)). The three telemetry pages also take `slots` (a banner, a section) like any packaged page.
11. **Add an exporter or a reader** to the OpenTelemetry SDK in `instrumentation.ts`: `initializeOtel({ metricReaders: [...], spanProcessors: [...], logRecordProcessors: [...], views, sampler, textMapPropagator, resourceAttributes })`. The SDK puts every processor and reader behind the runtime export gate, so switching telemetry off in the admin UI stops them too, and no environment variable decides it. Example: [`dev-console-metrics.ts`](../apps/api/src/platform-extensions/telemetry/dev-console-metrics.ts).
12. **Test it.** The API: `createQueryFacade` of `@marinoscar/platform-api/telemetry/testing` over a recording query service, and `withTemporaryEntries` on `dashboardPanelRegistry` / `telemetryAssistantToolRegistry` ([`apps/api/test/examples/telemetry/`](../apps/api/test/examples/telemetry/)); the conformance suite (`telemetryConformanceSuite`) checks every registered group, panel and tool. The web: render the real dashboard over MSW ([`signups-panel.test.tsx`](../apps/web/src/__tests__/examples/telemetry/signups-panel.test.tsx)).

What stays closed: the metric catalog's SQL and the assistant's own prompt still describe the OpenTelemetry-on-GreptimeDB layout ([EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md#telemetry)).

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
9. **Prove it** with the kit, beside the handler: `describeJobHandlerConformance(name, () => handler, { payloads })` from `@marinoscar/platform-api/jobs/testing`. It checks the static contract (a dotted type, a label, a profile of exactly two numbers inside sane ceilings, the node pair both-or-neither, `ai.*` server-only), then per payload that the job settles through `createFakeJobQueue()`, that running it twice leaves the same result (give the payload an `observe()` snapshot, or an `assertIdempotent` for a handler that is additive by design), that a payload it must reject makes it throw (`expectFailure`), that duplicates collapse, and that `canDelete` is honoured. A service test injects `queue.asJobsService()` instead of a mocked `JobsService` and runs `queue.drain()`. Examples: [`example-handlers.conformance.spec.ts`](../apps/api/test/examples/jobs/example-handlers.conformance.spec.ts); the static half runs over every registered handler in [`job-handlers-contract.spec.ts`](../apps/api/test/jobs/job-handlers-contract.spec.ts), so yours is covered with no edit.

### Add a job reason

Examples: [`import.job-reason.ts`](../apps/api/src/platform-extensions/jobs/import.job-reason.ts), proved by [`job-reason.example.spec.ts`](../apps/api/test/examples/jobs/job-reason.example.spec.ts). `jobs.reason` is `TEXT`, so a reason of your own needs no migration.

1. **Declare it** (`import { registerJobReason } from '@marinoscar/platform-api/jobs'`): `{ id, label }`. The id is 2 to 48 lower-case letters, digits, `_`, `.` or `-`, starting with a letter, and permanent once rows carry it. In the reference app, list it in `APP_JOB_REASONS` (`apps/api/src/app-registrations/jobs.ts`); `platform/jobs/jobs.config.ts` registers the list at import time, before the application bootstraps.
2. **Enqueue with it**: `JobsService.enqueue({ type, reason: 'import', ... })`. An unregistered reason throws, naming the registered ones, so a typo is a bug rather than a new reason.
3. **Read it**: the admin job list publishes `reason` and `reasonLabel` (the registered label, or the id itself when the registration was removed; a stored row is never rejected).

### Put an app table on the nightly retention

Examples: [`import-rows.retention.ts`](../apps/api/src/platform-extensions/jobs/import-rows.retention.ts), proved by [`import-rows-retention.example.spec.ts`](../apps/api/test/examples/jobs/import-rows-retention.example.spec.ts). Spec: [job-queue.md, Retention policies](specs/job-queue.md#retention-policies).

1. **Declare the policy** (`registerRetentionPolicy` from `@marinoscar/platform-api/jobs`): a permanent `key` (`importRows`), a `label`, `defaultDays`, optional `minDays`/`maxDays` (within 1 to 3650) and `purge: { type, what }`, the job that enforces it. It ships OFF unless you set `defaultEnabled: true`: deleting rows is an operator decision. In the reference app, list it in `APP_RETENTION_POLICIES` (`app-registrations/jobs.ts`); the settings manifest registers the list before it registers the `retention` namespace. Registering after the namespace is composed throws.
2. **Write the purge handler**: a server-only `JobHandler` (neither node member) whose `type` is `purge.type`. Read its own policy per run (`getRetentionPolicy()[key]`) and delete with `runRetentionPolicyPurge`, which batches oldest first, by the exact ids read, and is a logged no-op while the policy is off. The table is yours: put it behind a port the app binds to its Prisma model.
3. **Mount it**: provide the handler in a module that is loaded. The 01:00 task enqueues one job per enabled policy whose handler is mounted; it needs no `RetentionPurgeRegistry.register` call (a handler may still declare one, which wins).
4. **Regenerate the settings catalog** (`npm run catalog:settings --workspace=api`) and commit it: the `retention` defaults now include your key. Reading an older stored row fills your key with its default; a key whose registration is removed is ignored with one warning and kept in the row.

### Report an executor's requirements, spans and vitals

Examples: [`transcode.executor.ts`](../apps/cli/src/examples/transcode.executor.ts) (the executor), [`transcode.span-attributes.ts`](../apps/api/src/platform-extensions/nodes/transcode.span-attributes.ts) (the API half), [`transcode.vitals.ts`](../apps/web/src/platform-extensions/nodes/transcode.vitals.ts) (the browser half). Spec: [worker-nodes.md](specs/worker-nodes.md#capability-probing).

1. **Declare what the machine needs** (CLI, `@marinoscar/platform-cli/node`): `registerProbedBinary('ffmpeg', { versionArgs: ['-version'] })` and `registerJobRequirement('app.transcode', { required: [binaryCapability('ffmpeg')], degradable: [...] })`. The startup self-test refuses to claim the type without a required tool, and `node doctor` lists the tool and its version. Call both before the node starts.
2. **Emit your own span** from the executor: `context.phase('job.app.transcode', work, (result) => ({ frames: result.frames, codec: result.codec }))`. The name must be `job.app.<name>`; attributes are non-negative integers or short token-shaped strings.
3. **Let the API relay the attributes** (`registerNodeSpanAttribute({ key, type, maxLength? })` from `@marinoscar/platform-api/nodes`, listed in `APP_NODE_SPAN_ATTRIBUTES`): an attribute nobody registered is dropped from the span, which is kept. They are emitted as `job.app.<key>`.
4. **Report numbers**: give the executor `vitals()` returning `Record<string, number>` (cheap, synchronous, at most 16 keys fleet-wide, keys `^[a-z][a-z0-9_.]{1,47}$`). They arrive as `vitals.extra` and show in the fleet page's vitals dialog; word them with `registerNodeVital({ key, label, unit })` from `@marinoscar/platform-web/nodes/headless` (an unregistered key still shows, by its key).

### Add a doctor check

Full recipe: [the Doctor README](../packages/platform-api/src/doctor/README.md#quick-start); contract: [doctor.md §4](specs/doctor.md#4-extending-it-in-a-fork). Example: [`example-capability.doctor-check.ts`](../apps/api/src/examples/doctor/example-capability.doctor-check.ts).

1. **Implement `DoctorCheck`** (`import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '@marinoscar/platform-api/doctor'`) with a unique `id`, a `category`, a `label` and `run()`. A check is read-only: a `SELECT`, a `HEAD`, a settings read, never a write.
2. **Return an outcome with a remedy** on every `warn` and `fail`; return `skip` with a reason when the capability is intentionally off. Use `dependsOn: ['db.connection']` to run after a check and be skipped with it.
3. **Register from `onModuleInit`**: `this.registry.register(this)`.
4. **Provide it** in the feature module that owns the capability. `DoctorModule` is global; the feature module imports nothing of it.
5. **Add the check id** to the pinned list in `apps/api/test/doctor/registered-checks.integration.spec.ts`.
6. Optionally describe the outbound hosts of the capability with an `EgressContributor` (`EgressRegistry.register` from `onModuleInit`).
7. Optionally put the check's facts in `data` (small scalars, never secret) and draw them in the check's row on the web with `registerDoctorCheckRenderer` ([Add a slot to a packaged page](#add-a-slot-to-a-packaged-page)).
8. **Prove it** with the kit, in the check's own spec: `describeDoctorCheckConformance(name, ({ prisma, storage }) => new MyCheck(registry, prisma.client), { scenarios })` from `@marinoscar/platform-api/doctor/testing`. It builds the check per test over a recording Prisma client and a write-failing storage provider, and per scenario checks its identity, that the run completes in time and never throws, that the outcome is valid with a remedy on `warn` and `fail` and no seeded secret, the statuses the scenario expects, and that nothing was written. Example: [`example-capability.conformance.spec.ts`](../apps/api/test/examples/doctor/example-capability.conformance.spec.ts). The `doctor-read-only` suite of `apps/api/test/conformance.spec.ts` runs the same proof over every registered check, so a check that writes fails the app's build even if its author never ran the kit.

### Add a conformance suite of your own

An invariant over what your app declares is a suite: the API's through `conformanceSuites` and a `declare module` augmentation of `PlatformConformanceSuiteOptions`, the web's through `webConformanceSuites` and a third `options` argument. Full recipe with code: [the API testing README](../packages/platform-api/src/testing/README.md#adding-a-suite-from-an-app-or-a-package) and [the web testing README](../packages/platform-web/src/testing/README.md#adding-a-web-suite-from-an-app-or-a-package). Examples: [`app-routes.suite.ts`](../apps/web/src/__tests__/examples/testing/app-routes.suite.ts) (a web suite with options and a planted-violation test); the android-app slice's [`testing/conformance.ts`](../packages/platform-api/src/android-app/testing/conformance.ts) and the Doctor's [`doctor-read-only.suite.ts`](../packages/platform-api/src/doctor/testing/doctor-read-only.suite.ts) (an API scan suite and an API suite that boots the app).

1. **Write the suite**: an `id`, a `title`, a `description`, and either `check` and `cases` (scan once, assert on the report) or, for an app-suite, `register(api, context, options)`. Discover what you check from the router, a registry or the source tree; a suite that lists names is a test of those names.
2. **Register it at import time**, once (`if (!conformanceSuites.has(id)) conformanceSuites.register(suite)`), and import the file before `runPlatformConformance`; the registry freezes on its first run. The web registry throws on a duplicate id.
3. **Add its options key** by augmenting the public specifier (`declare module '@marinoscar/platform-api/testing' { interface PlatformConformanceSuiteOptions { orderRoutes?: OrderRoutesOptions } }`). The option key is the camelCase form of the id. A web suite needs no augmentation: `suites: { 'order-routes': { ... } }`.
4. **Plant a violation** in a test and assert the suite names it. A suite that cannot fail is not a tripwire.
5. **Opt out with a reason** (`{ skip: 'why' }`) where an app does not need it; an empty reason throws.

### Add a notification event and template

Full recipe: [the notifications README](../packages/platform-api/src/notifications/README.md#quick-start). Example: [`invoice-ready.notification.ts`](../apps/api/src/examples/notifications/invoice-ready.notification.ts).

1. **Write the email template**: a function `(data, ctx?) => RenderedEmail` using `html`, `plainText`, `renderLayout`, `resolveEmailRenderContext` and `TRANSACTIONAL_EMAIL_HEADERS` from `@marinoscar/platform-api/email`. Type its data by augmenting `EmailTemplateDataMap` in that module.
2. **Write the browser renderer**: a `BrowserNotificationTemplate` from `@marinoscar/platform-api/notifications` returning `{ title, body, link }`; `link` is root-relative. Web Push reuses it.
3. **Declare the event**: a `NotificationEventDef` with a stable `key` (`coach.weekly_review`), `label`, `description`, `channels` and `defaultEnabled`.
4. **Register** the template and the notification in `apps/api/src/app-registrations/notifications.ts` (`APP_EMAIL_TEMPLATES`, `APP_NOTIFICATIONS`), or call `registerEmailTemplates` then `registerNotification({ event, emailTemplate, browserTemplate })` at import time. Event keys and template names are persisted: add new ones, never rename.
5. **Raise it** after the triggering write commits, outside any `$transaction`: `await this.notifications.notify('coach.weekly_review', userId, data)` (`NotificationsService`). `notifyNow` is the awaited form for a job handler.

A new channel (Slack, SMS, Teams, a webhook) is [Add a notification channel](#add-a-notification-channel).

### Add a notification channel

Available now. An app, or a package an app installs, adds a delivery channel (Slack, SMS, Teams, a webhook) with its own per-user handle, template, administrator switch and place in the broadcast composer and the preferences matrix, with no edit under `packages/`. A channel is a registry id plus a transport; unlike an AI provider or an email transport it has no settings form of its own to generate (the transport reads whatever configuration the app keeps for it), so it keeps the notifications registries rather than being [a pluggable kind](#writing-a-pluggable-implementation). The worked example is the [`webhook` channel](../apps/api/src/platform-extensions/notifications/webhook.channel.ts); the reference for every member is the [notifications README](../packages/platform-api/src/notifications/README.md#adding-a-channel).

1. **Declare the channel and its templates as data** (no Nest, so the registrations file can import it): a `NotificationChannelDef` with a permanent `id`, a `label` (what the switch, the composer and the matrix show) and the flags that apply (`criticalCapable`, `broadcastDefault`, `rendersRawData`, `userConfigurable`), and a template for each event that uses it.

   ```ts
   export const SLACK_CHANNEL: NotificationChannelDef = { id: 'slack', label: 'Slack', description: 'A direct message in Slack.' };
   export const invoiceSlackTemplate: ChannelTemplateRender = (data: { number: string }) => ({
     title: 'Invoice ready',
     body: `Invoice ${data.number} is ready.`,
     link: '/billing',
   });
   ```

2. **Register it** in `apps/api/src/app-registrations/notifications.ts`: the channel in `APP_NOTIFICATION_CHANNELS`, and each event with the channel listed and its template bound in `APP_NOTIFICATIONS` (`registerNotification({ event: { ..., channels: ['email', 'slack'] }, channelTemplates: { slack: invoiceSlackTemplate } })`). To put the channel on a **platform** event (the broadcast pair), register a copy with the channel added in `adaptPlatformBroadcasts`, in the same file: the package's constants are not edited. A template for an unregistered channel, an unregistered event or an event that does not list the channel fails at import with a `RegistryError` naming it; the `notifications` conformance suite fails an event bound for the channel with no template, unless the channel declares `rendersRawData: true`.
3. **Write the transport**: a `NotificationChannelSender` provided by the app's module, which registers itself with `NotificationChannelSenderRegistry` from `onModuleInit`. Implement `resolveRecipient(recipient, context)`: return `{ to, display }`, where `to` is what `deliver` needs (it may be secret: a phone number, a token) and `display` is the **redacted** label the delivery row stores (`+1 ***-**67`, `#ops-alerts`); return `null` when the user cannot be reached (no handle on file), which skips the channel for that user with no row and no attempt. `context.handle()` reads the user's destination from the handle source of step 4. `deliver` returns `{ success: false, error }` and **never throws**; keep every secret and the message body out of `error`. Read the rendered template with `renderChannelPayload(this.channel, context)`.
4. **Bind the handle source**: `NotificationsModule.forRoot({ recipientHandles: { useClass: SlackHandles } })` in `platform/notifications/notifications.config.ts`, where `SlackHandles implements RecipientHandleSource` (`handleFor(userId, channelId)` reads the app's own table). Never provide `NOTIFICATION_RECIPIENT_HANDLES` in an app module: Nest resolves a token from the consuming module's own providers, so the dispatcher would not see it.
5. **Prove it** with the kit, in the app's tests, with a fake for the HTTP call: `describeNotificationSenderConformance(sender, { describe, it, expect, recipient, handles, secrets })` from `@marinoscar/platform-api/notifications/testing`. It checks that the channel is registered, a reachable recipient resolves with a display that carries no secret, an unreachable one resolves to `null`, `deliver` never throws (any payload, a down transport, an empty destination), no secret reaches `error` or `messageId`, and an administrator's switch drops the channel (mandatory events included). The example's [`webhook-channel.spec.ts`](../apps/api/test/examples/notifications/webhook-channel.spec.ts) also boots the real application and checks the matrix, the switch, a broadcast and the handle.

What you get for free: an administrator switch per channel on `/admin/settings/notifications` (the `channels` record of the `notifications` system namespace, which an organization may only tighten), a column in the preferences matrix of every event that lists the channel, a checkbox in the broadcast composer when the broadcast events list it (the labels, order, defaults and the critical rule come from `GET /api/notifications/channels`), and a warning on a broadcast sent over a channel an administrator switched off. A gated column with a banner ("link your Slack account first") is `UserNotificationsPage`'s `channelStates` prop. A push can carry an icon, action buttons, a collapse tag or an urgency: `NotificationsModule.forRoot({ pushPayload })` returns them per event, and only those five survive. The notification pages take `slots` ([Add a slot to a packaged page](#add-a-slot-to-a-packaged-page)) for a banner or a section; the channel columns and labels still come from the registry (audit: [notifications](EXTENSIBILITY-AUDIT.md#notifications)).

### Add a settings namespace

Full recipe: [the reference app's settings registry README](../apps/api/src/settings/registry/README.md#adding-a-namespace) and [settings-ui.md §4](specs/settings-ui.md#4-extending-it-in-a-fork). Example: [`org-overridable.namespaces.ts`](../apps/api/src/platform-extensions/settings/examples/org-overridable.namespaces.ts).

1. **Write the declaration** (`SystemSettingsNamespace` or `UserSettingsNamespace` from `@marinoscar/platform-api/settings`): `key`, the stored, patch, put and wire-patch schemas, `defaults` that satisfy the stored schema, and a `merge`. No `.default()` in a user namespace. No field named `secret`, `password`, `apiKey`, `token`, `privateKey` and the like: the registry refuses it. Secrets are credential purposes.
2. **Add it** to `APP_SYSTEM_SETTINGS_NAMESPACES` or `APP_USER_SETTINGS_NAMESPACES` in `apps/api/src/app-registrations/settings.ts`. The manifests register it after the platform's namespaces; a colliding key fails at import time naming your entry. To add fields inside a platform namespace, see [Extend a settings namespace](#extend-a-settings-namespace).
3. **Type it**: `declare module '@marinoscar/platform-api/settings' { interface SystemSettingsNamespaces { coach: CoachSettings } }`.
4. **Regenerate the seed catalog** (system namespaces): `npm run catalog:settings --workspace=api`, and commit `prisma/catalog/system-settings-defaults.json`.
5. **Read it**: `await systemSettings.getNamespace('coach')` (`SystemSettingsService`). A stored row without the namespace reads as `defaults`.
6. **A namespace an organization may override** declares an `org` block and then appears on the Organization settings page without a web change.
7. **Give it a page** with [Add an admin card](#add-an-admin-card).

### Extend a settings namespace

Contract and security rules: [the settings README](../packages/platform-api/src/settings/README.md#extending-a-namespace). Examples: [`telemetry-query.extension.ts`](../apps/api/src/platform-extensions/settings/examples/telemetry-query.extension.ts), [`notifications-digest.extension.ts`](../apps/api/src/platform-extensions/settings/examples/notifications-digest.extension.ts), [`defaults.override.ts`](../apps/api/src/platform-extensions/settings/examples/defaults.override.ts), [`profile-timezone.ts`](../apps/api/src/platform-extensions/settings/examples/profile-timezone.ts), [`contribution.ts`](../apps/api/src/platform-extensions/settings/contribution.ts). The reference app registers none of them; [`extensions.http.spec.ts`](../apps/api/test/examples/settings/extensions.http.spec.ts) boots the real application with all of them.

1. **Add fields inside a namespace you do not own.** List a `SystemSettingsNamespaceExtension` (or `UserSettingsNamespaceExtension`) in `APP_SYSTEM_SETTINGS_EXTENSIONS` / `APP_USER_SETTINGS_EXTENSIONS`: `key`, the added `storedSchema` (required fields, no `.default()`) and their `defaults`. Without `path` the fields sit beside the namespace's top-level fields. With `path: 'query'` (a dot path to an object field) they go INSIDE that object: an existing leaf key is refused, the parent is not. A stored value that predates the field reads with the field at its default and everything else kept.
2. **Let organizations set the added field.** Add `org: { mode: 'override' }`, or `org: { mode: 'tighten', tighten: { slowQuerySeconds: 'min' } }` (`'and'`, `'or'`, `'min'`, `'max'` or a function that only restricts). Only the fields the extension adds can join the org layer; naming a base field fails at import. A top-level field appears on the Organization settings page as a control. A nested one is an object there; draw it with `registerOrgSettingsFieldRenderer` ([`SlowQueryField.example.tsx`](../apps/web/src/platform-extensions/settings/SlowQueryField.example.tsx)).
3. **Change a default.** `APP_SYSTEM_SETTINGS_DEFAULT_OVERRIDES` (data) or `overrideSettingsNamespaceDefaults('jobs', { stuckThresholdMinutes: 45 })` (a call, for a package). Checked at boot against the stored schema; it changes defaults only, never the shape or the merge. Regenerate the seed catalog after adding one: `npm run catalog:settings --workspace=api`.
4. **Add a profile field or a theme.** `extendUserProfile({ fields: z.object({ timezone: z.string().max(64).optional() }) })` and `registerThemePreference({ id: 'high-contrast', label: 'High contrast' })`, called at import time before `SettingsModule.forRoot()`. A profile field must be optional, bounded and not secret-named. In the web app pass the card a slot: `<UserProfilePage slots={{ ExtraFields: TimezoneField }} />` ([`TimezoneField.example.tsx`](../apps/web/src/platform-extensions/settings/TimezoneField.example.tsx)); a registered theme is offered by `UserAppearancePage` from the document's `themeOptions`, and applying it is your theme code. `security` stays closed on purpose: it is derived from the session policy.
5. **Ship it as a package.** The package calls `registerSettingsContribution({ id: '@kappa/billing-settings', system, user, extensions })` from its entry module, and the app adds one line to `app-registrations/settings-contributions.ts`: `import '@kappa/billing-settings';`. The manifests assemble, in this order: the platform's namespaces, the contributions' (import order), the app's own; then the extensions (the contributions', then the app's); then the defaults overrides. A key two owners declare fails the import naming both.
6. **Prove it.** Boot the application with your registration the way [`extensions.http.spec.ts`](../apps/api/test/examples/settings/extensions.http.spec.ts) does (reset the module registry, register, then build the app), and check the document, the org page and the stored value.

What is still closed (audit: [settings](EXTENSIBILITY-AUDIT.md#settings)): slots on the routed settings pages beyond `ExtraFields` (PP-14.24), and a second org extension under one nested path root (put every org field of a path in one extension).

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

### Add a slot to a packaged page

Full contract: [Page slots](../packages/platform-web/src/core/README.md#page-slots) in the web core README; page-specific slots in the README of the page's slice ([jobs](../packages/platform-web/src/jobs/README.md), [nodes](../packages/platform-web/src/nodes/README.md), [db-backup](../packages/platform-web/src/db-backup/README.md), [doctor](../packages/platform-web/src/doctor/README.md), [ai](../packages/platform-web/src/ai/README.md), [storage](../packages/platform-web/src/storage/README.md), [email](../packages/platform-web/src/email/README.md), [android-app](../packages/platform-web/src/android-app/README.md), [host](../packages/platform-web/src/host/README.md), [settings](../packages/platform-web/src/settings/README.md), [user-data](../packages/platform-web/src/user-data/README.md), [notifications](../packages/platform-web/src/notifications/README.md), [exports](../packages/platform-web/src/exports/README.md), [onboarding](../packages/platform-web/src/onboarding/README.md)). Examples, each with a test over the real packaged page: an extra jobs column ([`WaitedColumn.example.tsx`](../apps/web/src/platform-extensions/jobs/WaitedColumn.example.tsx)), a worker row action ([`CopyHostnameAction.example.tsx`](../apps/web/src/platform-extensions/nodes/CopyHostnameAction.example.tsx)), a backup run action ([`CopyArchiveKeyAction.example.tsx`](../apps/web/src/platform-extensions/db-backup/CopyArchiveKeyAction.example.tsx)) a Doctor check renderer ([`ExampleCapabilityFacts.example.tsx`](../apps/web/src/platform-extensions/doctor/ExampleCapabilityFacts.example.tsx)), a line under each AI provider's card ([`ProviderConsoleLink.example.tsx`](../apps/web/src/platform-extensions/ai/ProviderConsoleLink.example.tsx)), a section on the storage, email, Android, About, profile and organization settings pages ([`LifecycleRuleChecklist`](../apps/web/src/platform-extensions/storage/LifecycleRuleChecklist.example.tsx), [`DnsChecklistSection`](../apps/web/src/platform-extensions/email/DnsChecklistSection.example.tsx), [`StoreListingChecklist`](../apps/web/src/platform-extensions/android-app/StoreListingChecklist.example.tsx), [`HostExtras`](../apps/web/src/platform-extensions/host/HostExtras.example.tsx), [`AccountExtras`](../apps/web/src/platform-extensions/settings/AccountExtras.example.tsx)), the user-data pages' `copy` and notice ([`ErasureNotice.example.tsx`](../apps/web/src/platform-extensions/user-data/ErasureNotice.example.tsx)) notices on the notification pages ([`NotificationNotices.example.tsx`](../apps/web/src/platform-extensions/notifications/NotificationNotices.example.tsx)), a notice and list columns on the data export page ([`DataExportPageSlots.example.tsx`](../apps/web/src/platform-extensions/exports/DataExportPageSlots.example.tsx)) and notes on the Getting started page and the Setup guide ([`OnboardingPageSlots.example.tsx`](../apps/web/src/platform-extensions/onboarding/OnboardingPageSlots.example.tsx)); the tests are in [`apps/web/src/__tests__/examples/`](../apps/web/src/__tests__/examples/).

Every packaged page takes an optional `slots` prop typed to `PageSlotsBase` (`Header`, `BeforeContent`, `Sections`, `AfterContent`), and a page with a table adds `TableSlots<Row>` (`Columns`, `RowActions`, `DetailPanel`, `Toolbar`). With no slot the page's markup is unchanged.

1. **Pick the slot** from the page's README. Prefer the narrowest one: a `Columns` function over a copied page, `RowActions` over a custom table.
2. **Write a function component.** It receives data (the row, the check, the state the page holds), never an API client. If it must call the API, use `usePlatformApi()` and let the server enforce permissions.
3. **Pass it at the route**: `<Route path="/admin/settings/jobs" element={<JobsPage slots={{ Columns, RowActions }} />} />`. Keep the `slots` object, or its members, stable (module scope or `useMemo`): a page re-derives its columns when a table slot changes identity.
4. **Add a column** by wrapping `Columns`: `(base) => [...base, { id: 'owner', label: 'Owner', priority: 'secondary', value: (job) => ownerOf(job) }]`. The column type is the slice's (`JobsTableColumn<Job>`, `NodesTableColumn<WorkerNode>`).
5. **Render `Sections` with a position.** It is rendered at both ends of the body; return `null` for the end you do not want.
6. **Doctor.** `registerDoctorCheckRenderer(checkId, Component)` (from `@marinoscar/platform-web/doctor/headless`, at module scope, so the main chunk does not import the page) draws a check's `data` inside its row (the API's `example.capability` check reports `data: { configured, enabled }`); `slots.CheckRowActions` adds a button to every row.
7. **Test it** by rendering the real page with your slot, over `createTestPlatformHost` from `@marinoscar/platform-web/testing`, and assert the slot's output beside the page's own.
8. **A page of your own** follows the same contract: type its `slots` as `interface MyPageSlots extends PageSlotsBase`, and lay the body out with `PageSlotsFrame` (`header`, `headerProps`, `children`) so the order and the no-wrapper rule hold. The package's CI check (`test/page-slots.contract.test.ts`) enforces this for the packaged pages only.
9. **A line under each provider** (AI): `<AiConfigPage slots={{ ProviderCardExtra: ({ provider }) => <ConsoleLink id={provider.id} /> }} />`. The provider cards themselves are `registerAiProviderCard`; a storage driver panel or an email transport panel is its own registry, and the page slot is only for what sits around them.
10. **What a page prints from the API is registered on the API.** The Danger Zone's "Always kept" list and the factory reset page's "Deleted" and "Kept" lists are `kept` / `deleted` in the summary responses: give a kept model (`registerUserDataModels`) or a factory reset step (`registerFactoryResetStep`) a `summary` line and the page prints it after the platform's. The pages' `copy` prop renames headings and lead sentences.
11. **Not a page, so not a slot.** `MaintenanceScreen` (`logo`, `actions`, `children`), `InstallPrompt` (`icon`, `copy`) and `MaintenanceBanner` (`copy`, `actions`) take plain optional props.

Nothing is closed any more: `packages/platform-web/test/page-slots.exempt.json` is empty (PP-14.24b, #974 migrated the last three pages, `DataExportPage`, `GettingStartedPage` and `SetupGuidePage`). Keep it empty: a new packaged `*Page` takes `slots` typed to `PageSlotsBase` (or an interface that extends it) from its first commit and is never listed in the file. The contract test fails on a page that does not conform, naming it, and on an entry whose page now conforms.

### Add a field to `/auth/me` and to the user list, and show it

Available now (PP-14.25). Full reference: [the identity API README](../packages/platform-api/src/identity/README.md#user-extensions) and [the identity web README](../packages/platform-web/src/identity/README.md#user-extensions-on-the-user-payloads). Worked example with a spec: [`team-directory.extensions.ts`](../apps/api/src/platform-extensions/identity/team-directory.extensions.ts), [`user-extensions.spec.ts`](../apps/api/test/examples/identity/user-extensions.spec.ts) and the web column [`TeamColumn.example.tsx`](../apps/web/src/platform-extensions/identity/TeamColumn.example.tsx).

1. **Register at import time** in `apps/api/src/app-registrations/identity.ts`: `registerCurrentUserExtension({ id: 'billing', resolve: async (userId) => ({ plan: 'pro' }) })` for `GET /api/auth/me`, and `registerUserListExtension({ id: 'billing', resolve: async (userIds) => new Map(...) })` for the rows of `GET /api/users`. The id is lower-case (`USER_EXTENSION_ID_PATTERN`); the contribution appears under `extensions.billing`.
2. **Batch the list.** The list resolver is called ONCE per request with every id of the page and answers a `Map` from user id to a small object: one query for the page, never one per row. A user missing from the map gets nothing; an id not on the page is ignored.
3. **Keep it small and public-safe.** JSON only (no class instances, dates, functions), at most 4 KiB on `/auth/me` and 1 KiB per list row, five levels deep, and no key named like a secret (`token`, `apiKey`, `clientSecret`, ...) and no credential-looking value. A violation drops that contribution (never truncates it) and logs a warning with the extension id. Secrets belong in `CredentialsService`.
4. **Expect it to be skipped on failure.** A throw, a rejection or a timeout (`timeoutMs`, default 1.5 s on `/auth/me`, 3 s on the list) skips the extension and logs it; the request still succeeds. `/auth/me` runs this on every call, so keep `resolve` cheap.
5. **Read it on the web** with `useCurrentUserExtension<{ plan: string }>('billing')` or `userExtension(user, 'billing')`, and show it through a slot: a column with `<UsersPage slots={{ Columns: (base) => [...base, planColumn] }} />`, or a badge in your own chrome. Treat it as display data; the API enforces every permission.
6. **Test it** against the real application, as the example spec does (register before `createTestApp`, since the registries freeze at bootstrap), and assert the batch count.

### Add a tab, a section or a member action to the sharing pages

Available now (PP-14.25). Full reference: [the sharing web README](../packages/platform-web/src/sharing/README.md#page-slots-pp-1425). Examples with tests: [`GroupActivityTab.example.tsx`](../apps/web/src/platform-extensions/sharing/GroupActivityTab.example.tsx), [`ShareExpirySection.example.tsx`](../apps/web/src/platform-extensions/sharing/ShareExpirySection.example.tsx).

1. **A group tab:** `<GroupDetailPage slots={{ Tabs: [{ id: 'activity', label: 'Activity', Panel: GroupActivity }] }} />`. `Panel` receives `{ group }`. The page appends your tabs after Members and Invitations (which become tabs once you add one); keep the array a module constant. Use a tab only for content parallel to those views.
2. **A member action:** `MemberRowActions` receives `{ member, group, isSelf, canManage }` per row; the API still decides what the click may do.
3. **A share dialog section:** `<ShareDialog slots={{ Sections: ({ position, resource, canWrite }) => position === 'top' ? <PolicyNotice resource={resource} /> : null }} />` draws a stacked section (with its own `h3`, never a tab) at either end of the body; `Footer` adds a control beside "Done". The grantee picker is not slotted.
4. **A banner** on any of these pages is `BeforeContent`; the Users page's `Tabs` is the same append-only idea and follows the Settings UI rule 2 (tabs only for parallel content; a new page is a registry card).

### Add a destination badge, a group, an external link or a theme to the shell

Available now (PP-14.25). Full reference: [the shell README](../packages/platform-web/src/shell/README.md#destination-fields). Examples with tests: [`unread-badge.example.tsx`](../apps/web/src/platform-extensions/shell/unread-badge.example.tsx), [`high-contrast.theme.ts`](../apps/web/src/platform-extensions/shell/high-contrast.theme.ts).

1. **A badge:** give the destination `badge: useUnreadCount` (any function returning a number, string, element or nothing; it may call hooks). A count is added to the accessible name.
2. **A group:** `group: 'Work'` on destinations declared next to each other prints the heading in the rail and in the More sheet.
3. **An external link:** `external: true` with an `https://` `path` opens a new tab with `rel="noopener noreferrer"`; any other scheme is not drawn.
4. **A veto:** `onClick(event)` runs before navigation; `event.preventDefault()` cancels it (open a dialog instead).
5. **More than four destinations:** the phone bar draws three and a More sheet (`maxItems`, default 4); the reference app has four, so it never overflows.
6. **A theme mode:** `registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme })` at module scope in `theme/index.ts`, and the same id with `registerThemePreference` on the API so the Appearance page offers it (`themeOptions`). The stored choice then reaches the shell through `applyTheme` (your `setMode`). Carry your token contracts (`withTelemetryTokens`) in the theme, or the pages that read them cannot draw under it.

### Run the shell in a single-user host with no API

Available now (#997). A second host (KVox Desktop: Electron, one user, no sign-in, no `/user-settings`) uses the same shell as the web app. Full reference and example tree: [the shell README](../packages/platform-web/src/shell/README.md#running-in-a-local-single-user-no-api-host); the identity side: [the identity README](../packages/platform-web/src/identity/README.md#local-identity-no-sign-in-host).

1. **Mount, outermost first:** `ShellRoot` > router > `PlatformHostProvider` (a `viewer` that answers `hasPermission`, and an `api` that rejects) > `LocalIdentityProvider` (`userId`, `displayName`, `permissions`) > `ShellPreferencesProvider` (`createLocalStorageShellPreferencesPort()`) > `ShellLayout`.
2. **Permissions** come from the mounted `AuthContext`, else `PlatformHost.viewer`; keep the two lists from one constant.
3. **The user menu** hides sign-out and the organization switcher in local mode; add rows with `extraItems`. **The phone bar** renders `pinned` destinations at its end (in the More sheet when it overflows), so one `ShellNavigation` serves both surfaces.
4. **Prove it** in the host's CI with the `shell-local-host` web conformance suite.

### Add a side table with an `extend model` relation

Full reference: [the platform-db README](../packages/platform-db/README.md#extension-point-catalog) and [the app fragments README](../apps/api/prisma/fragments/README.md). Only a model its owner marked `// @extensible` takes a back-relation: `User`, `Organization`, `Role`, `Job`, `Group`, `Grant`, `AiRun`, `StorageObject`, `Notification`, `NotificationDelivery` and `Credential` (what an app may hang on each, and why `Permission` stays closed: [the platform-db README](../packages/platform-db/README.md#extension-point-catalog)). Never add a column to a platform table: a per-user or per-organization field goes in [metadata](#add-app-metadata-to-users-and-organizations).

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

A back-relation changes no SQL: marking a model `@extensible` adds no column, key or index, so no migration is needed for the relation itself. Mind the model's ownership:

- **A user-owned model** (`Notification`, `NotificationDelivery`, `User`) takes a plain key on `id`. Use `onDelete: Cascade` on a table that follows a notification so the inbox purge keeps working.
- **An org-owned model** (`Group`, `Grant`, `AiRun`, `StorageObject`) takes a composite key `(<x>_id, org_id)` -> `<table> (id, org_id)` from a table that carries `org_id` (every one of them has the `(id, org_id)` unique key), never a plain key on `id`: a foreign-key check runs without row-level security.
- **`Credential`** takes non-secret bookkeeping only. The `secret` column is never copied or related to; read plaintext through `CredentialsService`.
- **`Permission` is closed on purpose.** A permission is a string the registry owns and `seedPlatform` never deletes; a key from an app table would block retiring it. Refer to a permission by name in code.

The worked example, composed against the real platform fragments and run against Postgres, is [`apps/api/test/examples/db/`](../apps/api/test/examples/db/coach-notes.prisma): an organization table with a key to a notification, a composite key to a grant, a partial unique index and a policy.

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
3. **List the policy in `apps/api/prisma/platform.lock`**: `"rlsPolicies": [{ "name": "workouts_org_isolation", "table": "workouts", "usingSha256": "…", "checkSha256": "…" }]`. The two hashes are optional and make a weakened policy visible offline; `npm run db:policies --workspace=api` prints the entries, hashes included, from your migration SQL. A raw-SQL partial or expression index goes under `rawSqlIndexes` with its `pg_indexes.indexdef`; never "fix" either with `@@unique` or a schema change.
4. **Classify the model** in `APP_MODEL_OWNERSHIP` (`app-registrations/model-ownership.ts`) as `{ model: 'Workout', kind: 'org', rationale }`. `test/tenancy/model-ownership.spec.ts` fails for a model with no entry.
5. **Teach the reference app's live coverage spec your policy.** `apps/api/test/tenancy/rls-coverage.db.spec.ts` builds its lists from the package's `RLS_POLICIES`; add your policy names from the lock to the three places that read it, or the exact-match case fails. `runDbConformance` already checks your lock entries offline against the migration SQL (test `app-schema-objects`: a listed entry no migration creates, a changed policy expression, a table without `ENABLE`/`FORCE`, and an unlisted partial index or policy all fail), and `db:drift` checks them against the database.
6. **Query through the org-scoped client**: `PrismaService.forOrg(orgId)` for a single statement, `runInOrg` for a transaction (never a `forOrg` client inside `$transaction`). Take the organization from `@CurrentOrg()` (`@marinoscar/platform-api/identity`), never from a header, query or body. A job that touches the table carries `orgId` in its payload.
7. **Check it**: `npm run db:check --workspace=api`, `npm run db:drift --workspace=api` (asserts each listed policy in `pg_policies`, enabled and forced) and `npm run test:db --workspace=api`. The application role must be an ordinary `NOSUPERUSER NOBYPASSRLS` role, or no policy applies.

### Add app metadata to users and organizations

`users.metadata` and `organizations.metadata` are JSONB documents with one top-level key per namespace your app registers: a per-user or per-organization setting needs no side table, no column and no migration. Reference: [the identity README](../packages/platform-api/src/identity/README.md#app-metadata-on-users-and-organizations).

1. **Declare the shape** as a closed zod object in `apps/api/src/platform-extensions/identity/<name>.metadata.ts` (the example: `coach-preferences.metadata.ts`). No `z.any()` or `z.unknown()`, and no property named like a secret (`password`, `apiKey`, `token`, `webhookSecret`, ...): registration refuses both. Metadata is **not a secret store**; a secret goes in `user_credentials`, with at most a `hasKey` flag here.
2. **Register it at import time** in `apps/api/src/app-registrations/identity.ts`:

   ```ts
   import { registerUserMetadataSchema } from '@marinoscar/platform-api/identity';
   export const coachPreferences = registerUserMetadataSchema({ namespace: 'preferences.coach', schema: coachPreferencesSchema });
   ```

   An organization namespace is `registerOrganizationMetadataSchema`. The namespace is the JSON key: lower-case words joined by `.`, `-` or `_`, prefixed with your owner, **permanent once rows hold it**.
3. **Use it from a service** with `IdentityMetadataService` (global, nothing to import): `getUserMetadata(userId, coachPreferences)`, `setUserMetadata`, `updateUserMetadata(userId, handle, (current) => next)` (read-modify-write under a row lock) and `deleteUserMetadata`; the organization four. Values are validated on every write and read, typed by the handle, and the whole document may not exceed 16 KiB.
4. **Expose it only through a route you write.** The platform returns no metadata anywhere. Write the route with `@Auth()` (and an org permission for an organization namespace) and return the namespace you own, as `CoachPreferencesController` does; the helpers authorise nothing.
5. **Evolve the schema with the data.** A stored value that no longer satisfies a changed schema is `STORED_VALUE_INVALID` on read. Widen the schema (optional fields), or migrate the rows in an app migration (`UPDATE users SET metadata = jsonb_set(...)`).
6. **Personal data in a namespace** belongs in the app's export and purge decisions ([user-data-reset](specs/user-data-reset.md)); the platform's user-data export does not read it.

Proved by `apps/api/test/examples/identity/coach-preferences.spec.ts` (the real `AppModule`, the app service and route) and `apps/api/test/examples/db/app-extension.db.spec.ts` (real Postgres: concurrent writers of two namespaces lose nothing, the database CHECK).

### Add a seed step

`seedPlatform(prisma, input, { extras })` runs your steps after the platform's own, each in its own transaction, under the same log. Reference: [the seed README](../packages/platform-db/src/seed/README.md#app-seed-steps).

1. **Write the step** as `{ id, run(tx, ctx) }` returning `{ created, updated }`, in `apps/api/prisma/seed-app.ts` (or a file under `prisma/` it imports): an upsert on a natural unique, `update: {}` for anything an administrator may edit, never a delete, no import from `src/` or `@nestjs/*`. The example is `src/platform-extensions/db/coach-defaults.seed-step.ts`.
2. **List it** in `APP_SEED_STEPS` (`seed-app.ts`); `seed.ts` already passes the list as `extras`. An id is lower-case words joined by `.`, `-` or `_`, unique, and not one of the platform's six.
3. **Prove the second run creates nothing** in a real-database test: `await assertSeedIdempotent(() => seedPlatform(prisma, input, { extras: APP_SEED_STEPS }))` throws, naming the step, when it does. CI's `smoke` job also runs the seed twice.

### Keep an app migration clear of the platform history

An app migration lives after the installed ones and keeps Prisma's timestamped name. `platform db sync` and `platform db check` (and the `app-migrations` conformance test) refuse an app directory named like a package migration, and one that sorts before an installed platform migration but was not there at the last `sync` (a branch started before the sync and merged after): give it a timestamp after the last installed directory, or, if it was already applied, run `platform db sync` once. Details: [the platform-db README](../packages/platform-db/README.md#app-migrations-and-the-installed-history).

### Replace the object store

Rung 3, available now, for a backend that is not configured at runtime (one an administrator configures is [a storage driver](#add-a-storage-driver)). Full recipe: [the storage README](../packages/platform-api/src/storage/README.md#the-three-rungs-for-storage). Example: [`in-memory-storage.provider.ts`](../apps/api/src/platform-extensions/storage/in-memory-storage.provider.ts), proven by [`storage-provider-override.spec.ts`](../apps/api/test/examples/storage/storage-provider-override.spec.ts).

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
4. **Configuration stays runtime.** A bound provider overrides whatever driver the settings select, and the bundled `/admin/settings/storage` page does not configure it. Give the provider its own settings namespace and credential purpose ([above](#add-a-settings-namespace), [above](#add-a-credential-purpose)). Never add a storage environment variable. A backend that an administrator should configure on that page is a driver, not a binding: [Add a storage driver](#add-a-storage-driver).
5. **Test it with real consumers**: copy `storage-provider-override.spec.ts` and run `storageConformanceSuite` through `runPlatformConformance`.

Prefer [a storage driver](#add-a-storage-driver) unless the backend cannot be configured at runtime.

### Add a storage driver

Available now. An app, or an `@kappa/storage-azure` package an app installs, adds an object store (Azure Blob, Google Cloud Storage, a local disk) that an administrator configures at runtime, with its own settings, encrypted secrets, connection test and admin form, and that every storage consumer then writes through, with no edit under `packages/`. It is [a pluggable kind](#writing-a-pluggable-implementation) (`storageDriverKind`, kind id `storage-driver`) behind one function, `registerStorageDriver`. The worked example is [`local-fs`](../apps/api/src/platform-extensions/storage/local-fs.driver.ts): objects as files in a folder on the API host. The contract and the rationale are in [the storage spec, §2.8 and §4](specs/storage-providers.md); the reference for every member is the [storage README](../packages/platform-api/src/storage/README.md#adding-a-storage-driver-from-an-app-or-package).

1. **Implement the provider** the driver builds: `StorageProvider` (`import type { StorageProvider } from '@marinoscar/platform-api/storage'`), the whole interface, including the readonly `kind` (the driver id, written to `storage_objects.storage_provider` and to backup rows) and the synchronous `getBucket()` (the location, recorded on every row). Uploads of unbounded size stream, and a backup archive is never buffered: [`LocalFsStorageProvider`](../apps/api/src/platform-extensions/storage/local-fs.driver.ts) pipes into a temporary file and renames it into place. An operation the backend cannot do (`local-fs` has no browser-direct multipart upload) raises a clear error; declare it, do not hide it.
2. **Define the driver** (`StorageDriverDefinition`), the part the rest of the slice reads before any provider exists:

   ```ts
   import { z } from 'zod';
   import type { StorageDriverDefinition } from '@marinoscar/platform-api/storage';

   export const localFsStorageDriver: StorageDriverDefinition<{ directory: string }> = {
     id: 'local-fs',
     label: 'Local filesystem',
     settingsSchema: z.object({ directory: z.string().trim().max(512).meta({ label: 'Directory' }).describe('Absolute path the objects are written under.') }),
     defaults: { directory: '' },
     // secrets: [{ name: 'connectionString', label: 'Connection string', required: true }],   // a driver with a key declares it here
     build: ({ settings, appOrigin }) => new LocalFsStorageProvider(resolveLocalFsDirectory(settings), appOrigin ?? ''),
     testConnection: async ({ settings }) => ({ ok: true, message: `Wrote and read back a probe in ${resolveLocalFsDirectory(settings)}.` }),
     provision: async ({ settings }) => ({ created: true, message: `Created ${resolveLocalFsDirectory(settings)}.` }),
     listKeys: async function* ({ settings }, prefix) { yield* new LocalFsStorageProvider(resolveLocalFsDirectory(settings)).keys(prefix); },
     location: (settings) => ({ bucket: resolveLocalFsDirectory(settings) }),
     missing: () => [],
   };
   ```

   - **`id`** matches `^[a-z][a-z0-9-]{1,47}$` and is permanent once a row exists: it is the key of `storage.drivers`, the value of `storage.provider`, the provider's `kind` and `storage_objects.storage_provider`.
   - **`settingsSchema`** is a `z.object` of the **non-secret** settings only. `.describe('help')` is a field's help text and `.meta({ label })` its label. A field named like a secret (`secretAccessKey`, `apiKey`, `token`, `password`, ...) is refused at registration.
   - **`defaults`** parse with `settingsSchema`.
   - **`secrets`** (`{ name, label, required, help? }[]`) are kept encrypted in the credential store at the credential purpose `storage_<id>`, which `registerStorageDriver` registers for you. Read one with `await ctx.secret('name')` (`null` when none is stored); never put it in the settings and never in an environment variable.
   - **`build`** returns the provider every consumer shares. It runs when the configuration changes, not per request, and the provider's `destroy()` is called when it is superseded.
   - **`testConnection`** backs **Test connection** and **never throws**: every failure is `{ ok: false, message }`, and no `message`, `details` or `checks` entry carries a secret.
   - **`provision`** (optional) backs **Create bucket**; omit it for a backend with no bucket or container. **`listKeys`** (optional) lets `npm run storage:purge` empty the store; a driver that defines neither `purge` nor `listKeys` is reported `unsupported` (exit `3`). **`location`** says where the objects live (default `settings.bucket`, else the driver id), **`missing`** names what is still unset (default: every `required` secret that is absent), **`egressHosts`** lists the hosts for the Doctor.
3. **Register it at import time**, in [`apps/api/src/app-registrations/storage.ts`](../apps/api/src/app-registrations/storage.ts):

   ```ts
   import { registerStorageDriver } from '@marinoscar/platform-api/storage';

   registerStorageDriver(localFsStorageDriver);
   ```

   [`platform/storage/storage.config.ts`](../apps/api/src/platform/storage/storage.config.ts) imports that file before it builds the storage module. The registry freezes when the application bootstraps, so a later registration fails with `FROZEN`; a duplicate id or a malformed definition (a bad id, a secret-named setting, defaults that do not parse, a missing operation) throws at registration. A package exposes the same call behind an entry the app imports (`import '@kappa/storage-azure/register'`), as in [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package).
4. **There is nothing else to wire.** Registering gives the driver:
   - **A settings record.** `drivers['local-fs'] = { directory }` in the `storage` namespace, validated by the schema on every write: an unregistered id is `400` with `details.reason` `STORAGE_UNKNOWN_DRIVER`, a setting the schema refuses `STORAGE_DRIVER_SETTINGS_INVALID`. A read never fails: a record stored for a driver that is no longer registered is ignored with one warning.
   - **An entry in the driver list**, off until an administrator selects it and saves: a fresh install keeps `s3`. Selecting a driver relocates the deployment, so the `SWITCH` confirmation applies while objects exist; it acknowledges and does not copy.
   - **Every consumer.** The objects API, profile images, exports, database backups and the node object store receive the provider the selected driver builds. `databaseBackup.storageProvider` accepts the driver id, `npm run storage:purge` uses `listKeys` (or `purge`), and the Doctor's `network.egress` view lists `egressHosts` under `storage.<id>`.
5. **The web needs no code.** `GET /api/admin/storage-config` serves a descriptor per driver (`descriptors`, and every driver's settings in `drivers`), and the admin Storage page lists one radio per driver and draws a generated form: a control per setting and a write-only field per secret, **Test connection** (the driver's `message` and `details`) and **Create bucket**. To replace the generated form, register a panel at module scope (a presentation choice; the API still validates every save):

   ```tsx
   import { StorageGenericDriverPanel, registerStorageDriverPanel } from '@marinoscar/platform-web/storage/ui/driver-panels';

   registerStorageDriverPanel('local-fs', (props) => <StorageGenericDriverPanel {...props} />);
   ```

   Wrap `StorageGenericDriverPanel` to add to the generated form, or render your own markup from `StorageDriverPanelProps`.
6. **Prove it with the kit and a test that boots the real app.**
   - **The driver.** `describeStorageDriverConformance` of `@marinoscar/platform-api/storage/testing`: put, head, read and delete real bytes, a 6 MiB streamed upload, the signed URL, key listing, and a `testConnection` that never throws and never returns a secret. It needs no network: point the driver at a fake (a temporary directory, an in-memory SDK, an emulator).

     ```ts
     import '../../../src/app-registrations/storage';
     import { describeStorageDriverConformance } from '@marinoscar/platform-api/storage/testing';

     describeStorageDriverConformance('local-fs', { describe, it, expect, settings: { directory: tmpDir }, secrets: {} });
     ```

     The kit cannot tell a driver that buffers a whole stream from one that pipes it; keeping that rule is yours.
   - **The consumers.** [`local-fs-driver.spec.ts`](../apps/api/test/examples/storage/local-fs-driver.spec.ts) selects the driver through the real admin routes and asserts a profile image, an export and a database backup write through it, recorded with `storage_provider = local-fs`, that an unknown driver and an invalid setting are refused, and that an old flat row still loads.
   - **The web.** [`local-fs-driver-panel.test.tsx`](../apps/web/src/__tests__/examples/storage/local-fs-driver-panel.test.tsx): the admin page lists the driver with no web code, saves `{ provider, drivers }`, shows the driver's test message, and takes a secret write-only under `secrets.<id>.<name>`.
7. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/storage
   npm run test:run --workspace=web -- src/__tests__/examples/storage
   ```

What `local-fs` does not do, and a fork that selects it must add: its signed download URLs point at `/api/local-fs/objects/<token>`, a route the app does **not** mount by default (the driver is off until selected). A deployment that selects it mounts a route that calls `verifyLocalFsToken` and streams the object. It also has no browser-direct multipart upload, and it is a single-host store.

What is still closed (audit: [storage](EXTENSIBILITY-AUDIT.md#storage)): slots on the page (`Sections`), a flag on the descriptor saying whether a driver implements `provision` (the page learns it only from the answer to **Create bucket**), a driver `message` that is more than a plain string, and a `secretStatus` that describes more than the active driver's first declared secret (every driver's presence is in `descriptors`).

### Add an email transport

Available now. An app, or an `@kappa/email-sendgrid` package an app installs, adds a way of sending mail (SendGrid, Postmark, a log for local development) that an administrator configures at runtime, with its own settings, encrypted secrets and admin form, and that the notification channel, broadcasts and the admin **Send test email** then use, with no edit under `packages/`. It is [a pluggable kind](#writing-a-pluggable-implementation) (`emailTransportKind`, kind id `email-transport`) behind one function, `registerEmailTransport`. The worked example is [`log`](../apps/api/src/platform-extensions/email/log-transport.ts): messages kept in memory and one redacted line in the application log, no mail server. The reference for every member is the [email README](../packages/platform-api/src/email/README.md#adding-an-email-transport).

1. **Implement the transport**: an `EmailTransport` (`send`, and optionally `verify` and `destroy`). Extend `BaseEmailProvider` and write `deliver`; it implements `send` once, so `send` **never throws** (every failure is `{ success: false, error }`), the error text is scrubbed of each secret you pass to `redact.protect(...)` and length-capped, and a thrown throttle is classified (`rateLimited`, `retryAfterMs`) with the classifier the app gave `EmailModule.forRoot`. Implementing `EmailProvider` directly loses all three.

   ```ts
   import { BaseEmailProvider, type EmailMessage, type EmailSendResult, type SecretRedactor } from '@marinoscar/platform-api/email';

   class SendgridTransport extends BaseEmailProvider {
     protected readonly transportName = 'SendGrid';
     constructor(private readonly apiBase: string, private readonly apiKey: () => Promise<string | null>, protected readonly logger: Logger, classify?: GenericRateLimitClassifier) {
       super();
       this.rateLimitClassifier = classify;
     }
     protected async deliver(msg: EmailMessage, redact: SecretRedactor): Promise<EmailSendResult> {
       const key = await this.apiKey();
       redact.protect(key);                       // BEFORE anything that might throw with it in the text
       // ...POST msg (to, from, subject, html, text, headers, attachments) to the vendor...
       return { success: true, messageId };
     }
   }
   ```

2. **Define the transport** (`EmailTransportDefinition`), the part the rest of the slice reads before any transport exists:

   ```ts
   import { z } from 'zod';
   import type { EmailTransportDefinition } from '@marinoscar/platform-api/email';

   export const sendgridTransport: EmailTransportDefinition<{ apiBase: string }> = {
     id: 'sendgrid',
     label: 'SendGrid',
     settingsSchema: z.object({ apiBase: z.string().trim().describe('API base URL').meta({ label: 'API base URL' }) }),
     defaults: { apiBase: 'https://api.sendgrid.com' },
     secrets: [{ name: 'apiKey', label: 'API key', required: true }],
     build: ({ settings, secret, logger, classifyRateLimit }) => new SendgridTransport(settings.apiBase, () => secret('apiKey'), logger, classifyRateLimit),
     egressHosts: (settings) => [new URL(settings.apiBase).host],
   };
   ```

   - **`id`** matches `^[a-z][a-z0-9-]{1,47}$` and is permanent once a row exists: it is the key of `transports`, the value of `provider` and the suffix of the credential purpose.
   - **`settingsSchema`** is a `z.object` of the **non-secret** settings only. `.describe('help')` is a field's help text and `.meta({ label })` its label. A field named like a secret (`apiKey`, `password`, `token`, `secret`, ...) is refused at registration.
   - **`defaults`** parse with `settingsSchema`.
   - **`secrets`** (`{ name, label, required, help? }[]`) are kept encrypted at the credential purpose `email_<id>`, which `registerEmailTransport` registers for you (`credentialAddress` overrides it, as the built-ins do to keep `smtp` and `email_ses`). Read one with `await secret('name')` **at send time**, not once at build: a rotation then takes effect on the next message.
   - **`build`** returns the transport. It runs when the transport's settings change (the previous one is `destroy()`ed), not per message. `classifyRateLimit` is the app's generic throttle classifier.
   - **Optional hooks.** `verify` (a pre-flight the admin test runs before sending; never throws), `missing` (what the Doctor reports as unset; default: every required secret that is absent), `summary` (the Doctor's phrase for a complete configuration), `egressCapability` and `egressHosts` (the network-egress view).
3. **Register it at import time**, in [`apps/api/src/app-registrations/email.ts`](../apps/api/src/app-registrations/email.ts):

   ```ts
   import { registerEmailTransport } from '@marinoscar/platform-api/email';

   registerEmailTransport(sendgridTransport);
   ```

   [`platform/email/email.config.ts`](../apps/api/src/platform/email/email.config.ts) imports that file before it builds the email module. The registry freezes when the application bootstraps, so a later registration fails with `FROZEN`; a duplicate id or a malformed definition (a bad id, a secret-named setting, defaults that do not parse, a missing `build`) throws at registration. A package exposes the same call behind an entry the app imports (`import '@kappa/email-sendgrid/register'`), as in [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package).
4. **There is nothing else to wire.** Registering gives the transport:
   - **A settings record.** `transports.sendgrid = { apiBase }` in the `email` row, validated by the schema on every write: an unregistered id is `400` with `details.reason` `EMAIL_UNKNOWN_TRANSPORT`, a setting the schema refuses `EMAIL_TRANSPORT_SETTINGS_INVALID`, a secret it never declared `EMAIL_UNKNOWN_SECRET`. A read never fails on a transport that is no longer registered: its record is ignored, and a send or the Doctor reports the missing transport.
   - **An entry in the transport list**, off until an administrator selects it and saves: a fresh install keeps what it had.
   - **Every sender.** `EmailTransportResolver` (provided and exported once by `EmailModule`) builds the transport the settings' `provider` names; `EmailNotificationChannel` (notifications, broadcasts) and the admin **Send test email** depend on it, never on the SES and SMTP classes. The Doctor's `email.config` check judges it by its own `missing` and `summary`, and `network.egress` lists `egressHosts` under `email.<id>`.
5. **The web needs no code.** `GET /api/email-settings` serves a descriptor per transport (`descriptors`, and every transport's settings in `transports`), and the admin Email page lists one radio per transport and draws a generated form: a control per setting and a write-only field per secret. To replace the generated form, register a panel at module scope (a presentation choice; the API still validates every save):

   ```tsx
   import { EmailGenericTransportPanel, registerEmailTransportPanel } from '@marinoscar/platform-web/email/ui/transport-panels';

   registerEmailTransportPanel('sendgrid', (props) => <EmailGenericTransportPanel {...props} />);
   ```

   Wrap `EmailGenericTransportPanel` to add to the generated form, or render your own markup from `EmailTransportPanelProps`; `{ validate, toForm, toInput }` are optional client-side helpers.
6. **Prove it with the kit and a test that boots the real app.**
   - **The transport.** `describeEmailTransportConformance` of `@marinoscar/platform-api/email/testing`: `send` never throws (a network error, a thrown string and a thrown object are failed results), the error text carries no secret and no message content, attachments and headers are passed through to exactly one recipient, a throttle is classified. It needs no network: point the transport at a fake and hand the kit a `backend` that accepts or fails on demand.

     ```ts
     import '../../../src/app-registrations/email';
     import { describeEmailTransportConformance } from '@marinoscar/platform-api/email/testing';

     describeEmailTransportConformance('sendgrid', { describe, it, expect, settings: {}, secrets: { apiKey: 'SG.example' }, backend });
     ```

   - **The consumers.** [`log-transport.spec.ts`](../apps/api/test/examples/email/log-transport.spec.ts) selects the transport through the real admin route, sends the admin test email, delivers a notification with an email channel, reads the Doctor and the egress view, and asserts a failure comes back as a result with the credential redacted.
   - **The web.** [`log-transport-panel.test.tsx`](../apps/web/src/__tests__/examples/email/log-transport-panel.test.tsx): the admin page lists the transport with no web code, saves `{ provider, transports }`, takes a secret write-only under `secrets.<id>.<name>`, and draws a panel the app registered.
7. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/email
   npm run test:run --workspace=web -- src/__tests__/examples/email
   ```

An old `email` row (the flat `sesRegion`, `smtpHost`, ... fields) still loads: the fields are read into `transports.ses` and `transports.smtp`, served in the old flat shape on the response, and rewritten in the new shape on the next save; `PUT` still accepts the flat fields and `smtpPassword` / `sesSecretAccessKey` as aliases.

What is still closed (audit: [email](EXTENSIBILITY-AUDIT.md#email)): slots on the page (`Sections`), a `verify` that the Doctor runs (the Doctor never touches the network), and a descriptor field kind richer than the five of `describeConfigFields`.

### Replace the telemetry store

Available now. An app, or an `@kappa/telemetry-clickhouse` package an app installs, keeps the telemetry the collector exports in another database and has the explorer, the Telemetry Dashboard, the status page, the retention job and the Doctor query it, with no edit under `packages/`. It is [a pluggable kind](#writing-a-pluggable-implementation) with two parts: a **store** (the connection) and a **dialect** (the spelling of the SQL the dashboard cannot write portably). The worked example is [`memory-store.ts`](../apps/api/src/platform-extensions/telemetry/memory-store.ts): rows held in process memory, queried by a tiny SQL engine, no database. The reference for every member is the [telemetry README](../packages/platform-api/src/telemetry/README.md#replacing-the-store-rung-2).

1. **Implement the store** (`TelemetryStore`). `query` is the part that matters: it MUST refuse a statement that writes (`options.readOnly` is always `true`), honour `timeoutMs` (throw `TelemetryQueryTimeoutError`) and `signal` (`TelemetryQueryAbortedError`), and throw `TelemetryNotConfiguredError` while unconfigured. It returns positional rows (`{ fields: [{ name, dataTypeID }], rows: unknown[][] }`, a PostgreSQL type OID per column, 64-bit integers and timestamps as text). The explorer's guard (one read-only statement, the row cap, the timeout, the audit row) runs above the store, so a route never hands it a write; the guard is not a reason to skip the check.

   ```ts
   import { TelemetryQueryTimeoutError, type TelemetryStore } from '@marinoscar/platform-api/telemetry';

   class ClickHouseTelemetryStore implements TelemetryStore {
     readonly id = 'clickhouse';
     constructor(readonly database: string, private readonly client: ClickHouseClient) {}
     isConfigured() { return true; }
     configurationProblem() { return null; }
     async query(sql: string, _params: readonly unknown[], { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal }) {
       // a read-only connection (readonly=1), the timeout and the abort signal passed to the driver...
       return { fields: [/* { name, dataTypeID } */], rows: [/* unknown[] per row */] };
     }
     async schema() { return { tables: [/* { name, rows, columns: [{ name, type, semanticType }] } */] }; }
     async ping() { return { reachable: true, version: 'ClickHouse 24.3' }; }   // never throws
     async close() { await this.client.close(); }
   }
   ```

   `retention` is optional: add `{ isApplicable(), apply(days), current() }` and the nightly retention job calls it; without it the job is a logged no-op and the status page shows no TTL.
2. **Write the dialect** (`TelemetrySqlDialect`). The dashboard's statements are ANSI-flavoured SQL except seven constructs, which the platform asks the dialect for. Start from the built-in (`GREPTIME_SQL_DIALECT`) and replace what your engine spells differently:

   ```ts
   import { GREPTIME_SQL_DIALECT, quoteSqlLiteral, type TelemetrySqlDialect } from '@marinoscar/platform-api/telemetry';

   export const CLICKHOUSE_DIALECT: TelemetrySqlDialect = {
     ...GREPTIME_SQL_DIALECT,
     id: 'clickhouse',
     timeBucket: (column, seconds) => `toStartOfInterval(${column}, INTERVAL ${seconds} SECOND)`,
     percentile: (fraction, expr) => `quantile(${fraction})(${expr})`,
     // regexpReplaceAll, jsonString, containsIgnoreCase, castText and limit follow
   };
   ```

   | Member | The construct | GreptimeDB spelling |
   |---|---|---|
   | `timeBucket(column, seconds)` | An epoch-aligned time bucket | `date_bin(INTERVAL '60 seconds', "timestamp")` |
   | `percentile(fraction, expr)` | An aggregate quantile that ignores NULLs | `approx_percentile_cont(0.95) WITHIN GROUP (ORDER BY expr)` |
   | `regexpReplaceAll(expr, pattern, replacement)` | Route normalisation | `regexp_replace(expr, 'p', 'r', 'g')` |
   | `jsonString(column, key)` | A key of a log record's JSON `resource_attributes` | `json_get_string(col, '["service.name"]')` |
   | `containsIgnoreCase(expr, escapedPattern)` | The events search | `expr ILIKE '%p%' ESCAPE '\'` |
   | `castText(expr)` | Full-precision timestamp text for the events cursor | `CAST(expr AS STRING)` |
   | `limit(rows)` | The row cap | `LIMIT n` |
   | `timestampColumn`, `valueColumn` | The metric tables' time index and value | `greptime_timestamp`, `greptime_value` |

   What the dialect does **not** abstract, and a store must therefore accept: double-quoted identifiers, single-quoted literals, `CASE WHEN`, `GROUP BY` an alias, `UNION`, subqueries in `FROM`, scalar subqueries, `count`/`sum`/`min`/`max`/`avg`, `substr`, ISO timestamp literals compared with a timestamp column, `lag(...) OVER (...)` in the metric catalog's series, and the OpenTelemetry table layout the collector's exporter writes (`opentelemetry_traces`, `opentelemetry_logs`, flattened `"span_attributes.*"` columns). A store over another layout maps it in its query layer.
3. **Define and register it** at import time, in [`apps/api/src/app-registrations/telemetry.ts`](../apps/api/src/app-registrations/telemetry.ts):

   ```ts
   import { registerTelemetryStore } from '@marinoscar/platform-api/telemetry';

   registerTelemetryStore({
     id: 'clickhouse',
     label: 'ClickHouse',
     settingsSchema: z.object({ url: z.string().url().describe('HTTP endpoint'), database: z.string().default('otel') }),
     defaults: { url: 'http://clickhouse:8123', database: 'otel' },
     secrets: [{ name: 'password', label: 'Password', required: true }],
     build: async ({ settings, secret }) => ({
       store: new ClickHouseTelemetryStore(String(settings.database), makeClient(String(settings.url), await secret('password'))),
       dialect: CLICKHOUSE_DIALECT,
     }),
   });
   ```

   - **`id`** matches `^[a-z][a-z0-9-]{1,47}$` and is permanent once settings or a secret exist: it keys the `telemetry_store` row and names the credential purpose.
   - **`settingsSchema`** is a `z.object` of the **non-secret** settings; a field named like a secret is refused at registration. **`secrets`** are kept encrypted at the credential purpose `telemetry_<id>`, which `registerTelemetryStore` registers for you; read one with `await secret('name')` inside `build`.
   - **`build`** runs when the stored settings or a secret change (the previous store is `close()`d), not per query. A throw leaves the store unbuilt and the page shows why.
   - The registry freezes when the application bootstraps, so a later registration fails with `FROZEN`; a duplicate id or a malformed definition throws at registration. [`platform/telemetry/telemetry.config.ts`](../apps/api/src/platform/telemetry/telemetry.config.ts) imports that file before it builds the module.
4. **Select it.** Registering is not selecting. The store is a deployment decision, made in code, so every instance agrees:

   ```ts
   TelemetryModule.forRoot({ host: platformHost, imports: [TelemetryHostModule], store: 'clickhouse' });
   ```

   A `store` nobody registered fails boot, naming the registered ids. Allow the settings row in the app's settings-store adapter (`telemetry_store`, beside `telemetry_connection`: the reference app's `TELEMETRY_OWNED_ROW_KEYS`).
5. **There is nothing else to wire.** Selecting the store gives it:
   - **Every consumer.** The explorer, the export, the assistant's statements, the dashboard, the status page, the retention job, the Doctor checks and the support bundle read `TELEMETRY_STORE`; none imports the GreptimeDB client. The override reaches them all because `forRoot` binds the token where it is provided ([the rule](#overrides-go-through-forroot-bindings-never-an-app-module-provider)).
   - **A settings route and a form.** `GET` / `PUT /api/admin/telemetry/store` describe the store (a descriptor: its fields, then a write-only field per secret with presence only) and save it (`If-Match`, validated with your schema, secrets encrypted, an audit row with names only). A save reaches the running store on that instance at once and on every other within five seconds.
6. **The web needs no code.** The Telemetry settings page shows the GreptimeDB Connection form for the built-in store and, for yours, one **Store** section: a control per setting and a write-only field per secret, drawn from the descriptor by the settings slice's `PluggableConfigForm`. The services section (the GreptimeDB containers) is left out.
7. **Prove it with the kit and a test that boots the real module.**
   - **The store.** `describeTelemetryStoreConformance` of `@marinoscar/platform-api/telemetry/testing`: the definition, `query` refusing writes and staying usable, its timeout and abort signal, `schema()`, a `ping()` that never throws and leaks no secret, an unconfigured store, `close()` twice, and, given a `fixture`, **every dashboard statement built with your dialect run against your store**.

     ```ts
     import '../../../src/app-registrations/telemetry';
     import { describeTelemetryStoreConformance } from '@marinoscar/platform-api/telemetry/testing';

     describeTelemetryStoreConformance('clickhouse', {
       describe, it, expect, settings: {}, secrets: { password: 'x' },
       writeStatements: ['DROP TABLE opentelemetry_logs'],
       timeout: { statement: 'SELECT sleep(3)', timeoutMs: 20 },
       fixture: { prepare: (store) => loadRows(store), from, to },
     });
     ```

   - **The consumers.** [`memory-store.spec.ts`](../apps/api/test/examples/telemetry/memory-store.spec.ts) boots the real `TelemetryModule.forRoot({ store: 'memory' })` (through `bootStubApp({ store })`), loads fixture rows, and calls the dashboard summary, top routes, filters and events, the explorer (a read, and a write the guard refuses above the store), the status and schema routes and the store settings route. [`telemetry-store.module.spec.ts`](../packages/platform-api/test/telemetry/telemetry-store.module.spec.ts) asserts seven consumers all hold the same store.
   - **The web.** [`memory-store-section.test.tsx`](../apps/web/src/__tests__/examples/telemetry/memory-store-section.test.tsx): the page draws the Store section with no web code and saves `{ settings, secrets }` with the row's version.
8. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/telemetry
   npm run test:run --workspace=web -- src/__tests__/examples/telemetry
   ```

Not covered here: **replacing the OpenTelemetry collector's exporter**, which writes the telemetry into the store, is an infra overlay (the collector config is `@marinoscar/platform-infra/telemetry`; [telemetry runbook §2.4](runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay)). The API only reads. What is still closed (audit: [telemetry](EXTENSIBILITY-AUDIT.md#telemetry)): the assistant's own SQL and system prompt describe GreptimeDB (DataFusion) SQL, the metric catalog's series still read the OpenTelemetry-on-GreptimeDB table layout, and the Doctor's tables check names GreptimeDB in its text.

### Add a backup target, a mirror or a restore gate

Available now. An app, or an `@kappa/backup-vault` package an app installs, changes where database backups are written, keeps a second copy of each archive elsewhere, or adds a check that must pass before a restore, with no edit under `packages/`. All three are on the `db-backup` slice; the reference for every member is the [db-backup README](../packages/platform-api/src/db-backup/README.md) and the design is [the backup spec](specs/database-backup.md) and [the restore spec](specs/database-restore.md). The worked examples are [`local-dir.target.ts`](../apps/api/src/platform-extensions/db-backup/local-dir.target.ts) (an archive per file under a directory) and [`cdn-quiesced.gate.ts`](../apps/api/src/platform-extensions/db-backup/cdn-quiesced.gate.ts) (block a restore until the CDN is paused), both registered or bound from [`app-registrations/db-backup.ts`](../apps/api/src/app-registrations/db-backup.ts).

**Four things hold for every one of them, and the kits assert them:** an archive is **never buffered** (a target's write is a stream the dump is piped into, and the write AND the dump's exit code are awaited); the dump and the restore still carry both RLS flags (`--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on`, in the environment) whatever the target is; **no restore pre-flight creates, drops, renames or alters anything**, so a gate is read-only; and long-running work stays a queue job (a mirror copy runs inside the existing `db.backup.run` job, after the primary succeeded).

1. **Implement `BackupTarget`** (`import type { BackupTarget } from '@marinoscar/platform-api/db-backup'`).

   ```ts
   class VaultBackupTarget implements BackupTarget {
     readonly id = 'vault';                    // recorded on every run; lowercase
     openWrite(key: string): BackupSink {      // a streaming sink: { stream: Writable, done: Promise<void> }
       const stream = new PassThrough();
       const done = pipeline(stream, this.vault.putStream(key));   // settles when stored; rejects on a destroyed stream
       done.catch(() => undefined);
       return { stream, done };
     }
     async openRead(key: string): Promise<Readable> { return this.vault.getStream(key); }   // rejects when missing
     async delete(key: string): Promise<void> { await this.vault.remove(key); }             // a missing key is not an error
     async *list(prefix: string) { for await (const o of this.vault.list(prefix)) yield { key: o.key, sizeBytes: o.size }; }
   }
   ```

   The key is the server's (`database-backups/<slug>/<yyyy>/<mm>/<file>.dump`): never derive, rewrite or accept one from elsewhere, and refuse a key that leaves your root. Optional members: `location` (recorded as the run's `bucket`), `refresh()` (re-read settings your `id` depends on), `signedDownloadUrl(key, { expiresInSeconds, filename })` (without it the download route answers `400 backup_target_cannot_sign`; the archive is still restorable). Keep credentials in the credential store, never in an environment variable or a log line.
2. **Bind it, as the primary or as a mirror** (`apps/api/src/app-registrations/db-backup.ts`, imported by `platform/db-backup/db-backup.config.ts`):

   ```ts
   export const APP_BACKUP_TARGET = { useClass: VaultBackupTarget };                         // replaces the default adapter over STORAGE_PROVIDER
   export const APP_BACKUP_MIRROR_TARGETS = [localDirMirror('/mnt/backup-mirror')];          // each gets a copy after the primary is proven
   ```

   Exactly one of `useClass`, `useExisting`, `useFactory` per binding; its dependencies come from the slice's `imports` and global modules. Every consumer receives it: the runner, retention, the stale sweep, the admin download and delete and the restore. What changes with a target:
   - **A primary target** is recorded on each run (`storage_provider` = its `id`); `databaseBackup.storageProvider`, when set, must equal that id. A worker node cannot take a backup for it (its presigned PUT writes through the storage provider), so node offload is withheld and the in-process worker streams the dump into your target.
   - **A mirror** is copied to after the run is `completed`: the primary's bytes stream into the mirror, the copy is read back and its SHA-256 compared, and the result is an `audit_events` row (`db_backup.mirror.completed` / `.failed`). A failed mirror never fails the backup; the Doctor's `backup.mirrors` check warns. Retention and the admin delete remove the copy with the original. Ids must be unique.
3. **Schedule and retention need no code.** `databaseBackup.frequency: 'cron'` with `cron` (`0 */6 * * *`; lists, ranges and steps, at least an hour between runs, validated on write) and `retention: { count?, maxAgeDays? }` (`retentionCount` stays its alias) are settings an administrator or `PATCH /api/system-settings` writes. A row stored before them loads unchanged.
4. **Add a restore gate.**

   ```ts
   import { registerRestoreGate } from '@marinoscar/platform-api/db-backup';

   registerRestoreGate({
     id: 'cdn-quiesced',                       // letters, digits, _ and -
     label: 'CDN quiesced',                    // the row heading in the restore dialog
     async check(ctx) {                        // read-only: ctx is frozen; ctx.settings.get(namespace) reads a registered system namespace
       const cdn = await ctx.settings.get('cdn');
       if (cdn === undefined) return { status: 'pass', message: 'No CDN is configured.' };   // inert until the app registers the namespace
       return cdn.quiesced === true
         ? { status: 'pass', message: 'The CDN is quiesced.' }
         : { status: 'fail', message: 'The CDN is still serving.', action: 'Pause or purge the CDN, then retry.' };
     },
   });
   ```

   Register at import time (the registry freezes at bootstrap). The eight built-ins run first, then yours in registration order. `pass` and `warn` proceed (a `warn` is shown); a `fail` blocks the restore outright with no override (`overrideSchemaCheck` answers the schema gate only); a throw, a malformed answer or ten seconds without one is a block that names your gate. The dialog shows your gate beside the built-ins with no web code.
5. **React to the outcome.** `db_backup.run.completed` and `db_backup.restore.completed` (`DB_BACKUP_RUN_COMPLETED_EVENT`, `DB_BACKUP_RESTORE_COMPLETED_EVENT`) carry `{ runId, status, targetId, sizeBytes, durationMs }` on the application's event emitter, after the settling write commits and outside any transaction:

   ```ts
   @OnEvent(DB_BACKUP_RUN_COMPLETED_EVENT)
   onBackup(event: DbBackupRunCompletedEvent): void { void this.chat.post(`Backup ${event.runId}: ${event.status}`).catch(log); }
   ```

   A listener must not do I/O in its body (the `on-event-no-io` suite): enqueue a job or start a contained dispatch.
6. **Add a section to the page** (optional). `<DbBackupPage slots={{ Sections: RestoreDrillSection }} />` renders your component below the run history with the policy, the runs on screen, `canWrite`, `canRestore` and a `refresh`; see [`RestoreDrillSection.example.tsx`](../apps/web/src/platform-extensions/db-backup/RestoreDrillSection.example.tsx). With no slot the page's markup is unchanged.
7. **Prove it with the kits and a test that boots the real module.**
   - **The target.** `describeBackupTargetConformance` of `@marinoscar/platform-api/db-backup/testing` streams 20 MiB through it and fails a target that buffers (Buffer memory grows with the object, the sink queues more than 4 MiB, or the read arrives as one chunk), reads back byte for byte, fails a destroyed write through `done`, lists exactly a prefix, deletes idempotently and, with `rejectsEscapingKeys: true`, refuses `../`.
   - **The gate.** `describeRestoreGateConformance` runs your scenarios against a context that records every write, with `watch` counters for your own side effects (each must stay at zero), twice for repeatability, and through the registry's evaluator.

   ```ts
   describeBackupTargetConformance(() => new LocalDirBackupTarget(dir), { describe, it, expect, rejectsEscapingKeys: true });
   describeRestoreGateConformance(cdnQuiescedGate, { describe, it, expect, scenarios: [{ name: 'quiesced', settings: { cdn: { quiesced: true } }, expectStatus: 'pass' }] });
   ```

   - **The consumers.** [`local-dir.target.spec.ts`](../apps/api/test/examples/db-backup/local-dir.target.spec.ts) binds the mirror the way a fork would (`APP_BACKUP_MIRROR_TARGETS`) in the real application, takes a backup, and asserts the copy is written after the primary with the same key and bytes, a failing mirror is recorded without failing the backup, the event reaches a listener and the Doctor check is registered. [`cdn-quiesced.gate.spec.ts`](../apps/api/test/examples/db-backup/cdn-quiesced.gate.spec.ts) runs the real pre-flight and restore service: inert without a namespace, blocking until quiesced, `startRestore` refusing and queueing nothing, the cluster receiving no DDL. [`mirror-doctor.db.spec.ts`](../apps/api/test/examples/db-backup/mirror-doctor.db.spec.ts) is the real-database proof of the Doctor read.
   - **The web.** [`restore-drill-section.test.tsx`](../apps/web/src/__tests__/examples/db-backup/restore-drill-section.test.tsx) renders the packaged page with the slot, a cron schedule and an app gate.
8. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/db-backup
   npm run test:run --workspace=web -- src/__tests__/examples/db-backup
   ```

What is still closed (audit: [db-backup](EXTENSIBILITY-AUDIT.md#db-backup)): `RunRowActions` and the rest of the page-slot contract (PP-14.23). A mirror is copied one after another inside the backup job, so a very slow mirror lengthens the job (the job's six-hour ceiling applies) but never delays the primary's availability.

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

### Extend the host: health, maintenance, About, deployment modes and app guards

Available now. Full recipes: [the host README](../packages/platform-api/src/host/README.md#adding-a-health-indicator-a-maintenance-bypass-or-an-about-section); the design and the security reasoning: [the maintenance spec](specs/maintenance-mode.md). Examples live in [`platform-extensions/host/`](../apps/api/src/platform-extensions/host/), are registered (opt in, because each changes what every fork serves) by `registerHostExamples()` in [`app-registrations/host.ts`](../apps/api/src/app-registrations/host.ts), and are proven against the real host core by [`host-extension-points.integration.spec.ts`](../apps/api/test/examples/host/host-extension-points.integration.spec.ts) and [`app-guard.example.spec.ts`](../apps/api/test/examples/host/app-guard.example.spec.ts). Every registry below freezes at bootstrap: register at import time from `app-registrations/host.ts`.

1. **A health indicator** joins `GET /api/health` (every indicator) and, with `critical: true`, `GET /api/health/ready` (any critical one down is `503`). `/live` runs none.

   ```ts
   import { registerHealthIndicator } from '@marinoscar/platform-api/host';

   registerHealthIndicator({ id: 'broker', critical: true, timeoutMs: 1000, check: async () => ({ status: (await ping()) ? 'up' : 'down', details: { depth: 3 } }) });
   ```

   The probes are **public**: `details` is bounded (16 keys, strings up to 200 characters, credential-looking keys dropped) and a thrown error's text never leaves the process. Keep secrets and hostnames out of it anyway. Example: [`queue-readiness.indicator.ts`](../apps/api/src/platform-extensions/host/queue-readiness.indicator.ts).
2. **A maintenance bypass** lets a request through an open window that the built-in rule would refuse (a payment provider's webhook). It is fail-closed: only `true` allows; a throw, a rejection, a timeout or any other value blocks. It runs only after the built-in admin rule, never widens what an admin sees, and passes the window only: the route still authenticates its caller.

   ```ts
   registerMaintenanceBypass({ id: 'payments-webhook', allows: (request) => request.method === 'POST' && request.path === '/api/webhooks/payments' });
   ```

   `@AllowDuringMaintenance()` on a route you own is still the first choice; use a bypass for a route you cannot decorate or a rule that depends on the request. Example: [`payments-webhook.bypass.ts`](../apps/api/src/platform-extensions/host/payments-webhook.bypass.ts).
3. **An About contributor** adds a section to `GET /api/admin/about` (`extras: [{ id, label, facts }]`, absent when none is registered) and to the web About page, which renders one section per group with no slot needed. `registerAboutContributor({ id: 'transcription', label: 'Transcription', describe })`. A contributor that throws or takes over two seconds is left out. Example: [`transcription.about-contributor.ts`](../apps/api/src/platform-extensions/host/transcription.about-contributor.ts).
4. **A deployment mode or capability.** `registerDeploymentMode({ id: 'byoc', capabilities: { inAppRestore: false } })` makes `DEPLOYMENT_MODE=byoc` valid; `registerDeploymentCapability({ id: 'bulkExport', default: true, byMode: { saas: false } })` adds a switch read with `DeploymentModeService.can('bulkExport')`. Register both before `main.ts` parses the variable. `inAppRestore` stays the platform's capability. Example: [`byoc.deployment-mode.ts`](../apps/api/src/platform-extensions/host/byoc.deployment-mode.ts).
5. **A global guard of your own** (a throttler, a tenant guard). `MaintenanceGuard` stays the platform's `APP_GUARD` and must run first, so import `PlatformHostCoreModule.forRoot()` before the module that registers yours. Declare the guard to the `host` conformance suite, with the reason: `runPlatformConformance({ sourceRoots, suites: { host: { rootModule: AppModule, allowedAppGuards: [{ name: 'ThrottlerGuard', why: 'rate limiting is app-wide by policy' }] } } })`. An entry with an empty `why` throws, an entry nobody registers is a finding, and a guard registered ahead of `MaintenanceGuard` is a finding. Example: [`example-throttler.guard.ts`](../apps/api/src/platform-extensions/host/example-throttler.guard.ts).
6. **The maintenance routes' access and permissions.** `PlatformHostCoreModule.forRoot({ host, permissions: { maintenanceRead, maintenanceWrite } })` guards `GET`/`PUT /api/admin/maintenance` with the app's own access decorators and permission strings (default `system_settings:read` and `write`). The card in your admin registry must declare the same string.
7. **CORS and the response `meta`.** `buildCorsOptions(process.env.CORS_ORIGIN, { exposedHeaders: ['x-api-revision'], maxAge: 600 })` adds `methods`, `allowedHeaders`, `exposedHeaders` or `maxAge` and never touches the origin policy. `registerResponseMetaContributor({ id: 'api-revision', contribute: () => ({ revision: '2026-10' }) })` adds bounded keys (no credential-looking key, no more than a few short JSON values; `timestamp` is the platform's) to the `meta` of every enveloped response; it is synchronous and must not do I/O. Example: [`api-revision.response-meta.ts`](../apps/api/src/platform-extensions/host/api-revision.response-meta.ts).

What is still closed (audit: [host](EXTENSIBILITY-AUDIT.md#host)): the web pages' slots (PP-14.24), the CLI deploy wizard's `DEPLOYMENT_MODE` validator and the factory reset's `saas` comparison.

### Writing a pluggable implementation

Available now. A **pluggable kind** is the one shape every slice with a swappable part (AI provider, storage driver, email transport, sign-in provider, notification channel, telemetry store, backup target) is moving to, so you learn it once. The primitive is `definePluggableKind` of `@marinoscar/platform-api/core`; the AI providers, the storage drivers and the email transports use it ([Add an AI provider](#add-an-ai-provider-the-assemblyai-case), [Add a storage driver](#add-a-storage-driver), [Add an email transport](#add-an-email-transport)), the telemetry stores use it too ([Replace the telemetry store](#replace-the-telemetry-store)). Backup targets are the one swappable part that does not use it: a target has no administrator settings form to generate (where archives go is the deployment's, bound in code), so it binds through `DbBackupModule.forRoot` like an event bus adapter does: [Add a backup target, a mirror or a restore gate](#add-a-backup-target-a-mirror-or-a-restore-gate). Sign-in providers keep identity's own registry (`registerAuthProvider`), extended compatibly: a provider has no admin settings form to generate (its secrets are credentials, its enablement is whether they exist), so [Add a sign-in provider](#add-a-sign-in-provider) is its own recipe. Notification channels keep the notifications registries for the same reason (a channel's configuration is the app's, and its administrator control is one switch per channel): [Add a notification channel](#add-a-notification-channel). The full reference is [the core README, Pluggable kinds](../packages/platform-api/src/core/README.md#pluggable-kinds). Worked example, with no consumer slice: [`greeter.kind.ts`](../apps/api/src/platform-extensions/core/greeter.kind.ts), registered by [`app-registrations/core.ts`](../apps/api/src/app-registrations/core.ts), proven by [`pluggable-kind.spec.ts`](../apps/api/test/examples/core/pluggable-kind.spec.ts) on the API side and [`pluggable-config-form.test.tsx`](../apps/web/src/__tests__/examples/settings/pluggable-config-form.test.tsx) on the web side.

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

Available now. An app, or an `@kappa/ai-assemblyai` package an app installs, adds a provider (here a transcription-only AssemblyAI) that is configured at runtime, keyed by users, organizations and the deployment, and metered, limited and gated like the built-ins, with no edit under `packages/`. It is [a pluggable kind](#writing-a-pluggable-implementation) (`aiProviderKind`, kind id `ai-provider`) behind one function, `registerAiProvider`. The worked example is [`example-transcribe`](../apps/api/src/platform-extensions/ai/example-transcribe/), a stand-in for AssemblyAI over a fake transport (no network); the contract and the rationale are in [the AI platform spec, §4](specs/ai-platform.md#4-extending-it-in-a-fork).

1. **Write the adapter**, one class implementing `AiProviderAdapter` (everything below imports from `@marinoscar/platform-api/ai`): [`example-transcribe.adapter.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-transcribe.adapter.ts).
   - `id` (`example-transcribe`, permanent once a setting, a key or a usage row references it), `displayName`, `defaultBaseUrl` (the host the Doctor's egress inventory lists), `listModels`, `verifyKey` and `classifyModel`.
   - **Only the ports the vendor has.** Presence is the declaration: an `audio` port with `transcribe` and no `speech` gives the capability `audio_transcription` and nothing else, and the gate pipeline refuses every other operation before the adapter is reached. A kind of call the platform has no port for (diarization, moderation, rerank, OCR) is a custom operation, not a new port: [Add an AI capability and operation](#add-an-ai-capability-and-operation-diarization-moderation-rerank-ocr).
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

   [`platform/ai/ai.config.ts`](../apps/api/src/platform/ai/ai.config.ts) imports that file before it calls `AiModule.forRoot()`, which loads the `module` of every registered definition. The registry freezes when the application bootstraps, so a later registration fails with `FROZEN`. `AiModule.forRoot({ providers: ['openai', 'example-transcribe'] })` loads only the ids you name, and an id nobody registered fails at boot, naming the registered ones. A package exposes the same call behind an entry the app imports (`import '@kappa/ai-assemblyai/register'`), as in [How to ship an extension as its own npm package](#how-to-ship-an-extension-as-its-own-npm-package). A malformed definition (a bad id, a secret-looking field, defaults that do not parse) throws at registration.
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
   - **The adapter.** `describeAiProviderConformance` of `@marinoscar/platform-api/ai/testing` over the fake transport: [`example-transcribe.conformance.spec.ts`](../apps/api/test/examples/ai/example-transcribe.conformance.spec.ts). The scenarios of a port the adapter does not carry have nothing to check and pass; the spec adds what the kit cannot know (the capability set is `audio_transcription` from the port plus `speaker_diarization` from the operation, the region reaches the transport, no log or error carries the key). The kit's `operations` fixture runs the same scenarios over the custom operation.
   - **The gates over your provider.** `createAiRuntimeHarness({ extraProviders, extraAdapters, models, extraProviderSettings })` runs the real `AiService`, key resolver, usage recorder and run state machine over in-memory tables, with your provider enabled and a user key for it. [`example-transcribe.e2e.spec.ts`](../apps/api/test/examples/ai/example-transcribe.e2e.spec.ts) drives the admin routes (descriptor, enable with `region: 'eu'`, key verified before it is stored, `403 AI_DISABLED` while off) and the runtime (a user transcribes through the existing route and job, the usage row names the provider, a user's own key wins over the deployment key).
   - **The stored shape.** [`ai-stored-settings.spec.ts`](../apps/api/test/examples/ai/ai-stored-settings.spec.ts): a row stored before the registry existed loads unchanged, and a slot for a removed provider is dropped with one warning.
   - **The web.** [`example-provider-card.test.tsx`](../apps/web/src/__tests__/examples/ai/example-provider-card.test.tsx): the admin page draws the provider with no web code, and the typed key goes out once, alone.
9. **Check it.**

   ```bash
   npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/examples/ai
   cd apps/web && npx vitest run src/__tests__/examples/ai/example-provider-card.test.tsx
   ```

What is still closed (audit: [ai](EXTENSIBILITY-AUDIT.md#ai)): slots on the AI pages.

### Add an AI capability and operation (diarization, moderation, rerank, OCR)

Available now. An app, or a package an app installs, adds a kind of AI call the platform has no built-in port for, with no edit under `packages/`. Three registrations, in this order, at import time: a **capability** (what one model can do, declared in the catalog), an **operation** (one metered kind of call, with the zod schemas that are its trust boundary) and a **feature** (what an app feature needs from a model). The provider implements the operation under `AiProviderAdapter.operations`, and `AiService.forUser(userId, { feature }).run(operationId, input)` then runs it through the same gate pipeline as `respond` or `transcribe`: the kill switch, the provider and model gates (the model must declare the capability), the key policy, the rate limits, one usage row and one span. The worked example is `audio.diarize` on `example-transcribe`: [`example-diarize.operation.ts`](../apps/api/src/platform-extensions/ai/example-transcribe/example-diarize.operation.ts), registered by [`app-registrations/ai.ts`](../apps/api/src/app-registrations/ai.ts). The reference is the [AI platform spec, §2.26](specs/ai-platform.md#226-open-capabilities-operations-and-per-feature-usage).

1. **Register the capability** (`registerAiCapability`; `id` matches `^[a-z][a-z0-9_]{1,47}$`, permanent once a catalog row or an override stores it):

   ```ts
   import { registerAiCapability } from '@marinoscar/platform-api/ai';

   registerAiCapability({ id: 'speaker_diarization', label: 'Diarization', description: 'Labels who spoke when in a recording.' });
   ```

2. **Register the operation** (`registerAiOperation`; `id` matches `AI_OPERATION_ID_PATTERN`, permanent once a usage row exists, because it is the row's `operation`). Both schemas are required and **bound** their side (`.max(...)`): the runtime parses the input before any key is read and the output before it is returned.

   ```ts
   registerAiOperation({
     id: 'audio.diarize',
     label: 'Diarization',
     capability: 'speaker_diarization',
     inputSchema: z.object({ audioBase64: z.string().min(4).max(350_000) }),
     outputSchema: z.object({ speakers: z.array(z.string().max(32)).max(16), durationSeconds: z.number().min(0) }),
     usageUnits: (output) => ({ audioSeconds: output.durationSeconds }), // what the usage row meters
   });
   ```

3. **Implement it in the adapter**: an entry of `operations`, keyed by the operation id. It receives the parsed input and an `AiOperationContext` (the call's key, endpoint, settings and signal, plus `model` and `operation`), returns the output, and throws `AiError` only:

   ```ts
   readonly operations = {
     'audio.diarize': (input, ctx) => this.diarize(input as ExampleDiarizeInput, ctx),
   };
   ```

   Presence is the declaration, as with a port: the registry derives that the provider supports `speaker_diarization` from the entry, and `classifyModel` (or an administrator's override) declares the capability on a model. A model that lacks it, or a provider that does not implement the operation, is refused with `AI_CAPABILITY_UNSUPPORTED`.
4. **Register a feature** that needs the capability, after step 1 (`registerAiFeature({ id: 'example_meeting_notes', needs: ['audio_transcription', 'speaker_diarization'], ... })`), and call it:

   ```ts
   const output = await this.ai.forUser(userId, { feature: 'example_meeting_notes' }).run('audio.diarize', { audioBase64 });
   ```

   An omitted `model` is the first usable model that declares the capability on a provider that implements the operation; pass `{ provider, model }` to choose.
5. **Know what the runtime guarantees about secrets.** The key reaches the handler in `ctx.apiKey` and nowhere else. An output that contains the key is refused (`AI_STRUCTURED_OUTPUT_INVALID`), an error whose message or details carry it is replaced by a generic one of the same code, a raw error becomes `AI_PROVIDER_UNAVAILABLE` with a generic message, and the input and output are never logged or recorded: the usage row has ids, counts, codes, the feature and the units `usageUnits` returns.
6. **The web needs no code for the labels.** `GET /api/admin/ai/capabilities` (`ai_config:read`) lists every capability and operation; the admin Models page, its capability filter and the override dialog draw the app's capability from it, and the usage page groups by `operation` and `feature`. A page a viewer without `ai_config:read` sees (the Playground, the user pages) learns the label from `registerAiCapabilityLabel('speaker_diarization', 'Diarization')` at module scope, and shows the id until then.
7. **Add a Playground mode** with `registerAiPlaygroundMode`, at module scope (the six built-in modes register through the same function). The mode lists the usable models that declare its `capability`, is disabled with `unavailableReason` when there are none, and draws its `Panel`. The worked example reuses the packaged Transcribe panel with a provider option, in [`diarize-playground-mode.example.tsx`](../apps/web/src/platform-extensions/ai/diarize-playground-mode.example.tsx):

   ```tsx
   import { registerAiPlaygroundMode } from '@marinoscar/platform-web/ai/ui/playground-modes';

   registerAiPlaygroundMode({
     id: 'diarize',
     label: 'Diarize',
     operation: 'audio.diarize',          // the usage operation the mode exercises
     capability: 'speaker_diarization',   // the capability a model needs to be listed (default: the operation id)
     Panel: DiarizePanel,                 // receives { models, preferredModel, ready }
   });
   ```

8. **Prove it.**
   - **The adapter.** Add an `operations` fixture to `describeAiProviderConformance` (`{ [operationId]: { input, model, failingModel } }`): the scenarios `operations.declared`, `operations.run`, `operations.invalidKey` and `operations.providerError` check that the operation is registered and runnable, its output satisfies the schema without echoing the key, a rejected key is `AI_KEY_INVALID` and a failure is an `AiError`. [`example-transcribe.conformance.spec.ts`](../apps/api/test/examples/ai/example-transcribe.conformance.spec.ts).
   - **The gates.** [`example-diarize.spec.ts`](../apps/api/test/examples/ai/example-diarize.spec.ts) runs the real `AiService.run` over the example provider: the user key pays, one usage row names the feature and the audio seconds, a transcribe-only model is refused, an oversized input is `AI_INVALID_REQUEST` before the key is read.
   - **The web.** [`example-playground-mode.test.tsx`](../apps/web/src/__tests__/examples/ai/example-playground-mode.test.tsx): the mode appears after the built-ins, is disabled without a capable model, and posts the transcription with the provider option.

### Read usage by feature, and put a price on it

Available now. Every usage row carries the registered feature the call was made for (`ai_usage_events.feature`, and `ai_runs.feature` for a background run, carried to the usage row of the job's round trip), so usage is answerable per feature from the database. `GET /api/admin/ai/usage` and `GET /api/admin/ai/org-usage` take a `feature` filter and group by `feature` (key: the feature id, `none` for calls recorded without one) or by `operation`; the usage page has the matching breakdowns. The feature is validated against the feature registry before it is used and re-checked against its id pattern before it is stored, never free text. Calls made before the column existed have no feature.

The platform ships no rates. A deployment that has them binds one port through `AiModule.forRoot`, not a provider in an app module (Nest would not show it to the usage service):

```ts
import { ExamplePricing } from '../../platform-extensions/ai/example-pricing/example-pricing';

export const AiModule = PlatformAiModule.forRoot({ imports: [AiHostModule], pricing: { useClass: ExamplePricing } });
```

`AiPricing.costFor(usage)` prices one `(provider, model, operation)` slice of a report group (summed tokens and units) and answers `{ amount, currency }` or `null` for no price. The administrator's and the organization administrator's reports then carry `priced: true` and a `cost` on every bucket, and the usage page shows a Cost tile and column; a user's own report is never priced. A group's cost is the sum of its priced slices, `null` when none is priced or they use more than one currency, and a throwing port is a missing price (logged without the usage). Nothing stores a cost. [`example-pricing.ts`](../apps/api/src/platform-extensions/ai/example-pricing/example-pricing.ts) prices the example provider by the minute; [`ai-usage-by-feature.db.spec.ts`](../apps/api/test/examples/ai/ai-usage-by-feature.db.spec.ts) proves the filter, the group-bys and the priced report against a real Postgres.

### Read a transcript with speakers

Available now. `AiTranscriptionResult.extras` carries what a provider reports beyond the neutral fields: `segments` (`{ start, end, text, speaker? }`), `language` and any other JSON, at most 64 KiB serialised. A result whose extras are larger, not JSON or malformed keeps its transcript and drops the extras (the call is billed and recorded either way). A succeeded run's `output.extras` is the same object, and the packaged transcript view draws speaker-labelled segments. `POST /api/ai/audio/transcriptions` takes `providerOptions` keyed by provider id (a JSON object of at most 4 KiB, passed to the adapter, never logged and never put on a span or a usage row); the example adapter reads `providerOptions['example-transcribe'].diarize` and answers speaker-labelled extras ([`example-transcribe.e2e.spec.ts`](../apps/api/test/examples/ai/example-transcribe.e2e.spec.ts)).

### Add a sign-in provider

Available now. An app, or an `@kappa/auth-github` package an app installs, adds a way to sign in (GitHub, Entra, a generic OIDC, a company SSO) that completes a full login with no edit under `packages/`: the identity is stored under the provider's own id, the allowlist and the app's sign-in policy apply, the session and the refresh cookie are Google's, and the provider turns on when its secrets exist. The seam is `registerAuthProvider` (a registry, rung 2) plus `IdentityModule.forRoot({ signInPolicy })` (a binding, rung 3). The worked example is [`example-oidc`](../apps/api/src/platform-extensions/identity/example-oidc.provider.ts): a fake OIDC provider with no network. The reference for every member is the [identity README](../packages/platform-api/src/identity/README.md#adding-a-sign-in-provider).

1. **Define the provider** (`AuthProviderDefinition`):

   ```ts
   import { authCredentialPurpose, type AuthProviderDefinition } from '@marinoscar/platform-api/identity';

   const PURPOSE = authCredentialPurpose('github'); // 'auth_github'

   export const githubProvider: AuthProviderDefinition = {
     id: 'github',
     label: 'GitHub',
     isEnabled: async (_config, { credentials }) => (await credentials.getSecret(PURPOSE, 'client_secret')) !== null,
     createStrategy: async ({ config, credentials }) =>
       new GithubStrategy({
         clientID: config.get<string>('github.clientId')!,        // not a secret: configuration
         clientSecret: (await credentials.getSecret(PURPOSE, 'client_secret'))!,
         callbackURL: `${config.get('appUrl')}/api/auth/github/callback`,
       }, verify),                                                 // verify -> done(null, rawProfile)
     mapProfile: (raw) => ({ provider: 'github', subject: String(raw.id), email: raw.primaryVerifiedEmail ?? null, emailVerified: Boolean(raw.primaryVerifiedEmail), displayName: raw.name }),
     egressHosts: ['github.com', 'api.github.com'],
     doctorRemedy: 'Store the GitHub OAuth app secret under the credential purpose auth_github.',
   };
   ```

   - **`id`** matches `^[a-z][a-z0-9-]{0,31}$` and is permanent once an identity exists: it is the route segment, `UserIdentity.provider` and the Passport strategy name.
   - **`createStrategy(ctx)`** builds the Passport strategy **for each sign-in request**, from the credential store as it is at that moment, so a rotated secret applies to the next sign-in with no restart. A provider that must be constructed by Nest at boot instead supplies `strategy` and `guard` classes (Google does); exactly one of the two ways is required for a `redirect` provider.
   - **`isEnabled(config, ctx)`** may be asynchronous. The provider is listed by `GET /api/auth/providers` and its routes answer only while it is true; a throw counts as "not enabled". A fresh install that stored no secret lists nothing new.
   - **`mapProfile(raw)`** turns what the strategy's verify callback returned into an `ExternalProfile`. Set `emailVerified: true` **only when the provider vouches the person controls the address**: an unverified or missing address is refused (`access_denied`) before any lookup, because the address keys the allowlist, the initial-administrator bootstrap and account linking. The `provider` you return is ignored; the route uses the definition's `id`. Never log `raw`.
   - **`linkExistingByEmail`** (default `false`). Google links a verified address to the account that holds it; a new provider does not unless you say so. Without it, an address that belongs to a user with no identity at this provider is refused (`access_denied`), never merged. It means **"this provider is trusted to vouch for the address"** and gates two things: linking by address and the `INITIAL_ADMIN_EMAIL` bootstrap (the allowlist bypass and the first administrator's grant). Any other provider is allowlist-only and is never made an administrator. Set it only for a provider whose verified addresses an attacker cannot choose; for Entra (a tenant administrator sets the `email` claim) and a shared OIDC issuer leave it off, and accept only your own tenants and domains in a `SignInPolicy`, or an attacker can pre-create the account of an allowlisted address before its owner signs in. For a provider that does not link, an existing account is also matched case-insensitively.
   - **`egressHosts`** and **`doctorRemedy`** feed the network-egress view (`auth.<id>`) and the Doctor's `auth.providers` check.
   - **`mode: 'custom'`** for a provider with its own flow (a popup, a SAML POST): no routes are mounted, `GET /api/auth/providers` lists it with `mode: 'custom'`, and your own controller maps the profile, calls `AuthService.completeExternalLogin(profile)` and answers with `respondToSignIn`.
2. **Declare the credential purpose and register**, at import time, in [`apps/api/src/app-registrations/identity.ts`](../apps/api/src/app-registrations/identity.ts) (imported by `platform/identity/identity.config.ts` before `IdentityModule.forRoot()`):

   ```ts
   import { registerCredentialPurpose } from '@marinoscar/platform-api/credentials';
   import { registerAuthProvider } from '@marinoscar/platform-api/identity';

   registerCredentialPurpose({ purpose: 'auth_github', owner: 'identity', label: 'GitHub OAuth secret', tiers: ['system'] });
   registerAuthProvider(githubProvider);
   ```

   The registry freezes when the application bootstraps; a duplicate id or a malformed definition throws at registration. The app binds the store once: `{ provide: IDENTITY_AUTH_CREDENTIALS, useExisting: CredentialsService }` in [`identity-host.module.ts`](../apps/api/src/platform/identity/identity-host.module.ts). Without that binding every secret reads as absent and a credentials-backed provider stays off.
3. **Store its secret** (the credential store, never an environment variable), then the provider is on. The slice mounts `GET /api/auth/github` (starts the flow) and `GET /api/auth/github/callback` (maps the profile, calls `completeExternalLogin`, sets the HttpOnly `refresh_token` cookie and redirects to the web `/auth/callback` with the access token, or with `error=<code>`), and an unknown, `custom` or unconfigured id is a 404 on the start route and a 302 to `error=authentication_failed` on the callback.
4. **Bind a sign-in policy** only if you need one. It is consulted for **every** provider, Google included, after the allowlist and before the first write:

   ```ts
   IdentityModule.forRoot({ signInPolicy: { useClass: CompanyDomainPolicy }, /* ... */ });

   class CompanyDomainPolicy implements SignInPolicy {
     beforeLogin(profile: ExternalProfile): SignInDecision {
       if (!profile.email?.endsWith('@kappa.example.test')) return { allow: false, reason: 'access_denied' };
       return { allow: true, roles: profile.raw?.admin ? ['org_admin'] : [] };   // applied to a NEW user only
     }
   }
   ```

   A denial carries one of the closed reasons to the redirect; `roles` map an `org` role onto the new membership (at most one) and any `system` roles onto the user, only at creation, so an administrator's later edits stick; an unknown role or a throwing policy fails the sign-in closed. Providing `IDENTITY_SIGNIN_POLICY` in an app module does not work (identity's internals never see it): bind it here. The example policy is [`ExampleOidcSignInPolicy`](../apps/api/src/platform-extensions/identity/example-oidc.provider.ts).
5. **React to sign-ins** with `IDENTITY_EVENTS.LOGIN_SUCCEEDED` (`identity.login.succeeded`, `{ userId, provider, isNewUser }`, after the session exists) and `identity.user.created` (its `source` is the provider id). Both run after commit; a throwing listener cannot fail the sign-in.
6. **The web needs a look and, for a custom provider, a start.** A redirect provider appears on the login page with a generic button; register its look with `registerAuthProvider({ id, label, Icon })` of `@marinoscar/platform-web/identity/headless`. For a `custom` provider add `start`, which `login(id)` calls instead of navigating. `LoginPage` also takes `BeforeProviders` and `AfterProviders` slots (they receive `{ providers, login }`). Worked example: [`company-sso.tsx`](../apps/web/src/platform-extensions/identity/company-sso.tsx).
7. **Prove it with the kit and a test that boots the real app.**
   - **The provider.** `describeAuthProviderConformance` of `@marinoscar/platform-api/identity/testing`: `mapProfile` returns a valid profile with the expected subject and survives a sparse payload, `isEnabled` is false without configuration and true with it, the strategy builds, the route is mounted, a full login creates a `UserIdentity` for this provider and subject, the allowlist still applies, an unverified address is refused and a policy denial returns its reason. The strategy is only built, never run: no network.

     ```ts
     import '../../../src/app-registrations/identity';
     import { describeAuthProviderConformance } from '@marinoscar/platform-api/identity/testing';

     describeAuthProviderConformance(githubProvider, { describe, it, expect, rawProfile, expectedSubject: '42', enabledWith: { credentials: { client_secret: 'x' } }, host });
     ```

   - **The app.** [`example-oidc.spec.ts`](../apps/api/test/examples/identity/example-oidc.spec.ts) drives the real application: a fresh install is unchanged, a new user, a returning user, an allowlist refusal, an unverified address, no merge into an existing account, the cookie's attributes and the events; [`example-oidc.policy.spec.ts`](../apps/api/test/examples/identity/example-oidc.policy.spec.ts) binds a policy through `forRoot` and proves a denial reason and a role mapping.

     ```bash
     cd apps/api && npx jest --config test/jest.config.js test/examples/identity
     cd apps/web && npx vitest run src/__tests__/examples/identity
     ```

Nothing in the identity slice is closed any more (audit: [identity](EXTENSIBILITY-AUDIT.md#identity)); the Users and Organization pages take slots ([Add a field to `/auth/me` and to the user list, and show it](#add-a-field-to-authme-and-to-the-user-list-and-show-it)). **Login CSRF is yours to prevent: the slice adds no `state` and no PKCE.** With `passport-oauth2`, `state: true` or `pkce: true` without a `store` throws "requires session support" on every sign-in here, because this app registers no session plugin. A real OAuth 2.0 provider must pass `store: createCookieStateStore({ secret: config.get('jwt.secret') })` (a signed, short-lived HttpOnly cookie; it does not do PKCE) or a store of its own. The example strategy has none only because it never leaves the process, and it is not a template for that part.

### Add a role, assign it, and give it a platform permission

Available now. Full reference: [the identity README](../packages/platform-api/src/identity/README.md#roles-and-who-may-assign-them) and [the manifest README](../packages/platform-api/src/manifest/README.md). Example: [`coach-support.roles.ts`](../apps/api/src/platform-extensions/identity/coach-support.roles.ts), proven over HTTP by [`coach-support.example.spec.ts`](../apps/api/test/examples/manifest/coach-support.example.spec.ts) and in the packaged dialogs by [`app-roles.test.tsx`](../apps/web/src/__tests__/examples/identity/app-roles.test.tsx).

A role is a string in `roles.name`: no package edit, no migration. Three cases, all through `apps/api/src/app-registrations/permissions.ts`:

1. **An org role** (`coach`: held on a membership). Add it to `APP_ROLES` with a `label`:

   ```ts
   export const APP_ROLES: readonly RoleDeclaration[] = [
     { id: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org', label: 'Coach' },
   ];
   ```

   Run `npm run catalog:permissions --workspace=api`, commit the regenerated `prisma/catalog/permissions.json` and re-seed. From then on an organization administrator can invite someone as a coach and move a member to it, and the packaged dialogs list it (they read `GET /api/roles`), with no web code.
2. **A system role that holds a platform permission** (`support`: held in `user_roles`, reads the user list). A platform permission's `defaultGrants` are the platform's, so the app grants it:

   ```ts
   export const APP_ROLES = [{ id: 'support', description: 'Reads the user list', scope: 'system', label: 'Support' }];
   export const APP_GRANTS = [{ role: 'support', permissions: ['users:read'] }];
   ```

   `common/permissions/permission.manifest.ts` passes `APP_GRANTS` to `registerPlatformPermissions({ app: { grants } })`. A grant is validated when the process starts: the role and the permission exist, both have the same scope, the permission does not already grant it by default, and the target is not one of the platform's four roles. The catalog's `rolePermissions` carries it, the seed writes it into `role_permissions`, and the guards read those rows.
3. **A role the application manages itself** (`service-bot`). Declare `assignable: false`: it can hold permissions and be seeded, but the invite, member and user-role routes refuse it (`400`, `code: ROLE_NOT_ASSIGNABLE`), the dialogs do not offer it, and `PUT /api/users/:id/roles` leaves a user's existing system role of this kind in place.

Prove it by registering the roles in a test with `withTemporaryEntries(roleRegistry, ...)` and driving the routes, as the example spec does. A role that a request names but nobody registered, a role of the other scope and an `assignable: false` role all answer the same `400`, so the response never says which.

Group roles (`admin`, `editor`, `viewer` on a sharing group) are open too: see [Add a group role or an access rule to sharing](#add-an-access-rule-or-a-grantee-kind-to-sharing) below.

### Add an access rule or a grantee kind to sharing

Available now: the rule, the grantee kind (stored, when `persisted`) and the group role. Full reference, with the decision order: [the sharing README](../packages/platform-api/src/sharing/README.md#grantee-kinds-and-access-rules). Examples: [`project-member.access-rule.ts`](../apps/api/src/platform-extensions/sharing/project-member.access-rule.ts) (an allow), [`frozen-record.access-rule.ts`](../apps/api/src/platform-extensions/sharing/frozen-record.access-rule.ts) (a deny), [`email-domain.grantee-kind.ts`](../apps/api/src/platform-extensions/sharing/email-domain.grantee-kind.ts), proven on real Postgres by [`project-member.example.db.spec.ts`](../apps/api/test/examples/sharing/project-member.example.db.spec.ts) and [`email-domain.example.db.spec.ts`](../apps/api/test/examples/sharing/email-domain.example.db.spec.ts), and in the share dialog by [`GranteePicker.example.test.tsx`](../apps/web/src/__tests__/examples/sharing/GranteePicker.example.test.tsx).

**An access rule** adds an app opinion to `AccessPolicy` and to "resources I can see" without replacing either. In an `app-registrations` file, after the resource type it names:

```ts
registerAccessRule({
  id: 'project-member',
  position: 'before-grants',               // or 'after-grants': only orders ties; a deny wins either way
  resourceTypes: ['project_document'],     // default: every type
  async evaluate(ctx) {                    // ctx: principal, action, resource {type,id,orgId,owner}, tx, cache
    return (await isMemberOfRecordsProject(ctx)) ? 'allow' : 'abstain';
  },
  sql: (ctx) => ({ allow: ctx.kit.sql`EXISTS (SELECT 1 FROM project_members pm WHERE pm.org_id = ${ctx.orgId}::uuid AND pm.user_id = ${ctx.principal.userId}::uuid AND pm.project_id = ${ctx.column('project_id')})` }),
});
```

- An allow confers `role` (default the weakest role of the type). A rule that can deny sets `mayDeny: true` and must give `sql` with a `deny` condition (never `NULL`). The record's user owner and a bypass holder are decided before the rules; everyone else is subject to a `deny`.
- Every value in `sql` is a bind parameter through `ctx.kit` (SQL built outside it fails the kit); bind `ctx.orgId` in every sub-select of an organization table (app tables such as `project_members` rarely have RLS) and give the sub-select an alias of its own. A rule that throws, returns an unknown verdict, or returns `deny` without `mayDeny` denies and is flagged `ruleFailure`; a failing statement cannot abort the request's transaction (a savepoint).
- Prove it with `describeAccessRuleConformance` (`@marinoscar/platform-api/sharing/testing`): fixtures of principal, record, action and expected outcome, the real `AccessPolicy.decide` and the real list query; it fails when the decision and the list disagree, when another organization leaks, or when a principal-derived string reaches the SQL text.

**A grantee kind** names a new way to say who a grant shares with. Register it with `registerGranteeKind({ kind, label, input, validateGrantee, describe, matchesPrincipal, resolvePrincipalMatch })`: the last two are the in-memory and the SQL spelling of "does this grantee name me", and `describeGranteeKindConformance` proves they agree on your database. The share dialog lists the kinds from `GET /api/sharing/grantee-kinds`; a kind with `input: 'text'` gets a text field and one with `input: 'custom'` a component you register with `registerGranteePicker(kind, Component)` (and `freezeGranteePickers()` at start-up).

**Store the grants of a kind** with `persisted: true` plus `principalWhere(principal)`, the Prisma spelling of the same predicate over a `Grant` row (`granteeKind`, `granteeRef`, ...). `POST /api/grants` with `{ kind: 'custom', granteeKind: 'email-domain', ref: 'example.com' }` then runs `validateGrantee` and stores the kind's id with the normalised reference it returned in `grants.grantee_ref` (migration `0037_open_sharing_vocabularies`; the same domain shared twice is one grant). A resource type lists the roles the kind may carry, none by default: `grantable: { 'email-domain': ['viewer'] }`. The platform pins the kind's predicate to the kind and to the caller's organization, so a kind cannot read another organization's grants; use a reference that is not personal data (it is in the audit row and the events). Prove it end to end, stored, matched in memory and in "resources I can see" and isolated per organization, as [`open-vocabularies.example.db.spec.ts`](../apps/api/test/examples/sharing/open-vocabularies.example.db.spec.ts) does.

**A group role** (`commenter`, `auditor`) is `registerGroupRole({ id, label, actions })`: `actions` says what the role may do in the group (`manage` administers it and counts for the last-admin guard, `write` and `read` set its rank, anything else is the app's own). Register it, and the kinds, before the resource types that name them. The role is text in `group_members.role` and `group_invites.role`; the member role pickers list it from `GET /api/sharing/group-roles`; the API answers 422 `GROUP_ROLE_UNKNOWN` for an id nobody registered. It grants nothing by itself: map it in the resource type, `groupRoleMap: { commenter: 'viewer' }`, and a role the map does not name holds nothing on that type's records. Example and proof: [`open-vocabularies.example.ts`](../apps/api/test/examples/sharing/open-vocabularies.example.ts).

### Add a permission set from a package

Available now. Reference: [the manifest README](../packages/platform-api/src/manifest/README.md). Example: [`permission-set.example.spec.ts`](../apps/api/test/examples/manifest/permission-set.example.spec.ts).

A package outside the platform that enforces its own permissions (`@kappa/reports`) declares them with `registerPermissionSet` at import time, before the app's permission manifest runs:

```ts
import { registerPermissionSet } from '@marinoscar/platform-api/manifest';

registerPermissionSet({
  slice: 'kappa-reports',
  roles: [{ id: 'analyst', description: 'Runs reports', scope: 'org', label: 'Analyst' }],
  permissions: [{ id: 'reports:run', description: 'Run a report', scope: 'org', defaultGrants: ['org_admin', 'analyst'] }],
});
```

`registerPlatformPermissions()` then registers the set after the platform's own and before the app's, in the seed catalog and in the registries, and then freezes the set registry so a package that registers too late fails with `FROZEN` instead of missing the seed. `slices` selects it by id like a platform slice (`identity` stays mandatory). The slice id cannot be a platform slice's.

### Add an env group, a generated value or an override of a platform key

Imports: `@marinoscar/platform-cli/core`. Examples: [`coach.env-group.ts`](../apps/cli/src/examples/coach.env-group.ts), [`coach.env-generator.ts`](../apps/cli/src/examples/coach.env-generator.ts), [`coach.env-annotation.ts`](../apps/cli/src/examples/coach.env-annotation.ts). Each is also a `createCli` option (`envGroups`, `envGenerators`, `envAnnotations`), and the same either way.

1. **Declare the keys** in `infra/compose/app.env.example` (an explanation above each, never a commented `KEY=value` line), then `npm run platform:infra:sync`.
2. **Register the group**: `registerEnvGroup({ id, label, description, defaultEnabled })`, then put keys in it with `registerEnvSpecFragment({ id, metadata: { KEY: { group: 'id' } } })`. The wizard asks a group's keys only when `deploy install --group <id>` (or the TUI's group question) enabled it; `defaultEnabled: true` adds it to every deployment, as the telemetry group is. A fragment naming an unregistered group throws and lists the registered ones.
3. **Register a generator** for a value with a shape of its own: `registerEnvGenerator({ kind, generate })`, then `generate: 'kind'` in the key's metadata (with `autoGenerate: true` to generate it unasked). A generator is a synchronous function, never a command, and its value must be 1 to 512 characters of letters, digits and `+ / = _ . : @ -`; anything else is refused before it reaches `.env`.
4. **Override a platform key** with `annotateEnvKey(key, { fixed?, help? })`. The app wins for those two fields. Nothing else of the owner's metadata changes, `fixed` on a secret key throws, and a key that is `never` written stays unwritten.
5. **Test it**: `metadataFor(key)` and `effectiveGroups(groups)` from `@marinoscar/platform-cli/deploy` show the group, the generator kind and the enabled groups, and `generateWithKind(kind)` from `/core` makes a value, as [the example test](../apps/cli/src/examples/coach.env-group.test.ts) does.

### Add a deploy check, or place a deploy step

Imports: `@marinoscar/platform-cli/deploy`. Examples: [`coach.deploy-check.ts`](../apps/cli/src/examples/coach.deploy-check.ts), [`coach.deploy-step-placement.ts`](../apps/cli/src/examples/coach.deploy-step-placement.ts), [`announce.deploy-step.ts`](../apps/cli/src/examples/announce.deploy-step.ts).

1. **A check** is a `DeployCheck`: `registerDeployCheck({ id, title, severity, requires?, run })`, or `createCli({ deployChecks })`. `run` receives a narrow `DeployCheckContext` (`deployRoot`, `bindPort`, optional `composeProject`, `proxyRoot`, `domain`, `skipProxy` and an `env` that withholds secrets like a step's). It never throws, a `fail` carries a `remedy` that names a command or a path, and it is read-only. `required` blocks `deploy install` and `deploy update` and makes `doctor` exit non-zero; `recommended` is advice. It runs after the built-ins in `doctor`, in both preflights and in the TUI.
2. **A step** takes exactly one anchor: `after`, `before` or `replaces`. `skipWhen(context)` skips the replaced step; with no `step` it is a conditional skip of the built-in. The built-in step ids are a stable surface ([`INSTALL_STEP_IDS`](../packages/platform-cli/README.md), `UPDATE_STEP_IDS`). Replacing a built-in is your responsibility: later steps read what it prepared.
3. **Read the configuration** from `context.env` and `context.answers`. They are read-only and withhold secrets: `get` returns `undefined` for a key annotated secret or named like one (`*_SECRET`, `*PASSWORD*`, `*TOKEN*`, `*API_KEY*`), `has` still reports presence.
4. **Test a step** without a pipeline using `testDeployStepContext(overrides, values)` from `@marinoscar/platform-cli/testing`.

### Stream an app route through the VPS host proxy

Imports: `@marinoscar/platform-cli` (`createCli`), `@marinoscar/platform-cli/deploy`. Example: [`coach.proxy-stream.ts`](../apps/cli/src/examples/coach.proxy-stream.ts); runbook: [deploy-to-vps.md](runbooks/deploy-to-vps.md#63-stream-an-app-route-through-the-host-proxy).

An SSE or other long-lived route has two hops to configure. The app's own nginx: a location in `infra/nginx/app.d/locations/` that includes `platform/sse-proxy.conf` (see `stream-route.conf.example` there). The shared host proxy in front of it: the path declared to the CLI, or the route is buffered and cut at 60 seconds only on a VPS.

1. **Declare the path**: `createCli({ proxy: { streamPaths: ['/api/coach/chat/stream'] } })` or `registerProxyStreamPath(path)`. A path object takes `timeoutSeconds` (default one hour).
2. **Redeploy.** `deploy install` and `deploy update` render one unbuffered location per path with the directives of the platform's SSE locations.
3. **Paths are validated** because the vhost is shared by every site on the server: a leading `/`, letters, digits and `. _ ~ / : @ + , = -` only. A newline, `;`, quote, brace, `$`, `#` or space throws before any file is written. An app that declares no path gets a byte-identical vhost.

### Choose which manifests the deploy version step writes

Imports: `@marinoscar/platform-cli` (`createCli`). Example: [`coach.versioned-manifests.ts`](../apps/cli/src/examples/coach.versioned-manifests.ts); runbook: [deploy-to-vps.md](runbooks/deploy-to-vps.md#64-an-app-whose-cli-keeps-its-own-version).

`deploy install` and `deploy update` write the release version into a list of workspace manifests and the lockfile's workspace entries of the same paths. The default is the four of the reference layout (`apps/api`, `apps/web`, `apps/cli`, `packages/shared`). An app whose CLI keeps its own version would have it overwritten by every release.

1. **Declare the list**: `createCli({ deploy: { versionedManifests: ['apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json'] } })`. Repository-relative POSIX paths ending in `package.json`.
2. **The first entry is the version source**: the current version, the suggested patch bump and the forward-only check read it. Put the manifest that carries the app release first.
3. **Only the listed files change**: a manifest left out and its lockfile workspace entry are byte for byte untouched. The step's journal line names every file written.
4. **A bad list throws at `createCli`**: empty, a duplicate, `..`, an absolute path, an entry that is not a `package.json`, the root manifest.

### Tell the operator a newer CLI exists

Imports: `@marinoscar/platform-cli` (`createCli`, `githubRawManifest`). Example: [`coach.update-notice.ts`](../apps/cli/src/examples/coach.update-notice.ts); reference: [platform-cli README](../packages/platform-cli/README.md#the-start-up-update-notice).

Operators run an old app CLI on a server without knowing a newer one exists. An app turns on a start-up notice; left unset, the CLI makes no request and nothing changes.

1. **Declare where the newest version is and how to update**: `createCli({ updateNotice: { latestVersion: githubRawManifest({ repo: 'owner/name', ref: 'main', path: 'apps/cli/package.json' }), upgradeHint: 'git pull && npm ci && npm run build' } })`. `latestVersion(signal?)` is any function that resolves the newest version or `undefined`; `githubRawManifest` is the one for a `package.json` on GitHub. `upgradeHint` is one non-empty line.
2. **What the operator sees**: one line on stderr after the command's output, `<cli> <latest> is available (you have <current>). Update: <upgradeHint>`, only when the latest is semver-greater than the running version. The exit code and stdout never change.
3. **How it runs**: the check starts with the command and runs beside it; the end of the command waits for what remains of `timeoutMs` (default 1500 ms). At most one network check per `intervalMs` (default 24 hours); the answer is cached in `~/.<cli>/update-check.json`. Offline, a timeout or a bad answer is silent.
4. **When it is skipped**: `CI` set, stderr not a terminal, `--json`, `--version`, `--help`, the worker daemon `node start`, or `<PREFIX>_NO_UPDATE_CHECK=1` (the prefix follows the CLI identity, `APPCTL_NO_UPDATE_CHECK`). Tell operators about that variable if they want it off on a workstation.
5. **A bad option throws at `createCli`**: no `latestVersion`, an empty or multi-line `upgradeHint`, a negative `intervalMs`, a non-positive `timeoutMs`; `githubRawManifest` throws for a `repo` that is not `owner/name` or a `ref` / `path` that is not a plain relative path.
6. **Test it** without a network: pass a `fetch` to `githubRawManifest`, and `run(argv, { updateCheck: { env, home, stderr } })` for the environment, the home directory and the stream. The example's test does both.

### Extend the CSP without copying it

Files: `infra/nginx/app.d/csp/`, [`connect-src.conf.example`](../infra/nginx/app.d/csp/connect-src.conf.example).

1. **Add sources to a directive**: copy the example to `app.d/csp/connect-src.conf` (also `img-src`, `media-src`, `font-src`, `style-src`) and write one line, `default " wss://realtime.example.com";`, with a leading space. It is appended to that directive of the default policy.
2. **Add a directive the policy lacks** (`frame-src`, `child-src`) in `app.d/csp/extra.conf`: `default "; frame-src https://www.youtube.com";`. A repeated directive is ignored by browsers, so this cannot widen a directive the policy already has.
3. **What is deliberately not open**: `script-src`, `default-src`, `object-src`, `base-uri`, `form-action` and `frame-ancestors` have no hook, and the `/api/docs` policy is not extended. Widening those is an edit of the policy, not an include. The reference file is [`csp.conf`](../infra/nginx/csp.conf).
4. **Check it**: `nginx -t` on the composed configuration (the CI step, or `runInfraConformance`).

### Check an app compose overlay, a compose mode or a single-file mount

Imports: `@marinoscar/platform-infra`, `@marinoscar/platform-infra/testing`, `@marinoscar/platform-cli/deploy`. Examples: [`staging.compose-mode.ts`](../apps/cli/src/examples/staging.compose-mode.ts), [`coach.edge-config.ts`](../apps/cli/src/examples/coach.edge-config.ts), [`infra-conformance.test.ts`](../apps/cli/src/infra-conformance.test.ts).

1. **Overlays**: `infra/compose/app.<name>.compose.yml` applies to every mode built on `base.compose.yml`; `app.<scope>.<name>.compose.yml` to that scope (`dev`, `devdb`, `prod`, `vps`, `worker`, `test`). `app.test.*` reaches the disposable test database only.
2. **A mode of your own**: `registerComposeMode({ id, files })`. Its id is its overlay scope. `composeFilesForMode(id, { overlays })` returns the files, the overlays last.
3. **A single-file bind mount** into nginx pins an inode, so a `git checkout` leaves the container reading old bytes. Register the file with `registerEdgeConfigFile({ checkout, container })` and `deploy update` hashes it in the checkout and in the container and recreates nginx once on a difference. A directory mount needs none.
4. **Prove they work**: `runInfraConformance({ appRoot, testApi })` runs `platform-infra sync --check`, `docker compose config` over each mode with your overlays, and `nginx -t` over `app.d/` with both CSP files. A missing Docker or nginx registers a passing case named with the reason; `skip: { compose: 'why' }` opts out and needs a reason.

### Add a section to the node and deploy TUI screens

Imports: `@marinoscar/platform-cli/tui`. Example: [`fleet-note.tui-section.tsx`](../apps/cli/src/examples/fleet-note.tui-section.tsx).

1. **Write an ink component** taking `TuiSectionProps` (`{ screen }`).
2. **Register it**: `registerTuiScreenSection('node' | 'deploy', Component, { id })`, or `{ id, load }` to load it when the screen opens, or `createCli({ tuiSections })`. Only `node` and `deploy` have a slot.
3. **It renders below the screen's top-level list**, in registration order. A section that throws, or whose `load` rejects, shows a one-line notice and leaves the screen working.

### Add a CLI conformance suite

Imports: `@marinoscar/platform-cli/testing`. Example: [`coach.conformance-suite.ts`](../apps/cli/src/examples/coach.conformance-suite.ts); the run: [`conformance.test.ts`](../apps/cli/src/conformance.test.ts).

1. **Register the suite**: `registerCliConformanceSuite({ id, title, description, register(api, options) })`. Its option key is the camelCase of the id.
2. **Run it**: `runPlatformConformance({ suites: { yourSuite: options } })`. Every suite the app names gets its options or `{ skip: 'reason' }`; an empty reason, or `false`, throws, and the run prints which suites ran and which were skipped.
3. **The built-ins** are `cli` (env template fragments, executor credential hygiene) and `deployRegistrations` (every env key's group and generator is registered, both deploy plans resolve, no duplicate edge-config file, the vhost renders with your stream paths).

### Add a system access reason

Available now. A background job of your own needs cross-organization access (a re-index, a data repair) and names a reason the platform does not know. Registering the reason makes the label valid; it grants no access. Worked example: [`transcript-reindex.job.ts`](../apps/api/src/platform-extensions/core/transcript-reindex.job.ts), registered by [`app-registrations/core.ts`](../apps/api/src/app-registrations/core.ts), proven by [`open-vocabularies.spec.ts`](../apps/api/test/examples/core/open-vocabularies.spec.ts).

1. **Register it at import time**, in `apps/api/src/app-registrations/core.ts`:

   ```ts
   import { registerSystemAccessReason } from '@marinoscar/platform-api/core';

   registerSystemAccessReason({ id: 'transcript-reindex', description: 'Rebuilds the transcript search rows of every organization.' });
   ```

   The id matches `^[a-z][a-z0-9-]{2,47}$`; a duplicate (a built-in included) throws `DUPLICATE_ID`, and a registration after the application has bootstrapped `FROZEN`.
2. **Run the work under it** with `runAsSystem(client, 'transcript-reindex', (tx) => ...)` or `forSystem`. An unregistered reason throws `ScopedAccessError`.
3. **Reach the system client the allowed way.** The reason does not change who may inject `PrismaSystemService`: the allowlist in `apps/api/test/tenancy/system-injection-boundary.spec.ts` stays as it is, and a new file is a reviewed decision there. A job handler therefore takes a port that one of the allowlisted host modules implements with `PrismaSystemService.runAsSystem` (the shape the packaged slices use: `STORAGE_SYSTEM_DATA`, `AI_SYSTEM_PRISMA`), as the example's `SystemWork` does. That spec's scan of literal `asSystem('...')` reasons lists the base's nine; a fork that writes a literal reason in `src/` extends the list there in the same reviewed change.
4. **The job** is an ordinary queue job ([Add a job type](#add-a-job-type)); one that writes as it goes is server-only. Put `orgId` in the payload when it touches an org table.
5. **Run the kit**: `describeVocabularyConformance({ describe, it, expect }, { expectedAppReasons: ['transcript-reindex'] })` from `@marinoscar/platform-api/core/testing`, after importing the registration file.

### Add a credential kind

Available now. An integration authenticates with something that is not a session, a device token or a PAT (an API key, a webhook token). The kind names *how the request authenticated*; it does not grant anything. Example: [`api-key.credential-kind.ts`](../apps/api/src/platform-extensions/core/api-key.credential-kind.ts), registered by [`app-registrations/core.ts`](../apps/api/src/app-registrations/core.ts), proven by [`open-vocabularies.spec.ts`](../apps/api/test/examples/core/open-vocabularies.spec.ts).

1. **Type it** by augmenting the core entry (`CredentialKinds`; add a key to `PrincipalKinds` for a new principal kind):

   ```ts
   declare module '@marinoscar/platform-api/core' {
     interface CredentialKinds { 'api-key': true }
   }
   ```

   The augmentation widens `CredentialKind` for the whole program, so a `switch` over it needs a `default` that denies, and code that builds a `UserPrincipal` literal types its credential with `BuiltinCredentialKind` (a `UserPrincipal` carries one of the platform's three).

2. **Register it at import time** (`registerPrincipalKind` first when the principal kind is new; the credential kind's `principalKind` must already be registered):

   ```ts
   registerCredentialKind({ id: 'api-key', principalKind: 'user', description: 'An `ak_` key a user minted.' });
   ```

3. **Write the guard.** Plain Nest: read the credential, resolve its owner, check what the route needs, then set `request.principal = toPrincipal(owner, 'api-key')` (`toPrincipal` of `@marinoscar/platform-api/identity`). **Unknown means denied**: `toPrincipal` answers 401 for a kind that is not registered, and for one whose principal kind has no factory there; a custom kind never becomes a node principal. Every built-in decision keys on the built-in ids, so the new kind cannot switch organization or reach `/api/nodes`; the guard grants what the credential may do and nothing more.
4. **A principal kind of your own** (`service`) has no factory in the identity slice: build that principal in your guard, and keep `Principal` narrowing on `kind`.
5. **Run the kit** (above) and test the deny paths: a missing key, an unknown key, a key without the route's permission, and a guard built for an unregistered kind.

### Add an error code and an error mapper

Available now. A client that must tell "this title is taken" from "the version moved" branches on a **domain code**; a Prisma `P2002` that would be a 500 becomes a 409 with a **mapper**. Examples: [`note-title-taken.error-code.ts`](../apps/api/src/platform-extensions/core/note-title-taken.error-code.ts), [`prisma-unique-violation.mapper.ts`](../apps/api/src/platform-extensions/core/prisma-unique-violation.mapper.ts), proven (through the real host core and its filter) by [`open-vocabularies.spec.ts`](../apps/api/test/examples/core/open-vocabularies.spec.ts).

1. **Register the code** at import time, for ONE status:

   ```ts
   registerErrorCode({ code: 'NOTE_TITLE_TAKEN', status: 409, description: 'A note with this title already exists.' });
   ```

   `^[A-Z][A-Z0-9_]{2,63}$`, status 400 to 599; `ERROR` (the fallback) and the platform's ten codes cannot be registered again.
2. **Throw it** with the code in the payload: `throw new ConflictException({ code: 'NOTE_TITLE_TAKEN', message: '...', details: { field: 'title' } })`. The filter passes the code through only when it is registered for the exception's own status; anything else keeps the status-derived code, so the published list is exactly the registry. Machine-readable data still goes under `details`.
3. **Write a mapper** for a foreign error and pass it to the host core (`apps/api/src/platform/host-core.config.ts`):

   ```ts
   export const hostCoreModule = PlatformHostCoreModule.forRoot({ errorMappers: [prismaUniqueViolationMapper] });
   ```

   An `ErrorMapper` is `(error: unknown) => HttpException | null`. It sees only values that are not already an `HttpException` (so it cannot rewrite a built-in response), runs in order, and the first result wins. Build the `message` and `details` yourself and never copy the original error's text: a driver message can carry SQL, hostnames and values. The filter logs the original server-side. The reference app does not wire its example mapper (it would turn today's 500 for an unhandled `P2002` into a 409); a fork does.
4. **Check the document**: `npm run openapi:dump` lists the registered codes as the `examples` of `ErrorDto.code`, which is a string, not an enum.

### Add a port to the web host

Available now. A package an app installs needs something only the app can supply (how to open a record in the app's router, a feature switch source). It declares a typed port under a key it exports and reads it with `usePlatformPort`; the app supplies it in `PlatformWebHost.extensions`. Example: [`transcripts-port.example.tsx`](../apps/web/src/platform-extensions/core/transcripts-port.example.tsx), proven by [`platform-port.test.tsx`](../apps/web/src/__tests__/examples/core/platform-port.test.tsx).

1. **In the package**: `export const TRANSCRIPTS_PORT = Symbol.for('@kappa/transcripts/port')` (a `Symbol.for` key or a namespaced string such as `'kappa.transcripts'`), an interface for the port, and `usePlatformPort<TranscriptsPort>(TRANSCRIPTS_PORT)` where it is needed. The hook throws at the first render, naming the key and the fix, when the app did not supply the port; `useOptionalPlatformPort` answers `undefined` for a port that is genuinely optional.
2. **In the app**, in the host built by `useAppPlatformHost` (`apps/web/src/platform/platformHost.tsx`): `extensions: { [TRANSCRIPTS_PORT]: { open: (id) => navigate(`/transcripts/${id}`) } }`. Keep the record and each port stable across renders (memoise them with the host).
3. **In tests**, `createTestPlatformHost({ extensions })` of `@marinoscar/platform-web/testing`.

Only own keys are ports (`toString` is not one), and nothing validates a port's shape: type it in the package and validate in the package when the app is untrusted code.

### Add an onboarding audience, or a step for the organization administrator

Available now. An audience is a group of onboarding steps and the rule that says who sees them. The platform registers three: `user` (Get started, everyone), `admin` (the Setup guide, the holder of the admin permission) and `org_admin` (the holder of the `org_admin` role of their active organization). The organization administrator of a multi-organization deployment holds no system permission, so before `org_admin` existed none of the Setup steps reached them. Examples: [`org-admin-step.example.ts`](../apps/api/src/platform-extensions/onboarding/examples/org-admin-step.example.ts), proven by [`onboarding-examples.spec.ts`](../apps/api/test/onboarding/onboarding-examples.spec.ts).

1. **A step for the organization administrator.** Register a step with `audience: 'org_admin'` (`registerOnboardingStep`, from `app-registrations/onboarding.ts`). It still declares its own `permission` and `feature`: the audience decides which block the step lands in, never whether those gates apply. The response carries it under `audiences.org_admin`; draw that block with `OnboardingChecklist` (`useOnboarding().state?.audiences?.['org_admin']`).
2. **Your own audience.** `registerOnboardingAudience({ id, label, matches(principal, ctx) })`, BEFORE the steps that name it (`ONBOARDING_AUDIENCE_ID_PATTERN`: lower case, `_` and `-`, 2 to 48 characters; the id is permanent). `matches` is synchronous and reads the caller only (`permissions`, `roles`, `activeOrgId`): a rule cannot query, so it adds nothing to the cost of the endpoint. A rule that throws counts as "does not match".
3. **What does not move.** `user` and `admin` keep their rules whatever is registered (the engine ignores a rule for those two ids), a caller outside an audience never has the audience's facts resolved, and the `audiences` key is absent from the response unless a block has a step for the caller.
4. **Order and skips.** `registerOnboardingOrdering({ audience })` takes any registered audience (one per audience); `skippable` and the stored `skipped` list work for every audience.
5. **Run the suite.** `runPlatformConformance` derives the checklists once for a caller holding every permission and the `org_admin` role, so a step of any registered audience is counted for fact reads and for I/O in `evaluate`; it also flags a step that names an audience nobody registered.

### Add a filter type, a column editor, saved views or a toolbar to a DataTable

Available now. A filter TYPE is what a column's `filter.type` (or `filterType`) names: its operators, the control that collects the operand, how a URL operand is coerced back and how a row matches. The five built-ins (`text`, `number`, `date`, `enum`, `boolean`) are registered through the same function. Examples: a `tags` type with a chip editor ([`TagsFilterType.example.tsx`](../apps/web/src/platform-extensions/datatable/TagsFilterType.example.tsx), [test](../apps/web/src/__tests__/examples/datatable/tags-filter-type.test.tsx)) and saved views in a toolbar ([`SavedViewsToolbar.example.tsx`](../apps/web/src/platform-extensions/datatable/SavedViewsToolbar.example.tsx), [test](../apps/web/src/__tests__/examples/datatable/saved-views-toolbar.test.tsx)).

1. **Register the type once, before the first render**: `registerDataTableFilterType({ type: 'tags', operators: [{ id: 'hasAny', label: 'has any of', arity: 'many' }], Editor, matches })` (from `@marinoscar/platform-web/datatable/headless`). An operator id has one arity everywhere (`0`, `1`, `2` or `'many'`); reusing a built-in id such as `contains` is fine when the arity agrees. `coerce` turns a URL operand back into a scalar; `format` words an operand in a chip.
2. **Use it on a column**: `{ id: 'tags', label: 'Tags', priority: 'secondary', value: ..., filter: { type: 'tags' } }`. `filter` makes the column filterable (unless `filterable` is `false`) and wins over `filterType`; an array in `filterable` still pins the operators. A column naming a type nobody registered is not filterable and says so once on the console.
3. **The editor draws the operand only.** It receives `{ column, operator, arity, value, onChange, stacked }`; the column and operator pickers, the Add button and the draft-then-commit rule stay the form's, so a half-built filter is never emitted. A type with no editor falls back to a text field (comma-separated for a set).
4. **One column, its own editor or operators**: `filter: { type: 'text', editor: UserPicker }` or `filter: { type: 'text', operators: [...] }` replaces the type's for that column only.
5. **The table never filters rows.** `matches` is for the page that filters locally and for tests: `matchesFilters(row, columns, model)`. A server-backed page maps the model onto its endpoint as for any filter.
6. **Saved views and your own state.** `useDataTableLayoutPrefs` (and the `prefs` the `Toolbar` slot receives) keeps a bounded `extra` (plain JSON, 8 KiB, 32 keys, 8 levels) and up to 20 `savedViews`: `prefs.saveView(name, { filters })` snapshots the layout plus your state, `prefs.applyView(id)` restores the layout (sort and page size through the page's own callbacks) and returns the view so you restore `layout.extra` yourself. The user-settings API validates the same bounds on write, so a stored value is never trusted on read either.
7. **Slots.** `slots={{ Toolbar, BulkBar }}` on `DataTable`: `Toolbar` draws extra controls above the table (it receives the state the table holds, `prefs` and the page's `onFiltersChange`); `BulkBar` replaces the bulk-action bar while rows are selected (it receives the ids, the actions and `onClear`). With no slot the markup is unchanged.

### Attach a writer to the export sources, or replace a platform source

Available now. A writer lists itself on the sources instead of each source listing it. Examples: an NDJSON writer attached to every source ([`example-ndjson.writer.ts`](../apps/api/src/examples/exports/example-ndjson.writer.ts), registered in [`export-registrations.manifest.ts`](../apps/api/src/platform/exports/export-registrations.manifest.ts)), proven by [`exports-examples.spec.ts`](../apps/api/src/examples/exports/exports-examples.spec.ts), the HTTP test in [`exports.integration.spec.ts`](../apps/api/test/exports/exports.integration.spec.ts) and the `exports` conformance suite.

1. **Attach**: `registerExportWriter({ id: 'ndjson', ..., attachTo: '*' })` (every source whose columns the writer supports) or `attachTo: ['user-data', 'health']` (exactly those). `sources` still narrows. The platform sources list no formats: their formats are the writers attached to them (json, csv, xlsx first, then yours), so a registered writer appears in the dialog and on `POST /api/exports` for `user-data` and `org-data`.
2. **Declare what it can write.** A writer restricted with `columnTypes: ['string', 'number']` attaches under `'*'` only to sources that declare `columnTypes` inside that set (the platform sources declare `string`, `number`, `boolean` and `datetime`); naming a source in a list is a decision and skips that check. An export whose dataset has a column the writer cannot write fails with a message naming the column, and the half-written file is destroyed.
3. **Writers see the same rows as the built-ins.** A source produces its rows (redacted) before any writer runs, so a writer cannot reach a column a built-in one cannot. Do not read from the database in a writer.
4. **Column typing for your format**: a source may set `meta` on a column (`{ key: 'amount', label: 'Amount', type: 'number', meta: { logicalType: 'DECIMAL(10,2)' } }`; flat scalars, at most 16 keys). The built-in writers ignore it and never write it.
5. **Keep a source to the formats you reviewed**: `acceptsAttachedWriters: false` on the source. Declare `columnTypes` on a source of your own so restricted writers can attach.
6. **Replace a platform source.** `ExportsModule.forRoot({ platformSources: { userData: false } })`, then `registerExportSource({ ...USER_DATA_EXPORT_SOURCE, label: 'Your account data', permission: ... })` with the same id: the writers attached to `user-data` follow it. Under another id the platform writers (attached to `user-data` and `org-data` only) do not follow, so list the formats you want in `formats`.
7. **Run the suite.** `exports.secret-egress` runs `user-data` and `org-data` through every writer offered on them, an attached one included, and flags a writer attached to a source nobody registered.

### Add columns or actions to the exports list

Available now. `ExportsList` takes `slots`: `Columns(base)` returns the columns to draw (a column is placed by its `priority`: `primary` is the title, `secondary` the line under it, `detail` a full-width line; `placement: 'trailing'` puts it in the right-hand group) and `RowActions` adds controls after Download. Example: [`ExportsListSlots.example.tsx`](../apps/web/src/platform-extensions/exports/ExportsListSlots.example.tsx), [test](../apps/web/src/__tests__/examples/exports/exports-list-slots.test.tsx). Both read the export the list already holds; neither calls the API.

## How to ship an extension as its own npm package

An extension package (`@kappa/ai-assemblyai`, `@kappa/storage-azure`) is a package that an app installs next to `@marinoscar/platform-*` and that registers or binds its parts through the same seams an app uses. The platform packages are its host, so the package follows the rules that keep one copy of each.

1. **Depend on the platform as a peer, never as a dependency.** List `@marinoscar/platform-api` (or `-web`, `-contract`, `-db`, `-cli`) in `peerDependencies` at the range of the platform version you test against. Two copies of a platform package split module-level singletons (registries, injection tokens, the OpenTelemetry global) and fail at run time with "Nest can't resolve dependencies" or a registry that looks empty. The repository's `npm run check:single-instance` (`node scripts/check-single-instance.mjs --root <app>`) detects a second copy.
2. **Declare the peers of the slices you import.** A slice's peers are listed per slice in [`packages/platform-slice-peers.json`](../packages/platform-slice-peers.json) and printed by `node scripts/check-slice-peers.mjs --table`. Your package lists as peers what the slices it imports need (for a Nest package: `@nestjs/common`, `@nestjs/core`, `zod` and the rest), because the app must have them installed anyway and npm does not install an optional peer for it. The consuming app runs `node scripts/check-slice-peers.mjs --app <dir>`, which scans its `@marinoscar/platform-*` imports and fails for a missing peer. Rules: [PACKAGES.md](PACKAGES.md#peer-dependencies-per-slice).
3. **Import only documented subpaths** (`@marinoscar/platform-api/ai`, `…/host/testing`). A deep import is blocked by the `exports` map and is not part of any promise. Rely on `stable` symbols; an `experimental` one may change in a minor release, so pin the platform range tightly and re-run your conformance kit on each upgrade.
4. **Register at import time.** A static registry freezes when the application bootstraps, so your package registers from a module-scope side effect. Expose it as an entry the app imports before it composes the slice (`import '@kappa/storage-azure/register'` in the app's registration file, before `forRoot()`), or as a function the app calls from `app-registrations/`. Registrations held by Nest (a job handler, a Doctor check) come from your Nest module's providers, which register from `onModuleInit`.
5. **Bind through `forRoot`, never a provider.** Export the class and let the app pass it: `StorageModule.forRoot({ provider: { useClass: AzureBlobProvider } })`. If your package ships a Nest module, make it export what the binding needs (the provider's dependencies come from the slice's `imports` option and global modules).
6. **Augment typed ids from your package's public entry**: `declare module '@marinoscar/platform-api/<slice>' { interface … }`, in a file your `types` entry reaches, so the app sees the widened ids without writing the augmentation.
7. **Never read or write secrets outside the credential store.** A provider key is a credential purpose (`registerCredentialPurpose`); your settings hold non-secret fields only. No environment variable for runtime configuration.
8. **Ship the kit's run as your tests.** Run the slice's conformance kit against your implementation in your package's own tests ([below](#conformance-kits)), and document in your README the app's wiring: the registration import, the `forRoot` binding, the credential purpose and the typed augmentation.
9. **Document it the platform's way.** The README states the platform range it supports, the exact lines an app adds, and what is not supported. The app's conformance run (`runPlatformConformance`) then discovers your registrations from the registries it scans.

## Conformance kits

A kit is a function an extension author calls with the implementation and the test runner's `describe`, `it` and `expect`, so it works under Jest and Vitest. The Doctor and job-handler kits take them as an optional `testApi` and default to the runner's globals.

| Kit | Import | Checks | Status |
|---|---|---|---|
| `describeEventBusConformance(bus, { describe, it, expect })` | `@marinoscar/platform-api/host/testing` | Publish and subscribe on a dotted channel, ordering, unsubscribe, publish with no subscriber, `close()` | Available |
| `describeAiProviderConformance(name, factory, options?)` | `@marinoscar/platform-api/ai/testing` | `listModels`, `verifyKey`, `classifyModel`, each port the adapter carries (responses, embeddings, images, audio), every error is an `AiError`; the scenarios of a port it lacks pass | Available |
| `createAiRuntimeHarness({ extraProviders, extraAdapters, models })` | `@marinoscar/platform-api/ai/testing` | Not a kit but the runtime for one: the real gate pipeline (kill switch, provider switch, key policy, limits, usage) over your provider and in-memory tables | Available |
| `runPlatformConformance` | `@marinoscar/platform-api/testing` | The platform's invariants over the app's source and registrations; a slice's suites register by importing its `…/testing` entry | Available |
| `describePluggableKindConformance(kind, { describe, it, expect }, options?)` | `@marinoscar/platform-api/core/testing` | For each registered implementation of a pluggable kind: a valid id and label, defaults that parse, a descriptor that validates with secrets as presence flags only, no secret-looking setting, a `build` function | Available |
| `describeVocabularyConformance({ describe, it, expect }, options?)` | `@marinoscar/platform-api/core/testing` | The built-in system access reasons, principal kinds, credential kinds and error codes are intact; every registration is well formed; an unregistered or prototype-named reason is refused by the bypass entry points; an unregistered credential kind is denied; a payload code passes only for its own status | Available |
| `describeStorageDriverConformance(driver, { describe, it, expect, settings, secrets })` | `@marinoscar/platform-api/storage/testing` | A valid definition (id, label, defaults that parse); the full `StorageProvider` surface with `kind` equal to the driver id; put, head, read and delete real bytes; a 6 MiB streamed upload; the signed URL; key listing; `testConnection` never throws and never returns a secret; `provision`, `location` and `missing` when defined. It cannot detect a driver that buffers a whole stream | Available |
| `describeEmailTransportConformance(transport, { describe, it, expect, settings, secrets, backend })` | `@marinoscar/platform-api/email/testing` | A valid definition (id, label, defaults that parse, declared secrets); an accepted message is `{ success: true }`; `send` never throws (network error, thrown string, thrown object); no secret material and no message content in the error text; attachments and headers passed through to one recipient; a throttle classified; `verify`, when defined, never throws | Available |
| `describeAuthProviderConformance(definition, { describe, it, expect, rawProfile, expectedSubject, enabledWith?, host? })` | `@marinoscar/platform-api/identity/testing` | A well-formed definition; `mapProfile` returns a valid `ExternalProfile` (and survives a sparse payload); `isEnabled` is false without configuration and true with it; the strategy builds; the route is mounted; a full login creates a `UserIdentity` for this provider and subject; the allowlist applies; an unverified address is refused; a policy denial returns its reason | Available |
| `describeNotificationSenderConformance(sender, { describe, it, expect, recipient, handles?, secrets?, breakTransport? })` | `@marinoscar/platform-api/notifications/testing` | The channel is registered and the sender has a resolver; a reachable recipient resolves to a destination with a redacted display that carries no secret; an unreachable one resolves to `null`; `deliver` never throws (any payload, a down transport, an empty destination) and reports a failure with a reason; no secret in the display, `error` or `messageId`; the channel switch drops the channel, mandatory events included | Available |
| `describeTelemetryStoreConformance(store, { describe, it, expect, settings?, secrets?, writeStatements?, timeout?, unconfigured?, fixture? })` | `@marinoscar/platform-api/telemetry/testing` | A valid definition (id, label, defaults, no secret-looking setting, a form descriptor); `query` refuses writes and answers a read afterwards, honours its timeout and abort signal; `schema()` has the explorer shape, sorted; `ping()` never throws and leaks no secret; an unconfigured store refuses with a typed error; `close()` twice; the dialect renders every construct; given a fixture, every dashboard statement built with the dialect runs against the store | Available |
| `describeBackupTargetConformance(target, { describe, it, expect, rejectsEscapingKeys?, skip? })` | `@marinoscar/platform-api/db-backup/testing` | A valid id and the four members; write, read back, a missing key fails to read, idempotent delete; a 20 MiB stream that is not buffered (queued bytes, Buffer memory, chunked reads) and matches by SHA-256; a destroyed write rejects `done`; exact prefix listing; a signed URL when defined; `../` refused when declared | Available |
| `describeRestoreGateConformance(gate, { describe, it, expect, scenarios, watch? })` | `@marinoscar/platform-api/db-backup/testing` | A valid definition; answers `{ status, message }` per scenario; read-only (a context that records every write, plus watched side-effect counters); repeatable; evaluates to a pre-flight row with the gate's id and label | Available |
| `describeAccessRuleConformance(name, { rule, resourceType, sqlKit, decide, listsRecord, fixtures })` | `@marinoscar/platform-api/sharing/testing` | The decision equals "the record is listed" on every fixture (against the real `AccessPolicy` and `accessibleSql`), another organization is denied and never listed, a rule that can deny has SQL, no principal-derived string reaches the SQL text | Available |
| `describeGranteeKindConformance(name, { kind, sqlKit, runQuery, principals, grantees, validInputs, invalidInputs })` | `@marinoscar/platform-api/sharing/testing` | A valid descriptor, `validateGrantee` accepts and refuses the right inputs (hostile strings included), `describe` answers, the in-memory match equals the SQL fragment on your database over a principal x grantee matrix, a grantee of another kind never matches, the fragment is parameterised and confined to the grant row | Available |
| `runDbConformance({ appRoot })` | `@marinoscar/platform-db` | Offline, no database: the package's raw-SQL index and policy tripwires, `platform.lock` against the files, the app's own `rawSqlIndexes` and `rlsPolicies` against its migration SQL (`app-schema-objects`), and app migrations that collide with or reorder the installed history (`app-migrations`) | Available |
| `assertSeedIdempotent(() => seedPlatform(...))` | `@marinoscar/platform-db/seed` | The seed run twice over one database: the second run creates 0 rows, in the platform's default organization and in every extra step | Available |
| `runPlatformConformance({ suites })` (CLI) | `@marinoscar/platform-cli/testing` | The `cli` and `deployRegistrations` suites, and any suite registered with `registerCliConformanceSuite`; a skip needs a reason | Available |
| `runInfraConformance({ appRoot })` | `@marinoscar/platform-infra/testing` | `sync --check`, `docker compose config` per mode with the app's overlays, `nginx -t` over `app.d/` and both CSP files | Available |
| `describeDoctorCheckConformance(name, factory, { scenarios?, defaultTimeoutMs?, testApi? })` | `@marinoscar/platform-api/doctor/testing` | Per scenario: a dotted id, category, label, root-relative `settingsPath`, positive `timeoutMs`; the run completes within its timeout and never throws; a valid outcome (status, detail, a real remedy on `warn` and `fail`, scalar `data`); the statuses the scenario expects; no seeded secret and no secret-shaped value in the result; read-only against a recording Prisma client and a write-failing storage provider. It cannot see a write that reaches neither double (an HTTP POST, a file) | Available |
| `doctor-read-only` suite (`doctorReadOnly: { fixture, minChecks?, exempt?, forbiddenServices? }`) | `@marinoscar/platform-api/doctor/testing`, run by `runPlatformConformance` | The same proof over every check of the booted app's registry: no Prisma write (including a raw write, a job enqueue, an audit row), no storage write, no held side-effecting "test" service, a valid outcome for every check whose `dependsOn` passed; an exemption needs a reason and a stale one is a finding | Available |
| `describeJobHandlerConformance(name, handler \| () => handler, { payloads, canDelete?, ... })` | `@marinoscar/platform-api/jobs/testing` | A dotted permanent type, a label, a profile of exactly `{ maxRuntimeMs, maxAttempts }` inside the ceilings, `nodeResultSchema` and `persistNodeResult` both or neither, `ai.*` server-only; per payload: settles through `createFakeJobQueue()`, idempotent over two runs (`observe`, `assertIdempotent`), throws on a payload it must reject, duplicates collapse, an org-scoped payload carries a subject; `canDelete` answers `null` or a reason and the queue follows it. `findJobHandlerContractViolations` is the static half, without a runner | Available |
| `createFakeJobQueue(options?)` | `@marinoscar/platform-api/jobs/testing` | Not a kit but the double for one: an in-memory queue with the real dedup rule, claim order, attempt budget and delete decision; `asJobsService()` for a service under test | Available |
| `runPlatformWebConformance` with a registered suite | `@marinoscar/platform-web/testing` | The web harness runs your own `WebConformanceSuite<Options>` next to the platform's; the options are the third argument, ids are unique, the matcher subset is `toEqual`, `toBe`, `toMatchObject`, `toHaveLength`, `toThrow`, `toContain`, `toBeGreaterThanOrEqual` | Available |

An app adds its own suite with `conformanceSuites.register` and a `declare module '@marinoscar/platform-api/testing'` augmentation of `PlatformConformanceSuiteOptions`; the android-app slice's `testing/conformance.ts` is the model, and [the recipe above](#add-a-conformance-suite-of-your-own) has the steps. More: [TESTING.md](TESTING.md#platform-conformance).

## See also

- [EXTENSIBILITY-AUDIT.md](EXTENSIBILITY-AUDIT.md): every closed point, its evidence and the story that opens it.
- [specs/platform-packages.md](specs/platform-packages.md#the-extension-contract): the ladder, the decision rule, the guardrails.
- [SLICES.md](SLICES.md): the slice catalog.
- [PACKAGES.md](PACKAGES.md): the documentation standard and the peer-dependency rules.
- [ADOPTING-THE-PLATFORM.md](ADOPTING-THE-PLATFORM.md): moving an existing app onto the packages.
- [`apps/api/src/app-registrations/README.md`](../apps/api/src/app-registrations/README.md): the app-owned registration files.

# Extensibility audit

> **Status:** living tracker · **Epic:** PP-14, every slice extensible, alterable and improvable from the app (#918) · **Audited:** `main` @ `bb700916`, 2026-10-10 · **Guide:** [EXTENDING.md](EXTENDING.md) · **Contract:** [The Extension Contract](specs/platform-packages.md#the-extension-contract)

The audit record of the extension seams of every platform slice. A closed point is a place where an app, or a package an app installs, cannot add, replace or restyle something without editing a file under `packages/platform-*`. Each closed point names its evidence, the proposed fix and the story of epic PP-14 that opens it. A story that merges flips its rows from Open to Fixed in the same pull request, so the page stays a tracker rather than a snapshot.

## How to read this page

| Term | Meaning |
|---|---|
| **Verdict** | How open a slice is to extension: **Open** (every seam an app needs exists), **Mostly open** (registries and options exist; a few vocabularies, pages or tokens are closed), **Partly closed** (a pluggable kind or an entire path cannot be reached from an app), **Closed** (no seam). |
| **Open points** | What an app can already do without a package edit, by registry, option, token binding or event. Names are those of the slice's extension-point catalog (see the slice README). |
| **Closed points** | What it cannot do, each with `file:line` evidence as of `bb700916`. Lines drift; the file and the symbol stay the way to find the point. |
| **Status** | **Open**: the point is still closed. **Fixed**: the story merged; the row stays as the record. |

Evidence paths are written `api:`, `web:`, `contract:`, `cli:`, `db:` and `infra:` for `packages/platform-api/src/`, `packages/platform-web/src/`, `packages/platform-contract/src/`, `packages/platform-cli/src/`, `packages/platform-db/` and `packages/platform-infra/`; a path under `apps/` or `docs/` is from the repository root. A story is written PP-14.n (its issue number follows).

As of this version: 114 closed points in 29 sections, 27 fixed and 87 open.

## Verdicts

| Slice | Verdict | Closed points | Fixed | Open | Stories |
|---|---|---|---|---|---|
| [onboarding](#onboarding) | Open | 1 | 0 | 1 | PP-14.20 |
| [credentials](#credentials) | Open | 0 | 0 | 0 | none |
| [settings](#settings) | Mostly open | 7 | 1 | 6 | PP-14.21, PP-14.5, PP-14.24 |
| [notifications](#notifications) | Mostly open | 7 | 1 | 6 | PP-14.10, PP-14.8, PP-14.24 |
| [exports](#exports) | Mostly open | 3 | 0 | 3 | PP-14.20 |
| [jobs](#jobs) | Mostly open | 4 | 0 | 4 | PP-14.19, PP-14.23, PP-14.26 |
| [nodes](#nodes) | Mostly open | 4 | 0 | 4 | PP-14.19, PP-14.23 |
| [doctor](#doctor) | Mostly open | 2 | 0 | 2 | PP-14.23, PP-14.26 |
| [telemetry](#telemetry) | Mostly open | 7 | 0 | 7 | PP-14.11, PP-14.18, PP-14.24 |
| [otel-core](#otel-core) | Mostly open | 1 | 0 | 1 | PP-14.18 |
| [core](#core) | Mostly open | 6 | 1 | 5 | PP-14.14, PP-14.5, PP-14.23 |
| [shell](#shell) | Mostly open | 2 | 0 | 2 | PP-14.25 |
| [sharing](#sharing) | Mostly open | 4 | 0 | 4 | PP-14.16, PP-14.15, PP-14.25 |
| [manifest](#manifest) | Mostly open | 2 | 0 | 2 | PP-14.15 |
| [user-data](#user-data) | Mostly open | 1 | 0 | 1 | PP-14.24 |
| [platform-db](#platform-db) | Mostly open | 6 | 1 | 5 | PP-14.27, PP-14.4 |
| [platform-cli](#platform-cli) | Mostly open | 7 | 0 | 7 | PP-14.22 |
| [platform-infra](#platform-infra) | Mostly open | 2 | 0 | 2 | PP-14.22 |
| [testing (api and web)](#testing-api-and-web) | Mostly open | 2 | 0 | 2 | PP-14.26 |
| [ai](#ai) | Mostly open | 10 | 6 | 4 | PP-14.3, PP-14.6, PP-14.17, PP-14.24 |
| [storage](#storage) | Mostly open | 5 | 4 | 1 | PP-14.1, PP-14.7, PP-14.24 |
| [identity](#identity) | Partly closed | 8 | 6 | 2 | PP-14.9, PP-14.15, PP-14.25 |
| [email](#email) | Partly closed | 5 | 4 | 1 | PP-14.8, PP-14.24 |
| [host](#host) | Partly closed | 8 | 1 | 7 | PP-14.2, PP-14.13, PP-14.24 |
| [datatable](#datatable) | Partly closed | 2 | 0 | 2 | PP-14.20 |
| [db-backup](#db-backup) | Partly closed | 4 | 0 | 4 | PP-14.12, PP-14.23 |
| [android-app](#android-app) | Partly closed | 1 | 0 | 1 | PP-14.24 |
| [testing (CLI runner)](#testing-cli-runner) | Closed | 1 | 0 | 1 | PP-14.22 |
| [docs (cross-cutting)](#docs-cross-cutting) | Documentation | 2 | 2 | 0 | PP-14.4 |

## Stories

The 28 stories of the epic, in order. Phase 1 makes the existing seams real; phase 2 adds one pluggable-kind primitive and applies it to every pluggable kind; phase 3 opens the remaining vocabularies; phase 4 is the packaged-page slot contract; phase 5 is test kits, the data model and the guardrail.

| Story | Issue | Title | Phase | Depends on | Migration | Status |
|---|---|---|---|---|---|---|
| PP-14.1 | #919 | storage: make the STORAGE_PROVIDER override reach every package consumer | 1 | none | no | Merged (PR #947) |
| PP-14.2 | #920 | host: make the event bus pluggable (binding option and adapter registry) | 1 | none | no | Merged (PR #948) |
| PP-14.3 | #921 | ai: a registered provider without a settings slot must not break the admin AI page | 1 | none | no | Merged (PR #949) |
| PP-14.4 | #922 | docs: extension author guide, audit record and corrected recipes | 1 | none | no | This change |
| PP-14.5 | #923 | core: the pluggable-kind primitive (registry, per-implementation settings, secrets, descriptors, generic form, kit) | 2 | none | no | This change |
| PP-14.6 | #924 | ai: let an app or package add an AI provider (the AssemblyAI case) | 2 | 14.5, 14.3 | no | This change |
| PP-14.7 | #925 | storage: pluggable storage drivers (Azure Blob, GCS, local) | 2 | 14.1, 14.5 | verify | This change |
| PP-14.8 | #926 | email: pluggable email transports (SendGrid, Postmark) | 2 | 14.5 | no | This change |
| PP-14.9 | #927 | identity: add a sign-in provider (GitHub, Entra, OIDC) | 2 | 14.5 | no | This change |
| PP-14.10 | #928 | notifications: first-class app channels (Slack, SMS, Teams, webhook) | 2 | 14.5 | no | Open |
| PP-14.11 | #929 | telemetry: a TELEMETRY_STORE port so the time-series store is replaceable | 2 | 14.5 | no | Open |
| PP-14.12 | #930 | db-backup: pluggable backup target, schedule policy and restore gates | 2 | 14.1 (14.7) | verify | Open |
| PP-14.13 | #931 | host: health indicators, maintenance bypass, About contributors, deployment capabilities and app guards | 3 | 14.2 | no | Open |
| PP-14.14 | #932 | core: open the access-reason, principal and error-code vocabularies | 3 | none | no | Open |
| PP-14.15 | #933 | roles: app roles become assignable, and apps can grant platform permissions to them | 3 | none | no | Open |
| PP-14.16 | #934 | sharing: pluggable grantee kinds and access rules | 3 | 14.15 | maybe | Open |
| PP-14.17 | #935 | ai: open capabilities and operations, richer transcription results, per-feature usage | 3 | 14.6 | yes | Open |
| PP-14.18 | #936 | telemetry and otel-core: app units, group presentation, dashboard panels, assistant tools, SDK extension | 3 | 14.11, 14.23 | no | Open |
| PP-14.19 | #937 | jobs and nodes: app retention policies, open job reasons, node vitals and executor telemetry | 3 | none | yes | Open |
| PP-14.20 | #938 | onboarding, datatable and exports: close the remaining small vocabularies | 3 | none | no | Open |
| PP-14.21 | #939 | settings: nested and org-layer extensions, core profile and theme fields, package self-registration | 3 | none | no | Open |
| PP-14.22 | #940 | cli and infra: app env groups, deploy checks and steps, proxy stream routes, CSP, compose modes, CLI conformance | 3 | none | no | Open |
| PP-14.23 | #941 | web: the packaged-page slot contract, its CI check, and the operations pages | 4 | none | no | Open |
| PP-14.24 | #942 | web: apply the slot contract to AI, storage, email, telemetry, android, host, profile, user-data and notifications pages | 4 | 14.23 (and the phase 2 story of each slice) | no | Open |
| PP-14.25 | #943 | web: slots for identity and sharing pages, login layout, and shell navigation and themes | 4 | 14.23, 14.9, 14.15 | no | Open |
| PP-14.26 | #944 | testing: extension-author kits for doctor checks and job handlers, and configurable web suites | 5 | none | no | Open |
| PP-14.27 | #945 | db: app metadata on users and organizations, more extensible models, offline checks for app indexes and RLS policies, seed hook | 5 | 14.4 | yes | Open |
| PP-14.28 | #946 | ci: a guardrail that stops new closed id lists in the packages | 5 | all other PP-14 stories | no | Open |

## Patterns

The closed points fall into six repeating patterns. Each is removed once, in one consistent way, and then applied everywhere.

| # | Pattern | Removed by |
|---|---|---|
| 1 | Closed id lists for pluggable kinds (TypeScript unions, `z.enum`, a fixed settings key per implementation, a `switch` over ids) | The pluggable-kind primitive (PP-14.5, shipped: [Writing a pluggable implementation](EXTENDING.md#writing-a-pluggable-implementation)) applied by the phase 2 stories, and the open vocabularies of phase 3. The rule is [Open an id vocabulary](EXTENDING.md#open-an-id-vocabulary); the guardrail is PP-14.28. |
| 2 | Documented token overrides that a package-internal consumer never sees (NestJS module scoping) | Bindings through `forRoot` (PP-14.1, PP-14.2 and the phase 2 stories). The rule is [overrides go through `forRoot`](EXTENDING.md#the-extension-ladder). |
| 3 | Packaged web pages with no slots, or a `Header` slot only | The packaged-page slot contract (PP-14.23 to PP-14.25). |
| 4 | Settings extension is top-level only (no nested paths, no org layer, no core `profile` or `theme`) | PP-14.21. |
| 5 | No test kit for extension authors (except AI providers and storage drivers) | Each phase 2 story ships its kit; PP-14.26 covers the rest. |
| 6 | Data model: few platform models accept app relations, no JSONB `metadata` on `User` or `Organization` | PP-14.27. |

## Slices

Sections follow the verdict, from the most open slice to the most closed.

### onboarding

**Verdict:** Open · **Packages:** api, web, contract · **Closed points:** 1 (0 fixed, 1 open) · **Stories:** PP-14.20

**Open points.** Step, fact, ordering and activation-milestone registries (`registerOnboardingStep`, `registerOnboardingFact`, `registerOnboardingOrdering`, `registerActivationMilestone`), `extendOnboardingSettings`, the `ONBOARDING_DATA` and `ONBOARDING_FEATURES` host ports, `registerFeatureNotice` and the `WelcomeDialog` slot on the web.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| onboarding-1 | The audiences are `admin` and `user`; tiers and statuses are closed; there is no organization-administrator audience for a multi-org app, and `validateStep` rejects any other audience. | contract: `onboarding/constants.ts:16`; api: `onboarding/onboarding.registries.ts` | Add the built-in `org_admin` audience (from the `org_admin` membership role) and `registerOnboardingAudience`; audiences become `Builtin | (string & {})`. | PP-14.20 (#938) | Open |

### credentials

**Verdict:** Open · **Packages:** api, web, contract · **Closed points:** 0 (0 fixed, 0 open) · **Stories:** none

**Open points.** The two purpose registries (`registerCredentialPurpose`, `registerUserCredentialPurpose`), the three tier modules and `UserCredentialResolver`, and the write-only `SecretField` on the web. No closed point was recorded at the audit commit; a pluggable implementation's declared secrets are stored by its consuming slice as credential purposes, and the generic `PluggableConfigForm` renders them with the write-only `SecretField`.

Closed points: none recorded at the audit commit.

### settings

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 7 (1 fixed, 6 open) · **Stories:** PP-14.21, PP-14.5, PP-14.24

**Open points.** System and user namespace registries (`registerSystemSettingsNamespaces`, `registerUserSettingsNamespaces`), the `app-registrations/settings.ts` extension lists, the org layer, `SettingsResolver`, `SystemSettingsRowStore`, `registerSettingsFeature` and the packaged hub and profile pages.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| settings-1 | A namespace extension adds top-level fields only and throws on an existing key; it cannot reach nested objects and does not extend the `org` layer. | api: `settings/registry/extend.ts:122` | Nested extension by dot path and an `org` block (`override` or `tighten`); same for user namespaces (no org layer). | PP-14.21 (#939) | Open |
| settings-2 | A platform namespace's defaults, merge and org rules cannot be replaced (a key collision is `DUPLICATE_ID`). | api: `settings/registry/extend.ts:122` | `overrideSettingsNamespaceDefaults(id, partialDefaults)` (defaults only, validated against the schema). | PP-14.21 (#939) | Open |
| settings-3 | The core user fields sit outside the registries: `theme` (light, dark, system), `profile` and the derived `security` block. No `profile.timezone`, no extra themes. | contract: `settings/constants.ts:21`; api: `settings/registry/compose.ts:236` (`UserSettingsCoreShape`) | `extendUserProfile({ fields })` and `registerThemePreference({ id, label })`; `security` stays closed on purpose. | PP-14.21 (#939) | Open |
| settings-4 | `ProfileSettings` and `ThemeSettings` take fixed props; `OrgSettingsPage` renders `other` fields (objects, records) only as a link. | web: `settings/ui/` | `slots.ExtraFields`; `registerOrgSettingsFieldRenderer(namespace, field, Component)`. | PP-14.21 (#939) | Open |
| settings-5 | A separately installed package cannot contribute a namespace: the manifests that fold and register them are app code. | api: `settings/registry/` | `registerSettingsContribution({ system, user, extensions })`, a pre-bootstrap collector folded in a documented order. | PP-14.21 (#939) | Open |
| settings-6 | The org-settings field descriptor knows five kinds and no secret; it is the base the generic form generalises. | api: `settings/org-settings/describe-fields.ts`; contract: `settings/schemas.ts:303, settings/constants.ts:147` | Move to `describeConfigFields` in core; add the write-only `secret` kind; `PluggableConfigForm` in the settings web slice (new slice edge `settings -> credentials`). | PP-14.5 (#923) | Fixed |
| settings-7 | `UserProfilePage` and `UserAppearancePage` take no slots. | web: `settings/ui/` | `PageSlotsBase` on both. | PP-14.24 (#942) | Open |

### notifications

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 7 (1 fixed, 6 open) · **Stories:** PP-14.10, PP-14.8, PP-14.24

**Open points.** Event, channel and template registries with open channel ids (`registerNotification`, `registerNotificationEvent`, `registerNotificationChannel`, the two template bindings), `NotificationChannelSenderRegistry`, `NotificationsService`, the org policy layer and the web bell, provider and pages.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| notifications-1 | A recipient carries only an email address (`resolveTo` is synchronous), so a Slack or SMS channel has no per-user handle; the push channel works around it by returning the user id, which is then stored in the delivery row. | api: `notifications/notification.types.ts:58, :365`; `notifications/channels/push-notification.channel.ts:159` | Async `resolveRecipient` returning `{ to, display }` and a `NOTIFICATION_RECIPIENT_HANDLES` port bound by `NotificationsModule.forRoot({ recipientHandles })`; the row stores `display`. | PP-14.10 (#928) | Open |
| notifications-2 | The admin kill switch is browser-only: the `notifications` namespace is `browserEnabled` plus `disabledEvents`, and `policyChannels` special-cases `browser`. | api: `notifications/notifications.system-settings.ts:38, :56`; `notifications/notification-policy.ts:204` | `channels: Record<channelId, { enabled }>` in the namespace with `browserEnabled` kept as an alias; one switch per registered channel. | PP-14.10 (#928) | Open |
| notifications-3 | Templates exist only for email and browser; a new channel renders from raw data with no registry or validation. | api: `notifications/registry/bindings.registry.ts:72, :92` | `registerChannelTemplate({ channelId, eventKey, render })`, validated at bootstrap. | PP-14.10 (#928) | Open |
| notifications-4 | The broadcast composer and the preference matrix hard-code the channel list, order, labels and the critical rule. | web: `notifications/ui/BroadcastComposer.tsx:115, :118, :229`; contract: `notifications/schemas.ts:954`; web: `notifications/ui/NotificationSettings.tsx:188, :568` | `GET /notifications/channels` (labels, order, `criticalCapable`); delete `CHANNEL_ORDER`, `DEFAULT_CHANNELS`, `CHANNEL_LABELS`. | PP-14.10 (#928) | Open |
| notifications-5 | The push payload has exactly five fields. | api: `notifications/channels/push-notification.channel.ts:~111` | `NotificationsModule.forRoot({ pushPayload })` with an allowlisted extras shape. | PP-14.10 (#928) | Open |
| notifications-6 | `EmailNotificationChannel` takes the two concrete email classes, so no other transport reaches notifications. | api: `notifications/channels/email-notification.channel.ts:116` | Depend on the `EmailTransportResolver`, never on concrete classes. | PP-14.8 (#926) | Fixed |
| notifications-7 | `NotificationSettings` labels and the admin composer need the channel list from the API. | web: `notifications/ui/NotificationSettings.tsx:188` | Labels from the channel registry plus `PageSlotsBase`. | PP-14.24 (#942) | Open |

### exports

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 3 (0 fixed, 3 open) · **Stories:** PP-14.20

**Open points.** `registerExportSource`, `registerExportWriter`, `ExporterRegistry`, the CSV helpers, the `EXPORTS_SYSTEM_DATA` and `EXPORTS_NOTIFIER` ports and the web dialog, list and page.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| exports-1 | A new writer cannot attach to the built-in sources: `writersFor` filters by `source.formats`, `writer.sources` can only narrow, and `user-data` and `org-data` hard-code `json`, `csv`, `xlsx`. | api: `exports/sources/user-data.source.ts:91`; `exports/sources/org-data.source.ts:149` | `registerExportWriter({ attachTo: '*' | string[] })`; built-in sources compute formats from attached writers. | PP-14.20 (#938) | Open |
| exports-2 | `EXPORT_COLUMN_TYPES` is closed and a writer has nowhere to keep its own typing (Parquet logical types). | contract: `exports/constants.ts` | `ExportColumn.meta` (bounded scalars); the column types stay closed. | PP-14.20 (#938) | Open |
| exports-3 | `ExportsList` has no column or row-action slots. | web: `exports/ui/` | `slots.Columns` and `slots.RowActions`. | PP-14.20 (#938) | Open |

### jobs

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 4 (0 fixed, 4 open) · **Stories:** PP-14.19, PP-14.23, PP-14.26

**Open points.** `JobHandlerRegistry.register`, `registerJobTypeLabel`, `JobSecretBroker`, `enqueueHousekeepingJob`, `RetentionPurgeRegistry`, `JobScope.run`, the `JOBS_*` ports and the packaged Jobs and Job Insights pages (`slots.Header`).

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| jobs-1 | The retention policy keys and the four-key `retention` namespace are fixed; `RetentionPurgeRegistry.register` throws for any other key, so an app table cannot join the nightly retention. | contract: `jobs/retention-schemas.ts:39`; api: `jobs/retention/retention-purge.registry.ts:67`; api: `jobs/retention/retention.system-settings.ts:~60` | `registerRetentionPolicy({ key, label, defaultDays, minDays, maxDays, purge })`; the namespace is composed from the registry; the nightly task enqueues one job per policy. | PP-14.19 (#937) | Open |
| jobs-2 | `JobReason` is a closed Prisma enum (`upload`, `rerun`, `backfill`) mirrored in the contract, and every enqueue requires one. | db: `schema/jobs.prisma:351`; contract: `jobs/constants.ts:44` | Migration: enum to text, values kept; `jobReasonSchema` as a pattern; `registerJobReason({ id, label })`. | PP-14.19 (#937) | Open |
| jobs-3 | `JobsPage` and `JobInsightsPage` expose only `slots.Header`. | web: `jobs/ui/JobsPage.tsx:134, :197` | `PageSlotsBase`, `TableSlots<JobRow>` and `Filters`. | PP-14.23 (#941) | Open |
| jobs-4 | `jobs/testing` holds only the `on-event-no-io` suite; nothing exercises a handler's own contract (profile bounds, idempotence on retry, node-eligibility pairing, dedup). | api: `jobs/testing/index.ts` | `createFakeJobQueue()` and `describeJobHandlerConformance(handler, { payloads })`. | PP-14.26 (#944) | Open |

### nodes

**Verdict:** Mostly open · **Packages:** api, web, contract, cli · **Closed points:** 4 (0 fixed, 4 open) · **Stories:** PP-14.19, PP-14.23

**Open points.** `NodesModule.forRoot`, the `NODE_OBJECT_STORE` and `NODE_JOB_INPUTS` ports, `NodeOfflineEvent`, `registerNodeExecutor` in the CLI and the Worker Nodes page (`slots.Header`).

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| nodes-1 | Node vitals and counters are `.strict()`; the vitals dialog and fleet gauges are fixed and `capabilities` is not shown. | contract: `nodes/schemas.ts:420, :458` | `vitals.extra` (up to 16 numeric keys) and `registerNodeVital({ key, label, unit })`; capabilities as a read-only list. | PP-14.19 (#937) | Open |
| nodes-2 | Executor span names are closed on both sides (a custom span gets a 400 for the whole batch); relayed attributes are four integer keys. | api: `nodes/dto/node-telemetry.dto.ts:45, :90`; cli: `telemetry/node-span.ts:17`; api: `nodes/node-telemetry.service.ts:74` | Allow `job.app.<name>` spans on both sides, drop an invalid span individually, `registerNodeSpanAttribute`. | PP-14.19 (#937) | Open |
| nodes-3 | `JOB_TYPE_REQUIREMENTS` and `PROBED_BINARIES` are not exported, so an executor that needs `ffmpeg` cannot declare it and the node self-test cannot protect it. | cli: `engine/node/capabilities.ts:64, :101` | Export `registerJobRequirement(type, { required, degradable })` and `registerProbedBinary(name, { versionArgs })` from `@marinoscar/platform-cli/node`. | PP-14.19 (#937) | Open |
| nodes-4 | `WorkersPage` exposes only `slots.Header`. | web: `nodes/ui/WorkersPage.tsx:202` | `PageSlotsBase`, `TableSlots<NodeRow>` and `VitalsPanel`. | PP-14.23 (#941) | Open |

### doctor

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.23, PP-14.26

**Open points.** `DoctorCheck` and `DoctorCheckRegistry.register`, `EgressContributor`, `SupportBundleSection`, the `DEPLOYMENT_NETWORK_SOURCE` port, `categoryOrder` and `DoctorPage`'s `categories` prop.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| doctor-1 | The Doctor `CheckRow` never renders `check.data` and has no slot; there is no per-check renderer or action. | web: `doctor/ui/check-row.tsx:100-175` | `PageSlotsBase`, `registerDoctorCheckRenderer(checkId, Component)` and `CheckRowActions`. | PP-14.23 (#941) | Open |
| doctor-2 | "Doctor checks are read-only" is convention only: the conformance row says "None yet" and an extension author has no harness. | api: `doctor/README.md:194` | `doctor/testing`: `runDoctorCheck`, `describeDoctorCheckConformance` and the `doctor-read-only` suite in `runPlatformConformance`. | PP-14.26 (#944) | Open |

### telemetry

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 7 (0 fixed, 7 open) · **Stories:** PP-14.11, PP-14.18, PP-14.24

**Open points.** `TelemetryModule.forRoot` options, `metricGroups` and `registerMetricGroup`, the verdict thresholds and `VERDICT_POLICY` (bound by `dashboard.verdictPolicy`), the `TELEMETRY_*` host ports, `withTelemetryTokens` and the packaged dashboard, explorer and settings pages. The reference group is `apps/api/src/platform-extensions/telemetry/activity.metric-group.ts`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| telemetry-1 | The time-series store is a concrete class: `GreptimeClient` (a `pg` pool) is injected directly by the query and dashboard services and the module providers, and the dashboard SQL is GreptimeDB-specific (`date_bin`, `greptime_timestamp`). | api: `telemetry/query/telemetry-query.service.ts:140`; `telemetry/dashboard/telemetry-dashboard.service.ts:383, :409`; `telemetry/telemetry.module.ts:103, :196`; `telemetry/dashboard/telemetry-dashboard.sql.ts:347` | `TelemetryStore` and `TelemetrySqlDialect`, `registerTelemetryStore`, `TelemetryModule.forRoot({ store })`; Greptime becomes the built-in implementation. | PP-14.11 (#929) | Open |
| telemetry-2 | The only credential purpose is `telemetry_greptime`. | api: `telemetry/connection/telemetry-connection.schema.ts:72` | One purpose per store implementation. | PP-14.11 (#929) | Open |
| telemetry-3 | `METRIC_UNITS` is a closed 15-value list enforced by `assertUnit`; `kind` is `gauge`, `counter` or `histogram`. | contract: `telemetry/constants.ts:446`; api: `telemetry/metrics/metric-group.registry.ts`; `telemetry/metrics/metric-catalog.ts:174-223` | `registerMetricUnit({ id, label, format, currency?, decimals? })`. | PP-14.18 (#936) | Open |
| telemetry-4 | Presentation is a module constant covering the six platform groups only; an app group gets default tiles (no colours, top-N or virtual columns). | web: `telemetry/ui/components/dashboard/metrics/MetricSections.tsx:83` | `MetricGroupDef.presentation` (bounded, validated, no code), served by `/metric-groups`. | PP-14.18 (#936) | Open |
| telemetry-5 | `DASHBOARD_PANELS` (`api`, `logs`) and `DASHBOARD_TOP_KINDS` are closed; the three pages take no props or slots. | contract: `telemetry/constants.ts:402, :417`; web: `telemetry/ui/pages/TelemetryDashboardPage.tsx:279` | `registerDashboardPanel` (API) and `registerDashboardPanelView` (web); `Sections`, `Header`, explorer `starterQueries`. | PP-14.18 (#936) | Open |
| telemetry-6 | The assistant has a fixed eight-tool list and a hard-coded system prompt. | contract: `telemetry/constants.ts:525`; api: `telemetry/assistant/telemetry-assistant.service.ts:1269` | `registerTelemetryAssistantTool` (read-only, guarded query facade only) and an `extraInstructions` option. | PP-14.18 (#936) | Open |
| telemetry-7 | The dashboard, settings and explorer pages take no slots. | web: `telemetry/ui/pages/TelemetryDashboardPage.tsx:279` | `Sections`, `Header`, explorer `starterQueries` (the panel registry is PP-14.18). | PP-14.24 (#942) | Open |

### otel-core

**Verdict:** Mostly open · **Packages:** api · **Closed points:** 1 (0 fixed, 1 open) · **Stories:** PP-14.18

**Open points.** `initializeOtel`, the runtime export gate (`telemetryGate`), `registerAppMetrics` and the `appMetricRegistry`, `MetricsHostService.registerGaugeProvider`, `OtelMetricsModule.forRootAsync`, `registerRequestSpanAttributes` and `@Trace()`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| otel-core-1 | `initializeOtel` hard-wires OTLP/HTTP exporters to one endpoint; there is no way to add span processors, metric readers or views, a sampler, a propagator or resource attributes (the resource is fixed). | api: `otel-core/sdk/initialize-otel.ts:203-207, :210-236` | `InitializeOtelOptions` gains `spanProcessors`, `metricReaders`, `views`, `sampler`, `textMapPropagator`, `resourceAttributes`, all behind the export gate. | PP-14.18 (#936) | Open |

### core

**Verdict:** Mostly open · **Packages:** api, web · **Closed points:** 6 (1 fixed, 5 open) · **Stories:** PP-14.14, PP-14.5, PP-14.23

**Open points.** `defineRegistry` and the static registries, the host ports (`PlatformHostModule.forRoot`, `AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`, `PLATFORM_PRISMA`), `HttpExceptionFilter`, `PortBinding`, and on the web `PlatformHostProvider`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| core-1 | `SystemAccessReason` is a closed union plus a frozen array, validated against it: an app or package cannot add a bypass reason for its own jobs. | api: `core/data-access/rls.ts:86, :102, :199` | `registerSystemAccessReason({ id, description })`; the allowlist of files that may inject `PrismaSystemService` stays closed (this opens which reason, not who may bypass). | PP-14.14 (#932) | Open |
| core-2 | `CredentialKind` and `PrincipalKind` are closed; an app auth scheme (API key, webhook token) has no principal kind. | api: `core/principal/principal.types.ts:58, :70` | Augmentable `PrincipalKinds` and `CredentialKinds` plus `registerCredentialKind`; guards deny unknown kinds unless registered. | PP-14.14 (#932) | Open |
| core-3 | `HttpExceptionFilter` derives `code` from the HTTP status and ignores a payload `code`; `ErrorDto` publishes a closed nine-value enum; there is no mapper for foreign errors (Prisma, SDKs). | api: `core/errors/http-exception.filter.ts:156` | `registerErrorCode`, `HttpExceptionFilter` option `mappers`; `ErrorDto.code` becomes an open string. | PP-14.14 (#932) | Open |
| core-4 | `PlatformWebHost` has fixed ports (`api`, `viewer`, `formatRelativeTime`, `applyTheme`); an installed extension package cannot add its own. | web: `core/` (PlatformWebHost) | `PlatformWebHost.extensions` and `usePlatformPort<T>(key)`. | PP-14.14 (#932) | Open |
| core-5 | No pluggable-kind primitive: seven slices each hard-code their own implementation list. | api: `core/registry/registry.ts:459` (the registry it builds on) | `definePluggableKind`, `describeConfigFields`, `PluggableConfigForm`, `describePluggableKindConformance`. | PP-14.5 (#923) | Fixed |
| core-6 | No shared slot contract for packaged pages. | web: `core/` | `PageSlotsBase` and `TableSlots<Row>` in `@marinoscar/platform-web/core`, with a CI check. | PP-14.23 (#941) | Open |

### shell

**Verdict:** Mostly open · **Packages:** web · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.25

**Open points.** `ShellNavigation`, `ShellLayout`, `ShellAppBar`, `ShellUserMenu`, `ShellProviders`, `createShellTheme`, `useShellRailPreference`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| shell-1 | A destination has no `badge`, `group`, `onClick` or `external`; the bottom navigation renders every destination with no overflow. | web: `shell/headless/navigation.ts:51-81`; `shell/ui/ShellBottomNav.tsx:71-80` | `ShellDestination.badge`, `group`, `external`, `onClick`; `ShellBottomNav maxItems` (default 4) with a "More" sheet. | PP-14.25 (#943) | Open |
| shell-2 | `ShellThemeMode` is `light`, `dark`, `system` and `ShellThemeProvider` takes exactly `{ light, dark }`. | web: `shell/headless/theme.ts:23` | `ShellThemeProvider themes` and `registerThemeMode({ id, label, theme })`. The five breakpoint gates stay where they are. | PP-14.25 (#943) | Open |

### sharing

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 4 (0 fixed, 4 open) · **Stories:** PP-14.16, PP-14.15, PP-14.25

**Open points.** `registerGroupOwnedResource`, `registerResourceType`, `AccessPolicy`, `accessibleWhere` and `accessibleSql`, the `SHARING_*` ports, `registerLinkRenderer` and the packaged groups pages and `ShareDialog`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| sharing-1 | Grantee kinds are fixed (`user`, `group`, `link`) and the per-kind SQL is hard-coded; there is no team, role or email-domain grantee. | contract: `sharing/constants.ts:100`; api: `sharing/access/resource-types.ts:76`; `sharing/grants/grants.service.ts:253, :383-396` | `registerGranteeKind` (parameterised SQL fragment, composite `org_id` rules kept), `GET /sharing/grantee-kinds`, `registerGranteePicker`. | PP-14.16 (#934) | Open |
| sharing-2 | The nine-step access decision order is fixed; a project-membership or time-window rule means replacing `AccessPolicy` wholesale. | api: `sharing/access/access-policy.service.ts:10-30, :78` | `registerAccessRule({ id, position, evaluate, sql? })`; `AccessVia` open. | PP-14.16 (#934) | Open |
| sharing-3 | Group roles are a fixed list validated in the resource-type registry. | contract: `sharing/constants.ts:13`; api: `sharing/access/resource-types.ts:199` | `registerGroupRole({ id, label, actions })`. | PP-14.15 (#933) | Open |
| sharing-4 | `GroupsPage` and `GroupDetailPage` expose only `Header`, `ShareDialog` only `Title`. | web: `sharing/ui/GroupsPage.tsx:53`; `sharing/ui/GroupDetailPage.tsx:69`; `sharing/ui/ShareDialog.tsx:68` | `PageSlotsBase`, `MemberRowActions`, `Tabs`; `ShareDialog` `slots.Sections` and `slots.Footer`. | PP-14.25 (#943) | Open |

### manifest

**Verdict:** Mostly open · **Packages:** api · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.15

**Open points.** `registerPlatformPermissions` (platform roles, every slice's permission set, then the app's), `platformPermissionCatalog`, `registerPlatformModelOwnership`, `registerPlatformUserOwnedModels`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| manifest-1 | An app cannot grant a platform permission to its own role: `defaultGrants` lives on the declaration, and re-declaring a platform permission is `DUPLICATE_ID`. | api: `manifest/register-permissions.ts:~90`; `core/permissions/permission.registry.ts:189` | `registerPlatformPermissions({ app: { roles, permissions, grants } })`, validated and applied by the seed and the role resolver. | PP-14.15 (#933) | Open |
| manifest-2 | `PLATFORM_PERMISSION_SLICES` is a fixed tuple and `slices` must include `identity`; a package slice added outside the platform has nowhere to declare. | api: `manifest/platform-permissions.ts:38`; `manifest/register-permissions.ts:~104` | `registerPermissionSet({ slice, permissions, roles })`; `identity` stays mandatory. | PP-14.15 (#933) | Open |

### user-data

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 1 (0 fixed, 1 open) · **Stories:** PP-14.24

**Open points.** Category, scope, keep-or-delete hint, factory-reset step and offboarding-precondition registries, `registerUserDataModels`, the `USER_DATA_*` ports and the Danger Zone, factory-reset and offboarding UI.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| user-data-1 | The kept and deleted copy of the Danger Zone and factory-reset pages is static text rendered unconditionally; the pages accept only `onCompleted` and `pollIntervalMs`. | web: `user-data/ui/copy.ts:13-37`; `user-data/ui/FactoryResetPage.tsx:151, :159`; `user-data/ui/UserDangerZonePage.tsx:168` | The summary endpoint returns `kept` and `deleted` built from the registered hints and steps (contract change); `copy?` and `PageSlotsBase`. | PP-14.24 (#942) | Open |

### platform-db

**Verdict:** Mostly open · **Packages:** db · **Closed points:** 6 (1 fixed, 5 open) · **Stories:** PP-14.27, PP-14.4

**Open points.** `extend model` blocks (`ComposeOptions.appFragmentsDir`), app migrations after the installed ones, `rawSqlIndexes` and `rlsPolicies` in `platform.lock`, `platform db drift` over the app's lists, `seedPlatform`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| platform-db-1 | Only five models are `@extensible` (`User`, `Organization`, `Job`, `Group`, `StorageObject`); `Notification*`, `Credential`, `AiRun`, `Grant`, `Role` and `Permission` are closed, so an app cannot hang a relation on them. | db: `compose/compose.ts:149-153` (`NOT_EXTENSIBLE`) | Mark `Notification`, `NotificationDelivery`, `Credential` (metadata only), `AiRun`, `Grant`, `Role` extensible; `Permission` stays closed, documented. | PP-14.27 (#945) | Open |
| platform-db-2 | `extend` accepts back-relations only and `extend enum` is rejected; `User` and `Organization` have no JSONB `metadata`, so any per-user app field needs a side table. | db: `compose/compose.ts:141, :162-183` | Migration: `metadata jsonb NOT NULL DEFAULT '{}'` on `users` and `organizations`; `registerUserMetadataSchema` and `registerOrganizationMetadataSchema`. | PP-14.27 (#945) | Open |
| platform-db-3 | `runDbConformance` checks only the package's own indexes and policies; an app's `rawSqlIndexes` and `rlsPolicies` are checked only by `db drift` against a live database, and an app policy is listed by `{ name, table }` only. | db: `drift/db-conformance.ts:79, :83`; `lock/lock.ts:38` | `runDbConformance({ appRoot })` scans the app's migrations for each lock entry; policy entries gain an optional expression hash. | PP-14.27 (#945) | Open |
| platform-db-4 | The seed writes five fixed tables with no hook for app steps and no shared idempotence contract. | db: `seed/` | `seedPlatform(prisma, input, { extras: SeedStep[] })` with an idempotence contract. | PP-14.27 (#945) | Open |
| platform-db-5 | Nothing checks that an app migration name does not collide with, or reorder around, an installed platform id. | db: `sync/` | `platform db sync` and `db:check` fail on a collision. | PP-14.27 (#945) | Open |
| platform-db-6 | The `rlsPolicies` lock key and the RLS migration shape were undocumented for app tables (the README covered `rawSqlIndexes` only). | db: `README.md` (Extension-point catalog, Data) | Document the lock entry, the migration SQL and the drift problem codes. | PP-14.4 (#922) | Fixed |

### platform-cli

**Verdict:** Mostly open · **Packages:** cli · **Closed points:** 7 (0 fixed, 7 open) · **Stories:** PP-14.22

**Open points.** `registerCliCommand`, `registerEnvSpecFragment`, `registerDeployStep` (`after` only), `registerTuiScreen`, `registerNodeExecutor`, `createCli` identity.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| platform-cli-1 | `ENV_GROUPS` is a closed list and `fromFragment` throws for any other group; the TUI group record is closed, so an app cannot make its keys an opt-in group. | cli: `engine/deploy/env-metadata.ts:64, :285-290`; `engine/tui/screens/deploy/install.tsx:423` | `registerEnvGroup({ id, label, description, defaultEnabled })`. | PP-14.22 (#940) | Open |
| platform-cli-2 | The deploy checks are a fixed array with no register function. | cli: `engine/deploy/checks/index.ts:21` | `registerDeployCheck(check)` exported from `@marinoscar/platform-cli/deploy`. | PP-14.22 (#940) | Open |
| platform-cli-3 | `registerDeployStep` supports `after` only: no `before`, replace or skip; the step context has no env or answers; built-in command names are reserved. | cli: `engine/deploy/steps/registry.ts`; `engine/program.ts:49` | `before`, `replaces`, `skipWhen` and a read-only redacted `env` and `answers` on the context. | PP-14.22 (#940) | Open |
| platform-cli-4 | The VPS host-proxy vhost hard-codes the three platform SSE locations and puts everything else under `location /` with 60 s timeouts and buffering. An app SSE route works at the inner nginx but is buffered and cut at 60 s at the VPS edge (a production bug). | cli: `engine/deploy/proxy.ts:346-470` (the SSE locations at :418, :440, :459, `location /` at :397, `ProxyTarget` at :62) | `ProxyTarget.streamPaths` and `extraLocations`, filled from `createCli({ proxy: { streamPaths } })` and `registerProxyStreamPath`. | PP-14.22 (#940) | Open |
| platform-cli-5 | The compose mode union and scopes are closed (no `test` overlay scope), and the single-file mount list knows only `nginx.conf` and `csp.conf`. | infra: `compose-order.ts:41, :70`; cli: `engine/deploy/edge-config.ts:42` | `test` scope, `registerComposeMode` (or a documented reason) and `registerEdgeConfigFile(path)`. | PP-14.22 (#940) | Open |
| platform-cli-6 | Built-in TUI screens have no slots. | cli: `tui/` | `registerTuiScreenSection(screenId, Section)` for the node and deploy screens. | PP-14.22 (#940) | Open |
| platform-cli-7 | `GenerateKind` is `base64-32` or `hex-32`, and each env key has one owner with no app annotation of a platform key. | cli: `core/env-spec-registry.ts:32, :140` | `registerEnvGenerator({ kind, generate })` and `annotateEnvKey(key, { fixed?, help? })`. | PP-14.22 (#940) | Open |

### platform-infra

**Verdict:** Mostly open · **Packages:** infra · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.22

**Open points.** App overlay points: `infra/compose/app[.<scope>].<name>.compose.yml`, `infra/nginx/app.d/{http,server,locations}/*.conf`, `app.d/permissions-policy.conf`, `infra/compose/app.env.example`, app-owned collector overlays, `platform-infra sync --check`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| platform-infra-1 | The CSP is one `map $uri $csp_policy` of full strings, so allowing one extra host means copying the whole policy. | infra: `nginx/csp.conf:16` | `app.d/csp/*.conf` include point appended to each policy (a `$csp_extra` pattern) with an `nginx -t` fixture test. | PP-14.22 (#940) | Open |
| platform-infra-2 | There is no infra conformance suite; an app cannot assert that its overlays merge. | infra: `` (none) | `runInfraConformance({ appRoot })`: `docker compose config` over the app overlays (skipped with a reason without Docker) and `nginx -t` over `app.d`. | PP-14.22 (#940) | Open |

### testing (api and web)

**Verdict:** Mostly open · **Packages:** api, web · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.26

**Open points.** `runPlatformConformance` and `conformanceSuites.register` (an app adds a suite with a `declare module` augmentation of `PlatformConformanceSuiteOptions`; the android-app slice is the model), `runPlatformWebConformance`, `webConformanceSuites`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| testing-1 | The web runner's options are skip-only, every suite receives only the settings-shaped context, `register()` silently ignores a duplicate id and the `expect` subset is tiny. | web: `testing/conformance.ts:251, :277` | `suites?: Record<string, Options | { skip }>`; `register` throws on a duplicate; suites receive `(api, context, options)`; widen `expect`. | PP-14.26 (#944) | Open |
| testing-2 | The API testing README says a new suite "registers in `conformance-suites.ts`", which reads as an in-package edit although module augmentation works for an app. | api: `testing/README.md` (Extension-point catalog) | Document `conformanceSuites.register` plus `declare module` augmentation. | PP-14.26 (#944) | Open |

### ai

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 10 (6 fixed, 4 open) · **Stories:** PP-14.3, PP-14.6, PP-14.17, PP-14.24

**Open points.** The adapter contract (`AiProviderAdapter`), `AiProviderRegistry.register`, `registerAiProvider` (the provider definition: its settings, key requirement, endpoint rule, help and SDK packages) with `AiModule.forRoot({ providers })`, `registerAiProviderCard` and the generated provider card on the web, `registerAiFeature`, the `AI_SYSTEM_PRISMA`, `AI_OBJECT_STORE`, `AI_METRICS` and `AI_TARGET_RESOLVER` ports, `describeAiProviderConformance`, `createAiRuntimeHarness({ extraProviders, extraAdapters })` and the seven `ai-*` conformance suites (`ai-no-sdk-leak` with `providerDirs`).

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| ai-1 | A registered adapter under a new id makes every admin AI save fail: `describeForAdmin` lists the registry, the web form sends every listed provider back, and `buildNext` answers `400 AI_UNKNOWN_PROVIDER` for an id without a settings slot. | api: `ai/config/ai-config-admin.service.ts:~294, :336`; web: `ai/ui/AiConfigPage.tsx:264-267` | `configurable: false` on a slotless provider, ignored when submitted as listed; the form does not submit it. | PP-14.3 (#921) | Fixed (PR #949) |
| ai-2 | A provider cannot be enabled from an app: `AiProviderModuleId` and `PROVIDER_MODULES` are closed and `forRoot` throws on any other id. | api: `ai/ai.module.ts:25, :28, :107-108` | `registerAiProvider(AiProviderDefinition)` backed by the pluggable-kind primitive; `AiModule.forRoot({ providers })` defaults to every registered definition. | PP-14.6 (#924) | Fixed |
| ai-3 | The provider ids and the per-id settings keys are fixed in the contract: `AI_PROVIDER_IDS`, and one zod key per id in the stored, patch, response and org schemas. | contract: `ai/constants.ts:34`; `ai/schemas.ts:439, :707, :935, ~:1088` | `aiProviderIdSchema` (a pattern), `BUILTIN_AI_PROVIDER_IDS`, `providers` as a record; descriptors in the admin response. | PP-14.6 (#924) | Fixed |
| ai-4 | The defaults, merge and slot helpers iterate the fixed id list, and `assertProviderEnabled` needs `slot?.enabled`. | api: `ai/ai.system-settings.ts:51, :127, :190-230`; `ai/config/ai-config.service.ts:~311` | Namespace schema, defaults and merge built from the registry (system and org); unknown stored ids dropped with one warning. | PP-14.6 (#924) | Fixed |
| ai-5 | Provider-specific settings are a fixed field list mirrored in the DTO and the web type; the base-URL requirement and the help text switch on provider id in both packages. | api: `ai/config/ai-config.service.ts:81`; `ai/config/ai-config-admin.service.ts:83`; web: `ai/headless/types.ts:290`; `ai/ui/admin/aiProviderForm.ts:51`; `ai/ui/admin/AiProviderCard.tsx:167` | `settingsSchema`, `requiresBaseUrl` and `help` on the provider definition; `registerAiProviderCard(id, Component)` and the generic `PluggableConfigForm` card. | PP-14.6 (#924) | Fixed |
| ai-6 | The runtime harness pins one provider and fixed slots; `ai-no-sdk-leak` forbids an SDK import in the app unless `sdkDirs` or `extraSdkPackages` are passed. | api: `ai/testing/ai-runtime-harness.ts:94, :509-519`; `ai/testing/conformance/ai-no-sdk-leak.suite.ts:92, :110, :299` | `createAiRuntimeHarness({ extraProviders, extraAdapters })`; `sdkPackages` on the definition and a `providerDirs` option. | PP-14.6 (#924) | Fixed |
| ai-7 | `AI_CAPABILITIES`, `AiUsageOperation` and `TRACKED_OPERATIONS` are closed (and mirrored on the web), so diarization, moderation, rerank or OCR need a package edit. | api: `ai/core/capabilities.ts:31`; `ai/runtime/ai-usage.recorder.ts:35`; `ai/runtime/ai.service.ts:~447`; web: `ai/ui/shared/aiCapabilities.ts` | `registerAiCapability`, `registerAiOperation`, a custom-operation port `AiService.forUser(...).run(operationId, input)` through the same gate pipeline. | PP-14.17 (#935) | Open |
| ai-8 | `AiTranscriptionResult` has no speakers or segments, the transcription DTO does not expose `providerOptions`, `feature` is never persisted on `ai_usage_events` or `ai_runs`, the playground modes are a fixed tuple, and there is no pricing seam. | api: `ai/core/types/media.types.ts:325`; web: `ai/ui/playground/aiPlaygroundModes.ts:28` | `extras` on the result, `providerOptions` (bounded), a migration adding `feature`, `registerAiPlaygroundMode`, the `AI_PRICING` port. | PP-14.17 (#935) | Open |
| ai-9 | The documented override of `AI_TARGET_RESOLVER` (a `@Global()` module passed to `AiModule.forRoot({ imports })`) is unproven: `AiModule` does not provide the token, so a global provider should reach `AiService`, but the example test builds a test module holding only the token and hands the resolver to the harness by hand, so DI resolution through the real `AiModule` is never exercised. The epic requires every documented override to be proven with the real package modules. | api: `ai/runtime/target-resolver.ts:17`; `apps/api/test/examples/ai/example-summary.spec.ts:45` | A test that boots the real `AiModule.forRoot` and asserts `AiService` resolves through the app's resolver. | none yet (epic success criterion) | Open |
| ai-10 | `AiWebAdapters` has only `Spinner`; `AiConfigPage`, `AiProviderCard`, `UserAiKeysPage` and `AiModelsPage` take no slots. | web: `ai/headless/adapters.tsx:38` | `ProviderCardExtra`, `Sections`, `TableSlots<Row>` per page. | PP-14.24 (#942) | Open |

### storage

**Verdict:** Mostly open · **Packages:** api, web, contract · **Closed points:** 5 (4 fixed, 1 open) · **Stories:** PP-14.1, PP-14.7, PP-14.24

**Open points.** `registerStorageDriver` (a driver: its settings, secrets, `build`, `testConnection`, optional `provision`, `listKeys` and `purge`; the three S3 drivers register through it) with `describeStorageDriverConformance`, `registerStorageDriverPanel` and the generated driver panel on the web, `StorageModule.forRoot({ provider })` (the object store reaches every package consumer), `STORAGE_PROVIDER`, `ObjectProcessorRegistry`, `registerStorageKeyPrefixes`, `runStoragePurge`, `storageConformanceSuite`. Worked examples: `apps/api/src/platform-extensions/storage/` (the `local-fs` driver and an in-memory provider).

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| storage-1 | The documented rung-3 override ("provide `STORAGE_PROVIDER` in your app module") did not reach any of the 16 package modules that import `StorageProvidersModule`; the only test built a toy module with no package consumers; rows recorded the configured kind even for a custom backend. | api: `storage/providers/storage-providers.module.ts:64-75`; `apps/api/test/storage/storage-extension-points.spec.ts:61-70`; api: `db-backup/db-backup-runner.service.ts:1302` | `StorageModule.forRoot({ provider })` through a global binding module; `StorageProvider.kind` written to rows. | PP-14.1 (#919) | Fixed (PR #947) |
| storage-2 | The provider kind is closed (`s3`, `r2`, `s3compatible`), used as `z.enum` in four schemas plus a literal copy; Azure and GCS need different fields. | contract: `storage/constants.ts:32`; `storage/settings-schemas.ts:89, :139, :189, :225, :263` | `storageDriverIdSchema` (a pattern), `BUILTIN_STORAGE_PROVIDER_KINDS`, settings `provider: string` plus `drivers: Record<id, settings>` with read-compat for the flat fields. | PP-14.7 (#925) | Fixed |
| storage-3 | Per-kind `switch` with a `never` default and a region fallback; the S3 SDK is wired outside the provider (connection test, bucket provisioning, purge, Doctor egress labels). | api: `storage/config/storage-config.ts:316-338, :412`; `storage/config/storage-connection-test.service.ts:196`; `storage/config/storage-bucket-provision.service.ts:334, :461, :764`; `storage/purge/run-storage-purge.ts:202`; `storage/config/doctor/egress/storage.egress.contributor.ts:16` | `StorageDriver` (`build`, `testConnection`, optional `provision` and `listKeys`); the S3 code moves inside the built-in drivers. | PP-14.7 (#925) | Fixed |
| storage-4 | `StorageConfigPage` has hard-coded radios, a provider label record and per-provider blocks, and takes no props. There is no `StorageProvider` contract test for a custom driver. | web: `storage/ui/StorageConfigPage.tsx:140, :665-681, :737-821`; api: `storage/testing/conformance.ts:173-187` | `registerStorageDriverPanel(id, Component)`, the page from descriptors; `describeStorageDriverConformance`. | PP-14.7 (#925) | Fixed |
| storage-5 | `StorageConfigPage` takes no slots. | web: `storage/ui/StorageConfigPage.tsx` | `Sections`. | PP-14.24 (#942) | Open |

**Remaining gaps of the storage driver contract** (PP-14.7 ships it as specified; these are small additions that were found while building it and are not tracked as rows):

- A descriptor carries no flag saying whether a driver implements `provision`, so the page offers **Create bucket** after a failed test that reported no checks and learns the answer from the result.
- A driver's `message` (test and provisioning) is a plain string: no structured remedy, link or severity.
- `secretStatus` of the admin view describes only the active driver's first declared secret; every driver's presence is in `descriptors`.

### identity

**Verdict:** Partly closed · **Packages:** api, web, contract · **Closed points:** 8 (6 fixed, 2 open) · **Stories:** PP-14.9, PP-14.15, PP-14.25

**Open points.** `IdentityModule.forRoot` (and its `signInPolicy` binding), `registerAuthProvider` (`AuthProviderDefinition`: strategy and guard classes or `createStrategy`, async `isEnabled`, `mapProfile`, `egressHosts`, `doctorRemedy`), `AuthService.completeExternalLogin`, `respondToSignIn`, the `IDENTITY_*` ports (including `IDENTITY_SIGNIN_POLICY` and `IDENTITY_AUTH_CREDENTIALS`), `IDENTITY_EVENTS`, the guards and decorators, `identityConformanceSuite`, `describeAuthProviderConformance`, the web `AuthProvider`, `LoginPage` slots (`Logo`, `Title`, `Footer`, `ProviderButton`, `BeforeProviders`, `AfterProviders`) and the packaged pages. Roles and the user and organization pages are not open.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| identity-1 | A sign-in provider cannot be completed from an app: the registry mounts no routes and has no login-completion seam. | api: `identity/auth/providers/auth-provider.registry.ts:11-13, :79` | `ExternalProfile`, `AuthService.completeExternalLogin`, generic routes `/auth/:providerId` and `/auth/:providerId/callback` for every registered redirect provider. | PP-14.9 (#927) | Fixed |
| identity-2 | The only profile-to-session path is `handleGoogleLogin(profile: GoogleProfile)`, hard-coding `provider: 'google'` and `source: 'google'`; a GitHub subject would be stored as a Google identity. | api: `identity/auth/auth.service.ts:150, :173, :206, :470, :565` | `handleGoogleLogin` becomes a wrapper of `completeExternalLogin`; Google registers through the public path; `source` is the provider id. | PP-14.9 (#927) | Fixed |
| identity-3 | The refresh cookie and redirect logic are private to `AuthController`. | api: `identity/auth/auth.controller.ts:48-55, :161-215` | One exported cookie and redirect helper. | PP-14.9 (#927) | Fixed |
| identity-4 | `isEnabled` is synchronous and secrets come only from env/`ConfigService` (strategies take them at construction); `IdentityLoginOutcome`, the Doctor remedy and the egress contributor are Google-only. | api: `identity/ports.ts:228`; `identity/auth/providers/auth-provider.registry.ts:36-41`; `identity/auth/doctor/auth-providers.doctor-check.ts:36`; `identity/auth/doctor/egress/google-auth.egress.contributor.ts:42` | Async `isEnabled` with a credentials resolver (purpose `auth_<id>`), a generic `auth.providers` check, egress hosts from definitions. | PP-14.9 (#927) | Fixed |
| identity-5 | There is no sign-in policy hook (veto, role mapping, domain or org restriction) and no `identity.login.succeeded` or `identity.org.created` event; the allowlist is the only gate. | api: `identity/auth/auth.service.ts:155-166`; `identity/identity.events.ts:40-47` | `IDENTITY_SIGNIN_POLICY` bound by `IdentityModule.forRoot({ signInPolicy })`; the two events. | PP-14.9 (#927) | Fixed |
| identity-6 | The web `login()` always navigates to `/api/auth/<id>`, `AuthCallbackPage` defaults to `google`, and `LoginPage` has no slot around the provider buttons. | web: `identity/headless/auth-context.tsx:199` | `login(providerId)` by descriptor mode; `LoginPage` `BeforeProviders` and `AfterProviders`; the callback provider from the route. | PP-14.9 (#927) | Fixed |
| identity-7 | Org roles are closed in three layers: the contract list feeds `z.enum`s (update-member, create-invite), and the web has its own lists, labels and a `viewer` default. A role registered by an app (for example `coach`) is rejected by the invite and member routes and never shown. The test login accepts three fixed roles. | contract: `identity/constants.ts:106`; `identity/schemas.ts:125, :659, :719`; web: `identity/headless/api.ts:297`; `identity/ui/users/userListColumns.tsx:47`; `identity/ui/users/ManageRolesDialog.tsx:70, :82`; `identity/ui/org/orgLabels.ts:8`; `identity/ui/org/InviteMemberDialog.tsx:33`; api: `identity/testing/dto/test-login.dto.ts:6` | `GET /roles?scope=`, `roleIdSchema` as a pattern, role registry `assignable` and `label`, `ROLE_NOT_ASSIGNABLE`; the web dialogs read the endpoint. | PP-14.15 (#933) | Open |
| identity-8 | `UsersPage`, `UserList`, `OrganizationPage` and `OrgMembersPanel` take no slots; `buildUserColumns()` is exported but called internally; `/auth/me` and `UserListItem` have no enrichment seam. | web: `identity/ui/users/userListColumns.tsx:82` | `TableSlots<UserListItem>`, `registerCurrentUserExtension` and `registerUserListExtension` (optional `extensions` on the wire). | PP-14.25 (#943) | Open |

### email

**Verdict:** Partly closed · **Packages:** api, web, contract · **Closed points:** 5 (4 fixed, 1 open) · **Stories:** PP-14.8, PP-14.24

**Open points.** Template registry and layout theme (`registerEmailTemplate`, `EmailTemplateDataMap`, `EmailLayoutTheme`, `EmailBrandMark`), `configureEmailRendering`, the safe-HTML helpers and `emailConformanceSuite`; the transport (`registerEmailTransport`, `EmailTransportResolver`, `registerEmailTransportPanel`, `describeEmailTransportConformance`).

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| email-1 | There is no transport seam: consumers take the concrete classes, `EmailModule` provides and exports them, so the README recipe ("provide `SmtpEmailProvider` in the app module") never reached `EmailNotificationChannel` or `EmailTestSendService`. The recipe was corrected to say "not supported yet" by PP-14.4 and is replaced here by the working one. | api: `notifications/channels/email-notification.channel.ts:116`; `email/email-test-send.service.ts:169`; `email/email.module.ts:141-142` | `EmailTransport`, `registerEmailTransport` and an `EmailTransportResolver` the two consumers depend on. | PP-14.8 (#926) | Fixed |
| email-2 | The transport kinds (`ses`, `smtp`) are closed in the contract, the settings have fixed `ses*` and `smtp*` fields, and only the `smtp` and `email_ses` credential purposes exist. | contract: `email/constants.ts:14`; `email/schemas.ts:31, :47-75, :244` | Open kind, settings `provider: string` plus `transports: Record<id, settings>` with read-compat; one purpose per transport. | PP-14.8 (#926) | Fixed |
| email-3 | The Doctor check, the egress contributor and the `test-email` template hard-code the two kinds. | api: `email/doctor/email-config.doctor-check.ts:43, :63`; `email/doctor/egress/email.egress.contributor.ts:54, :64`; `email/templates/test-email.email.ts:81` | Labels and egress hosts from the registry. | PP-14.8 (#926) | Fixed |
| email-4 | `EmailSettingsPage` takes no props and hard-codes the transport radios; there is no transport conformance (never throw, redaction, attachments). | web: `email/ui/EmailSettingsPage.tsx:584, :590` | `registerEmailTransportPanel(id, Component)`; `describeEmailTransportConformance`. | PP-14.8 (#926) | Fixed |
| email-5 | `EmailSettingsPage` takes no slots. | web: `email/ui/EmailSettingsPage.tsx` | `Sections`. | PP-14.24 (#942) | Open |

### host

**Verdict:** Partly closed · **Packages:** api, web, contract · **Closed points:** 8 (1 fixed, 7 open) · **Stories:** PP-14.2, PP-14.13, PP-14.24

**Open points.** `PlatformHostCoreModule.forRoot` (including `eventBusAdapter` and `eventBus`), `registerEventBusAdapter` and `describeEventBusConformance`, `AboutModule.forRoot`, `registerPlatformDocs`, the `host` conformance suite. Worked example: `apps/api/src/platform-extensions/host/recording-event-bus.ts`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| host-1 | The event bus was a closed pair (`in-process`, `postgres`) built by a fixed factory in a global module the app cannot override. | api: `host/event-bus/event-bus.interface.ts:103, :110`; `host/event-bus/event-bus.factory.ts`; `host/host-core.module.ts:168-171` | `registerEventBusAdapter`, `PlatformHostCoreModule.forRoot({ eventBus })`, `describeEventBusConformance`. | PP-14.2 (#920) | Fixed (PR #948) |
| host-2 | `/health` hard-codes the database indicator and `HealthController` is fixed, so an extension (a queue, Redis, an AI provider) cannot join readiness. | api: `host/health/health.controller.ts:161, :181-185`; `host/host-core.module.ts:155` | `registerHealthIndicator({ id, critical, check, timeoutMs })`. | PP-14.13 (#931) | Open |
| host-3 | `MaintenanceGuard.isAdminBearer` is hard-wired to the admin role and JWTs (`pat_` and `nod_` bearers are never admin); exemptions exist only as a decorator. | api: `host/maintenance/maintenance.guard.ts:196-216` | `registerMaintenanceBypass({ id, allows })`, evaluated after the built-in admin rule. | PP-14.13 (#931) | Open |
| host-4 | `AboutService.describe()` returns a fixed object and the options carry only `apiVersion`. | api: `host/about/about.options.ts:30` | `registerAboutContributor`; `GET /api/about` gains optional `extras`. | PP-14.13 (#931) | Open |
| host-5 | Deployment modes and capabilities are a closed pair and a `switch`. | api: `host/deployment/deployment-mode.ts:41, :110-117` | `registerDeploymentCapability`, `registerDeploymentMode`; `inAppRestore` stays built in. | PP-14.13 (#931) | Open |
| host-6 | The `host` conformance suite requires exactly one `APP_GUARD`, so an app cannot add a throttler or tenant guard without skipping the whole suite. | api: `host/testing/conformance.ts:157-169` | `allowedAppGuards: Array<{ name, why }>` (an empty `why` throws); `MaintenanceGuard` stays first. | PP-14.13 (#931) | Open |
| host-7 | Host controllers import `Auth` and `Public` from identity and hard-code `system_settings:read` and `write`; `buildCorsOptions` accepts only the env string; the response `meta` is only `{ timestamp }`. | api: `host/maintenance/maintenance.controller.ts:40, :67` | A `permissions` option, `buildCorsOptions(raw, extra)`, `registerResponseMetaContributor`. | PP-14.13 (#931) | Open |
| host-8 | `AboutPage`, `MaintenancePage`, `MaintenanceScreen`, `InstallPrompt` and `MaintenanceBanner` have no slots or copy props. | web: `host/ui/about-page.tsx:572`; `host/ui/maintenance-page.tsx:156`; `host/ui/maintenance-screen.tsx:35` | `Sections`, `logo`, `actions`, `copy`. | PP-14.24 (#942) | Open |

### datatable

**Verdict:** Partly closed · **Packages:** web · **Closed points:** 2 (0 fixed, 2 open) · **Stories:** PP-14.20

**Open points.** `DataTable` and its column, sort, filter and selection parts, `/headless`, `/ui` and `/testing`, `DataTablePreferencesProvider` and `createUserSettingsPreferencesPort`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| datatable-1 | The filter types and operators are closed unions and records, and `FilterEditor` branches on the type; a column cannot plug its own editor (user picker, tag picker, date presets). | web: `datatable/headless/types.ts:31, :67`; `datatable/headless/filter/operators.ts:45`; `datatable/ui/filter/FilterEditor.tsx:224-315` | `DataTableColumn.filter`, `registerDataTableFilterType({ type, operators, Editor, matches })`; built-ins through it. | PP-14.20 (#938) | Open |
| datatable-2 | The stored layout is fixed, so saved filters and views cannot persist; there are no toolbar or bulk-bar slots. | web: `datatable/headless/layout/layoutModel.ts:97-111` | `DataTableStoredLayout.extra` (bounded JSON) and `savedViews`; `Toolbar` and `BulkBar` slots. | PP-14.20 (#938) | Open |

### db-backup

**Verdict:** Partly closed · **Packages:** api, web, contract · **Closed points:** 4 (0 fixed, 4 open) · **Stories:** PP-14.12, PP-14.23

**Open points.** `DbBackupModule.forRoot`, `registerRestoreCarryOver`, the `DB_BACKUP_*` ports, `DbBackupPage` and `DbBackupWebAdaptersProvider`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| db-backup-1 | Every backup service injects the single `STORAGE_PROVIDER`; `databaseBackup.storageProvider` must equal the active provider, and there is no second or offsite target. | api: `db-backup/db-backup-runner.service.ts:699`; `db-backup/db-backup-admin.service.ts:271`; `db-backup/db-backup-retention.service.ts:159` | `DB_BACKUP_TARGET` (streaming, never buffered) bound by `DbBackupModule.forRoot({ target })`, `mirrorTargets`. | PP-14.12 (#930) | Open |
| db-backup-2 | The schedule frequency is `daily`, `weekly` or `monthly`, and retention is a count only. | contract: `db-backup/constants.ts:231`; `db-backup/settings-schemas.ts:85`; api: `db-backup/schedule.util.ts` | `frequency: 'cron'` (minimum one hour) and `retention: { count?, maxAgeDays? }` with read-compat. | PP-14.12 (#930) | Open |
| db-backup-3 | The restore pre-flight gates are a closed id list and a hard-coded array; there is no backup or restore completion event. | contract: `db-backup/constants.ts:197`; api: `db-backup/restore-preflight.service.ts:566` | `registerRestoreGate` (read-only); `db_backup.run.completed` and `db_backup.restore.completed`. | PP-14.12 (#930) | Open |
| db-backup-4 | `DbBackupPage()` takes no props or slots. | web: `db-backup/ui/DbBackupPage.tsx:189` | `PageSlotsBase` and `RunRowActions`. | PP-14.23 (#941) | Open |

### android-app

**Verdict:** Partly closed · **Packages:** api, web, cli, contract · **Closed points:** 1 (0 fixed, 1 open) · **Stories:** PP-14.24

**Open points.** `AndroidAppModule.forRoot`, `registerAndroidDeviceSource`, `registerAndroidAppNotificationChannel`, the CLI `android` group and deploy step, `captureTwaLaunch`, `AndroidUpdateBanner`.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| android-app-1 | `AndroidAppPage` takes no props, and its `TrustedAppsSection`, `ReleasesSection` and `NotificationsSection` are private. | web: `android-app/ui/AndroidAppPage.tsx:424-451` | `Sections`; export the three sections from `android-app/ui`. | PP-14.24 (#942) | Open |

### testing (CLI runner)

**Verdict:** Closed · **Packages:** cli · **Closed points:** 1 (0 fixed, 1 open) · **Stories:** PP-14.22

**Open points.** None: the runner is hard-coded to one suite.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| testing-cli-1 | The CLI conformance runner is hard-coded to one suite, and `cli: false` opts out without a reason. | cli: `engine/conformance.ts:93, :139, :146` | `cliConformanceSuites.register(...)` mirroring the API, `{ skip: 'reason' }` required (an empty reason or `false` throws), suites receive options. | PP-14.22 (#940) | Open |

### docs (cross-cutting)

**Verdict:** Documentation · **Packages:** docs · **Closed points:** 2 (2 fixed, 0 open) · **Stories:** PP-14.4

**Open points.** Every slice README carries an extension-point catalog; the specs carry the ladder.

| # | Closed point | Evidence | Proposed fix | Story | Status |
|---|---|---|---|---|---|
| docs-1 | The spec labelled "The Extension Contract" PROPOSED although the packages implement it, and the specs and READMEs carried recipes that do not work: the email transport recipe, the storage spec's rung-3 bullet, the "never a platform change" claim for AI providers, and illustrative calls that do not exist (`registerJobHandler`, `registerDoctorCheck`, `registerAdminSection`, `registerSettingsNamespace`). | `docs/specs/platform-packages.md`; api: `email/README.md:105`; `docs/specs/storage-providers.md:277-282`; api: `ai/README.md` (Adding a provider) | Corrected to say what works and what is not supported yet. | PP-14.4 (#922) | Fixed |
| docs-2 | No single guide for someone extending a slice; no record of what is still closed. | (none) | `docs/EXTENDING.md` and this page. | PP-14.4 (#922) | Fixed |

## Keeping this page current

- A story that opens a closed point changes the row's Status from Open to Fixed in the same pull request, and adds the pull request to the Stories table.
- A new closed point found later gets a row under its slice with the story that will open it, or a new story if none fits. A point that is closed on purpose (a security vocabulary such as `AUTH_ERROR_CODES`) is listed with the reason and, once PP-14.28 lands, in `packages/closed-lists.allowlist.json`.
- A story that adds an extension point also replaces its "Coming in" placeholder in [EXTENDING.md](EXTENDING.md) and adds the catalog row to the slice README (`npm run check:package-docs`).
- Evidence is the audit's, as of `bb700916`; do not rewrite it to the current line. Fixed rows keep it as the record of what was closed.

## See also

- [EXTENDING.md](EXTENDING.md): the extension author guide and the recipes.
- [specs/platform-packages.md](specs/platform-packages.md#the-extension-contract): the ladder and the guardrails.
- [SLICES.md](SLICES.md): what each slice gives you and needs.
- [PACKAGES.md](PACKAGES.md): the documentation standard (README outline, extension-point catalog).

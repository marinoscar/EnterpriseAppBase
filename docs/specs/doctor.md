# Admin Doctor

> **Status:** shipped · **Code:** `@marinoscar/platform-api/doctor` (`packages/platform-api/src/doctor/`: contract, registry, service, controller factory), bound by `apps/api/src/doctor/doctor.config.ts`; checks under `apps/api/src/<module>/doctor/`; page `@marinoscar/platform-web/doctor/ui` (`packages/platform-web/src/doctor/`), bound by `apps/web/src/pages/Admin/DoctorPage.tsx`; wire schemas `@marinoscar/platform-contract/doctor` (`packages/platform-contract/src/doctor/`) · **API:** `GET /api/admin/doctor`, `GET /api/admin/doctor/support-bundle` (see `/api/docs`, tag `Doctor`) · **Admin UI:** `/admin/settings/doctor` · **Runbook:** [doctor.md](../runbooks/doctor.md) · **Recipe:** [§4](#4-extending-it-in-a-fork)

The Doctor answers one question for an administrator: is every capability of this deployment configured, reachable and healthy? It runs a set of small, read-only checks, one per fact worth knowing, that each capability's own module contributes, and returns one report. Each row carries a status, a one-line detail and, when something needs attention, a remedy and the settings page that fixes it.

## 1. Purpose

**What it is.** A diagnostic for the running deployment. It covers the database, authentication, maintenance mode, object storage, email, Web Push, AI, the job queue, worker nodes, database backups and telemetry capture.

**What it is not.**

- Not a liveness or readiness probe. `/api/health/*` stays public, cheap and always reachable; see [§6](#6-design-decisions).
- Not an exerciser. It never sends an email or a push, writes an object, calls a model or enqueues a job. The explicit "Test" buttons on each settings page remain the way to prove a capability end to end ([§2.2](#22-the-read-only-rule)).
- Not a monitor. It runs when an administrator asks; nothing polls it, schedules it or alerts from it.
- Not the host-level doctor. `appctl deploy doctor` asks "is this server ready to install?" before anything is deployed. The Doctor asks "is the running deployment healthy?" ([§2.9](#29-relation-to-appctl-deploy-doctor)).

**Where it lives.** Since #696 the Doctor is the first packaged slice of the platform: the framework is `@marinoscar/platform-api/doctor` and `@marinoscar/platform-web/doctor/{headless,ui}` ([API slice README](../../packages/platform-api/src/doctor/README.md), [web slice README](../../packages/platform-web/src/doctor/README.md)), and the app keeps only its binding (`apps/api/src/doctor/doctor.config.ts`, `apps/web/src/pages/Admin/DoctorPage.tsx`) and its checks. The wire shapes (the report, row, status and query schemas, their types and the status constants) live in `@marinoscar/platform-contract/doctor` ([contract slice README](../../packages/platform-contract/src/doctor/README.md), #701): the API's DTOs are `createZodDto()` over those schemas and the web client imports their types, so the two halves cannot drift. The packaged controller reaches the app's auth through the platform host ports ([core README](../../packages/platform-api/src/core/README.md#host-ports)). Nothing in this spec changed in behaviour.

**The problem it solves.** After a fork is deployed, the things that go wrong are spread over a dozen settings pages and several environment variables: a missing `SECRETS_ENCRYPTION_KEY`, a bucket the key cannot read, SMTP switched off, a worker that is not running, a telemetry collector that stopped exporting. The Doctor lists all of them in one place, in an order that hides consequences behind their causes.

## 2. How it works

### 2.1 The check contract

The contract lives in `@marinoscar/platform-api/doctor` (`packages/platform-api/src/doctor/doctor-check.interface.ts`). A check is an `@Injectable()` with these members:

| Member | Meaning |
|---|---|
| `id` | Stable, dotted, unique across the application (`storage.bucket`). |
| `category` | `core`, `auth`, `maintenance`, `storage`, `email`, `push`, `ai`, `jobs`, `nodes`, `backup`, `telemetry`, or any new string a fork adds. |
| `label` | Short human label shown in the page. |
| `settingsPath` | Optional web route that fixes the problem (`/admin/settings/storage`). |
| `timeoutMs` | Optional per-check ceiling; the default is 5000 ms ([§2.4](#24-the-service)). |
| `dependsOn` | Optional ids of checks that must not `fail` or `skip` for this one to run. |
| `run()` | Returns `{ status, detail, remedy?, error?, data? }`. Read-only. |

**Statuses.** The four values are identical to the CLI doctor's `CheckStatus`.

| Status | Meaning | Rank |
|---|---|---|
| `pass` | Verified healthy. | 0 |
| `skip` | Not evaluated (see below). Needs no remedy. | 1 |
| `warn` | Works, but needs attention. | 2 |
| `fail` | Broken. | 3 |

The order is `pass` < `skip` < `warn` < `fail`. The report's `verdict` is the worst status present; an empty report has verdict `skip`, so a run in which nothing ran never reads as `pass`.

**`skip` has exactly two causes.**

1. A check listed in `dependsOn` did not pass (it ended `fail` or `skip`). The service decides this and never calls `run()`.
2. The capability is intentionally off: AI switched off, telemetry collection off. That is an operator's choice, so it is neither `warn` (nothing to fix) nor `pass` (nothing was proven).

**Field rules.**

- `detail` is one line: what was found ("Connected in 12 ms"). The service flattens newlines and cuts it at 500 characters.
- `remedy` is expected on `warn` and `fail`, and names a settings page, a command or an environment variable. When a check omits it, the service supplies `Open <settingsPath> to review.` (or `See the API logs for details.` when there is no `settingsPath`), so a problem never appears without a next step. Each check's own spec asserts it supplies a real one.
- `error` carries the underlying error message when a probe failed.
- `data` holds small scalar facts (counts, versions, latencies).
- **A check never throws.** A crashed probe is a `fail` carrying the error's message. The service also guards every call (a throw becomes a `fail`, a hang becomes a `fail` after `timeoutMs`), but a check that catches its own failure reports a better `detail`.

### 2.2 The read-only rule

A Doctor run must be safe against a production deployment at any time, by anyone holding `system_settings:read`, as often as they like. A check:

- reads, and only reads: a `SELECT`, a `HEAD`, a settings read, `pg_dump --version`;
- writes no object, row or audit event, enqueues no job and calls no model;
- never calls the side-effecting "Test" services. These write probe objects, spend model tokens, send mail and pushes, or audit the attempt:

| Service | Why a check must not call it |
|---|---|
| `StorageConnectionTestService` | Round-trips a probe object and audits the attempt. |
| `AiProviderTestService` | Calls a provider model and spends tokens. |
| `EmailTestSendService` | Sends an email. |
| `PushTestService` | Sends a push notification. |
| `TelemetryConnectionTestService` | Audits the attempt. |

A check may reuse the test services' pure helpers where they exist. `push.vapid` calls `isValidVapidPublicKey`, `isValidVapidSubject` and `privateKeyDerivesPublicKey` from `push-test.service.ts` but never the send.

**No secret material in a result.** Not in `detail`, not in `error`, not in `data`. A check that reads a secret to validate it (the VAPID private key) reports only the verdict. Lengths, counts and "is set" booleans are fine; values, hints and fingerprints are not. `jwt-secret` reports the secret's length and never its value; `telemetry.export` strips userinfo and the query string from the OTLP endpoint before showing it.

### 2.3 The registry

`DoctorCheckRegistry` (`packages/platform-api/src/doctor/doctor-check.registry.ts`) is the one place that knows which checks run. It has `register`, `get` and `list` (registration order). It is built on the generic registry primitive ([`@marinoscar/platform-api/core`](../../packages/platform-api/src/core/registry/README.md)) as an instance registry, and freezes in `onApplicationBootstrap`, so a check that registers after every `onModuleInit` has run fails with `FROZEN`.

**Explicit self-registration.** Each check lives in its owning feature module under `<module>/doctor/`, injects the registry and calls `this.registry.register(this)` from its own `onModuleInit`. This is the mechanism and the rationale of `apps/api/src/jobs/job-handler.registry.ts`: "why does the Doctor run this check?" has a grep-able answer (one `register(this)` line), and a check nobody wired up is a missing line in a diff rather than a decorator scan that silently matched nothing. Every `onModuleInit` has run before the first HTTP request, so the Doctor never races a registration.

**Duplicate ids throw.** Where the job registry overwrites, this one fails at boot with both class names. A job `type` is a persisted contract a fork may legitimately shadow; a check id only names a line in a report, so two checks claiming one id is always a copy-paste mistake.

**`DoctorModule.forRoot()` is global and imports nothing of the app.** A feature module contributes a check by listing it in `providers`, without importing the Doctor's module. Every edge stays one-way: features know the registry, the Doctor knows no feature. The app mounts it once: `doctorModule = DoctorModule.forRoot({ host: platformHost })` in `apps/api/src/doctor/doctor.config.ts`, imported by `AppModule`. `forRoot` creates the controller with the host's access decorators (the app's own `@Auth()`), keeping the class name `DoctorController` and the handler `getReport`, so the OpenAPI operation `doctor_getReport` is unchanged; without a `host` it throws, so the route is never public.

### 2.4 The service

`DoctorService.run({ category?, refresh? })` (`packages/platform-api/src/doctor/doctor.service.ts`) owns everything a check should not have to.

**Dependency waves, without a barrier.** Every check whose dependencies have settled starts at once; a dependent starts the moment its last dependency settles. A slow telemetry probe never delays an unrelated storage one.

| Situation | Result |
|---|---|
| A dependency ended `fail` or `skip` | The check is `skip` with detail `Skipped: <dependency label> did not pass`, and `run()` is never called. |
| A dependency ended `warn` or `pass` | The check runs. |
| A `dependsOn` id is not registered | `skip`, detail names the missing id. |
| A check sits on a `dependsOn` cycle | `fail` with a remedy naming the cycle, instead of a hang. Checks outside the cycle that depend on a member are `skip`. |

**Timeouts.** The default ceiling is `DOCTOR_DEFAULT_TIMEOUT_MS` (5000 ms). A check overrides it with `timeoutMs` when its probe legitimately takes longer. A timeout is a `fail` with detail `Timed out after <n>ms` and a remedy. The probe is abandoned, not cancelled, so a probe that can hang must carry its own client-side bound.

| Check | `timeoutMs` | Why |
|---|---|---|
| `backup.pg-client` | 12000 | `pg_dump --version` gets its own 10 s before it counts as hung. |
| `telemetry.tables` | 12000 | A ping plus two reads, each bounded at 5 s by the status service. |
| `telemetry.reachable` | 7000 | The 5 s ping bound plus 2 s. |
| `telemetry.freshness` | 7000 | The 5 s statement bound plus 2 s. |

Because a dependent waits for its dependencies, the worst-case latency of a run is the sum of the timeouts along the longest chain: 36 s for the telemetry chain (`export`, `connection`, `reachable`, `tables`, `freshness`). Checks off that chain finish sooner.

**Normalisation.** An outcome with an unknown status becomes a `fail` with detail `The check returned an invalid outcome.` A `warn` or `fail` without a remedy gets the fallback from [§2.1](#21-the-check-contract). `data` is `null` when empty.

**Caching.** The report is cached in memory for `DOCTOR_CACHE_TTL_MS` (15 s), per `category` filter (the unfiltered report is its own key).

- The cache stores the in-flight promise, so concurrent callers share one run, and two administrators opening the page together do not double the probes.
- `refresh=true` bypasses the cache and replaces the entry with the new run.
- A cached report keeps its original `generatedAt`.
- Expired entries are dropped on every run, so arbitrary `category` values cannot grow the map. A run that itself rejects is evicted at once.
- The cache is per API process. Behind several API instances, each has its own.

**Category filter.** `category=<x>` reports only the checks in that category. A check's dependencies in other categories are still evaluated (so a filtered row reads `skip` for the right reason) but are not reported. A category nothing registered returns `checks: []` with verdict `skip`. A malformed category (not `^[a-z0-9][a-z0-9_-]{0,63}$`) is a `400`.

**Order.** Rows are sorted by category (in the order of `categoryOrder`, by default `PLATFORM_DOCTOR_CATEGORIES`; any other category after them), then by registration order.

**Report shape.** `{ verdict, generatedAt, durationMs, checks[] }`. Each row is `{ id, category, label, settingsPath, status, detail, remedy, error, data, durationMs }`. Every nullable field is present as `null` rather than absent. The schemas are `doctorReportSchema`, `doctorCheckReportSchema`, `doctorStatusSchema` and `doctorQuerySchema` in `@marinoscar/platform-contract/doctor`; the OpenAPI document is generated from them. `durationMs` is `0` for a check skipped without running. The body arrives in the usual `{ data, meta }` envelope ([API.md](../API.md#response-envelope)).

**Always `200`.** A failing check is a row, not an error status. The report is read precisely when something is wrong, and a `500` or `503` would withhold the list of what.

### 2.5 Why it is not a queue job

CLAUDE.md requires every long-running activity to be a queue job. The Doctor is a bounded read in the same way as the telemetry dashboard ([telemetry.md §11.6](telemetry.md#116-bounds-caching-and-why-this-is-not-a-queue-job)):

- every probe is bounded by a per-check timeout, and every statement a check issues is a single read;
- nothing outlives the HTTP request that started it: no `@Cron`, no `@OnEvent`, no detached promise;
- the result is a 15-second in-memory cache, not a stored record.

An administrator who opens the page is waiting for the answer, and a queued job would only add a place for the answer to get lost. The one caveat is the abandoned probe after a timeout ([§2.4](#24-the-service)).

### 2.6 Access and maintenance mode

The route is gated on `system_settings:read` and mounted under `admin/`, so it is outside the `nod_` allowlist by construction. No `doctor:read` permission exists; see [§6](#6-design-decisions).

**It is not `@AllowDuringMaintenance()`.** `GET /api/admin/about` is reachable during a window because it reads a file and answers a database liveness probe. The Doctor performs network I/O against object storage and GreptimeDB, and a window (above all the restore swap) is exactly when those dependencies may be mid-change. So while a window is open:

- with `allowAdmins: true` (the default), an Admin session JWT passes and the Doctor works. `maintenance.mode` reports the open window as a `warn`;
- with `allowAdmins: false`, every caller gets the maintenance `503`, and the web page shows its request-error alert. Close the window first ([maintenance runbook](../runbooks/maintenance-mode.md));
- a `pat_` token never passes a window, so scripted use during maintenance needs a session.

### 2.7 Check inventory

This is the single home for the list of checks. Twenty-six checks ship. `dependsOn` and the rules below are taken from the code; "no settings page" means the check has no `settingsPath` (the service's fallback remedy then names the API logs).

#### core

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `db.connection` | Database connection | none | The database answers `SELECT 1`, through `DatabaseHealthIndicator`, the same definition the readiness probe and About use. | pass: connected (latency in `data`). warn: round trip over 500 ms. fail: no answer. |
| `db.migrations` | Database migrations | `db.connection` | One `SELECT` on `_prisma_migrations`: no migration is half-applied. | pass: at least one applied, none unfinished or rolled back. fail: a migration started and never finished (names the first), a rolled-back migration never re-applied, none applied at all, or the table unreadable. |
| `secrets.encryption-key` | Secrets encryption key | none | `SECRETS_ENCRYPTION_KEY` is present and a valid 32-byte key, via the assertion bootstrap uses. | pass: valid. fail: missing or malformed (the error describes the key's shape, never its bytes). |
| `core.event-bus` | Event bus | none | Which event bus this process uses and whether it is connected, from `EventBus.health()`, an in-memory snapshot: no I/O, no probe message. | pass: `postgres` with its `LISTEN` session connected, or `in-process` with a recognised value (detail: single-process delivery; set `EVENT_BUS_ADAPTER=postgres` before running more than one API replica). warn: `postgres` disconnected (remedy names the transaction-mode pooler caveat and `POSTGRES_*`; last error in `error`), or an unrecognised `EVENT_BUS_ADAPTER`. Never `fail`. |
| `core.deployment-mode` | Deployment mode | none | The `DEPLOYMENT_MODE` this process parsed at startup, and the backup policy through `SystemSettingsService.getDatabaseBackupPolicy()` (memory plus one settings read). Settings page `/admin/settings/db-backup`. `data`: `mode`, `inAppRestore`, `inAppBackups`. | pass: self-hosted ("in-app backup and restore available"), or saas with in-app backups on ("in-app restore disabled; rely on provider PITR"). warn: saas with in-app backups off, or the policy unreadable (confirm provider backups/PITR). Never `fail`: an invalid value never boots. |

#### auth

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `auth.jwt-secret` | JWT signing secret | none | `JWT_SECRET` is a real value. | pass: set and at least 32 characters (length in `data`). warn: shorter than 32. fail: unset or the publicly known fallback value. |
| `auth.providers` | Sign-in providers | none | At least one sign-in provider is enabled, from the list the sign-in page renders. | pass: names the providers. fail: none enabled. |
| `auth.initial-admin` | Administrator access | `db.connection` | Somebody can administer the deployment. Settings page `/admin/settings/users`. | pass: at least one active Admin and `INITIAL_ADMIN_EMAIL` set. warn: active admins but `INITIAL_ADMIN_EMAIL` unset. fail: no active user holds the Admin role. |
| `auth.principal-cache` | JWT principal cache | none | How fast a role change or deactivation reaches every replica, from `PrincipalCache.stats()` and `EventBus.health()`, two in-memory snapshots: no I/O, no probe message. `data`: `ttlSeconds`, `size`, `hits`, `misses`, `invalidations`, `adapter`. | pass: enabled on a connected `postgres` bus. warn: enabled on the `in-process` bus (with more than one replica, invalidations do not cross; remedy `EVENT_BUS_ADAPTER=postgres`), or the `postgres` listener is disconnected (changes from other replicas wait for the TTL; last error in `error`). skip: `AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0`. Never `fail`. |
| `tenancy.mode` | Tenancy mode | `db.connection` | The database agrees with `TENANCY_MODE` (parsed at startup): three counts (default organizations, all organizations, active users without the membership the mode expects: an active default-organization membership in `single`, any active membership in `multi`). Settings page `/admin/settings/users`. `data`: `mode`, `organizations`, `usersWithoutMembership`. | fail: no default organization (migration or seed not run), or `single` with more than one organization (remedy: `TENANCY_MODE=multi` or consolidate). warn: `single` and active users without a default-organization membership (they self-heal at their next sign-in). pass: otherwise; in `multi`, users with no organization are reported, not graded (they are refused at sign-in by design). |

#### maintenance

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `maintenance.mode` | Maintenance mode | none | The deployment is in service, resolved fresh across the three layers. Settings page `/admin/settings/maintenance`. | pass: off. warn: a window is open (detail names which layer holds it; the remedy differs for the environment layer), or off but the saved setting could not be read. Never `fail`. |

#### storage

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `storage.config` | Object storage configuration | none | The active storage configuration is complete (fresh resolve). Settings page `/admin/settings/storage`. | pass: provider, bucket and region (never the credential). fail: fields missing (names them), or the configuration cannot be read (usually a wrong `SECRETS_ENCRYPTION_KEY`). |
| `storage.bucket` | Object storage reachability | `storage.config` | One `HeadObject` on the key `.doctor/read-only-probe-never-written`, which nothing ever writes. | pass: the store answered (latency in `data`). fail, each with its own remedy: endpoint unreachable, credential rejected, bucket missing, region mismatch, credential may not read the bucket, any other store error. |

**Known weakness of `storage.bucket`.** `StorageProvider.exists()` turns a `NotFound` answer into `false`, and the check treats any answer that is not an error as a pass. A `HeadObject` on a missing key answers a bodyless `404` whether or not the bucket exists, so the AWS SDK cannot name the cause. A pass therefore means "the store answered without refusing us", not "uploads will work". Missing-bucket detection fires only when the store returns a body that names `NoSuchBucket`. Every failure remedy points at the settings page's "Test connection", which round-trips a real probe object, for a full diagnosis.

#### email

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `email.config` | Email delivery | none | The email settings are complete, read from the admin view. Never sends. Settings page `/admin/settings/email`. | pass: SMTP or SES complete and switched on. warn: no provider chosen (notifications are in-app only), or configured but switched off. fail: the stored row does not validate, or fields missing (from address, SMTP host, an SMTP username with no stored password, SES region, an SES key id with no stored secret). |

#### push

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `push.vapid` | Web Push keys | none | The active VAPID configuration can sign a send: the public key is a valid P-256 point, the private key derives it, the subject is a `mailto:` or `https://` URL. Never sends. Settings page `/admin/settings/push`. | pass: valid pair and subject. warn: Web Push not configured or switched off. fail: any of the three problems (detail lists them, never a key). |

#### ai

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `ai.enabled` | AI platform | none | Whether the AI platform is switched on (fresh resolve). Settings page `/admin/settings/ai`. | pass: on. skip: off (intentional). Never `warn` or `fail`. |
| `ai.providers` | AI providers and keys | `ai.enabled` | Every enabled provider can serve a call, from key status only, with no model call. | pass: at least one enabled provider and no problem; detail says whether each uses an org key, users' own keys or needs none. fail: AI on but no provider enabled, an enabled provider with no adapter in this build, or no org key while the key policy is `byok_with_org_fallback`. A missing org key under plain `byok` is expected and passes. |

#### jobs

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `jobs.worker` | Background job worker | none | This process's worker configuration, through the shared `parseWorkerMode` and `resolveWorkerConcurrency` parsers. Settings page `/admin/settings/jobs`. | pass: mode `all` or `system` with at least one slot. warn: unrecognised `JOBS_WORKER_MODE` (falls back to `all`), mode `off` (jobs queue until another executor claims them), or concurrency of zero or less. Never `fail`. |
| `jobs.backlog` | Job queue backlog | `db.connection` | The queue is draining, using the stats and the reaper's own stuck predicate plus two reads. | pass: counts of pending, running and failed in the last 24 h. warn: jobs running past the stuck threshold with no live lease, or the oldest due pending job has waited over 15 minutes. Never `fail`. |

#### nodes

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `nodes.fleet` | Worker node fleet | `db.connection` | Every enrolled, non-disabled node is heartbeating, from the admin view's derived health. Settings page `/admin/settings/workers`. | pass: no nodes enrolled (the API runs every job itself) or every active node healthy. warn: a stale or offline active node (detail names up to five). A disabled node is excluded from the verdict. Never `fail`. |

#### backup

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `backup.schedule` | Database backups | `db.connection` | Backups are scheduled and recently succeeded, from the config and the latest runs. Settings page `/admin/settings/db-backup`. | pass: enabled and the last success is at most 48 h old. fail: the latest terminal run failed or went stale (error carried, cut at 300 characters). warn: schedule off, enabled but never completed, or last success over 48 h old. |
| `backup.pg-client` | PostgreSQL client (`pg_dump`) | none | This process's `pg_dump` can dump the server: runs `pg_dump --version` and reads `server_version_num`. Timeout 12 s. | pass: client can dump the server. warn: `pg_dump` not found or silent (backups cannot run on this API; a worker node may do them). fail: client older than the server, or older than the pinned major (17). Remedies link [the client-version runbook](../runbooks/postgres-client-version.md). |

#### telemetry

The five checks form one chain: `export`, `connection`, `reachable`, `tables`, `freshness`.

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `telemetry.export` | Telemetry export | none | The three switches that must all be on for this process to export: the `telemetry.enabled` setting, `OTEL_ENABLED`, and the runtime export gate. | skip: collection off (intentional, and the rest of the chain skips with it). fail: collection on but `OTEL_ENABLED` is not `true`. warn: the export gate is closed (no usable GreptimeDB connection yet). pass: exporting (endpoint shown without credentials). |
| `telemetry.connection` | GreptimeDB connection | `telemetry.export` | A reader connection is configured, from the in-memory snapshot. No network. | pass: `host:port/database (source)`. fail: no reader connection configured. |
| `telemetry.reachable` | GreptimeDB reachability | `telemetry.connection` | GreptimeDB answers `SELECT version()` as the reader, through `GreptimeClient.ping()`. Timeout 7 s. | pass: latency and version. fail: no answer. |
| `telemetry.tables` | Telemetry tables and retention | `telemetry.reachable` | Both the traces and logs tables exist, and a retention (TTL) is set. Timeout 12 s. | pass: both present with a finite TTL. fail: store unreadable, or a table missing (tables are created by the first export). warn: no TTL, or one that never expires. |
| `telemetry.freshness` | Telemetry data freshness | `telemetry.tables` | Data is actually arriving, from the dashboard's `lastDataSql` over the reader path (7-day lookback). Settings page `/admin/settings/telemetry/dashboard`. Timeout 7 s. | pass: both the newest trace and the newest log are within the threshold. warn: either side older than the threshold, or absent for 7 days. fail: neither arrived in 7 days. |

**`telemetry.freshness` uses the dashboard's threshold.** Its limit is `DASHBOARD_VERDICT_THRESHOLDS.noDataMinutes` (5 minutes), the same constant behind the dashboard's "no data" banner, so the two cannot disagree. It reads through `GreptimeClient.queryReader` rather than `TelemetryDashboardService.summary` because the summary writes a `telemetry:dashboard` audit row per read, which would break [§2.2](#22-the-read-only-rule).

#### network

| Id | Label | `dependsOn` | What it verifies | Rules |
|---|---|---|---|---|
| `network.egress` | Outbound dependencies (air-gap readiness) | none | The deployment's outbound dependencies, from every `EgressContributor` registered with `EgressRegistry` (#773): Google sign-in, AI providers, the AI catalog refresh, AI realtime voice, Web Push, email, object storage, GreptimeDB and the API docs CDN. Configuration only: no DNS lookup, no connection. Each host is classified `public`, `private` or `unknown` by shape alone. `data`: `network`, `enabled`, `public`, `private`, `unknown`, `required_public`, `public_ids` (comma-joined, at most 500 characters). The check lives in the package (`NetworkEgressDoctorCheck`) and the app contributes it from `DeploymentModule`. | `DEPLOYMENT_NETWORK=online` (default): always pass, an inventory ("N outbound dependencies enabled (P public, Q private): ..."). `air-gapped`: pass when every enabled dependency is private; warn when only optional ones are public (remedy names [the air-gapped runbook](../runbooks/air-gapped.md)); fail when a required one is public, such as Google as the only sign-in provider (remedy names the runbook section). `unknown` grades as public. A contributor that throws is one `unknown` entry under its id. Never `skip`. |

### 2.8 The web page

`/admin/settings/doctor` is a registry card and nothing else, per the [Settings UI Pattern](settings-ui.md): the last card of the Observability group in `ADMIN_SECTIONS`, built from the packaged descriptor (`{ ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }`), permission `system_settings:read`, and a route in `App.tsx` wrapped in `RequirePermission` with the same string. The page itself is `DoctorPage` from `@marinoscar/platform-web/doctor/ui`; it checks no permission and imports no app code, reading the app through the platform host (`apps/web/src/platform/platformHost.tsx`). The app's `apps/web/src/pages/Admin/DoctorPage.tsx` is the binding: the `system_settings:read` redirect, then the packaged page. Status colours come from the theme's `palette.status` tokens. It carries no `feature`, deliberately: it reports on AI and telemetry while they are off (as `skip`), which is when an administrator asks why a capability is missing.

| Part | Behaviour |
|---|---|
| Load | `useDoctor` runs `GET /api/admin/doctor` on mount; the answer may come from the 15 s cache. |
| **Run again** | Calls with `refresh=true`. The previous report stays on screen while it runs, and the button shows progress. |
| Verdict | One alert: "All checks passed", "No problems found; some checks were skipped", or "N problems need attention". |
| Counts | Chips for pass, warning, fail and skipped. |
| Problems only | A switch that filters each category to its `warn` and `fail` rows. |
| Categories | One accordion per category in `PLATFORM_DOCTOR_CATEGORY_LABELS` order (or the page's `categories` prop), with the worst status icon and "n/m passed". A category is expanded by default when it holds a `warn` or `fail`; manual toggles reset on **Run again**. A fork's category renders after the shipped ones, title-cased. |
| Rows | `CheckRow` shows the status icon, label, status chip, duration, detail, the remedy as its own sentence, the `error` verbatim in a wrapping `<pre>`, and an **Open settings** link to `settingsPath`. |

**A failing check is not a page error.** The endpoint answers `200` with a `fail` verdict and that renders as the verdict alert and the rows. The page-level error alert, with a **Retry** button, is reserved for a request that actually failed (`403`, network, a maintenance `503`). The `category` filter exists in the client (`createDoctorClient`) but the page always requests every category.

### 2.9 Relation to `appctl deploy doctor`

The contract deliberately mirrors the CLI's pre-install doctor (`apps/cli/src/deploy/checks/types.ts`): the same four statuses, the same one-line `detail`, the same `remedy`, the same read-only rule and the same "never throws". An operator who has read one report can read the other.

| | `appctl deploy doctor` | Admin Doctor |
|---|---|---|
| Question | Is this **server** ready to install? | Is the **running deployment** healthy? |
| Runs | On the VPS, before and around install and update | Inside the API, on demand |
| Sees | Docker, Compose, git, node, disk, memory, ports, DNS, the proxy | Database, settings, credentials, queue, nodes, backups, telemetry |
| Needs | A shell on the host | `system_settings:read` in the web app or over HTTP |
| Extra | `required` vs `recommended` decides its exit code | No exit code; the verdict is a field |

They are counterparts, not duplicates. The CLI cannot see settings stored in the database, and the API cannot see the host. When the Doctor shows the API or its dependencies as unreachable, run `appctl deploy doctor` on the server.

### 2.10 Support bundle

`GET /api/admin/doctor/support-bundle` (issue #772) returns ONE JSON file an operator attaches to a support ticket, instead of pasting fragments of the Doctor, About and telemetry pages. The file is the deployment's configuration and health, never its data: the Doctor's no-secret rule extended to a downloadable artefact that combines several sources.

**Shape.** The envelope is `supportBundleSchema` in `@marinoscar/platform-contract/doctor`:

```json
{
  "bundleVersion": 1,
  "generatedAt": "2026-10-06T09:08:07.654Z",
  "redaction": { "rules": "v1", "replacements": 4 },
  "sections": {
    "meta":      { "status": "ok", "data": { "platformPackages": { "@marinoscar/platform-api": "0.1.0" }, "sections": ["meta", "doctor", "versions", "telemetry"] } },
    "doctor":    { "status": "ok", "data": { "verdict": "warn", "checks": [] } },
    "versions":  { "status": "ok", "data": { "api": { "version": "1.4.0", "deploymentMode": "self-hosted" } } },
    "telemetry": { "status": "omitted", "reason": "requires the telemetry:query permission" }
  }
}
```

Each section is `ok` (collected; `truncated: true` with `data: null` when a size cap dropped it), `omitted` (a section permission is missing or the capability is off, with a `reason`) or `error` (it threw, timed out or broke its schema; one redacted line, the data dropped). The rest of the bundle is always intact.

**Sections.** A section is a registry entry (`SupportBundleRegistry`, `@marinoscar/platform-api/doctor`) with an id, a label, an optional extra permission, a STRICT zod schema and a read-only `collect()`, registered from `onModuleInit` exactly like a check ([§2.3](#23-the-registry); duplicate ids throw).

| Section | Registered by | Holds | Deliberately excludes |
|---|---|---|---|
| `meta` | the package (`DoctorModule.forRoot`) | installed `@marinoscar/platform-*` versions, the section ids | the caller's id and email |
| `doctor` | the package | the full report, from the 15 s cache (`run({ refresh: false })`) | nothing more: checks already obey rule 4 ([§2.1](#21-the-check-contract)) |
| `versions` | the app's About module (`apps/api/src/about/about-support-bundle.section.ts`) | `api.{version,deploymentMode}`, `app.{name,version,commitSha,ref}`, `deployedBy`, `lastCommand`, `installedAt`, `updatedAt`, `deployInfoStatus`, `remote.{commitsBehind,checkedAt}`, `runtime.{nodeVersion,environment,processStartedAt}`, `database.status`, `host.{os,kernel,arch,cpus,memoryBytes,dockerVersion,composeVersion}`, `proxy.mode`, `history` as `{ count, last: { at, command, commitSha, cliVersion, durationMs } }` | `host.hostname`, `domain`, `deployInfoPath`, `deployInfoError` (it may echo file content), `databaseError`, `proxy.container`, `bindPort`, `run` |
| `egress` | the package | `network` (`DEPLOYMENT_NETWORK`, `online` unbound), each outbound dependency's id, capability, direction, enabled, hostnames, scope, required, degradation, settings path, count | URLs, schemes, userinfo, ports, paths, query strings (contributors keep hostnames only) |
| `telemetry` | the app's telemetry module (`packages/platform-api/src/telemetry/telemetry-support-bundle.section.ts`); needs `telemetry:query` | status (configured, reachable, store version, TTL days, retention, table names and row counts, error), stack (agent state, each container's state and health), the 24-hour dashboard summary's verdict level and reasons and its fixed and runtime tiles (`key`, `label`, `value`, `previous`, `unit`), the metric group ids | `sql`, `sparkline`, `unknownRoutes` (its top routes are request paths), the database name, `agentError`, the last deploy's output, every raw log, span, trace and explorer row |

`telemetry` is `omitted` when no store is configured or telemetry is switched off. Its summary read is audited by the dashboard as `telemetry:dashboard`, exactly as when an administrator opens the dashboard, and comes from the dashboard's 15 s result cache. The built-in `egress` section is the outbound-dependency inventory of #773 (`describeEgress` over `EgressRegistry`, the same read `network.egress` grades): the declared `network` and, per dependency, its id, capability, direction, enabled, hostnames, scope, required flag, degradation line, settings path and count. Contributors already reduce endpoints to hostnames, and the section's strict schema has no field for a URL.

**Redaction, rules v1** (`packages/platform-api/src/doctor/support-bundle/redact.ts`, pure, table-tested). It runs over every section AFTER its schema, as a second line of defence; every replacement is counted in `redaction.replacements`.

- **Key-based.** A property whose name matches `/pass(word)?|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential|fingerprint|hint|dsn|connection[_-]?string/i` has its non-null value replaced by `"[redacted]"`.
- **Value-based**, in every string and every property name, in this order: PEM blocks → `[pem]`; `Bearer <token>` (a token holding a non-letter) → `Bearer [redacted]`; JWTs → `[jwt]`; URL userinfo → `scheme://[redacted]@host`; URL query strings (with a scheme, or a path starting `/`) → `?[redacted]`; `pat_…` and `nod_…` tokens → `[token]`; AWS access key ids (`AKIA…`, `ASIA…`) → `[aws-key]`; email addresses → `[email]`; IPv6 (validated, so times and `a::b` survive) and IPv4 literals → `[ip]`; runs of 32+ base64/hex characters → `[redacted]` (hex with dashes counts, so a UUID user id is redacted; runs made only of words, such as URL paths and `snake_case` names, survive).
- **Path allowlist.** A value that is exactly a 40-hex commit SHA survives only at `sections.versions.data.app.commitSha` and `sections.versions.data.history.last.commitSha` (`COMMIT_SHA_ALLOWED_PATHS`); anywhere else it is redacted. An explicit path list, not a relaxed pattern.

Over-redaction is the accepted failure: a supporter can ask for a value; a leaked key cannot be recalled.

**Bounds, and why it is not a queue job.** The work is bounded and finishes inside the request, like the telemetry export ("in memory, and bounded"): sections run in parallel, each cut off after its `timeoutMs` (default 10 s, `supportBundle.sectionTimeoutMs`); the doctor section reads the 15 s report cache, so a download never multiplies probes; the telemetry summary reads the dashboard's 15 s result cache; and the file is capped at 512 KiB per section and 2 MiB in all (pretty-printed JSON; the largest sections are truncated first). A build therefore takes at most the longest section timeout. A fork that registers a slow section is bounded by that section's timeout. Nothing is stored: no object, no row beyond the audit event.

**Access.** The same `system_settings:read` as the report (no new permission: the content is the deployment's configuration and health, which that permission covers); a section may require one more and is `omitted` for a caller without it. Not `@AllowDuringMaintenance()`, like the report ([§2.6](#26-access-and-maintenance-mode)). The response is the file itself (not the `{ data }` envelope): `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="support-bundle-<APP_SLUG>-<yyyyMMdd'T'HHmmss'Z'>.json"`, `Cache-Control: no-store`.

**Audit.** One `support_bundle:download` event per download, written through the host's `AUDIT_SINK` after the body is built: `targetType: 'deployment'`, `targetId: 'support_bundle'`, `meta: { sections: 'meta=ok,doctor=ok,versions=ok,telemetry=omitted', bytes, replacements }`. The actor is the event's `actorUserId`; no email. A failed audit write is logged, not fatal.

**Web.** The Doctor page's header has a **Download support bundle** button next to **Run again**, with the helper text "Includes the doctor report, versions and a 24-hour telemetry summary. Secrets and personal data are removed." It is visible to anyone who can see the page. `useSupportBundleDownload` (`@marinoscar/platform-web/doctor/headless`) fetches the file through the host transport's `getBlob` and saves it under the server's filename. No card, route or tab is added (Settings UI Pattern): the action lives on the existing Doctor destination.

## 3. Configuration and permissions

The Doctor has no settings, no environment variables and no database tables. The constants are in code: the 5000 ms default timeout and the 15 s cache TTL (the defaults of `DoctorModule.forRoot`'s `defaultTimeoutMs` and `cacheTtlMs`, which the reference app does not override), the thresholds inside each check (`DB_SLOW_LATENCY_MS`, `BACKUP_MAX_AGE_HOURS`, `JOBS_OLDEST_PENDING_WARN_MINUTES`, `JWT_MIN_SECRET_LENGTH`).

**Permission:** `system_settings:read`, the exact string the packaged controller enforces (`DEFAULT_DOCTOR_PERMISSION`; `doctor.config.ts` passes no `permission`) and the `Doctor` card declares. The role matrix is in [ARCHITECTURE.md](../ARCHITECTURE.md#72-permission-matrix).

| Route | Purpose | Permission |
|---|---|---|
| `GET /api/admin/doctor` | Run every check (or one `category`) and return the report | `system_settings:read` |
| `GET /api/admin/doctor/support-bundle` | Download the redacted support bundle ([§2.10](#210-support-bundle)) | `system_settings:read` (the `telemetry` section also needs `telemetry:query`) |

| Query | Type | Effect |
|---|---|---|
| `category` | lowercase identifier | Report only that category; an unknown one returns an empty report |
| `refresh` | `true` or `false` | `true` bypasses the 15 s cache |

An unauthenticated caller gets `401`; Contributor and Viewer get `403`. The per-field response reference is the generated OpenAPI.

## 4. Extending it in a fork

**Add a check.** A check belongs to the module that owns the capability. Four steps:

1. Create `apps/api/src/<module>/doctor/<thing>.doctor-check.ts`. Put the judgement in a pure `decide…` function and keep `run()` to reads.
2. Choose an `id` (dotted, unique; a duplicate throws at boot), a `category` (a shipped one, or a new string for a capability of your own), a `settingsPath` if a page fixes it, and `dependsOn` for anything that makes the check meaningless when it fails.
3. Add the class to the owning module's `providers`. Do not import the Doctor's module; `DoctorModule.forRoot()` is global.
4. Write the spec next to it ([§5](#5-guardrails)).

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';

import { DoctorCheck, DoctorCheckOutcome, DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { ReportsService } from '../reports.service';

export const REPORTS_SETTINGS_PATH = '/admin/settings/reports';

/** Pure: judges the facts. Reports counts, never content. */
export function decideReportQuota(usage: { used: number; limit: number }): DoctorCheckOutcome {
  const data = { used: usage.used, limit: usage.limit };

  if (usage.used >= usage.limit) {
    return {
      status: 'fail',
      detail: `Report quota exhausted (${usage.used} of ${usage.limit})`,
      remedy: `Raise the quota at ${REPORTS_SETTINGS_PATH}, or purge old reports.`,
      data,
    };
  }

  if (usage.used >= usage.limit * 0.9) {
    return {
      status: 'warn',
      detail: `Report quota at ${usage.used} of ${usage.limit}`,
      remedy: `Raise the quota at ${REPORTS_SETTINGS_PATH} before it runs out.`,
      data,
    };
  }

  return { status: 'pass', detail: `${usage.used} of ${usage.limit} reports used`, data };
}

/** `reports` / `reports.quota` — the report quota has headroom. */
@Injectable()
export class ReportQuotaDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'reports.quota';
  readonly category = 'reports';
  readonly label = 'Report quota';
  readonly settingsPath = REPORTS_SETTINGS_PATH;
  readonly dependsOn = ['db.connection'];

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly reports: ReportsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideReportQuota(await this.reports.usage());
  }
}
```

**Rules to hold to.**

- Read only ([§2.2](#22-the-read-only-rule)). If the only way to prove the capability is to use it, the check verifies the configuration and its remedy points at the page's Test button.
- Use `skip`, not `warn`, for a capability the operator turned off, and say so in `detail`.
- Reuse the feature's own definition of "healthy" (an indicator, a resolver, a parser) rather than copying it, so the Doctor cannot disagree with the feature.
- Catch your own failures and return a `fail` with a real `detail`. Declare `timeoutMs` if a probe can legitimately exceed 5 s, and give the probe its own client-side bound.
- Never put a key, password, token or hint in `detail`, `error` or `data`.

**Add an outbound dependency (`EgressRegistry`).** When a capability of yours reaches a host outside the deployment, describe it so `network.egress` (and an air-gapped install) can see it. The contributor is an `@Injectable()` in the owning module, next to its checks:

1. Create `apps/api/src/<module>/doctor/egress/<thing>.egress.contributor.ts` implementing `EgressContributor` (`id`, `describe()`), injecting `EgressRegistry` and calling `register(this)` from `onModuleInit`. Ids are unique; a duplicate throws at boot.
2. Return entries built with `egressDependency({ id, capability, direction, enabled, required, hosts, degradation, settingsPath?, count? })`. Pass the configured URL or `host:port`; the helper reduces it to a hostname (no scheme, userinfo, port, path or query), de-duplicates, caps at 20 and computes `scope`.
3. `describe()` is held to [§2.2](#22-the-read-only-rule) and to "no secret material": settings and configuration reads only, through the masked admin views (never an accessor that decrypts a key), and no network I/O. Set `required` only when the deployment cannot do its core job without the host.
4. Add the class to the owning module's `providers`, add its id to [the air-gapped runbook](../runbooks/air-gapped.md), and write a spec. The reference app's example is `apps/api/src/openapi/docs-egress.contributor.ts`.

**Add a category.** Use a new string as `category`. It sorts after the shipped ones and the web page renders it title-cased. To give it a position, pass `categoryOrder` to `DoctorModule.forRoot()` in `apps/api/src/doctor/doctor.config.ts` (the API sort order, e.g. `[...PLATFORM_DOCTOR_CATEGORIES, 'reports']`); to give it a display name, render the packaged page with a `categories` list in `apps/web/src/pages/Admin/DoctorPage.tsx` (e.g. `[...PLATFORM_DOCTOR_CATEGORY_LABELS, { key: 'reports', label: 'Reports' }]`). No package file is edited.

**Add a web surface.** None is needed: the page renders whatever the API returns.

**Add a support-bundle section.** A section belongs to the module that owns the facts, like a check ([§2.10](#210-support-bundle)). The reference example is `apps/api/src/about/about-support-bundle.section.ts`.

1. Create `apps/api/src/<module>/<module>-support-bundle.section.ts`: an `@Injectable()` implementing `SupportBundleSection` and `OnModuleInit`, which injects `SupportBundleRegistry` and calls `this.registry.register(this)`.
2. Give it a lowercase `id` (unique; a duplicate throws at boot), a `label`, and a STRICT schema: `.strict()` on every object, so a field nobody chose fails the section closed instead of leaking.
3. In `collect()`, COPY the fields you mean to send into a new object; never spread a service's response. Return `omitSupportBundleSection('<why>')` when the capability is off.
4. Declare `permission` when the facts need more than `system_settings:read` (telemetry declares `telemetry:query`), and `timeoutMs` if it can legitimately exceed 10 s.
5. Read only, like a check: no writes, jobs, model calls or "test" services. Aggregates and counts, never rows.
6. Add the class to the module's `providers`, and a spec that parses `collect()`'s output with the schema and asserts what is excluded.

```ts
@Injectable()
export class ReportsSupportBundleSection implements SupportBundleSection<ReportsSectionData>, OnModuleInit {
  readonly id = 'reports';
  readonly label = 'Reports';
  readonly schema = z.object({ quotaUsed: z.number().int(), quotaLimit: z.number().int() }).strict();

  constructor(private readonly registry: SupportBundleRegistry, private readonly reports: ReportsService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async collect(): Promise<ReportsSectionData> {
    const usage = await this.reports.usage();
    return { quotaUsed: usage.used, quotaLimit: usage.limit };
  }
}
```

The central redaction pass still runs over your section, but it is the second line of defence: your schema is the first.

## 5. Guardrails

| Invariant | Test |
|---|---|
| Duplicate ids throw; registration order; `list()` returns a copy; frozen after bootstrap | `packages/platform-api/test/doctor/doctor-check.registry.spec.ts` |
| Parallel start, dependency waves, `skip` on a failed or skipped dependency (transitively), `warn` does not block, unknown dependency, cycles, timeouts, throws become `fail`, remedy fallback, one-line detail, invalid status, verdict, category order, category filter, unknown category | `packages/platform-api/test/doctor/doctor.service.spec.ts` |
| Cache: TTL, refresh replaces the entry, keyed by category, one shared in-flight run | `packages/platform-api/test/doctor/doctor.service.spec.ts` (`cache`) |
| `forRoot` without a host (or with an empty access port) throws; permission, path, category order, timeout and TTL options honoured; controller named `DoctorController` with `getReport`; 401/403/200 and 400 through the test host; duplicate id message at boot; OpenAPI tag and generated text | `packages/platform-api/test/doctor/doctor.module.spec.ts` |
| Permission is exactly `system_settings:read` with no `doctor:read`; `401`, `403` for Viewer and Contributor; admin gets the `{ data, meta }` envelope; every row has the full shape and every `warn`/`fail` a remedy; category filter; `400` on a malformed `category` or `refresh`; the JWT secret and the encryption key never appear in the response; the live report parses with the contract schemas made strict (no undeclared field), and the route accepts exactly the queries `doctorQuerySchema` accepts | `apps/api/test/doctor/doctor.integration.spec.ts` |
| The contract schemas accept today's report, reject a row missing a nullable field, parse `refresh` by value; CommonJS and ESM halves export the same names; `constants.ts` imports no zod | `packages/platform-contract/test/doctor.test.ts`, `dual-format.test.ts`, `no-zod-in-constants.test.ts` |
| Each check: its verdict table, a real remedy on every `warn`/`fail`, that it depends on what it says, that `run()` reads through the intended service (and, where it matters, does not send or audit), that it registers itself, and that no secret is echoed | `apps/api/src/<module>/doctor/*.doctor-check*.spec.ts` (auth, core, maintenance, storage, email, push, ai, jobs, nodes, backup, telemetry) |
| Card is the last Observability card, carries exactly `system_settings:read` (the package's `DEFAULT_DOCTOR_PERMISSION`, not overridden by `doctor.config.ts`), no `feature` and no `alwaysShow`, is visible while AI and telemetry are off, hidden from a Viewer, and resolves its own title | `apps/web/src/__tests__/config/settingsRegistry.test.ts` |
| Every packaged page the app uses has exactly one card (built from its descriptor) and one route, gated on the permission the packaged controller enforces | `apps/web/src/__tests__/config/platformPages.test.ts` |
| App wiring: title matches its card, loading skeleton, request error with retry, mixed report, all-pass, Problems only, Run again sends `refresh=true` (msw through the real transport and host adapter), phone width, redirect without `system_settings:read`, category labels | `apps/web/src/__tests__/pages/Admin/DoctorPage.test.tsx` |
| Packaged page: loading skeleton, request error and retry, mixed report ordering, Problems only, `refresh=true`, unknown category title-cased, custom categories, `slots.Header` and `sx`, the host's time formatter, `palette.status` tokens | `packages/platform-web/test/doctor/doctor-page.test.tsx` |
| Support bundle, package: redaction rules v1 table (positive and negative per rule, the commit-SHA path allowlist), registry (duplicate and invalid ids, frozen), service (parallel sections, permission omission, throw, timeout with abort, strict-schema failure, 512 KiB and 2 MiB caps, central redaction count, section ids never treated as keys, audit row, failed audit), route through `forRoot` (401/403/200, headers, contract parse, `supportBundle: false`, OpenAPI), built-in sections | `packages/platform-api/test/doctor/support-bundle/*.spec.ts` |
| Support bundle, app: exact permission, 401/403/200, attachment headers and filename, `supportBundleSchema` parse, every app section, the versions allowlist, telemetry omitted (no `telemetry:query`, no store, switched off) and present (24-hour verdict and tiles, no `sql`), one audit row without email, under 15 s | `apps/api/test/doctor/support-bundle.integration.spec.ts` |
| Support bundle secret egress: JWT secret, encryption key, VAPID private key, SMTP password, AI org key, a user BYOK key, GreptimeDB reader and admin passwords, storage secret key, a PAT, a node token, an email, a user id and an IP (via a leaky check) never appear in the file, its headers or the audit row, raw, base64, base64url or hex | `apps/api/test/doctor/support-bundle-secret-egress.integration.spec.ts` |
| Support bundle, web: `filenameFromContentDisposition`, the hook (request, filename, 403, missing `getBlob`), the button and the page; the app transport's `getBlob` and the download through msw | `packages/platform-web/test/doctor/support-bundle.test.tsx`, `apps/web/src/__tests__/platform/platformHost.test.tsx`, `apps/web/src/__tests__/pages/Admin/DoctorPage.test.tsx` |
| Hook and client: loads on mount without refresh, a failing verdict is data rather than an error, `403` message, network fallback message, `rerun` sends `refresh=true` and clears a previous error, explicit client, moved path | `packages/platform-web/test/doctor/headless.test.tsx` |
| Egress inventory: host classification table (no DNS), `egressDependency` reduces to hostnames and caps hosts, `EgressRegistry` duplicates throw and freeze, `gradeEgress` table (online inventory, air-gapped pass/warn/fail, `unknown` as public), a throwing contributor becomes one `unknown` entry, scalars only in `data`, the check is the app's to contribute | `packages/platform-api/test/doctor/egress/*.spec.ts` |
| `network.egress` through the real app: one row for `category=network`, the three air-gapped scenarios, no seeded secret, URL path, query or userinfo on the wire or in the full inventory, no network I/O with `fetch`, `dns.lookup` and `net.connect` stubbed to throw, every module contributor registered | `apps/api/test/doctor/network-egress.integration.spec.ts`; each contributor's spec under `apps/api/src/<module>/doctor/egress/` |

The read-only rule has no single tripwire suite that scans every check for calls to the test services. It is held by each check's spec (which asserts what `run()` reads) and by review; a new check's spec is where a reviewer looks for it.

## 6. Design decisions

- **Explicit self-registration, not discovery.** A decorator scan hides "why does this run?" and lets a check that was never wired up look identical to one that does not exist. One `register(this)` line is grep-able and shows up in a diff ([§2.3](#23-the-registry)).
- **Duplicate ids throw instead of overwriting.** The job registry lets a fork shadow a persisted `type`. A check id is only a line in a report, so a collision is always a mistake, and overwriting would silently hide the check its author thought they had added.
- **`skip` is its own status.** Folding "AI is off" into `pass` claims something was verified; folding it into `warn` makes a healthy deployment read amber forever. `skip` ranks between the two, so an all-skip report is not green and a report with only intentional skips is not amber.
- **`system_settings:read`, not a new permission.** The report describes configuration, which is the blast radius `system_settings:read` already covers, and every check is read-only, so there is no new capability to grant. A `doctor:read` would protect nothing more and would need a migration, a seed row and a role decision in every fork. `system_settings:write` is not required: running the Doctor changes nothing.
- **Admin-only, not part of `/api/health`.** Health endpoints are public and reachable during maintenance, so orchestrators and load balancers can use them. The Doctor exposes configuration (bucket and endpoint names, admin counts, hosts) and performs network I/O against every dependency, which is neither safe to expose nor cheap enough to answer a probe. Keeping them apart also means a slow storage endpoint can never make the readiness probe fail.
- **Not reachable during maintenance unless admins are allowed.** It probes dependencies a window is usually changing. Reachable-by-default would put network I/O behind the one route set that is meant to stay minimal. The default `allowAdmins: true` already lets an administrator in ([§2.6](#26-access-and-maintenance-mode)).
- **Read-only, with weaker storage and AI verdicts as the price.** Proving uploads work means writing an object; proving a provider works means spending tokens. Those are the Test buttons' jobs. The Doctor says "configured, and the store answered" and sends the operator to the full test, which is why `storage.bucket` has a documented blind spot ([§2.7](#27-check-inventory)).
- **Always `200`.** A `503` from a diagnostic withholds the list of what is wrong, exactly when it is wanted.
- **In-process cache, not a stored report.** Fifteen seconds is long enough that a polling page or two administrators do not multiply the probes, and short enough that "Run again" is rarely needed. A stored report would be stale by the time anyone read it.
- **Dependencies skip rather than cascade failures.** "Bucket unreachable" beneath "storage not configured" is noise and would only time out. `skip` names the cause in its detail and keeps the real problem at the top.
- **The support bundle is a bounded request, not a queue job** ([§2.10](#210-support-bundle)). Rejected: a job writing the bundle to object storage, which adds retention and access questions and fails on air-gapped installs with no storage configured.
- **The support bundle carries aggregates, never raw telemetry.** Rejected: a zip with raw logs and the last N traces (log bodies, routes with ids and user agents are personal data). A supporter who needs rows asks the operator for a Telemetry Explorer export, which is audited per query.
- **Redaction by key AND by value.** Doctor `detail` and verdict reasons are free text, so key names alone would miss an address or an IP in a sentence. Rejected: key-only redaction.
- **No `support:read` permission.** The bundle is the deployment's configuration and health, which `system_settings:read` covers; telemetry keeps its own `telemetry:query` gate per section.
- **The stack agent is not a Doctor check.** The stack agent only powers the "Deploy / redeploy telemetry services" button; telemetry capture never calls it. A check on it reported a stopped agent as a telemetry `warn` on a VPS where capture was healthy, which misleads the operator. The agent's state is shown where it matters, on the Telemetry settings page ([telemetry spec §10](telemetry.md#the-admin-deploy-flow)). Rejected: keeping the check as informational only (the report has no such status).

## 7. Verification

```bash
npm run build:packages
npm run test:run -w @marinoscar/platform-api -- doctor
npm run test:run -w @marinoscar/platform-web -- doctor
npm test --workspace=api -- doctor
npm run test:run --workspace=web -- Doctor
npm run typecheck --workspace=api
npm run typecheck --workspace=web
```

By hand, with the app running and signed in as an Admin:

1. Open `/admin/settings` and choose **Doctor** (Observability group). The page loads and shows a verdict.
2. Set `JOBS_WORKER_MODE=off` for the `api` container and restart it. **Run again** shows `jobs.worker` as `warn` with its remedy. Restore the value afterwards.
3. Switch AI off at `/admin/settings/ai`. **Run again** shows `ai.enabled` as `skip` and `ai.providers` as `skip` (`Skipped: AI platform did not pass`), and the AI category is not amber.
4. With a bearer token: `curl -H "Authorization: Bearer $TOKEN" "http://localhost:3535/api/admin/doctor?category=core&refresh=true"` returns only `core` rows.
5. A second call within 15 s without `refresh` returns the same `generatedAt`.
6. As a Viewer, the same call answers `403`.
7. Click **Download support bundle**. A file `support-bundle-<slug>-<timestamp>.json` downloads; it parses as JSON, `redaction.rules` is `v1`, and searching it for your email or the server's hostname finds nothing.

## History

- #634 added the admin Doctor: the check contract, registry, service and `GET /api/admin/doctor`, the checks in each owning module, and the `/admin/settings/doctor` page and card.
- #644 removed the `telemetry.stack` check, because the stack agent is not part of telemetry capture, and surfaced the agent's error on the Telemetry settings page instead.
- PP-1.11 (#682) added `core.event-bus`.
- #685 added `core.deployment-mode` (platform-packages PP-1.14).
- PP-1.12 (#683) added `auth.principal-cache`.
- #772 (platform-packages PP-13.1) added the support bundle: `GET /api/admin/doctor/support-bundle`, `SupportBundleRegistry` with the built-in `meta`, `doctor` and `egress` sections and the app's `versions` and `telemetry` sections, redaction rules v1, the `support_bundle:download` audit event, and the **Download support bundle** button.
- #696 (platform-packages PP-2.7) moved the framework into `@marinoscar/platform-api/doctor` and `@marinoscar/platform-web/doctor/{headless,ui}`, defined the host ports every packaged slice reuses, and left the app its binding (`doctor.config.ts`, the page binding) and its checks. `DOCTOR_CATEGORIES` became `PLATFORM_DOCTOR_CATEGORIES` (alias kept); a category is added with `categoryOrder` / `categories` instead of editing a list. No behaviour, route, permission or OpenAPI change.
- PP-13.2 (#773) added `network.egress`, the egress inventory (`EgressRegistry`, `EgressContributor`, `classifyHost`) and `DEPLOYMENT_NETWORK`; `network` joined `PLATFORM_DOCTOR_CATEGORIES`.
- #701 (platform-packages PP-3.4) moved the schemas and wire types into `@marinoscar/platform-contract/doctor`, the first contract slice: the API's DTOs wrap them, the web types come from them, and the hand-written web mirrors are gone. Both packages re-export the old names. The OpenAPI document is byte-identical and the web bundle carries no zod.
- PP-6.2 (#722) added `tenancy.mode` (the `auth` category, registered by `OrganizationsModule`).

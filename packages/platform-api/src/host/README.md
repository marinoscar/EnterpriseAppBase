# @marinoscar/platform-api/host

The API host core (issue #867): the plumbing every other slice assumes is around it, packaged so an app mounts it with one `PlatformHostCoreModule.forRoot()` instead of copying it. It was the reference app's own code (`apps/api/src/common/{event-bus,otel,maintenance,interceptors,middleware}/` and `apps/api/src/openapi/`) until #867. NestJS, CommonJS. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `nodes` and `db-backup` of this package (`packages/platform-slices.json`; the last two only for the metric declarations the platform's `AppMetricsService` records into). It sits at the top of the graph on purpose: the app mounts it, while slices keep reaching the bus and the metrics through their own ports (`JOBS_EVENT_BUS`, `IDENTITY_METRICS`, ...), which the app binds to what this slice provides.

## Purpose and scope

`PlatformHostCoreModule.forRoot()` is one global module that provides:

- **The event bus** (PP-1.11, #682). `EVENT_BUS`, one per process: `in-process` (the default) or `postgres` (`pg_notify` to publish, one dedicated `LISTEN` session to receive), chosen by `EVENT_BUS_ADAPTER`; an unrecognised value falls back to `in-process` with one warning. Local delivery in a microtask, remote delivery at most once with no replay, no echo, isolated handler failures, a `publish` that never rejects, JSON copies, a 7,500-byte envelope limit, and never a secret on the bus. The `core.event-bus` Doctor check reports the adapter and the listener.
- **The platform's app metrics** (#600, #680). `AppMetricsService`: the typed recorders the slices' metric ports bind to (jobs, backups, sign-in, AI, notifications), the generic `add`/`record` an app emits its own registered metrics through, and the database-backed gauges (queue depth, oldest pending job, last backup), only when `OTEL_ENABLED` installed the SDK. `registerPlatformHostAppMetrics()` declares the platform's 31 `app.*` metrics and the event bus's three in the app-metric registry of `otel-core`.
- **Maintenance mode** (#257). `MaintenanceModeService` (environment override, then in-memory override, then the persisted `maintenance` namespace; audited through core's `AUDIT_SINK`), `GET`/`PUT /api/admin/maintenance` (`system_settings:read`/`system_settings:write`), the `maintenance.mode` Doctor check, the namespace declaration `MAINTENANCE_SYSTEM_SETTINGS` with its schemas (registered by `forRoot()` through the settings slice's `ensureSystemSettingsNamespaces` unless the app's manifest did), and `MaintenanceGuard` as the application's **only** `APP_GUARD`. There is no global JWT guard: a route without `@Auth()` is public.
- **The deployment facts and the generic Doctor checks** (#685, #773, #879). `DeploymentModeService` (`DEPLOYMENT_MODE`, `self-hosted` or `saas`, parsed once and refused when invalid; `verifyDeploymentModeAtStartup` is the bootstrap call), `DeploymentNetworkService` (`DEPLOYMENT_NETWORK`, bound as the doctor slice's `DEPLOYMENT_NETWORK_SOURCE`), and six Doctor checks registered in this order: `core.deployment-mode`, `db.connection`, `db.migrations`, `secrets.encryption-key`, `db.rls_role` (`core` category) and `network.egress`. The database checks read through core's `PLATFORM_PRISMA` host port (`SELECT 1`, `_prisma_migrations`, `pg_roles` and `pg_class`; none needs the bypass client) and report `skip` when it is unbound. Both services read the raw string the app publishes as `deployment.mode` / `deployment.network` in its configuration, else the environment variable.
- **About** (#401, packaged by #891). `AboutModule.forRoot({ apiVersion })`, a separate module (so the app places it where `/api/admin/about` belongs in the OpenAPI document): `GET /api/admin/about` (`system_settings:read`, readable during a maintenance window, always `200`) reports the API version (the app's `apiVersion` resolver), the deployment mode, the deploy document `appctl deploy` leaves on disk (`readDeployInfo`, read fresh per request, never cached) and a database liveness fact (one timed `SELECT 1` through `PLATFORM_PRISMA`; a failure is a field, never a status). It also registers the `versions` support-bundle section.
- **The health probes** (#901). `GET /api/health` (every dependency through Terminus), `/api/health/live` (the process is not hung; stays `200` during a maintenance window) and `/api/health/ready` (`503` with the maintenance marker while a window is open, checked before the database probe, then a timed `SELECT 1` through `PLATFORM_PRISMA` in `DatabaseHealthIndicator`). Public, `@AllowDuringMaintenance()`, tagged `Health`; moved from the reference app with the route, the responses and the OpenAPI document unchanged.
- **The HTTP layer.** The `{ data, meta }` response envelope (`TransformInterceptor`, which leaves an `@Sse()` stream and a body that already has `data` alone), the request log line (`LoggingInterceptor`), core's `HttpExceptionFilter`, and request ids (`RequestIdMiddleware`: the incoming `x-request-id` or a UUID, echoed with `x-trace-id`), and the CORS policy builder `buildCorsOptions(process.env.CORS_ORIGIN)` / `isSameOriginOnly` (#517, packaged by #901): `CORS_ORIGIN` unset gives no CORS headers (same-origin), a comma-separated list gives exactly those origins with credentials, a wildcard or a malformed origin throws at bootstrap. The app passes the result to `app.enableCors`.
- **The OpenAPI document and `/api/docs`** (#53), bootstrap-time because they need the built application: `createOpenApiDocument(app, openApi)` (Nest's introspection, nestjs-zod's clean-up, then the passes: generated **Requires:** lines from `@Auth()`, the PAT scheme on every authenticated operation, the `{ data }` envelope, the shared error response, `x-tagGroups` from core's tag registry, OpenAPI 3.1 nullables) and `registerPlatformDocs(app, openApi)`, which mounts `/api/openapi.json` and the Scalar page at `/api/docs` on Fastify, outside Nest's router (so outside the maintenance guard), and degrades both to a 503 if generation throws.

Not here: the validation pipe (the app registers nestjs-zod's `ZodValidationPipe` as `APP_PIPE`), the app's OpenAPI tag taxonomy (registered into core's `openApiTags`), the app's own egress declarations (the reference app keeps `DocsEgressContributor`, the catalog example of `EgressRegistry.register`), the logger (Pino), the app's `app.enableCors(...)` call, and the web app's maintenance screen (the web slice `@marinoscar/platform-web/host` owns the pages).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { PlatformHostCoreModule, registerPlatformDocs, EVENT_BUS, AppMetricsService } from '@marinoscar/platform-api/host';
```

The package's peers (`@nestjs/*`, `@nestjs/jwt`, `@nestjs/swagger`, `nestjs-zod`, `zod`, `@opentelemetry/api`, `rxjs`, `@nestjs/terminus` for the health probes) and `fastify` for the docs routes and the request types. `pg` (the Postgres listener) is a dependency of the package.

## Quick start

The reference app's binding ([`host-core.config.ts`](../../../../apps/api/src/platform/host-core.config.ts)), imported once in `AppModule`, and the docs routes in [`main.ts`](../../../../apps/api/src/main.ts):

```ts
// src/platform/host-core.config.ts: the app's metric manifest first, then the module
import '../common/otel/app-metric.manifest';
export const hostCoreModule = PlatformHostCoreModule.forRoot();

// src/main.ts, after setGlobalPrefix('api') and before listen()
const docsReady = registerPlatformDocs(app, { appName: APP_NAME, repoUrl: REPO_URL, version: resolveApiVersion });
```

It needs, from the app: core's `PlatformHostModule.forRoot()` (`AUDIT_SINK`; `PLATFORM_PRISMA` for the `postgres` bus and the gauges), the global settings slice (`forRoot()` registers `MAINTENANCE_SYSTEM_SETTINGS` unless the app's system-settings manifest already did, so call it before `SettingsModule.forRoot()` or register the namespace there; the reference app's manifest does, to fix the namespaces' order), a global `ConfigModule` carrying `jwt.secret` (the identity slice's configuration), and, for the two Doctor checks, the doctor slice. Bind the slices' ports to what it provides (`{ provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS }`, `{ provide: IDENTITY_METRICS, useExisting: AppMetricsService }`, `{ provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService }`).

Place it where `/api/admin/maintenance` belongs in the generated document: paths are listed in module order (the reference app: where `HealthModule` used to be, right after `ProfileImageModule`; the module now carries `/api/health` too).

## Configuration

`PlatformHostCoreModule.forRoot(options)`; every option is optional and the defaults are the reference app's behaviour:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `eventBusAdapter` | `string` | `EVENT_BUS_ADAPTER`, read when the bus is built | `in-process` or `postgres` (case-insensitive); anything else is `in-process` plus one warning. |
| `metricsGauges` | `boolean` | `OTEL_ENABLED === 'true'` | Whether the database-backed gauges register. |
| `imports` | `PlatformHostCoreImport[]` | none | Extra modules the host core's providers need from the app. |

`registerPlatformDocs(app, openApi, logger?)` and `createOpenApiDocument(app, openApi)` take `PlatformOpenApiOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `appName` | `string` | required | The title (`<appName> API`), the contact's name and the docs page header. |
| `repoUrl` | `string` | required | The contact URL and the `docs/` external link. |
| `version` | `string \| () => string` | required | `info.version` and the docs page's build label. |
| `description` | `(version) => string` | the platform's getting-started guide | The Markdown intro. |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `PlatformHostCoreModule.forRoot` | option | `forRoot(options?: PlatformHostCoreOptions): DynamicModule` | Mount the host core once, in the root module | experimental | [example](../../../../apps/api/src/platform/host-core.config.ts) |
| `AboutModule.forRoot` | option | `forRoot(options: AboutModuleOptions): DynamicModule` | Mount `GET /api/admin/about`, passing the app's `apiVersion` | experimental | [example](../../../../apps/api/src/platform/about/about.config.ts) |
| `AboutModuleOptions` | option | `{ apiVersion: () => string }` | Tell the about module which version the app's API is | experimental | [example](../../../../apps/api/src/platform/about/about.config.ts) |
| `registerPlatformDocs` | option | `registerPlatformDocs(app, openApi: PlatformOpenApiOptions, logger?): boolean` | Mount `/api/openapi.json` and `/api/docs` at bootstrap | experimental | [example](../../../../apps/api/src/main.ts) |
| `EVENT_BUS` | token | `@Inject(EVENT_BUS) bus: EventBus` | Publish or subscribe across replicas; bind a slice's bus port to it | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `registerPlatformHostAppMetrics` | registry | `registerPlatformHostAppMetrics(...appMetrics: readonly AppMetricDef[][]): void` | Declare the platform's metrics, then the slices' and the app's own, in that order, before bootstrap | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `hostConformanceSuite` | registry | `ConformanceSuite<HostConformanceOptions>` (`@marinoscar/platform-api/host/testing`) | Run the host invariants against the app's root module | experimental | [example](../../../../apps/api/test/platform/host-conformance.spec.ts) |

Supporting exports (experimental): the options (`PLATFORM_HOST_CORE_OPTIONS`, `resolvePlatformHostCoreOptions`); the bus contract (`EventBus`, `EventBusMeta`, `EventBusHandler`, `EventBusHealth`, `EVENT_BUS_CHANNEL_PATTERN`, `EVENT_BUS_MAX_PAYLOAD_BYTES`, `EventBusPayloadTooLargeError`, `exceedsEventBusPayloadLimit`), the selection (`EVENT_BUS_SELECTION`, `parseEventBusAdapter`, `DEFAULT_EVENT_BUS_ADAPTER`), the two adapters (`InProcessEventBus`, `PostgresEventBus` and its options and backoff) and the bus metrics (`EVENT_BUS_APP_METRICS`, `eventBusMetricsVia`); `AppMetricsService`, `fallbackAppMetrics`, `createRegisteredGauge`, `PLATFORM_APP_METRICS`; maintenance (`MaintenanceModeService`, `MaintenanceGuard`, the 503's `MAINTENANCE_ERROR_MARKER` and `MAINTENANCE_RETRY_AFTER_SECONDS`, the audit constants, the DTOs, `MAINTENANCE_SYSTEM_SETTINGS`, `mergeMaintenanceSettings` and the namespace schemas); the HTTP layer (`TransformInterceptor`, `ApiEnvelope`, `LoggingInterceptor`, `RequestIdMiddleware`); the OpenAPI builder and its passes' helpers (`createOpenApiDocument`, `buildOpenApiConfig`, `enrichOpenApiDocument`, `buildOperationId`, `isAuthenticatedOperation`, `SECURITY_SCHEMES`, `buildApiDescription`, `forEachOperation`, `REQUIREMENTS_MARKER`, `resolveApiVersion`) and the docs routes (`registerDocsRoutes`, `registerDocsRoutesOrDegrade`, `DOCS_PATH`, `OPENAPI_JSON_PATH`, `OPENAPI_UNAVAILABLE_CODE`, `renderDocsPage`, `DEFAULT_SCALAR_CDN`). The testing entry also exports `FakeEventBusNetwork` and `flushEventBus`, a multi-replica bus double for an app's own tests.

## Data

None owned. The maintenance window is the `maintenance` namespace of the settings slice's `system_settings` row (`MAINTENANCE_SYSTEM_SETTINGS`, registered by the app); its audit rows go through core's `AUDIT_SINK` (`maintenance:enable` / `maintenance:disable`, target `maintenance`/`global`). The gauges read `jobs` and, when the app's client has the `databaseBackupRun` delegate, `database_backup_runs`, through `PLATFORM_PRISMA` with structural types (no generated client is imported). The `postgres` bus publishes with `SELECT pg_notify('platform_bus', …)` and listens on one direct session (`application_name` `platform-event-bus`); it touches no table.

## Permissions and settings

No permission of its own: `/api/admin/maintenance` requires the settings slice's `system_settings:read` (GET) and `system_settings:write` (PUT); a window is a system setting. Settings read: the `maintenance` namespace (`enabled: false`, the default message, `allowAdmins: true`, no provenance by default).

## UI

The pages are the web slice's, [`@marinoscar/platform-web/host`](../../../platform-web/src/host/README.md) (the About page, the admin Maintenance page and the public maintenance screen); the app keeps the gate, the banner and its registry cards (`/admin/settings/maintenance`, `/admin/settings/about`). The web slice mirrors `MAINTENANCE_ERROR_MARKER` and `MAINTENANCE_RETRY_AFTER_SECONDS`.

## Infra

Environment variables, all read by the package itself (none is new; each was the reference app's):

| Variable | Default | Meaning |
|---|---|---|
| `EVENT_BUS_ADAPTER` | `in-process` | `postgres` before running more than one API replica; the listener needs a direct or session-mode connection (never a transaction-mode pooler). |
| `MAINTENANCE_MODE` | unset | The break-glass: the literal `true` forces a window open, `false` forces it shut; anything else is no override. |
| `OTEL_ENABLED` | unset | `true` registers the database-backed gauges (and, in the app, installs the SDK). |
| `API_DOCS_CDN` | the jsDelivr Scalar bundle | Where `/api/docs` loads Scalar from (a same-origin path for an air-gapped deployment). |
| `APP_VERSION` | `npm_package_version`, else the app's `package.json` | The document's `info.version` when the app passes `resolveApiVersion`. |

## Observability

Logs: one `HTTP` line per request (`GET /api/x - 12ms`; an SSE stream once, at open), the bus adapter at boot and every listener disconnect and reconnect (`EventBusModule`, `PostgresEventBus`), one warning per maintenance-settings outage and every window opened or closed (`MaintenanceModeService`), and a generation failure of the document at `error` (`OpenAPI`). Metrics: the platform's 31 `app.*` metrics (`app.jobs.*`, `app.backup.*`, `app.auth.*`, `app.ai.*`, `app.notifications.deliveries`, `app.nodes.*`) and `app.event_bus.published`, `app.event_bus.delivered`, `app.event_bus.reconnects` (labels: adapter, logical channel, outcome or origin; never a payload). Request ids and trace ids on every response (`x-request-id`, `x-trace-id`). Doctor checks: `core.event-bus`, `maintenance.mode`.

## Security notes

- **One global guard.** `MaintenanceGuard` is the only `APP_GUARD`; authentication and authorization are per route (`@Auth()` / `@Public()`). The `host` conformance suite fails an app that registers any other `APP_GUARD` anywhere in its module graph.
- **The guard authenticates nobody.** It verifies an admin session JWT only to honour `allowAdmins`, against the same `jwt.secret` as the identity slice, with a `JwtModule` of its own (it never imports `AuthModule` and never re-exports its `JwtService`); it never writes `request.user`. Opaque `pat_` and `nod_` bearers are never admins during a window.
- **Docs stay readable during a window.** `/api/docs` and `/api/openapi.json` are raw Fastify routes outside Nest's router; the degraded 503 carries no error detail (it is in the log).
- **Never put a secret on the bus.** A NOTIFY payload is readable by any session with the application's database credentials.

## Conformance suite

`@marinoscar/platform-api/host/testing` registers the `host` suite (option key `host`) with `runPlatformConformance()`. It walks the app's module graph from `rootModule` without booting it:

1. `app-guard`: exactly one `APP_GUARD`, and it is `MaintenanceGuard` (no global JWT guard).
2. `host-core`: `PlatformHostCoreModule.forRoot()` is imported exactly once (one event bus per process).
3. `envelope`: `TransformInterceptor` and `HttpExceptionFilter` are global, once each.

```ts
import '@marinoscar/platform-api/host/testing';
runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { host: { rootModule: AppModule } } });
```

The reference app's behavioural suites stay with the composed app: the maintenance window end to end (`apps/api/test/maintenance/`), the exempt route set, the document and the docs routes (`apps/api/test/openapi/`), the Postgres bus against a real database (`apps/api/test/event-bus/postgres-event-bus.db.spec.ts`).

## Upgrade notes

### Unreleased (#901)

The health controller, its `DatabaseHealthIndicator` and `cors-options.ts` moved here from the reference app (`src/health/`, `src/common/cors/`). Delete `HealthModule` and its import (`PlatformHostCoreModule.forRoot()` now mounts `GET /api/health`, `/live` and `/ready`, first among its controllers, so the OpenAPI document keeps its order when the module sits where `HealthModule` was), install `@nestjs/terminus` (a new peer), and import `buildCorsOptions` / `isSameOriginOnly` from this slice in `main.ts`. The routes, the responses and the OpenAPI document are byte-identical. The raw-SQL allowlist entry for the indicator is now `health/database.indicator.ts` (host root).

### Unreleased (#891)

`GET /api/admin/about` moved here from the reference app (`src/about/`). Delete the local copy, import `AboutModule.forRoot({ apiVersion: resolveApiVersion })` where the route belongs in the document, and import `readDeployInfo` / `resolveDeployInfoPath` from this slice. The route, the response and the OpenAPI document are byte-identical. The database probe now reads through `PLATFORM_PRISMA` instead of the health module's indicator, so the module no longer imports `HealthModule`.

### 0.1.0 (#867)

New slice. For an app built on the reference app before #867: delete the local copies (`src/common/event-bus/`, `src/common/interceptors/`, `src/common/middleware/`, `src/common/otel/app-metrics.{module,service}.ts` and `platform-app-metrics.ts`, `src/common/maintenance/` except the `AllowDuringMaintenance` re-export, and the OpenAPI passes, page and routes under `src/openapi/`), import `PlatformHostCoreModule.forRoot()` where `HealthModule` imported the old `MaintenanceModule`, drop the `APP_GUARD`, `APP_FILTER` and `APP_INTERCEPTOR` providers and the request-id `configure()` from the root module, register `MAINTENANCE_SYSTEM_SETTINGS` from this slice (or let `forRoot()` do it), call `registerPlatformHostAppMetrics(...)` from the metric manifest, and replace `registerDocsRoutesOrDegrade(app, () => createOpenApiDocument(app), logger)` with `registerPlatformDocs(app, openApi, logger)`. `EVENT_BUS` and `EVENT_BUS_SELECTION` are now `Symbol.for` keys. The `{ data }` envelope's type is `ApiEnvelope` (was `ApiResponse`). The generated document is byte-identical.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot fails: `Nest can't resolve dependencies of the MaintenanceModeService (SystemSettingsService, ?)` | No `AUDIT_SINK` bound | Import core's `PlatformHostModule.forRoot({ audit })`. |
| Boot fails: `EVENT_BUS_ADAPTER=postgres needs the app's Prisma client` | `PLATFORM_PRISMA` unbound | Bind it with `PlatformHostModule.forRoot({ prisma })`. |
| Boot fails: `JWT_SECRET is not set` | The guard's `JwtModule` reads `jwt.secret` | Load the identity slice's configuration into the global `ConfigModule`. |
| Boot fails: `PlatformHostCoreModule.forRoot() registers the system settings namespace(s) "maintenance", but SettingsModule.forRoot() already composed the request bodies` | `forRoot()` ran after the settings slice composed its bodies | Call it before `SettingsModule.forRoot()`, or register `MAINTENANCE_SYSTEM_SETTINGS` in the app's settings manifest. |
| `/api/admin/maintenance` moved in the OpenAPI document | The module sits at a different place in the root module | Import it where the old `MaintenanceModule` was first discovered. |
| Live events do not reach other replicas | `EVENT_BUS_ADAPTER` unset, or a transaction-mode pooler between the API and Postgres | Set `postgres`; point `POSTGRES_HOST` at the database or a session-mode pool. The Doctor's `core.event-bus` says which. |
| `/api/docs` and `/api/openapi.json` answer 503 | The document failed to generate at startup | Read the `OpenAPI` error in the log; `openapi:dump` reproduces it. |

## Links

- [Package README](../../README.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md)
- [Package documentation standard](../../../../docs/PACKAGES.md)
- [Maintenance mode spec](../../../../docs/specs/maintenance-mode.md)
- [API conventions (envelope, errors, OpenAPI)](../../../../docs/API.md)

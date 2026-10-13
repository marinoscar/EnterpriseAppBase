# @marinoscar/platform-api/host

The API host core (issue #867): the plumbing every other slice assumes is around it, packaged so an app mounts it with one `PlatformHostCoreModule.forRoot()` instead of copying it. It was the reference app's own code (`apps/api/src/common/{event-bus,otel,maintenance,interceptors,middleware}/` and `apps/api/src/openapi/`) until #867. NestJS, CommonJS. It depends on `core`, `doctor`, `otel-core`, `identity`, `settings`, `nodes` and `db-backup` of this package (`packages/platform-slices.json`; the last two only for the metric declarations the platform's `AppMetricsService` records into). It sits at the top of the graph on purpose: the app mounts it, while slices keep reaching the bus and the metrics through their own ports (`JOBS_EVENT_BUS`, `IDENTITY_METRICS`, ...), which the app binds to what this slice provides.

## Purpose and scope

`PlatformHostCoreModule.forRoot()` is one global module that provides:

- **The event bus** (PP-1.11, #682). `EVENT_BUS`, one per process: `in-process` (the default) or `postgres` (`pg_notify` to publish, one dedicated `LISTEN` session to receive), chosen by `EVENT_BUS_ADAPTER`, or any adapter the app registers with `registerEventBusAdapter` (PP-14.2), or a whole bus bound with the `eventBus` option; an unregistered `EVENT_BUS_ADAPTER` value falls back to `in-process` with one warning. Local delivery in a microtask, remote delivery at most once with no replay, no echo, isolated handler failures, a `publish` that never rejects, JSON copies, a 7,500-byte envelope limit, and never a secret on the bus. The `core.event-bus` Doctor check reports the adapter and the listener.
- **The platform's app metrics** (#600, #680). `AppMetricsService`: the typed recorders the slices' metric ports bind to (jobs, backups, sign-in, AI, notifications), the generic `add`/`record` an app emits its own registered metrics through, and the database-backed gauges (queue depth, oldest pending job, last backup), only when `OTEL_ENABLED` installed the SDK. `registerPlatformHostAppMetrics()` declares the platform's 31 `app.*` metrics and the event bus's three in the app-metric registry of `otel-core`.
- **Maintenance mode** (#257). `MaintenanceModeService` (environment override, then in-memory override, then the persisted `maintenance` namespace; audited through core's `AUDIT_SINK`), `GET`/`PUT /api/admin/maintenance` (`system_settings:read`/`system_settings:write`), the `maintenance.mode` Doctor check, the namespace declaration `MAINTENANCE_SYSTEM_SETTINGS` with its schemas (registered by `forRoot()` through the settings slice's `ensureSystemSettingsNamespaces` unless the app's manifest did), and `MaintenanceGuard` as the platform's `APP_GUARD`, which runs first. There is no global JWT guard: a route without `@Auth()` is public. An app lets extra requests through an open window with `registerMaintenanceBypass` (fail-closed predicates, evaluated after the built-in admin rule) and may add a global guard of its own, declared to the `host` conformance suite (`allowedAppGuards`). The two routes take the app's access decorators (`host`) and permission strings (`permissions`).
- **The deployment facts and the generic Doctor checks** (#685, #773, #879). `DeploymentModeService` (`DEPLOYMENT_MODE`: `self-hosted`, `saas` or any mode the app registered with `registerDeploymentMode`, parsed once and refused when invalid; `verifyDeploymentModeAtStartup` is the bootstrap call; `can(capabilityId)` answers an app capability registered with `registerDeploymentCapability`, and `inAppRestore` is the platform's own), `DeploymentNetworkService` (`DEPLOYMENT_NETWORK`, bound as the doctor slice's `DEPLOYMENT_NETWORK_SOURCE`), and six Doctor checks registered in this order: `core.deployment-mode`, `db.connection`, `db.migrations`, `secrets.encryption-key`, `db.rls_role` (`core` category) and `network.egress`. The database checks read through core's `PLATFORM_PRISMA` host port (`SELECT 1`, `_prisma_migrations`, `pg_roles` and `pg_class`; none needs the bypass client) and report `skip` when it is unbound. Both services read the raw string the app publishes as `deployment.mode` / `deployment.network` in its configuration, else the environment variable.
- **About** (#401, packaged by #891). `AboutModule.forRoot({ apiVersion, host?, permission? })`, a separate module (so the app places it where `/api/admin/about` belongs in the OpenAPI document): `GET /api/admin/about` (`system_settings:read`, readable during a maintenance window, always `200`) reports the API version (the app's `apiVersion` resolver), the deployment mode, the deploy document `appctl deploy` leaves on disk (`readDeployInfo`, read fresh per request, never cached) and a database liveness fact (one timed `SELECT 1` through `PLATFORM_PRISMA`; a failure is a field, never a status), and `extras`: the groups of facts the app contributed with `registerAboutContributor` (absent when there are none; a failing contributor is left out). It also registers the `versions` support-bundle section.
- **The health probes** (#901). `GET /api/health` (every registered indicator through Terminus: any `down` is `503`), `/api/health/live` (the process is not hung; runs no indicator; stays `200` during a maintenance window) and `/api/health/ready` (`503` with the maintenance marker while a window is open, checked before any indicator, then the critical indicators: any `down` is `503`). The indicators are a registry (`registerHealthIndicator`); the platform's `database` indicator, critical, is a timed `SELECT 1` through `PLATFORM_PRISMA` in `DatabaseHealthIndicator` and registers through the same function. Public, `@AllowDuringMaintenance()`, tagged `Health`; the routes, the responses and the OpenAPI document are unchanged.
- **The HTTP layer.** The `{ data, meta }` response envelope (`TransformInterceptor`, which leaves an `@Sse()` stream and a body that already has `data` alone), the request log line (`LoggingInterceptor`), core's `HttpExceptionFilter`, and request ids (`RequestIdMiddleware`: the incoming `x-request-id` or a UUID, echoed with `x-trace-id`), and the CORS policy builder `buildCorsOptions(process.env.CORS_ORIGIN, extra?)` / `isSameOriginOnly` (#517, packaged by #901): `CORS_ORIGIN` unset gives no CORS headers (same-origin), a comma-separated list gives exactly those origins with credentials, a wildcard or a malformed origin throws at bootstrap; `extra` adds `methods`, `allowedHeaders`, `exposedHeaders` and `maxAge` and can never touch the origin policy. The app passes the result to `app.enableCors`. `meta` carries `timestamp` and whatever the contributors registered with `registerResponseMetaContributor` return (bounded, secret-filtered).
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
export const hostCoreModule = PlatformHostCoreModule.forRoot({ host: platformHost });

// src/main.ts, after setGlobalPrefix('api') and before listen()
const docsReady = registerPlatformDocs(app, { appName: APP_NAME, repoUrl: REPO_URL, version: resolveApiVersion });
```

It needs, from the app: core's `PlatformHostModule.forRoot()` (`AUDIT_SINK`; `PLATFORM_PRISMA` for the `postgres` bus and the gauges), the global settings slice (`forRoot()` registers `MAINTENANCE_SYSTEM_SETTINGS` unless the app's system-settings manifest already did, so call it before `SettingsModule.forRoot()` or register the namespace there; the reference app's manifest does, to fix the namespaces' order), a global `ConfigModule` carrying `jwt.secret` (the identity slice's configuration), and, for the two Doctor checks, the doctor slice. Bind the slices' ports to what it provides (`{ provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS }`, `{ provide: IDENTITY_METRICS, useExisting: AppMetricsService }`, `{ provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService }`).

Place it where `/api/admin/maintenance` belongs in the generated document: paths are listed in module order (the reference app: where `HealthModule` used to be, right after `ProfileImageModule`; the module now carries `/api/health` too).

## Configuration

`PlatformHostCoreModule.forRoot(options)`; every option is optional and the defaults are the reference app's behaviour:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `eventBusAdapter` | `string` | `EVENT_BUS_ADAPTER`, read when the bus is built | `in-process`, `postgres` or any registered adapter id (case-insensitive). An id nobody registered fails the boot here, naming it and the registered ones; the same value in `EVENT_BUS_ADAPTER` is `in-process` plus one warning. |
| `eventBus` | `PortBinding<EventBus>` | none | A whole bus (`useExisting`, `useClass` or `useFactory`), bound as `EVENT_BUS` for every consumer. Wins over `eventBusAdapter` and the environment. Needs no registry entry. |
| `host` | `PlatformHost` | none (the identity slice's `@Auth()` and `@Public()`) | The app's access decorators (`definePlatformHost`), so the maintenance routes are guarded as the app's own admin routes are and the health probes carry the app's public marker. |
| `permissions` | `{ maintenanceRead?, maintenanceWrite? }` | `system_settings:read`, `system_settings:write` | The permission strings the maintenance routes enforce. Change the Maintenance settings card's `permission` to match. |
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

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `PlatformHostCoreModule.forRoot` | option | `forRoot(options?: PlatformHostCoreOptions): DynamicModule` | Mount the host core once, in the root module | experimental | [example](../../../../apps/api/src/platform/host-core.config.ts) |
| `AboutModule.forRoot` | option | `forRoot(options: AboutModuleOptions): DynamicModule` | Mount `GET /api/admin/about`, passing the app's `apiVersion` | experimental | [example](../../../../apps/api/src/platform/about/about.config.ts) |
| `AboutModuleOptions` | option | `{ apiVersion: () => string; host?: PlatformHost; permission?: string }` | Tell the about module which version the app's API is, which access decorators guard its route and (rarely) which permission it requires | experimental | [example](../../../../apps/api/src/platform/about/about.config.ts) |
| `PlatformHostCoreOptions.host` | option | `host?: PlatformHost` | Guard the maintenance routes with the app's own decorators and mark the probes public with the app's marker | experimental | [example](../../../../apps/api/src/platform/host-core.config.ts) |
| `PlatformHostCoreOptions.permissions` | option | `permissions?: { maintenanceRead?: string; maintenanceWrite?: string }` | Enforce other permission strings on `/api/admin/maintenance` than `system_settings:read` / `:write` | experimental | [example](../../../../apps/api/src/platform/host-core.config.ts) |
| `registerHealthIndicator` | registry | `registerHealthIndicator(indicator: HealthIndicatorDef): void` where `HealthIndicatorDef = { id, critical, check(ctx): { status: 'up' \| 'down', details? }, timeoutMs? }`; `id` matches `^[a-z][a-z0-9-]{1,31}$` | Make a dependency (a broker, a provider) count towards readiness (`critical: true`) or show in `GET /api/health` (any); import time | experimental | [example](../../../../apps/api/src/platform-extensions/host/queue-readiness.indicator.ts) |
| `healthIndicatorRegistry` | registry | `Registry<HealthIndicatorDef>` (`host.health-indicators`; the built-in `database` registers through `registerHealthIndicator` too) | List or look up the registered indicators | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `registerMaintenanceBypass` | registry | `registerMaintenanceBypass(bypass: MaintenanceBypassDef): void` where `MaintenanceBypassDef = { id, allows(request, principal): boolean \| Promise<boolean> }` | Let a request (a payment webhook) through an open maintenance window; fail-closed, after the admin rule | experimental | [example](../../../../apps/api/src/platform-extensions/host/payments-webhook.bypass.ts) |
| `maintenanceBypassRegistry` | registry | `Registry<MaintenanceBypassDef>` (`host.maintenance-bypasses`) | List or look up the registered bypasses | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `registerAboutContributor` | registry | `registerAboutContributor(contributor: AboutContributorDef): void` where `AboutContributorDef = { id, label, describe(): Record<string, string \| number \| boolean> }` | Add a section of the app's own facts to `GET /api/admin/about` and the About page | experimental | [example](../../../../apps/api/src/platform-extensions/host/transcription.about-contributor.ts) |
| `aboutContributorRegistry` | registry | `Registry<AboutContributorDef>` (`host.about-contributors`) | List or look up the registered contributors | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `registerDeploymentMode` | registry | `registerDeploymentMode(mode: DeploymentModeDef): void` where `DeploymentModeDef = { id, capabilities: Record<string, boolean> }`; `id` matches `^[a-z][a-z0-9-]{1,31}$` | Add a `DEPLOYMENT_MODE` value (BYOC, on-prem) and what it sets; import time, before `main.ts` parses the variable | experimental | [example](../../../../apps/api/src/platform-extensions/host/byoc.deployment-mode.ts) |
| `registerDeploymentCapability` | registry | `registerDeploymentCapability(capability: DeploymentCapabilityDef): void` where `DeploymentCapabilityDef = { id, default: boolean, byMode?: Record<string, boolean> }` | Add a yes/no fact modes answer differently (`DeploymentModeService.can(id)`); `inAppRestore` is the platform's own | experimental | [example](../../../../apps/api/src/platform-extensions/host/byoc.deployment-mode.ts) |
| `deploymentModeRegistry` | registry | `Registry<DeploymentModeDef>` (`host.deployment-modes`; `self-hosted` and `saas` register through `registerDeploymentMode` too) | List or look up the registered deployment modes | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `deploymentCapabilityRegistry` | registry | `Registry<DeploymentCapabilityDef>` (`host.deployment-capabilities`; `inAppRestore` registers through `registerDeploymentCapability` too) | List or look up the registered deployment capabilities | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `registerResponseMetaContributor` | registry | `registerResponseMetaContributor(contributor: ResponseMetaContributorDef \| ((request) => Record<string, unknown>)): void` where `ResponseMetaContributorDef = { id, contribute(request) }` | Add bounded keys to the `meta` of every enveloped response (an API revision); synchronous, no I/O | experimental | [example](../../../../apps/api/src/platform-extensions/host/api-revision.response-meta.ts) |
| `responseMetaContributorRegistry` | registry | `Registry<ResponseMetaContributorDef>` (`host.response-meta-contributors`) | List or look up the registered contributors | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `buildCorsOptions` | option | `buildCorsOptions(raw: string \| undefined, extra?: ExtraCorsOptions): CorsOptions` | Add `methods`, `allowedHeaders`, `exposedHeaders` or `maxAge` to the CORS policy; `origin` and `credentials` stay `CORS_ORIGIN`'s | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `ExtraCorsOptions` | option | `{ methods?: string[]; allowedHeaders?: string[]; exposedHeaders?: string[]; maxAge?: number }` | Type the second argument of `buildCorsOptions`; never carries `origin` or `credentials` | experimental | [example](../../../../apps/api/test/examples/host/host-extension-points.integration.spec.ts) |
| `HostConformanceOptions.allowedAppGuards` | option | `allowedAppGuards?: Array<{ name: string; why: string }>` | Let the `host` suite accept a global guard the app registers on purpose (a throttler, a tenant guard); `name` is the guard class, `why` is required | experimental | [example](../../../../apps/api/test/examples/host/app-guard.example.spec.ts) |
| `registerPlatformDocs` | option | `registerPlatformDocs(app, openApi: PlatformOpenApiOptions, logger?): boolean` | Mount `/api/openapi.json` and `/api/docs` at bootstrap | experimental | [example](../../../../apps/api/src/main.ts) |
| `EVENT_BUS` | token | `@Inject(EVENT_BUS) bus: EventBus` | Publish or subscribe across replicas; bind a slice's bus port to it | experimental | [example](../../../../apps/api/src/platform/jobs/jobs-host.module.ts) |
| `registerEventBusAdapter` | registry | `registerEventBusAdapter(adapter: EventBusAdapterDef): void` where `EventBusAdapterDef = { id, label, create(ctx: { id, config, logger, prisma, metrics }): EventBus \| Promise<EventBus> }`; `id` matches `^[a-z][a-z0-9-]{1,31}$` | Add an event bus (Redis, NATS, a test double) selectable by `EVENT_BUS_ADAPTER` or `eventBusAdapter`; call it at import time, before the app is created | experimental | [example](../../../../apps/api/src/app-registrations/host.ts) |
| `eventBusAdapterRegistry` | registry | `Registry<EventBusAdapterDef>` (`host.event-bus-adapters`; `in-process` and `postgres` register through `registerEventBusAdapter` too) | List or look up the registered adapters (`ids()`, `get(id)`) | experimental | [example](../../../../apps/api/test/examples/host/event-bus-adapter.spec.ts) |
| `PlatformHostCoreOptions.eventBus` | option | `eventBus?: PortBinding<EventBus>` | Replace the bus wholesale; the only override that reaches the package's own consumers (a provider of `EVENT_BUS` in the app module never does) | experimental | [example](../../../../apps/api/test/examples/host/event-bus-adapter.spec.ts) |
| `describeEventBusConformance` | hook | `describeEventBusConformance(bus \| () => bus, { describe, it, expect }, options?)` (`@marinoscar/platform-api/host/testing`) | Prove an adapter honours the bus rules: local delivery, JSON copies, per-channel order, unsubscribe, isolated handlers, a `publish` that never rejects, `health()`, `close()` | experimental | [example](../../../../apps/api/test/examples/host/event-bus-adapter.spec.ts) |
| `registerPlatformHostAppMetrics` | registry | `registerPlatformHostAppMetrics(...appMetrics: readonly AppMetricDef[][]): void` | Declare the platform's metrics, then the slices' and the app's own, in that order, before bootstrap | experimental | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `hostConformanceSuite` | registry | `ConformanceSuite<HostConformanceOptions>` (`@marinoscar/platform-api/host/testing`) | Run the host invariants against the app's root module | experimental | [example](../../../../apps/api/test/platform/host-conformance.spec.ts) |

Supporting exports (experimental): the options (`PLATFORM_HOST_CORE_OPTIONS`, `resolvePlatformHostCoreOptions`); the bus contract (`EventBus`, `EventBusMeta`, `EventBusHandler`, `EventBusHealth`, `EVENT_BUS_CHANNEL_PATTERN`, `EVENT_BUS_MAX_PAYLOAD_BYTES`, `EventBusPayloadTooLargeError`, `exceedsEventBusPayloadLimit`), the selection (`EVENT_BUS_SELECTION`, `parseEventBusAdapter`, `DEFAULT_EVENT_BUS_ADAPTER`, `BOUND_EVENT_BUS_SELECTION`), the adapter registry's supporting exports (`EventBusAdapterContext`, `EVENT_BUS_ADAPTER_ID_PATTERN`, `unknownEventBusAdapterError`, `IN_PROCESS_EVENT_BUS_ADAPTER`, `POSTGRES_EVENT_BUS_ADAPTER`, `BuiltinEventBusAdapterName`, `BUILTIN_EVENT_BUS_ADAPTERS`; `EVENT_BUS_ADAPTERS` is a deprecated alias), the two adapters (`InProcessEventBus`, `PostgresEventBus` and its options and backoff) and the bus metrics (`EVENT_BUS_APP_METRICS`, `eventBusMetricsVia`); `AppMetricsService`, `fallbackAppMetrics`, `createRegisteredGauge`, `PLATFORM_APP_METRICS`; maintenance (`MaintenanceModeService`, `MaintenanceGuard`, the 503's `MAINTENANCE_ERROR_MARKER` and `MAINTENANCE_RETRY_AFTER_SECONDS`, the audit constants, the DTOs, `MAINTENANCE_SYSTEM_SETTINGS`, `mergeMaintenanceSettings` and the namespace schemas, `MaintenanceBypassRequest` / `MaintenanceBypassPrincipal`, `MAINTENANCE_BYPASS_ID_PATTERN`, `MAINTENANCE_BYPASS_TIMEOUT_MS`, `createMaintenanceController` and `DEFAULT_MAINTENANCE_READ_PERMISSION` / `DEFAULT_MAINTENANCE_WRITE_PERMISSION`); the registries' patterns and limits (`HEALTH_INDICATOR_ID_PATTERN`, `HEALTH_INDICATOR_DEFAULT_TIMEOUT_MS`, `HEALTH_INDICATOR_MAX_TIMEOUT_MS`, `HealthIndicatorOutcome`, `HealthIndicatorContext`, `ABOUT_CONTRIBUTOR_ID_PATTERN`, `ABOUT_CONTRIBUTOR_TIMEOUT_MS`, `DEPLOYMENT_MODE_ID_PATTERN`, `DEPLOYMENT_CAPABILITY_ID_PATTERN`, `BUILTIN_DEPLOYMENT_MODES` (`DEPLOYMENT_MODES` is a deprecated alias), `BuiltinDeploymentMode`, `RESPONSE_META_*`, `buildResponseMeta`, `ExtraCorsOptions`); the HTTP layer (`TransformInterceptor`, `ApiEnvelope`, `LoggingInterceptor`, `RequestIdMiddleware`); the OpenAPI builder and its passes' helpers (`createOpenApiDocument`, `buildOpenApiConfig`, `enrichOpenApiDocument`, `buildOperationId`, `isAuthenticatedOperation`, `SECURITY_SCHEMES`, `buildApiDescription`, `forEachOperation`, `REQUIREMENTS_MARKER`, `resolveApiVersion`) and the docs routes (`registerDocsRoutes`, `registerDocsRoutesOrDegrade`, `DOCS_PATH`, `OPENAPI_JSON_PATH`, `OPENAPI_UNAVAILABLE_CODE`, `renderDocsPage`, `DEFAULT_SCALAR_CDN`). The testing entry also exports `FakeEventBusNetwork` and `flushEventBus`, a multi-replica bus double for an app's own tests.

### Adding an event bus adapter

The bus is built from a registry, so a new transport is one class and one call, with no package edit (worked example: [`recording-event-bus.ts`](../../../../apps/api/src/platform-extensions/host/recording-event-bus.ts), registered by [`app-registrations/host.ts`](../../../../apps/api/src/app-registrations/host.ts)):

1. Implement `EventBus` (`publish`, `subscribe`, `health`, optional `close`). Honour the rules at the top of `event-bus/event-bus.interface.ts`; implement Nest's `OnModuleInit` / `OnModuleDestroy` on it if it holds a connection (they run on the instance `create` returns).
2. Register it at import time, from `app-registrations/host.ts`: `registerEventBusAdapter({ id: 'redis', label: 'Redis pub/sub', create: ({ config, logger, metrics }) => new RedisEventBus(...) })`. The registry freezes once the application has bootstrapped, and the bus is built before that, so a late registration fails (`FROZEN`).
3. Select it: `EVENT_BUS_ADAPTER=redis`, or `PlatformHostCoreModule.forRoot({ eventBusAdapter: 'redis' })`.
4. Run the kit: `describeEventBusConformance(() => new RedisEventBus(...), { describe, it, expect })` from `@marinoscar/platform-api/host/testing`.

To skip the registry and hand over a finished bus, pass `PlatformHostCoreModule.forRoot({ eventBus: { useClass: RedisEventBus } })` (or `useFactory` / `useExisting`). `PlatformHostCoreModule` is global, so this is the way to replace `EVENT_BUS`: a provider of `EVENT_BUS` in the app's own module is never seen by the package's consumers. The binding is resolved in the host core's context, so a `useFactory`'s `inject` tokens come from the `imports` option and from global modules. The conformance suite of the example proves it reaches a real consumer (the identity slice's `PrincipalCache`).

### Adding a health indicator, a maintenance bypass or an About section

All three are registered at import time (from `app-registrations/host.ts`), freeze with the application, and have a worked example that `registerHostExamples()` opts into; `apps/api/test/examples/host/` drives each through the real `AppModule`.

- **Health indicator.** `registerHealthIndicator({ id: 'broker', critical: true, check })`. `check(context)` returns `{ status: 'up' | 'down', details? }`; `context.get(Token)` reaches any provider of the running application. `critical` indicators decide `GET /api/health/ready`; every indicator shows in `GET /api/health`; `/live` runs none. Each run is cut off at `timeoutMs` (default 3 s, at most 30 s), a throw or a timeout is `down`. **The probes are public**: details are bounded (16 keys, strings up to 200 characters, numbers and booleans, credential-looking keys dropped, `scheme://user:password@` redacted), a thrown error's text never leaves the process, and the indicator must still keep secrets, hostnames and stack traces out of `details`.
- **Maintenance bypass.** `registerMaintenanceBypass({ id: 'payments-webhook', allows: (request, principal) => request.method === 'POST' && request.path === '/api/webhooks/payments' })`. It runs only for a request the window would otherwise refuse (never when no window is open, never on an `@AllowDuringMaintenance()` route, never for an admin the built-in rule admitted), receives frozen copies (`method`, `path`, lower-cased `headers`, `ip`; the verified `kind`, `userId` and `roles` of a session JWT, `opaque` for `pat_` / `nod_`), and only `true` allows: `false`, any other value, a throw, a rejection or a predicate slower than a second all mean blocked. It lets the request past the window and nothing else: the route still authenticates its caller, so a webhook route verifies the provider's signature.
- **About contributor.** `registerAboutContributor({ id: 'transcription', label: 'Transcription', describe })` adds `extras: [{ id, label, facts }]` to `GET /api/admin/about` (absent when none is registered) and one section per group to the web About page. Facts are bounded like health details; a contributor that throws or exceeds two seconds is left out and the report still answers `200`.

### Adding a deployment mode or capability

`registerDeploymentMode({ id: 'byoc', capabilities: { inAppRestore: false } })` makes `DEPLOYMENT_MODE=byoc` valid; `registerDeploymentCapability({ id: 'bulkExport', default: true, byMode: { saas: false } })` adds a switch the app reads with `DeploymentModeService.can('bulkExport')`. A capability resolves to the mode's own entry, else its `byMode` entry, else its `default`; a mode that sets an unregistered capability fails when it is first resolved. Register both before `main.ts` calls `verifyDeploymentModeAtStartup` (import the file from `app-registrations/host.ts`). `inAppRestore` stays the platform's capability: the restore gate follows it (`DbBackupDeploymentMode.inAppRestoreEnabled`). Not open yet: the CLI deploy wizard's `DEPLOYMENT_MODE` validator and the factory reset's `saas` check (it compares the mode name).

### Allowing an app guard

Declare it to the suite, naming the guard class and why a global guard is right for it; import `PlatformHostCoreModule.forRoot()` before the module that registers it so `MaintenanceGuard` stays first:

```ts
runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { host: { rootModule: AppModule, allowedAppGuards: [{ name: 'ThrottlerGuard', why: 'Global rate limit; reads nothing but the address.' }] } },
});
```

An empty `why` throws, a guard that is not listed is a finding, a listed guard nobody registers is a finding (no stale allowances), and so is any guard registered ahead of `MaintenanceGuard`.

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

- **One platform guard, first.** `MaintenanceGuard` is the platform's only `APP_GUARD`; authentication and authorization are per route (`@Auth()` / `@Public()`). The `host` conformance suite fails an app that registers another `APP_GUARD` anywhere in its module graph unless the app lists it, with a written reason, in `allowedAppGuards`, and it fails any guard that would run before `MaintenanceGuard`.
- **A bypass is fail-closed.** It runs only for a request the window would refuse, sees frozen copies, and anything but `true` (a throw, a timeout, a truthy non-boolean) means blocked; it can add an allowance and never remove one, so it cannot change what an admin sees. It passes the window and nothing else: the route's own authentication still runs.
- **The health probes are public.** Indicator details are bounded and secret-filtered by the runner, and an indicator's error text is logged, never returned.
- **The guard authenticates nobody.** It verifies an admin session JWT only to honour `allowAdmins`, against the same `jwt.secret` as the identity slice, with a `JwtModule` of its own (it never imports `AuthModule` and never re-exports its `JwtService`); it never writes `request.user`. Opaque `pat_` and `nod_` bearers are never admins during a window.
- **Docs stay readable during a window.** `/api/docs` and `/api/openapi.json` are raw Fastify routes outside Nest's router; the degraded 503 carries no error detail (it is in the log).
- **Never put a secret on the bus.** A NOTIFY payload is readable by any session with the application's database credentials.

## Conformance suite

`@marinoscar/platform-api/host/testing` registers the `host` suite (option key `host`) with `runPlatformConformance()`. It walks the app's module graph from `rootModule` without booting it:

1. `app-guard`: `MaintenanceGuard` is registered as an `APP_GUARD` exactly once and runs first, and every other `APP_GUARD` is listed in `allowedAppGuards` with a reason (no global JWT guard).
2. `host-core`: `PlatformHostCoreModule.forRoot()` is imported exactly once (one event bus per process).
3. `envelope`: `TransformInterceptor` and `HttpExceptionFilter` are global, once each.

```ts
import '@marinoscar/platform-api/host/testing';
runPlatformConformance({ sourceRoots: [API_SOURCE_ROOT], suites: { host: { rootModule: AppModule /*, allowedAppGuards: [{ name, why }] */ } } });
```

The reference app's behavioural suites stay with the composed app: the maintenance window end to end (`apps/api/test/maintenance/`), the exempt route set, the document and the docs routes (`apps/api/test/openapi/`), the Postgres bus against a real database (`apps/api/test/event-bus/postgres-event-bus.db.spec.ts`).

## Upgrade notes

### Unreleased (#931)

Additive; every default is unchanged. New: the registries `registerHealthIndicator`, `registerMaintenanceBypass`, `registerAboutContributor`, `registerDeploymentMode`, `registerDeploymentCapability` and `registerResponseMetaContributor`; the `host` and `permissions` options of `PlatformHostCoreModule.forRoot` and the `host` and `permission` options of `AboutModule.forRoot`; `buildCorsOptions(raw, extra?)`; `allowedAppGuards` on the `host` suite. `GET /api/admin/about` gains an optional `extras` array and `api.deploymentMode` is documented as an id pattern instead of the two-value enum. `DeploymentMode` widens to `'self-hosted' | 'saas' | (string & {})` (so do the ports that carry it: `DbBackupDeploymentMode`, `UserDataEnvironment`), `DEPLOYMENT_MODES` is a deprecated alias of `BUILTIN_DEPLOYMENT_MODES`, `capabilitiesFor` throws for a mode nobody registered, and `DeploymentCapabilities` gains an index signature. `HealthController`, `MaintenanceController` and `AboutController` are created by `createHealthController`, `createMaintenanceController` and `createAboutController` (the exported names are the default instances, so existing imports keep working); `HealthController`'s constructor takes a `HealthIndicatorRunner` in place of `DatabaseHealthIndicator`. The `host` suite's `app-guard` case additionally requires `MaintenanceGuard` to be the first `APP_GUARD`.

### Unreleased (#920)

Additive. `PlatformHostCoreModule.forRoot` gains `eventBus` (a `PortBinding<EventBus>`), and `eventBusAdapter` / `EVENT_BUS_ADAPTER` now accept any adapter registered with `registerEventBusAdapter`. `EventBusAdapterName` widens to `'in-process' | 'postgres' | (string & {})`; `EVENT_BUS_ADAPTERS` stays as a deprecated alias of `BUILTIN_EVENT_BUS_ADAPTERS`. `EventBus` gains an optional `close()`. Behaviour change: an `eventBusAdapter` OPTION naming an unregistered id now fails the boot (it used to fall back to `in-process`); the `EVENT_BUS_ADAPTER` environment variable is unchanged (one warning, `in-process`). The internal `createEventBus` may return a promise (async adapters).

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
| Boot fails: `Unknown event bus adapter "x". Registered adapters: ...` | `eventBusAdapter: 'x'` names an adapter nobody registered, or registration ran after the app was created | `registerEventBusAdapter({ id: 'x', ... })` at import time, before `PlatformHostCoreModule.forRoot()` runs. |
| `EVENT_BUS_ADAPTER=redis` logs `Unrecognised EVENT_BUS_ADAPTER` and runs in-process | The id is not registered in this process | Register the adapter (it is listed in the warning's `registered adapters`). |
| Boot fails: `Nest can't resolve dependencies of the EVENT_BUS (?)` after `eventBus: { useFactory }` | A token in `inject` is not visible to the host core | Pass the module that provides it in `PlatformHostCoreModule.forRoot({ imports })`, or make it global. |
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

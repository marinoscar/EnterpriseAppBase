# @marinoscar/platform-api/telemetry

The API side of observability, packaged (issue #703, epic #528): the `telemetry` settings and the runtime export gate they drive, the runtime GreptimeDB connection and client, the explorer (guarded SQL, schema, export), the AI assistant, the Telemetry Dashboard with its metric-group registry and health verdict, the stack-agent surface, the two server-only job types, five Doctor checks, an egress contributor and a support-bundle section. It depends on `core`, `doctor` and `otel-core` (`packages/platform-slices.json`) and imports no app code: every app capability comes through a host port. The full reference and catalog land with #707; design and behaviour are in [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md).

## Purpose and scope

Owns every `/api/admin/telemetry/*` and `/api/telemetry/config` route, the `telemetry.retention.apply` and `telemetry.stack.deploy` job types (both server-only: they hold the GreptimeDB admin login and the stack-agent token, so neither declares `nodeResultSchema`/`persistNodeResult`), and the `telemetry.*` Doctor checks.

It does not own the web UI (`@marinoscar/platform-web/telemetry`, #704), the collector and GreptimeDB containers (`@marinoscar/platform-infra/telemetry`), the worker span relay (`@marinoscar/platform-cli/telemetry`), the wire shapes (`@marinoscar/platform-contract/telemetry`), or the OpenTelemetry SDK and export gate (`@marinoscar/platform-api/otel-core`). Jobs, settings storage, credentials, AI and auth stay in the app and are reached through ports.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`:

```ts
import { TelemetryModule } from '@marinoscar/platform-api/telemetry';
```

Beyond the package's peers, this slice needs `@nestjs/config` (the `greptime`, `stackAgent` and `otel` configuration namespaces) and `@nestjs/schedule` (the nightly retention cron). It brings `pg`, `exceljs` and `hyparquet-writer` as dependencies. Test fixtures are at `@marinoscar/platform-api/telemetry/testing`.

## Quick start

The reference app's binding ([`telemetry.config.ts`](../../../../apps/api/src/platform/telemetry/telemetry.config.ts)), imported once in its root module:

```ts
export const telemetryModule = TelemetryModule.forRoot({
  host: platformHost,               // the app's access decorators (definePlatformHost)
  imports: [TelemetryHostModule],   // exports one provider per telemetry port
  metricGroups: APP_METRIC_GROUPS,  // the app's own dashboard groups
});
```

[`TelemetryHostModule`](../../../../apps/api/src/platform/telemetry/telemetry-host.module.ts) binds the six ports to the app's adapters.

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host` | `PlatformHost` | required | The app's access decorators; every route is guarded by them. |
| `imports` | `ModuleMetadata['imports']` | required | Modules exporting the six host-port providers. |
| `metricGroups` | `readonly MetricGroupDef[]` | `[]` | Extra dashboard groups, registered after the six platform groups; documented in the `/metrics` `group` enum. |
| `actorId` | `(request) => string \| undefined` | `request.requestUser.id ?? request.user.id` | How a route reads the caller's id. |
| `dashboard.verdictThresholds` | `VerdictThresholdsOverride` | `{}` | Deep-merged over `DEFAULT_VERDICT_THRESHOLDS`; validated with zod at boot (a bad value, or a degraded bound beyond its critical one, fails boot naming the field). |
| `dashboard.verdictPolicy` | `PortBinding<VerdictPolicy>` | `{ useExisting: DefaultVerdictPolicy }` | What `VERDICT_POLICY` is bound to. |

The deployment defaults `GREPTIME_*` and `STACK_AGENT_URL`/`STACK_AGENT_TOKEN` are read through `ConfigService` (`greptime`, `stackAgent`); the runtime connection saved at `/admin/settings/telemetry` overrides `GREPTIME_*`.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `TelemetryModule.forRoot` | option | `forRoot(options: TelemetryModuleOptions): DynamicModule` | Mount the slice once in the app's root module | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry.config.ts) |
| `TelemetryModuleOptions` | option | `{ host; imports; metricGroups?; actorId?; dashboard? }` | Bind the ports, add metric groups, tune the verdict | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry.config.ts) |
| `TELEMETRY_AUDIT_SINK` | token | `unique symbol` -> `TelemetryAuditSink` | Bind where telemetry's audit rows go | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-audit-sink.adapter.ts) |
| `TELEMETRY_SETTINGS_STORE` | token | `unique symbol` -> `TelemetrySettingsStore` | Bind the `telemetry` namespace, its provenance and the `telemetry_connection` row | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-settings-store.adapter.ts) |
| `TELEMETRY_CREDENTIAL_STORE` | token | `unique symbol` -> `TelemetryCredentialStore` | Bind the encrypted credential store (`telemetry_greptime`) | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-host.module.ts) |
| `TELEMETRY_JOBS` | token | `unique symbol` -> `TelemetryJobsPort` | Bind the queue: enqueue, housekeeping enqueue, handler registry, job reads | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-jobs.adapter.ts) |
| `TELEMETRY_AI` | token | `unique symbol` -> `TelemetryAiPort` | Bind the AI platform (`forUser(userId).runTools`, `assertEnabled`) | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-ai.adapter.ts) |
| `TELEMETRY_APP_INFO` | token | `unique symbol` -> `TelemetryAppInfo` | Bind the app's slug, service name, version and deploy document | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-app-info.adapter.ts) |
| `TELEMETRY_VERDICT_THRESHOLDS` | token | `unique symbol` -> `VerdictThresholds` | Read the resolved thresholds in an app policy or check | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `VERDICT_POLICY` | token | `unique symbol` -> `VerdictPolicy` | Replace or extend the summary's verdict (delegate to `DefaultVerdictPolicy`) | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `MetricGroupRegistry.register` | registry | `register(definition: MetricGroupDefinition): void` | Add a metric group from the app's own `onModuleInit` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `registerMetricGroup` | registry | `registerMetricGroup(registry, definition): void` | The function form of `MetricGroupRegistry.register` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |

Supporting exports: the port interfaces (`TelemetryAuditSink`, `TelemetrySettingsStore`, `TelemetryCredentialStore`, `TelemetryJobsPort`, `TelemetryJobHandler`, `TelemetryAiPort` and its tool-loop types, `TelemetryAppInfo`), `TelemetryAiEnabledGuard`, the four exported services (`GreptimeClient`, `TelemetrySettingsService`, `TelemetryQueryService`, `TelemetrySchemaService`), `DEFAULT_VERDICT_THRESHOLDS` (and the deprecated `DASHBOARD_VERDICT_THRESHOLDS`), `computeVerdict`, `DefaultVerdictPolicy`, the metric-catalog types (`MetricGroupDef`, `GaugeFamily`, `CounterFamily`, `HistogramFamily`, `MetricRatio`, `MetricTableSpec`, ...), `metricGroupRegistry` and its live views, the permission and settings data, the job-type strings, `TelemetryHttpError` and `analyzeStatement`.

## Data

None. The slice owns no Prisma model: it stores its policy and connection through `TELEMETRY_SETTINGS_STORE`, its passwords through `TELEMETRY_CREDENTIAL_STORE`, its audit rows through `TELEMETRY_AUDIT_SINK`, and its jobs through `TELEMETRY_JOBS`.

## Permissions and settings

`TELEMETRY_PERMISSION_DECLARATIONS` declares `telemetry:read` (settings, status, connection), `telemetry:write` (change them) and `telemetry:query` (SQL, export, dashboard, assistant), all granted to `admin` by default; the app registers them in its permission registry. Routes also require app permissions listed in `TELEMETRY_HOST_PERMISSIONS`: `ai:use` (assistant, all-of with `telemetry:query`) and `system_settings:read`/`write` (stack). The `telemetry` settings namespace is `TELEMETRY_SETTINGS_NAMESPACE`, with `TELEMETRY_SETTINGS_DEFAULTS` (off), `mergeTelemetrySettings` and the contract's `telemetrySettingsSchema`.

## UI

None. The web pages are `@marinoscar/platform-web/telemetry` (#704).

## Infra

None in this slice. It reads GreptimeDB over its PostgreSQL wire protocol and the stack agent over HTTP; the containers come from `@marinoscar/platform-infra/telemetry`.

## Observability

Logs through `new Logger(Context)`. Every caller-supplied or assistant statement is audited (`telemetry:query`, `telemetry:export`, `telemetry:assistant_query`), as are dashboard reads (`telemetry:dashboard`), config, connection and stack writes. The export gate itself is `otel-core`'s `telemetryGate`, driven by `TelemetrySettingsService`.

## Security notes

No key material reaches the slice: the assistant calls models only through `TELEMETRY_AI` (`AiService.forUser` in the app), and no route, log line or audit row carries a password. GreptimeDB passwords are write-only and stored through the credential port. The SQL guard admits one read-only statement; the reader login is read-only. Both job types are server-only. The Doctor checks are read-only and never call the audited connection test.

## Conformance suite

The app's `cronEnqueueOnly` conformance run scans this slice's source (`apps/api/test/jobs/cron-source-roots.ts`), so `TelemetryRetentionTask` stays enqueue-only. The slice's own conformance suite comes with #707.

## Upgrade notes

0.1.0: moved from `apps/api/src/telemetry/` with no behaviour change; the routes, job types, permission strings, audit actions and OpenAPI document are unchanged. `DASHBOARD_VERDICT_THRESHOLDS` is deprecated in favour of `DEFAULT_VERDICT_THRESHOLDS` and the injected `TELEMETRY_VERDICT_THRESHOLDS`.

## Troubleshooting

- `Nest can't resolve dependencies ... Symbol(@marinoscar/platform/telemetry/...)`: a port is not exported by any module in `imports`.
- `TelemetryModule.forRoot: \`dashboard.verdictThresholds\` is invalid (...)`: fix the named field.
- `Duplicate metric group id` / `family key ... is already used`: two groups claim one id or key; boot fails by design.
- `FROZEN` from `MetricGroupRegistry.register`: register from `onModuleInit` or `forRoot({ metricGroups })`, never after bootstrap.

## Links

- [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md) and [docs/runbooks/telemetry.md](../../../../docs/runbooks/telemetry.md)
- [docs/specs/platform-packages.md](../../../../docs/specs/platform-packages.md)
- [core host ports](../core/README.md), [doctor](../doctor/README.md), [otel-core](../otel-core/README.md)
- [@marinoscar/platform-contract/telemetry](../../../platform-contract/src/telemetry/README.md)

# @marinoscar/platform-api/otel-core

`@marinoscar/platform-api/otel-core`: the **emitting** half of telemetry. It installs the OpenTelemetry Node SDK behind a runtime export gate, creates every application metric from one name registry with bounded labels, hands gauge providers their context, writes route and caller attributes on the HTTP server span, and offers `@Trace()`. Every instrumented slice emits through it. Two subpaths: `@marinoscar/platform-api/otel-core` (Nest-facing) and `@marinoscar/platform-api/otel-core/sdk` (Nest-free, loaded first). Extracted from the reference app's `apps/api/src/common/otel/` and `instrumentation.ts` by issue #700. Depends on the `core` slice only (the registry primitive; `packages/platform-slices.json`).

## Purpose and scope

Does:

- **SDK bootstrap** (`initializeOtel`, `sdk` subpath): OTLP/HTTP traces, metrics (every 60 s) and logs, each behind a gated exporter; Node auto-instrumentations (health probes ignored, fs off, pino log sending on); a SIGTERM shutdown. Nothing at all when `OTEL_ENABLED` is not `true`.
- **Runtime export gate** (`telemetryGate`): starts closed; the app opens it from its own setting. It also stamps `app.instance.id` on every exported batch.
- **Metrics host** (`MetricsHostService`, global through `OtelMetricsModule`): the `app` meter, every counter and histogram declared in the **app-metric name registry** (`appMetricRegistry`), the generic `add(key, …)` / `record(key, …)`, label bounding (`boundLabel`, `shapeLabel`), and the **gauge-provider seam** (`registerGaugeProvider`, `gaugeContext`, `createRegisteredGauge`).
- **Spans**: `registerRequestSpanAttributes` (`http.route`, `app.route.matched`, `app.request.bearer` on the server span) and `@Trace()`.
- **Identity resolvers**: `resolveServiceName(fallback)`, `resolveTelemetryInstanceId(configured, fallback)`, `ATTR_APP_INSTANCE_ID`.

Does not:

- View or query telemetry: the GreptimeDB client, the dashboard, the explorer, metric groups, retention and the telemetry settings are the telemetry product (the `telemetry` slice of this package, [`../telemetry/README.md`](../telemetry/README.md)).
- Declare any metric. The registry starts empty; the reference app registers its platform metrics (jobs, backup, auth, AI, notifications, nodes, event bus) and its own from `apps/api/src/common/otel/app-metric.manifest.ts`, and keeps the typed recorders and the database-backed gauges in `AppMetricsService` until those move with their slices.
- Know the product identity. The package never reads `@app/shared`: the app passes its slug (`resolveServiceName(\`${APP_SLUG}-api\`)`); the reference app binds it once in [`telemetry-identity.ts`](../../../../apps/api/src/common/otel/telemetry-identity.ts).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpaths:

```ts
// The file the entry point loads FIRST (main.ts line 2: `import './instrumentation';`)
import { initializeOtel } from '@marinoscar/platform-api/otel-core/sdk';

// Everywhere else
import { MetricsHostService, OtelMetricsModule, registerRequestSpanAttributes } from '@marinoscar/platform-api/otel-core';
```

**Import the `sdk` subpath first, and only it, from the bootstrap file.** Auto-instrumentation patches only modules required after `sdk.start()`; the `sdk` subpath loads no `@nestjs/*` module (pinned by `test/otel-core/load-order.spec.ts`), while the Nest-facing index loads `@nestjs/common`.

Peers: `@opentelemetry/api` (already a package peer: one API instance per process holds the global providers), plus `@nestjs/common`, `@nestjs/core` and `fastify` for the Nest-facing half. The SDK packages (`@opentelemetry/sdk-node`, `auto-instrumentations-node`, the three `exporter-*-otlp-http`, `sdk-metrics`, `sdk-logs`, `sdk-trace-base`, `resources`, `semantic-conventions`, `core`) are regular **dependencies** of `@marinoscar/platform-api`; an app does not install them. The bootstrap requires them lazily, only when enabled.

## Quick start

1. Install the SDK first (the reference app's [`instrumentation.ts`](../../../../apps/api/src/instrumentation.ts), imported on line 2 of `main.ts`):

```ts
import { initializeOtel } from '@marinoscar/platform-api/otel-core/sdk';
import { resolveServiceName, resolveTelemetryInstanceId } from './common/otel/telemetry-identity';

export const sdk = initializeOtel({
  serviceName: resolveServiceName(),            // OTEL_SERVICE_NAME, else `${APP_SLUG}-api`
  instanceId: resolveTelemetryInstanceId(null), // APP_SLUG until the settings say otherwise
});
```

2. Provide the metrics host (the reference app's [`app-metrics.module.ts`](../../../../apps/api/src/common/otel/app-metrics.module.ts)):

```ts
@Global()
@Module({
  imports: [
    OtelMetricsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ gauges: config.get<boolean>('otel.enabled') === true }),
    }),
  ],
  providers: [AppMetricsService],
  exports: [AppMetricsService],
})
export class AppMetricsModule {}
```

3. Register the request span hook right after `NestFactory.create` (the reference app's [`main.ts`](../../../../apps/api/src/main.ts)), and drive the gate from the app's setting (the telemetry slice's [`telemetry-settings.service.ts`](../telemetry/telemetry-settings.service.ts)):

```ts
registerRequestSpanAttributes(app.getHttpAdapter().getInstance(), process.env.OTEL_ENABLED === 'true');

telemetryGate.setInstanceId(resolveTelemetryInstanceId(policy.instanceId));
telemetryGate.setEnabled(policy.enabled && greptime.isConfigured());
```

### Worked example: register an app metric name and a gauge provider

The reference app does both in [`apps/api/src/common/otel/app-metrics.service.ts`](../../../../apps/api/src/common/otel/app-metrics.service.ts) (its manifest registers the names; its `registerGauges()` is a gauge provider) and borrows the context for a gauge provider that lives in a feature slice in [`packages/platform-api/src/nodes/node-fleet-metrics.service.ts`](../nodes/node-fleet-metrics.service.ts). A new metric group follows the same steps:

```ts
// 1. Declare the names at import time, from a manifest the metrics service imports.
registerAppMetrics([
  { key: 'coachNudgesSent', name: 'app.coach.nudges.sent', kind: 'counter', unit: '{nudge}',
    description: 'Coach nudges sent, by channel.', attributes: { channel: { kind: 'free' } } },
  { key: 'coachBacklog', name: 'app.coach.backlog', kind: 'gauge', unit: '{nudge}',
    description: 'Coach nudges waiting to be sent.' },
]);

// 2. Type the keys (optional).
declare module '@marinoscar/platform-api/otel-core' {
  interface AppMetricKeys { coachNudgesSent: true; coachBacklog: true }
}

// 3. Emit the counter.
metricsHost.add('coachNudgesSent', 1, { channel: 'push' });

// 4. Observe the gauge from the module that owns the data.
metricsHost.registerGaugeProvider(({ meter, gateOpen }) => {
  const backlog = createRegisteredGauge(meter, 'coachBacklog');
  backlog.addCallback(async (result) => {
    if (!gateOpen()) return; // query nothing while export is off
    result.observe(await countPendingNudges());
  });
});
```

## Configuration

`initializeOtel(options?: InitializeOtelOptions)` (`sdk` subpath). Every option defaults to the reference app's behaviour:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | `boolean` | `process.env.OTEL_ENABLED === 'true'` | Install the SDK at all. `false`: log `OpenTelemetry disabled (OTEL_ENABLED !== true)`, return `null`. |
| `endpoint` | `string` | `OTEL_EXPORTER_OTLP_ENDPOINT` or `http://localhost:4318` | OTLP/HTTP base URL; `/v1/traces`, `/v1/metrics`, `/v1/logs` are appended. |
| `serviceName` | `string` | `resolveServiceName()` | `service.name` resource attribute. |
| `serviceVersion` | `string` | `npm_package_version` or `0.0.1` | `service.version` resource attribute. |
| `instanceId` | `string` | unchanged gate value | The `app.instance.id` the gate stamps until the app sets its own. |
| `ignoreIncomingPaths` | `readonly string[]` | `DEFAULT_IGNORED_INCOMING_PATHS` (`/api/health/live`, `/api/health/ready`) | Incoming URL substrings never traced. |
| `instrumentationOverrides` | `Record<string, Record<string, unknown>>` | `{}` | Per auto-instrumentation fields merged over the defaults (fs off, pino log sending on, the http ignore hook). |
| `shutdownOnSigterm` | `boolean` | `true` | Register the SIGTERM handler that shuts the SDK down and exits. |

Environment variables read (all pre-existing, none runtime-configured): `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_DEBUG` (with `NODE_ENV=development`: the SDK's diagnostics on the console), `NODE_ENV` (`deployment.environment`), `npm_package_version`. The slice adds no variable.

`OtelMetricsModule.forRoot(options?)` / `forRootAsync({ imports?, inject?, useFactory })` provide `MetricsHostOptions` under `METRICS_HOST_OPTIONS`; a bare `OtelMetricsModule` import takes every default:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `meter` | `Meter` | `metrics.getMeter('app')` | Where instruments are created (tests pass an in-memory `MeterProvider`'s). |
| `now` | `() => number` | `Date.now` | The clock gauge providers use. |
| `gateOpen` | `() => boolean` | `telemetryGate.isEnabled()` | Whether export is on; a gauge callback queries nothing while it is closed. |
| `gauges` | `boolean` | `process.env.OTEL_ENABLED === 'true'` (per call) | Whether gauge providers run in this process. |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `initializeOtel` | option | `initializeOtel(options?: InitializeOtelOptions): NodeSDK \| null` | Install the SDK from the file the entry point loads first | experimental | [example](../../../../apps/api/src/instrumentation.ts) |
| `InitializeOtelOptions` | option | `{ enabled?; endpoint?; serviceName?; serviceVersion?; instanceId?; ignoreIncomingPaths?; instrumentationOverrides?; shutdownOnSigterm? }` | Name the service, seed the instance id, change the endpoint, ignored paths or instrumentations | experimental | [example](../../../../apps/api/src/instrumentation.ts) |
| `telemetryGate` | hook | `{ isEnabled(); setEnabled(next); instanceId(); setInstanceId(next) }` | Open or close export at runtime and relabel the instance from the app's own setting | stable | [example](../../../../apps/api/src/common/otel/telemetry-identity.ts) |
| `appMetricRegistry` | registry | `Registry<AppMetricDef>` | Read the declared metrics (`list()`, `require(key)`), for example to build a name table | stable | [example](../../../../apps/api/src/common/otel/app-metrics.service.ts) |
| `registerAppMetrics` | registry | `registerAppMetrics(defs: readonly AppMetricDef[]): void` | Declare an app's `app.*` metrics (name, unit, buckets, attributes) at import time | stable | [example](../../../../apps/api/src/common/otel/app-metric.manifest.ts) |
| `MetricsHostService.registerGaugeProvider` | registry | `registerGaugeProvider(provider: (ctx: AppGaugeContext) => void): boolean` | Add observable gauges whose callbacks read the app's own data | experimental | [example](../../../../apps/api/src/common/otel/app-metrics.service.ts) |
| `METRICS_HOST_OPTIONS` | token | `unique symbol` -> `MetricsHostOptions` | Provide an explicit meter, clock, gate or gauge switch (tests, custom wiring) | experimental | [example](../../../../apps/api/src/common/otel/app-metrics.service.ts) |
| `OtelMetricsModule.forRootAsync` | option | `forRootAsync({ imports?, inject?, useFactory }): DynamicModule` | Build the host options from the app's configuration | experimental | [example](../../../../apps/api/src/common/otel/app-metrics.module.ts) |
| `registerRequestSpanAttributes` | hook | `registerRequestSpanAttributes(fastify, otelEnabled: boolean): boolean` | Write route and caller attributes on every HTTP server span | stable | [example](../../../../apps/api/src/main.ts) |
| `Trace` | hook | `Trace(spanName?: string, options?: { tracer? }): MethodDecorator` | Wrap one async method in an INTERNAL span | experimental | [example](../../../../apps/api/test/platform/otel-disabled.spec.ts) |

Supporting exports. `sdk` subpath (also re-exported by the index): `GatedSpanExporter`, `GatedLogRecordExporter`, `GatedPushMetricExporter`, `stampResource`, `TelemetryGate`, `instrumentationConfig`, `resolveServiceName`, `resolveTelemetryInstanceId`, `ATTR_APP_INSTANCE_ID`, `DEFAULT_SERVICE_NAME`, `DEFAULT_INSTANCE_ID`, `DEFAULT_IGNORED_INCOMING_PATHS`, `DEFAULT_OTLP_ENDPOINT`, `METRIC_EXPORT_INTERVAL_MS`. Index: `MetricsHostService` (`meter`, `now`, `gateOpen`, `counter(key)`, `histogram(key)`, `add`, `record`, `boundLabel`, `gaugesEnabled`, `gaugeContext`), `MetricsHostOptions`, `OtelMetricsModule` (and `forRoot`), `OtelMetricsModuleAsyncOptions`, `APP_METER_NAME`, `AppMetricDef`, `AppMetricAttribute`, `AppMetricKind`, `AppMetricKeys` (augmentable), `AppMetricKeyLike`, `assertAppMetric`, the three name patterns, `createRegisteredGauge`, `AppGaugeContext`, `GaugeProvider`, `LabelBudget`, `shapeLabel`, `enumLabel`, `nonNegative`, `MAX_DISTINCT_VALUES`, `OTHER_LABEL`, `UNKNOWN_LABEL`, `requestSpanAttributesHook`, `hasBearer`, `ATTR_HTTP_ROUTE`, `ATTR_APP_ROUTE_MATCHED`, `ATTR_APP_REQUEST_BEARER`, `TraceOptions`.

## Data

None. No models, migrations or seeds. The gate, the registry and the label budgets are process memory.

## Permissions and settings

None of its own. The slice declares no permission and reads no system setting: the app decides when the gate opens (the reference app: the `telemetry.enabled` and `telemetry.instanceId` settings, read by its telemetry module) and whether gauges run (`otel.enabled`).

## UI

None. Viewing telemetry (the Telemetry settings, Explorer and Dashboard pages) belongs to the telemetry product, not to the emitting slice.

## Infra

The SDK exports OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`). The reference collector is [`infra/otel/otel-collector-config.yaml`](../../../../infra/otel/otel-collector-config.yaml) (started by `infra/compose/telemetry.compose.yml`, which also sets `OTEL_ENABLED=true` on the `api` service); its `attributes/redact` processor deletes credential attributes before storage. Without a collector and with `OTEL_ENABLED` unset the app runs unchanged: no SDK, no exporter, no connection attempt.

## Observability

By itself the slice emits nothing but what passes the gate:

- Console lines at boot: `OpenTelemetry disabled (OTEL_ENABLED !== true)` or `OpenTelemetry initialized - exporting to <endpoint> once the telemetry.enabled setting opens the gate`; on SIGTERM `OpenTelemetry SDK shut down` (or `Error shutting down OTEL SDK`).
- Resource attributes on everything exported: `service.name`, `service.version`, `deployment.environment`, and `app.instance.id` (stamped at export time by the gate, so it can change at runtime).
- Span attributes from the request hook: `http.route` (matched requests), `app.route.matched=false` (unknown routes), `app.request.bearer` (header present, never the token).
- `debug` logs from `MetricsHostService`: an unknown or mismatched metric key (once per key), a failed recording, a gauge provider that threw.
- The metrics themselves are the app's declarations; the package defines none.

## Security notes

- **No secret in an attribute or a label.** `app.request.bearer` reads only the header's scheme. Label bounding admits identifier-shaped values only: at most 64 characters of `[A-Za-z0-9_.:/@+-]`, never address-shaped (`shapeLabel` maps an email-like value to `other`), at most `MAX_DISTINCT_VALUES` (100) distinct values per attribute key per process, and enum attributes only their declared values. Never declare a user id, an email, a URL or an error message as an attribute.
- **Export is off until the app says otherwise.** The gate starts closed; a deployment that switched telemetry off does not leak the first batches of a boot.
- **One copy per process.** The gate, the metric-name registry and the meter cache are module-level state. Two copies of `@marinoscar/platform-api` would mean two gates (the app opens one while the SDK exports through the other) and two registries: install exactly one copy (the platform single-instance check, `npm run check:single-instance`, guards the package name).

## Conformance suite

None yet. The slice is pinned by its package specs (`test/otel-core/`: bootstrap on and off, load order, gate, registry, metrics host, request attributes, `@Trace()`), and the reference app pins its metric surface (`apps/api/src/common/otel/app-metrics.service.spec.ts`: names, descriptions, units and buckets of a recorded export) and the OTEL-off boot (`apps/api/test/platform/otel-disabled.spec.ts`).

## Upgrade notes

First packaged release (#700). Moving from the app's own `apps/api/src/common/otel/`:

- `instrumentation.ts` becomes `initializeOtel({ serviceName, instanceId })` from `@marinoscar/platform-api/otel-core/sdk`; keep it the first import of `main.ts`.
- Import `telemetryGate`, `registerRequestSpanAttributes`, `Trace`, the gated exporters and the app-metric registry (`appMetricRegistry`, `registerAppMetrics`, `AppMetricDef`) from the package. Augment `AppMetricKeys` on `'@marinoscar/platform-api/otel-core'`.
- `resolveServiceName()` and `resolveTelemetryInstanceId(configured)` now take the app's fallback (`${APP_SLUG}-api`, `APP_SLUG`); bind them once in the app.
- `AppMetricsService` keeps its API and builds on `MetricsHostService`; `APP_METRICS_OPTIONS` is now `METRICS_HOST_OPTIONS`. Metric names, units, buckets, labels and gate semantics are unchanged.
- `@Trace()` resolves its tracer on first call and accepts `{ tracer }`; without `OTEL_SERVICE_NAME` it falls back to that option, then `DEFAULT_SERVICE_NAME`.
- The SDK packages are dependencies of `@marinoscar/platform-api`; the app may drop its own copies unless it imports them directly.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `OpenTelemetry disabled (OTEL_ENABLED !== true)` at boot, no data anywhere | Expected without the telemetry overlay. Set `OTEL_ENABLED=true` (the overlay does) and restart; the SDK cannot be installed at runtime. |
| SDK initialized but nothing reaches the collector | The gate is closed: the app has not opened it (reference app: the `telemetry.enabled` setting, and a configured GreptimeDB). |
| No `http`, `pg` or `pino` spans, only manual ones | Load order: something required those modules before `initializeOtel()`. Import the `sdk` subpath from the first file the entry point loads, never the Nest-facing index. |
| Gate opened but the exporter still drops, or a metric registered twice | Two copies of `@marinoscar/platform-api` in `node_modules`. Run `npm ls @marinoscar/platform-api` and `npm run check:single-instance`; dedupe to one. |
| `Duplicate app metric key` or `already declared by` at import | Two declarations share a key or an OTLP name; rename the app's. |
| `Registry "app-metrics" is frozen` | A metric was registered after bootstrap; register from the manifest at import time. |
| A metric's attribute shows `other` | The value is not identifier-shaped, is an undeclared enum value, or the key's 100-value budget is spent. Use a lower-cardinality dimension. |
| Gauges never appear | `gauges` is off (`OTEL_ENABLED` not `true`), the gate is closed (callbacks query nothing), or the provider threw (see the `debug` log). |
| Spans carry `app.instance.id=unknown` | The app never set its default: pass `instanceId` to `initializeOtel` or call `telemetryGate.setInstanceId` at startup. |

## Links

- Spec: [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md) (§2 the two switches, §8 the runtime connection, §11.13 application metrics, §11.15 request attributes); runbook: [docs/runbooks/telemetry.md](../../../../docs/runbooks/telemetry.md).
- Platform spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), Dependency graph and Worked example: a new metric group.
- The registry primitive: [core README](../core/README.md).
- Package README: [platform-api](../../README.md).

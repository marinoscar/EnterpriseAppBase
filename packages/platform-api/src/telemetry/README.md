# @marinoscar/platform-api/telemetry

The API side of observability, in the API layer: the `telemetry` settings and the runtime export gate they drive, the telemetry store port (`TelemetryStore`, `TelemetrySqlDialect`) with GreptimeDB as its built-in implementation, the runtime GreptimeDB connection and client, the explorer (guarded SQL, schema, export), the AI assistant, the Telemetry Dashboard with its metric-group registry and health verdict, the stack-agent surface, two server-only job types, five Doctor checks, an egress contributor and a support-bundle section. It depends on `core`, `credentials`, `doctor`, `otel-core` and, only from `telemetry/testing`, `testing` (`packages/platform-slices.json`) and imports no app code: every app capability comes through a host port. Design and behaviour: [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md); packaging and the extension contract: [section 12](../../../../docs/specs/telemetry.md#12-packaging-and-extension-points).

An app replaces the store the telemetry is kept and queried in with one registration and one option ([Replacing the store](#replacing-the-store-rung-2)): [`memory-store.ts`](../../../../apps/api/src/platform-extensions/telemetry/memory-store.ts), registered from [`app-registrations/telemetry.ts`](../../../../apps/api/src/app-registrations/telemetry.ts).

An app adds its own dashboard group with one file and one option: [`activity.metric-group.ts`](../../../../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts) and `metricGroups` in [`telemetry.config.ts`](../../../../apps/api/src/platform/telemetry/telemetry.config.ts).

## Purpose and scope

Owns every `/api/admin/telemetry/*` and `/api/telemetry/config` route, the `telemetry.retention.apply` and `telemetry.stack.deploy` job types (both server-only: they hold the GreptimeDB admin login and the stack-agent token, so neither declares `nodeResultSchema`/`persistNodeResult`), and the `telemetry.*` Doctor checks.

It does not own the web UI (`@marinoscar/platform-web/telemetry`), the collector and GreptimeDB containers (`@marinoscar/platform-infra/telemetry`), the worker span relay (`@marinoscar/platform-cli/telemetry`), the wire shapes (`@marinoscar/platform-contract/telemetry`), or the OpenTelemetry SDK and export gate (`@marinoscar/platform-api/otel-core`). Jobs, settings storage, credentials, AI and auth stay in the app and are reached through ports.

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`:

```ts
import { TelemetryModule } from '@marinoscar/platform-api/telemetry';
```

Beyond the package's required peers (and those of `core`, `doctor` and `otel-core`, which it depends on), this slice needs the optional peers `@nestjs/config` (the `greptime`, `stackAgent` and `otel` configuration namespaces), `@nestjs/schedule` (the nightly retention cron) and `fastify` (the reply types of the SSE and export routes). Nothing else: no Passport, `@nestjs/jwt` or `@nestjs/event-emitter`. The consumer smoke `tests/consumer-smoke/api-slim` proves it. `telemetry/testing` also needs the optional `@nestjs/platform-fastify`. It brings `pg`, `exceljs` and `hyparquet-writer` as dependencies. Test fixtures are at `@marinoscar/platform-api/telemetry/testing`.

## Quick start

The reference app's binding ([`telemetry.config.ts`](../../../../apps/api/src/platform/telemetry/telemetry.config.ts)), imported once in its root module:

```ts
export const telemetryModule = TelemetryModule.forRoot({
  host: platformHost,                // the app's access decorators (definePlatformHost)
  imports: [TelemetryHostModule],    // exports one provider per telemetry port
  // the reference app's own group first, then the fork's (empty upstream)
  metricGroups: [ACTIVITY_METRIC_GROUP, ...APP_METRIC_GROUPS],
  dashboard: { verdictThresholds: REFERENCE_VERDICT_THRESHOLDS },
});
```

[`TelemetryHostModule`](../../../../apps/api/src/platform/telemetry/telemetry-host.module.ts) binds the six ports to the app's adapters. Three more steps finish the wiring, each in the file that owns it:

| Step | Reference-app file |
|---|---|
| Register the permissions with the app's permission registry | [`permission.manifest.ts`](../../../../apps/api/src/common/permissions/permission.manifest.ts): `registerPlatformPermissions()` (`@marinoscar/platform-api/manifest`) registers `TELEMETRY_PERMISSION_DECLARATIONS` with every other slice's, in seed order |
| Register the `telemetry` settings namespace | [`telemetry.system-settings.ts`](../../../../apps/api/src/platform/telemetry/telemetry.system-settings.ts) |
| Scan the slice's cron with the app's `cron-enqueue-only` run, and run the telemetry conformance suite | [`cron-source-roots.ts`](../../../../apps/api/test/jobs/cron-source-roots.ts), [`telemetry-conformance.spec.ts`](../../../../apps/api/test/telemetry/telemetry-conformance.spec.ts) |

## Configuration

`TelemetryModule.forRoot(options: TelemetryModuleOptions)`. Options are validated once, when `forRoot` runs; a bad one fails boot naming the field.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `host` | `PlatformHost` | required | The app's access decorators; every route is guarded by them, so no route is ever public. |
| `imports` | `ModuleMetadata['imports']` | required | Modules exporting the six host-port providers. |
| `metricGroups` | `readonly MetricGroupDef[]` | `[]` | Extra dashboard groups, registered after the six platform groups before the controllers are built, so the `/metrics` route documents them in its `group` enum. A duplicate id or family key fails boot. |
| `actorId` | `(request: unknown) => string \| undefined` | `request.requestUser.id`, else `request.user.id` | How a route reads the caller's user id. |
| `dashboard.verdictThresholds` | `VerdictThresholdsOverride` | `{}` | Deep-merged over `DEFAULT_VERDICT_THRESHOLDS`, validated with zod (a degraded bound beyond its critical one is refused). Every reader takes the resolved values from `TELEMETRY_VERDICT_THRESHOLDS`. |
| `dashboard.verdictPolicy` | `PortBinding<VerdictPolicy>` | `{ useExisting: DefaultVerdictPolicy }` | What `VERDICT_POLICY` is bound to. A policy's own dependencies come from `imports`. |
| `store` | `string` | `greptime` | The id of the telemetry store the explorer, the dashboard, the status page, the retention job and the Doctor use. It must be registered (`registerTelemetryStore`) before `forRoot` runs; an id nobody registered fails boot naming the registered ones. The built-in `greptime` binds the port to `GreptimeClient`; any other store is built by `TelemetryStoreResolver` from its `telemetry_store` settings and secrets. |
| `assistant.extraInstructions` | `string` | none | Notes from the app's developers appended to the assistant's system prompt as an `APPLICATION NOTES` section, at most 4 000 characters of plain text. Developer-authored at build time, never read from a user or from stored settings. A longer string or a control character fails boot. Read the resolved value from `TELEMETRY_ASSISTANT_EXTRA_INSTRUCTIONS`. |
| `metrics.freshMs` | `number` (ms) | `METRIC_FRESH_MS` (150 000) | The metric groups' freshness window: a per-key table cell read as `last` (and an uptime check) older than its table's newest reading by more than this is not current. A whole number from 1 000 to 86 400 000; anything else fails boot. Raise it when the app exports metrics less often than every 60 s. `/metrics` reports it as `freshMs`, and the web section header shows it. Read the resolved value from `TELEMETRY_METRIC_FRESH_MS`. |

The deployment defaults `GREPTIME_*` and `STACK_AGENT_URL` / `STACK_AGENT_TOKEN` are read through `ConfigService` (`greptime`, `stackAgent`, `otel`); the connection saved at `/admin/settings/telemetry` overrides `GREPTIME_*`. See [Infra](#infra).

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Order follows the extension ladder: options (rung 1), registries (rung 2), tokens (rung 3). Every row links a working use in the reference app. `Stability` is `experimental` for the module options and every host port (the ports are replaced when jobs, settings and AI are packaged) and `stable` for the metric-group shape, the thresholds and the settings schema.

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `TelemetryModule.forRoot` | option | `forRoot(options: TelemetryModuleOptions): DynamicModule` | Mount the slice once in the app's root module | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry.config.ts) |
| `TelemetryModuleOptions` | option | `{ host; imports; metricGroups?; actorId?; dashboard?; metrics?; store?; assistant? }` | Bind the ports, add metric groups, tune the verdict, add notes to the assistant | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry.config.ts) |
| `TelemetryDashboardOptions` | option | `{ verdictThresholds?: VerdictThresholdsOverride; verdictPolicy?: PortBinding<VerdictPolicy> }` | Tune the dashboard's verdict thresholds, or bind a policy | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/reference-verdict-thresholds.ts) |
| `TelemetryMetricsOptions` | option | `{ freshMs?: number }` | Widen or narrow the metric tables' freshness window (default 150 s) | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `DEFAULT_VERDICT_THRESHOLDS` | option | `VerdictThresholds` | Read the shipped thresholds to see every knob `verdictThresholds` may override | stable | [example](../../../../apps/api/src/platform-extensions/telemetry/reference-verdict-thresholds.ts) |
| `MetricGroupDef` | option | `{ id; label; title; order; description; families; ratios?; tables?; presentation? }` | Declare an app's dashboard group: its counters, gauges, histograms, ratios and tables, and optionally how the dashboard presents them | stable | [example](../../../../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts) |
| `MetricGroupRegistry.register` | registry | `register(definition: MetricGroupDefinition): void` | Add a metric group from the app's own `onModuleInit` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `registerMetricGroup` | registry | `registerMetricGroup(registry, definition): void` | The function form of `MetricGroupRegistry.register` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `TELEMETRY_PERMISSION_DECLARATIONS` | registry | `{ TELEMETRY_READ; TELEMETRY_WRITE; TELEMETRY_QUERY }`, each `{ id; description; scope; defaultGrants }` (`scope: 'system'`) | Register the three permissions with the app's permission registry | experimental | [example](../../../../apps/api/src/common/permissions/permission.manifest.ts) |
| `telemetrySettingsSchema` | schema | `ZodObject<{ enabled; retentionDays; instanceId; query; assistant }>` (re-exported from the contract) | Validate or `.extend()` the `telemetry` settings namespace in the app's settings registry | stable | [example](../../../../apps/api/src/platform/telemetry/telemetry.system-settings.ts) |
| `TELEMETRY_AUDIT_SINK` | token | `unique symbol` -> `TelemetryAuditSink` | Bind where telemetry's audit rows go | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-audit-sink.adapter.ts) |
| `TELEMETRY_SETTINGS_STORE` | token | `unique symbol` -> `TelemetrySettingsStore` | Bind the `telemetry` namespace, its provenance and the `telemetry_connection` row | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-settings-store.adapter.ts) |
| `TELEMETRY_CREDENTIAL_STORE` | token | `unique symbol` -> `TelemetryCredentialStore` | Bind the encrypted credential store (`telemetry_greptime`) | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-host.module.ts) |
| `TELEMETRY_JOBS` | token | `unique symbol` -> `TelemetryJobsPort` | Bind the queue: enqueue, housekeeping enqueue, handler registry, job reads | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-jobs.adapter.ts) |
| `TELEMETRY_AI` | token | `unique symbol` -> `TelemetryAiPort` | Bind the AI platform (`forUser(userId).runTools`, `assertEnabled`) | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-ai.adapter.ts) |
| `TELEMETRY_APP_INFO` | token | `unique symbol` -> `TelemetryAppInfo` | Bind the app's slug, service name, version and deploy document | experimental | [example](../../../../apps/api/src/platform/telemetry/telemetry-app-info.adapter.ts) |
| `TELEMETRY_VERDICT_THRESHOLDS` | token | `unique symbol` -> `VerdictThresholds` | Read the resolved thresholds in an app policy or check | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `TELEMETRY_METRIC_FRESH_MS` | token | `unique symbol` -> `number` | Read the resolved freshness window in an app check or test | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `VERDICT_POLICY` | token | `unique symbol` -> `VerdictPolicy` | Replace or extend the summary's verdict: delegate to `DefaultVerdictPolicy` and add a rule | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/examples/activity-verdict-policy.ts) |
| `registerTelemetryStore` | registry | `registerTelemetryStore(def: TelemetryStoreDefinition): void` | Add a telemetry store (a time-series database, a warehouse, a fake) the slice can query; call it at import time, then select it with `forRoot({ store })` | experimental | [example](../../../../apps/api/src/app-registrations/telemetry.ts) |
| `TelemetryStoreDefinition` | registry | `PluggableImplementation<{ store; dialect }, TelemetryStoreBuildContext>`: `{ id; label; settingsSchema; defaults; secrets?; build }` | Describe a store: its own settings and secrets (a generated admin form) and `build`, which returns the store and its dialect | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/memory-store.ts) |
| `TelemetryStore` | registry | `{ id; database; isConfigured(); configurationProblem(); query(sql, params, { readOnly: true, timeoutMs, signal? }); schema(); ping(); close(); retention? }` | The connection every service reads through: run a read-only statement, describe the schema, answer a ping, optionally control retention | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/memory-store.ts) |
| `TelemetrySqlDialect` | registry | `{ id; timestampColumn; valueColumn; timeBucket(); percentile(); regexpReplaceAll(); jsonString(); containsIgnoreCase(); castText(); limit() }` | Spell the seven constructs of the dashboard SQL that are not portable (the rest of it is ANSI-flavoured) | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/memory-store.ts) |
| `telemetryStoreKind` | registry | `PluggableKind<TelemetryStoreInstance, TelemetryStoreBuildContext>` | Read the registered stores (`ids()`, `get(id)`, `describe`) or run the pluggable-kind kit over them | experimental | [example](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts) |
| `TELEMETRY_STORE` | token | `unique symbol` -> `TelemetryStore` | Inject the active store in an app service or check (the resolved store, never the concrete class) | experimental | [example](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts) |
| `TELEMETRY_SQL_DIALECT` | token | `unique symbol` -> `TelemetrySqlDialect` | Inject the active store's dialect to build SQL the way the dashboard does | experimental | [example](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts) |
| `describeTelemetryStoreConformance` | registry | `describeTelemetryStoreConformance(store: TelemetryStoreDefinition \| string, options): void` (from `/telemetry/testing`) | Prove a store honours the contract: read-only, timeout, abort, schema, ping, close, the dialect and every dashboard statement over a fixture | experimental | [example](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts) |
| `TelemetryAssistantOptions` | option | `{ extraInstructions?: string }` | Add developer notes (at most 4 000 characters of plain text) to the assistant's system prompt, as `forRoot({ assistant })` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `registerMetricUnit` | registry | `registerMetricUnit(unit: MetricUnitDef): void` | Add a unit (`usd`, `bytes_per_s`) a metric family, ratio or table column may name; the dashboard formats it from the descriptor `/metric-groups` serves. Call it at import time, before a group that uses it is registered | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts) |
| `MetricUnitDef` | option | `{ id; label; format: 'number' \| 'percent' \| 'bytes' \| 'duration-ms' \| 'duration-s' \| 'currency' \| 'text' \| 'boolean' \| 'timestamp'; currency?; decimals?; suffix? }` | Describe how the browser writes a value of the unit: a built-in format, never code | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/activity.metric-group.ts) |
| `registerDashboardPanel` | registry | `registerDashboardPanel(panel: DashboardPanelDef): void` | Add a card to the Telemetry Dashboard: its `data(ctx)` reads the store through the guarded facade and returns JSON the app's web view draws | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts) |
| `DashboardPanelDef` | option | `{ id; label; order; data(ctx: DashboardPanelContext): Promise<unknown> \| unknown }` | Describe a panel: a permanent id, a title, an order and the function that reads its data | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts) |
| `dashboardPanelRegistry` | registry | `Registry<DashboardPanelDef>` | Read the registered panels (the platform's `api` and `logs` first), or isolate one in a test with `withTemporaryEntries` | experimental | [example](../../../../apps/api/test/examples/telemetry/signups.dashboard-panel.spec.ts) |
| `TelemetryQueryFacade` | hook | `{ query(sql, { maxRows? }): Promise<TelemetryFacadeResult>; sql: { literal; ident; timestamp; between }; dialect }` | The only way a panel or an assistant tool reads the store: one read-only statement per call, guarded, capped, timed out and audited, with a statement budget per request | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/signups.dashboard-panel.ts) |
| `registerTelemetryAssistantTool` | registry | `registerTelemetryAssistantTool(tool: TelemetryAssistantToolDef): void` | Add a read-only tool to the AI assistant: a name, a description for the model, a zod object schema for the arguments and a `run` that reads through the facade | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/top-features.assistant-tool.ts) |
| `TelemetryAssistantToolDef` | option | `{ name; description; inputSchema; output?: 'rows' \| 'aggregate'; run(input, ctx: TelemetryAssistantToolContext) }` | Describe a tool; `output: 'rows'` (the default) is withheld from the model while `assistant.shareResults` is off | experimental | [example](../../../../apps/api/src/platform-extensions/telemetry/top-features.assistant-tool.ts) |
| `telemetryAssistantToolRegistry` | registry | `Registry<TelemetryAssistantToolDef>` | Read the registered app tools, or isolate one in a test with `withTemporaryEntries` | experimental | [example](../../../../apps/api/test/examples/telemetry/top-features.assistant-tool.spec.ts) |
| `TELEMETRY_ASSISTANT_EXTRA_INSTRUCTIONS` | token | `unique symbol` -> `string \| null` | Read the resolved `assistant.extraInstructions` in an app check or test | experimental | [example](../../../../apps/api/test/telemetry/telemetry-extension-points.integration.spec.ts) |
| `telemetryConformanceSuite` | registry | `ConformanceSuite<TelemetryConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { telemetry } })` | experimental | [example](../../../../apps/api/test/telemetry/telemetry-conformance.spec.ts) |

Supporting exports: the unit and panel helpers (`metricUnitRegistry`, `metricUnitIds`, `isMetricUnit`, `isBuiltinDashboardPanel`, `PANEL_TIME_BUDGET_MS`, `DashboardPanelContext`, `DashboardPanelWindow`), the facade's types and bounds (`TelemetryFacadeResult`, `TelemetrySqlBuilders`, `TelemetryFacadeLimitError`, `FACADE_MAX_STATEMENTS`, `FACADE_MAX_ROWS`, `FACADE_DEFAULT_ROWS`), the assistant's `TelemetryAssistantToolContext`, `TelemetryAssistantOptions` and `TelemetryAssistantPromptExtension`, the store types (`TelemetryQueryResult`, `TelemetryStoreQueryOptions`, `TelemetryRetentionControl`, `TelemetrySchemaSnapshot`, `TelemetryPingResult`, `TelemetryStoreInstance`, `TelemetryStoreBuildContext`), `describeTelemetryStore`, `requireTelemetryStore`, `telemetryStoreIds`, `telemetryStoreCredentialPurpose`, `BUILTIN_TELEMETRY_STORE_ID`, `GREPTIME_SQL_DIALECT`, `quoteSqlIdent`, `quoteSqlLiteral`, `rowsAsObjects`, the store errors an implementation throws (`TelemetryStoreError`, `TelemetryNotConfiguredError`, `TelemetryQueryTimeoutError`, `TelemetryQueryAbortedError`, `TelemetryQueryFailedError`, `TelemetryMultiStatementError`), the port interfaces (`TelemetryAuditSink`, `TelemetrySettingsStore`, `TelemetryCredentialStore`, `TelemetryJobsPort`, `TelemetryJobHandler`, `TelemetryAiPort` and its tool-loop types, `TelemetryAppInfo`), `TelemetryAiEnabledGuard`, the four exported services (`GreptimeClient`, `TelemetrySettingsService`, `TelemetryQueryService`, `TelemetrySchemaService`), `computeVerdict`, `DefaultVerdictPolicy`, `resolveVerdictThresholds`, `resolveMetricFreshMs` and its default `METRIC_FRESH_MS`, the metric-catalog types (`GaugeFamily`, `CounterFamily`, `HistogramFamily`, `MetricRatio`, `MetricTableSpec`, ...), `metricGroupRegistry` and its live views, `TELEMETRY_PERMISSIONS`, `TELEMETRY_HOST_PERMISSIONS`, the settings data (`TELEMETRY_SETTINGS_NAMESPACE`, `TELEMETRY_SETTINGS_DEFAULTS`, `mergeTelemetrySettings`), the job-type strings, `TelemetryHttpError` and `analyzeStatement`. From `/telemetry/testing`: `describeTelemetryStoreConformance`, the conformance checks, `createStubTelemetryPorts` (with a `policy` patch and per-purpose secrets) and the metric-schema fixtures.

### Minimal examples

Add a unit, a presentation and a computed column to a group (rung 2). A presentation is data the dashboard renders; nothing in it is evaluated as code:

```ts
registerMetricUnit({ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 });

export const ACTIVITY_METRIC_GROUP: MetricGroupDef = {
  // ...id, families (one of them with unit: 'usd'), tables as above
  presentation: {
    tiles: [{ metric: 'authLogins', label: 'Sign-ins' }, { metric: 'aiSpend', color: 'info' }],
    series: [{ title: 'Sign-ins by outcome', metrics: ['authLogins'], colors: { success: 'ok', failed: 'crit' } }],
    tables: [{ metric: 'notificationEvents', topN: 5, sort: 'value-desc' }],
    virtualColumns: [{ id: 'failureRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'attempts'], table: 'notificationEvents' }],
  },
};
```

A colour is a theme token (`ok`, `warn`, `crit`, `info`, ...), never a CSS value. A presentation that names a metric the group does not declare, an unknown unit or a token outside the theme, or that exceeds its bounds, fails when the group is registered. A group without one renders every tile and table, as before.

Add a dashboard panel (rung 2) and read the store through the facade. Register the web view for the same id with `registerDashboardPanelView` ([web README](../../../platform-web/src/telemetry/README.md)):

```ts
registerDashboardPanel({
  id: 'signups', label: 'Sign-ins', order: 30,
  data: async (ctx) => {
    const { rows } = await ctx.query.query(
      `SELECT count(*) FROM app_auth_logins_total WHERE outcome = ${ctx.query.sql.literal('success')} AND ${ctx.query.sql.between('greptime_timestamp', ctx.window.from, ctx.window.to)}`);
    return { total: Number(rows[0]?.[0] ?? 0) };
  },
});
```

Add an assistant tool (rung 2). `run` receives the facade and no client; the loop validates the model's arguments against the schema first:

```ts
registerTelemetryAssistantTool({
  name: 'top_features',
  description: 'The most used product features in the window.',
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
  output: 'aggregate',
  run: async ({ limit }, ctx) => ({ rows: (await ctx.query.query('SELECT ...', { maxRows: limit })).rows }),
});
// TelemetryModule.forRoot({ ..., assistant: { extraInstructions: 'Checkout is the revenue path: weigh its errors first.' } })
```

Add a dashboard group (rung 2). The id is permanent; the tables are the ones the app's metrics write ([runbook](../../../../docs/runbooks/telemetry.md#84-adding-an-app-metric-group)):

```ts
export const ACTIVITY_METRIC_GROUP: MetricGroupDef = {
  id: 'activity', label: 'App activity', title: 'App activity', order: 70,
  description: 'sign-ins by outcome',
  families: [{
    key: 'authLogins', group: 'activity', label: 'Sign-ins', table: 'app_auth_logins_total',
    kind: 'counter', unit: 'count', rate: 'count', groupBy: 'outcome',
    requiredColumns: ['outcome'], filters: ['service', 'instance'],
  }],
};
// TelemetryModule.forRoot({ ..., metricGroups: [ACTIVITY_METRIC_GROUP] })
```

Widen the typed group id by module augmentation, next to the group: `declare module '@marinoscar/platform-api/telemetry' { interface MetricGroupIds { activity: true } }`.

Register a group from a provider instead (the group is then served, but not listed in the route's documented enum):

```ts
@Injectable()
export class CoachGroupRegistrar implements OnModuleInit {
  constructor(private readonly groups: MetricGroupRegistry) {}
  onModuleInit(): void { registerMetricGroup(this.groups, COACH_GROUP); }
}
```

Tune the verdict (rung 1) and extend it (rung 3). A policy delegates to the platform's and only adds; bind it with `dashboard.verdictPolicy` or `overrideProvider(VERDICT_POLICY)` in a test:

```ts
TelemetryModule.forRoot({ host, imports, dashboard: { verdictThresholds: { noDataMinutes: 10 }, verdictPolicy: { useClass: ActivityVerdictPolicy } } });

@Injectable()
export class ActivityVerdictPolicy implements VerdictPolicy {
  constructor(private readonly platform: DefaultVerdictPolicy) {}
  compute(input: VerdictInput, thresholds: VerdictThresholds): DashboardVerdict {
    const verdict = this.platform.compute(input, thresholds);
    return input.requests > 0 || verdict.level === 'no_data' ? verdict : { level: 'degraded', reasons: [...verdict.reasons, 'no requests'] };
  }
}
```

### Replacing the store (rung 2)

Every service reads the telemetry store through `TELEMETRY_STORE` and builds its SQL through `TELEMETRY_SQL_DIALECT`; none imports `GreptimeClient`. `greptime` is the built-in implementation and registers through the same function an app uses. To keep the telemetry somewhere else, register a store at import time and select it:

```ts
// apps/api/src/app-registrations/telemetry.ts (imported before platform/telemetry/telemetry.config.ts builds the module)
registerTelemetryStore({
  id: 'clickhouse',
  label: 'ClickHouse',
  settingsSchema: z.object({ url: z.string().url(), database: z.string().default('otel') }),
  defaults: { url: 'http://clickhouse:8123', database: 'otel' },
  secrets: [{ name: 'password', label: 'Password', required: true }],   // stored encrypted under telemetry_clickhouse
  build: async ({ settings, secret }) => ({
    store: new ClickHouseTelemetryStore(settings.url, settings.database, await secret('password')),
    dialect: CLICKHOUSE_DIALECT,
  }),
});

// apps/api/src/platform/telemetry/telemetry.config.ts
TelemetryModule.forRoot({ host, imports, store: 'clickhouse' });
```

- **The store** implements `TelemetryStore`. `query` MUST refuse a write (`readOnly: true` is always passed), honour `timeoutMs` (throw `TelemetryQueryTimeoutError`) and `signal` (`TelemetryQueryAbortedError`), and throw `TelemetryNotConfiguredError` while unconfigured. It returns the positional `TelemetryQueryResult` (`fields` with a PostgreSQL type OID each, `rows` as arrays; 64-bit integers, decimals and timestamps as text). `schema()` returns the tables and columns in the explorer's shape; `ping()` never throws; `retention` is optional (no retention control means the nightly job is a no-op).
- **The dialect** spells the seven constructs the dashboard SQL cannot write portably: the time bucket, the percentile, the regular-expression replace, the JSON attribute read, the case-insensitive substring match, the text cast and the row cap, plus the names of the metric tables' time and value columns. Everything else the platform sends is ANSI-flavoured SQL (double-quoted identifiers, `CASE WHEN`, `GROUP BY` an alias, `UNION`, subqueries in `FROM`, scalar subqueries, `count`/`sum`/`min`/`max`/`avg`, `substr`, ISO timestamp literals compared with a timestamp column, and `lag() OVER` in the metric catalog's series).
- **What stays above the store.** The explorer's guard (one read-only statement, the row cap, the timeout, the audit row), the dashboard's cache and verdict, the Doctor checks and the export gate are the platform's and run for every store. A store never sees a write from a route.
- **Settings and secrets.** The store's non-secret settings are one entry (`{ <id>: settings }`) of the `telemetry_store` system-settings row, validated with its own schema; its secrets are in the credential purpose `telemetry_<id>`, write-only. `GET` / `PUT /api/admin/telemetry/store` describe and save them, and the telemetry settings page draws a generated form (`PluggableConfigForm`) from the descriptor. A save reaches the running store on this instance at once and on every other within five seconds; the previous store is `close()`d. The built-in `greptime` keeps its `telemetry_connection` row and the `telemetry_greptime` purpose, unchanged.
- **Prove it.** Run `describeTelemetryStoreConformance` on the registered store ([the memory example does](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts)); give it a `fixture` and it runs every dashboard statement, built with your dialect, against your store.
- **Not here.** Replacing the OpenTelemetry collector's exporter, which writes the telemetry into the store, is an infra overlay concern ([runbook](../../../../docs/runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay)): the API only reads. Two things still assume the collector's GreptimeDB table layout: the names of the trace, log and metric tables and their flattened attribute columns (`opentelemetry_traces`, `"span_attributes.http.route"`, ...) and the assistant's own SQL and prompt, which describe GreptimeDB (DataFusion) SQL.

Bind a host port: provide one token from a module and list the module in `imports` ([`telemetry-host.module.ts`](../../../../apps/api/src/platform/telemetry/telemetry-host.module.ts)):

```ts
@Module({ providers: [{ provide: TELEMETRY_AUDIT_SINK, useClass: AppTelemetryAuditSink }], exports: [TELEMETRY_AUDIT_SINK] })
export class TelemetryHostModule {}
```

Register the permissions and the settings namespace, and validate the namespace in the app's own schema:

```ts
registerPermissions(TELEMETRY_PERMISSION_DECLARATIONS);                  // telemetry:read, :write, :query, admin by default
const appTelemetrySchema = telemetrySettingsSchema.extend({ owner: z.string().optional() });
```

## Data

None. The slice owns no Prisma model and no migration. What it stores, it stores through ports:

| What | Where | Through |
|---|---|---|
| The `telemetry` policy (collection switch, retention, query bounds, instance id, assistant) | The `telemetry` system-settings namespace | `TELEMETRY_SETTINGS_STORE` |
| The stored GreptimeDB connection (host, port, database, reader and admin usernames; never a password) | The `telemetry_connection` system-settings row, with its own version counter | `TELEMETRY_SETTINGS_STORE` |
| The reader and admin passwords | The encrypted credential store, purpose `telemetry_greptime`, names `reader` and `admin` | `TELEMETRY_CREDENTIAL_STORE` |
| The settings of a store that is not GreptimeDB (`{ <storeId>: settings }`, never a secret) | The `telemetry_store` system-settings row, with its own version counter | `TELEMETRY_SETTINGS_STORE` |
| That store's secrets | The encrypted credential store, purpose `telemetry_<storeId>`, one name per declared secret | `TELEMETRY_CREDENTIAL_STORE` |
| Audit rows | The app's audit log | `TELEMETRY_AUDIT_SINK` |
| The two job types | The app's queue | `TELEMETRY_JOBS` |

An app may reference the namespace name and the row key (`TELEMETRY_SETTINGS_NAMESPACE`, the contract's `telemetrySettingsSchema`) and nothing else; the row's value is private to the slice.

## Permissions and settings

`TELEMETRY_PERMISSION_DECLARATIONS` declares three system-scoped permissions, all granted to `admin` (the system administrator role) by default, which the app registers in its permission registry:

| Permission | Gates |
|---|---|
| `telemetry:read` | The `telemetry` policy, the store status, the connection and the store settings (read) |
| `telemetry:write` | Changing the policy; saving, testing or resetting the connection; saving the store settings |
| `telemetry:query` | Running SQL, the schema, export, every dashboard route and the assistant |

Routes also enforce app permissions, named in `TELEMETRY_HOST_PERMISSIONS`: `ai:use` (the assistant, all-of with `telemetry:query`) and `system_settings:read` / `system_settings:write` (the stack status and deploy). The permission each route shape declares, which the conformance suite enforces:

| Route shape | Permissions |
|---|---|
| `GET` / `PUT admin/telemetry/config`, `GET admin/telemetry/status` | `telemetry:read` / `telemetry:write` |
| `POST query`, `GET schema`, `POST export`, every `GET dashboard/*` | `telemetry:query` |
| `GET` / `PUT` / `DELETE` / `POST test` `admin/telemetry/connection` | `telemetry:read` for `GET`, `telemetry:write` otherwise |
| `GET` / `PUT admin/telemetry/store` | `telemetry:read` / `telemetry:write` |
| `GET` / `POST deploy` `admin/telemetry/stack` | `system_settings:read` / `system_settings:write` |
| `POST admin/telemetry/assistant/stream` | `telemetry:query` and `ai:use`, behind `TelemetryAiEnabledGuard` |
| `GET telemetry/config` | signed in only (`@Auth()`); answers whether telemetry is on |

The per-endpoint reference is the generated OpenAPI document (`/api/docs`). The `telemetry` namespace is `TELEMETRY_SETTINGS_NAMESPACE`, with `TELEMETRY_SETTINGS_DEFAULTS` (off), `mergeTelemetrySettings` and the contract's `telemetrySettingsSchema`.

## UI

None. The pages are `@marinoscar/platform-web/telemetry` ([README](../../../platform-web/src/telemetry/README.md)): three admin cards (`telemetry:read`, `telemetry:query`) over these routes. The settings page shows the GreptimeDB Connection form for the built-in store and a generated Store section for any other. A metric group the API reports renders as a dashboard section with no web change, in the order, colours and units its `presentation` declares; a registered panel is listed by `GET dashboard/panels` and drawn by the view the app registered for its id.

## Infra

None in this slice. It reads GreptimeDB over its PostgreSQL wire protocol and the stack agent over HTTP; the containers, the collector configuration and its app overlay come from `@marinoscar/platform-infra/telemetry` ([README](../../../platform-infra/src/telemetry/README.md)).

The environment variables below are deployment defaults, never runtime features: storage, AI, Web Push and SMTP have none, and neither does the telemetry connection once an administrator saves one at `/admin/settings/telemetry`. The reference is `infra/compose/.env.example`.

| Variable | Meaning |
|---|---|
| `OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | Whether the API exports telemetry, to which collector, under which service name; the `otel` configuration namespace the export gate reads. `OTEL_ENABLED=false` boots the slice with no collector. |
| `GREPTIME_HOST`, `GREPTIME_PG_PORT`, `GREPTIME_DB` | The deployment-default store the API reads (`greptime` namespace); an automatic stored connection resolves to them. |
| `GREPTIME_READER_USER` / `_PASSWORD`, `GREPTIME_ADMIN_USER` / `_PASSWORD` | The default read-only and DDL logins. The writer login and the HTTP port are used only by the collector and the GreptimeDB container. |
| `STACK_AGENT_URL`, `STACK_AGENT_TOKEN` | The stack-agent sidecar of a VPS deployment (`stackAgent` namespace). |

The collector's own configuration merges as maps, but **lists are replaced, never appended**: an app overlay that restates an existing pipeline's `receivers` drops the platform's. Add a new named pipeline instead ([runbook](../../../../docs/runbooks/telemetry.md#24-add-your-own-collector-pipelines-app-overlay)).

## Observability

The slice creates no metric and no span of its own: the API's request spans and `app.*` metrics come from `otel-core`, and the dashboard reads them back. What it emits:

| Signal | What |
|---|---|
| Logs | `new Logger(Context)` per service; never a password, a statement result or a key. |
| Audit actions | `telemetry:query` and `telemetry:export` (every caller-supplied statement; the `source` of a statement a panel runs is `panel`), `telemetry:assistant` and `telemetry:assistant_query` (the assistant run and each statement it runs), `telemetry:dashboard` (each store read), `telemetry:config_update`, `telemetry:connection_update`, `telemetry:connection_reset`, `telemetry:store_update` (setting and secret names only) and `telemetry:stack_deploy`. Meta carries field names and counts, never a value. |
| Export gate | `telemetryGate` (`otel-core`), driven by `TelemetrySettingsService`: closed means nothing leaves the process. |
| Doctor | `telemetry.export`, `telemetry.connection`, `telemetry.reachable`, `telemetry.tables`, `telemetry.freshness`: read-only. |
| Support bundle and egress | A telemetry section of aggregates only, and the GreptimeDB host in the egress inventory. |

## Security notes

- **No key or password reaches a response or a log.** The assistant calls models only through `TELEMETRY_AI` (`AiService.forUser` in the app, so no provider SDK is imported here); GreptimeDB passwords are write-only and live in the credential port. Conformance check 4 seeds known passwords and asserts none appears in `GET admin/telemetry/connection` or `/config`.
- **SQL is guarded.** `analyzeStatement` admits one read-only statement; the reader login is read-only on top of that, and the row cap and timeout bound every run. Dashboard statements are server-authored templates; the assistant's own statements go through the same `TelemetryQueryService` and guard as the explorer.
- **Every statement is audited**, and every route declares its permission; no route is public (check 2).
- **A store's secrets are write-only.** They are declared (`secrets`), stored encrypted under `telemetry_<id>`, resolved only inside `build` for the call that asks, and never part of a settings record, a response, an audit row or a log; the descriptor carries `hasValue` only. A settings field named like a secret (`key`, `secret`, `token`, `password`) is refused at registration. Conformance check 4 also covers `GET admin/telemetry/store`.
- **Extensions never hold a client.** A dashboard panel and an assistant tool receive `TelemetryQueryFacade` (`query`, `sql`, `dialect`) and nothing else: no pool, connection, store, service or settings port. Every `query` is one statement through the same SQL guard as the explorer (a write or several statements are refused), with a row cap, the timeout and an audit row (source `panel` or `assistant`), under a statement budget per request. Build values into SQL with `ctx.query.sql.literal` / `ident` / `timestamp` / `between`, never by concatenating text from the request or the model; the guard is the backstop, not the quoting.
- **Tool names cannot shadow the platform's.** A tool named like one of the eight built-ins, a malformed name or a duplicate is refused at registration, so the model's `run_query` is always the platform's. An app tool is read-only by construction (the facade has no write path), runs under the caller's own `telemetry:query` and `ai:use`, behind the same `TelemetryAiEnabledGuard`, and its output is bounded to 24 000 characters. Output declared `rows` (the default) is withheld from the model while `assistant.shareResults` is off.
- **`assistant.extraInstructions` is developer text.** It is set in code at build time and appended to the system prompt as an `APPLICATION NOTES` section that states it never changes the hard rules, the untrusted-data rules or the final-answer format; no route, setting or user input reaches it.
- **A presentation is data.** It is zod-validated and bounded, holds no function and no CSS, and the browser reads the colours as theme tokens and the unit as one of a fixed set of formats.
- **A panel's payload is bounded** (`DASHBOARD_PANEL_PAYLOAD_MAX_BYTES`, 256 KiB), has a time budget (`PANEL_TIME_BUDGET_MS`) and a failure answers a generic error.
- **Both job types are server-only**: they hold the GreptimeDB admin login and the stack-agent token, so neither declares `nodeResultSchema` or `persistNodeResult`.
- **The Doctor never writes**: no check injects the audited connection test, the audited dashboard service, the audit sink or the jobs port (check 3).
- **The cron only enqueues** (`TelemetryRetentionTask`): the app's `cron-enqueue-only` scan must cover this slice's source (check 5).

## Conformance suite

Importing `@marinoscar/platform-api/telemetry/testing` registers the `telemetry` suite with `runPlatformConformance()`. The suite discovers from registries and Nest metadata; nothing is a hand-kept list of routes or groups. Each check below is also an exported function, proved against a deliberately broken fixture (`test/telemetry/conformance.spec.ts`).

| # | Check | Where it runs |
|---|---|---|
| 1 | Every registered metric group has a unique id matching `METRIC_GROUP_ID_PATTERN` and a label, unique family, ratio and table keys across groups, units in the unit registry, a presentation that names only tiles, charts and tables the group declares, valid filter keys; and computes against an empty schema without throwing, everything reported in `skipped` | The suite |
| 2 | Every route under `admin/telemetry` and `telemetry` declares exactly the permissions of its shape (table in Permissions and settings); none is public; the assistant sits behind the AI guard | The suite |
| 3 | No Doctor check of the slice injects `TelemetryConnectionTestService`, `TelemetryDashboardService`, the audit sink or the jobs port | The suite |
| 4 | `GET admin/telemetry/connection`, `/config` and `/store` carry no stored password; `TELEMETRY_CONNECTION_CARRIES_NO_SECRET` is `true` | The suite |
| 5 | The app's cron scan roots contain `tasks/telemetry-retention.task.ts` | The suite, with `cronSourceRoots` |
| 6 | The module boots with `OTEL_ENABLED=false` and no GreptimeDB; every dashboard route answers `200` or `503` `TELEMETRY_NOT_CONFIGURED` | The suite |
| 9 | Every registered dashboard panel and app assistant tool is well formed (panel id, label, order and `data`; tool name not a built-in, description, zod object schema and `run`), and the platform's `api` and `logs` panels are still registered | The suite (`checkRegisteredExtensions`) |
| 10 | The query facade an extension is handed has exactly `query`, `sql` and `dialect`, is frozen and exposes no client, pool, connection, store or service | The suite (`checkFacadeSurface`) |
| 7 | Every `telemetryAdminCards` permission is one of the slice's, is routed once behind the same permission and is registered once | The app's web test ([`telemetryParity.test.ts`](../../../../apps/web/src/__tests__/config/telemetryParity.test.ts)) |
| 8 | The generated infra files match the package | `platform-infra sync --check` in CI |

Run it in the app (the reference app's [`telemetry-conformance.spec.ts`](../../../../apps/api/test/telemetry/telemetry-conformance.spec.ts)):

```ts
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '@marinoscar/platform-api/telemetry/testing';        // registers the suite
import '../../src/platform/telemetry/telemetry.config';     // registers the app's metric groups

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: { telemetry: { cronSourceRoots: CRON_SOURCE_ROOTS } },
});
```

A store an app registers is proved by its own kit, `describeTelemetryStoreConformance` (run for the built-in in the live-database tier, `npm run test:greptime`, and for the memory example in [`memory-store.spec.ts`](../../../../apps/api/test/examples/telemetry/memory-store.spec.ts)).

Checks 4 and 6 boot the module on Fastify, so the app needs `@nestjs/platform-fastify` (any Fastify app has it). A coach-shaped group over EvoPath's table names passes check 1 and renders with no platform edit (`metrics/coach-readiness.spec.ts`).

## Upgrade notes

1.0: first release. The slice moved from the app with no behaviour change: routes, job types, permission strings, audit actions and the OpenAPI document are unchanged.

| Old app path (`apps/api/src/telemetry/`) | Import from `@marinoscar/platform-api/telemetry` |
|---|---|
| `telemetry.module.ts` | `TelemetryModule.forRoot({ host, imports, ... })` |
| `telemetry.permissions.ts` | `TELEMETRY_PERMISSION_DECLARATIONS`, `TELEMETRY_PERMISSIONS` |
| the `telemetry` namespace, defaults and merge in the app's settings registry | `TELEMETRY_SETTINGS_NAMESPACE`, `TELEMETRY_SETTINGS_DEFAULTS`, `mergeTelemetrySettings` |
| `telemetry-settings.service.ts`, `greptime/greptime.client.ts` | `TelemetrySettingsService`, `GreptimeClient` |
| `query/telemetry-query.service.ts`, `query/telemetry-schema.service.ts` | `TelemetryQueryService`, `TelemetrySchemaService` |
| `metrics/metric-catalog.ts` | `metricGroupRegistry`, `metricGroups`, `MetricGroupDef` and the family types |
| `dashboard/telemetry-dashboard.verdict.ts` | `computeVerdict`, `DEFAULT_VERDICT_THRESHOLDS` (`DASHBOARD_VERDICT_THRESHOLDS` is deprecated) |
| `AuditService`, `SystemSettingsService`, `CredentialsService`, `JobsService`, `AiService` calls | The six host ports, bound by the app's `TelemetryHostModule` |
| `systemTelemetrySchema` (defined in `common/schemas/settings.schema.ts`) | `telemetrySettingsSchema` (the app keeps `systemTelemetrySchema` as an alias) |

Add the ports module and `TelemetryModule.forRoot(...)`, register the permissions, delete the moved files, and run the conformance suite.

Pluggable stores are additive: the default store is `greptime`, its routes, settings, credential purpose and behaviour are unchanged, and `GreptimeClient` is still exported (it now implements `TelemetryStore`, and `query()` is the port's name for `queryReader()`). The app's settings-store adapter must allow the new row key: add `telemetry_store` beside `telemetry_connection` (the reference app's `TELEMETRY_OWNED_ROW_KEYS`). The response of `GET admin/telemetry/config` gains an optional `store` block.

## Troubleshooting

Operator problems (no data, a red verdict, retention, the connection) are in the [telemetry runbook](../../../../docs/runbooks/telemetry.md#12-troubleshooting); developer problems:

| Symptom | Cause and fix |
|---|---|
| `Nest can't resolve dependencies ... Symbol(@marinoscar/platform/telemetry/...)` | A port is not exported by any module in `imports`. |
| `TelemetryModule.forRoot: \`dashboard.verdictThresholds\` is invalid (...)` | Fix the named field (a degraded bound beyond its critical one is refused). |
| `TelemetryModule.forRoot: \`metrics.freshMs\` must be a whole number of milliseconds ...` | Pass an integer from 1000 to 86400000, or leave `metrics` out for the 150 s default. |
| `Duplicate metric group id` / `family key ... is already used` | Two groups claim one id or key; boot fails by design. See the [runbook](../../../../docs/runbooks/telemetry.md#84-adding-an-app-metric-group). |
| `FROZEN` from `MetricGroupRegistry.register` | Register from `onModuleInit` or `forRoot({ metricGroups })`, never after bootstrap. |
| `runPlatformConformance: unknown conformance suite "telemetry"` | Import `@marinoscar/platform-api/telemetry/testing` before calling it. |
| `TelemetryModule.forRoot: \`store\` "x" is not a registered telemetry store (registered: ...)` | Register the store with `registerTelemetryStore` at import time, before `forRoot` runs (import `app-registrations/telemetry` first). |
| The explorer answers 503 `TELEMETRY_NOT_CONFIGURED` on a registered store | The store is unbuilt: its stored settings do not parse or `build` threw. `GET admin/telemetry/store` reports why in `error`. |
| The dashboard fails with an SQL error on a registered store | A dialect member spells a construct the store does not understand; run `describeTelemetryStoreConformance` with a `fixture`. |
| `Metric group "x" presentation is invalid (...)` | The presentation names a metric or unit the group does not have, a colour outside the theme tokens, or exceeds a bound; the message names the path. |
| `... has unit "x"; expected a registered unit (...)` | Call `registerMetricUnit` at import time, before the group that uses the unit is registered. |
| `"x" is one of the platform's own assistant tools` | Choose another tool name. |
| `Duplicate dashboard panel id` / `Duplicate assistant tool name` | A panel id and a tool name are registered once. |
| `TelemetryFacadeLimitError` from a panel or tool | The request spent its statement budget (`FACADE_MAX_STATEMENTS`); fold the reads into fewer statements. |
| A panel is listed but not drawn | No web view is registered for its id; call `registerDashboardPanelView` at boot. |
| Conformance 5 fails: the cron scan roots do not contain the retention task | Add the slice's source root to the app's `cron-enqueue-only` `sourceRoots`. |

## Links

- [Telemetry spec](../../../../docs/specs/telemetry.md) and [section 12, packaging](../../../../docs/specs/telemetry.md#12-packaging-and-extension-points); [runbook](../../../../docs/runbooks/telemetry.md)
- [Platform packages spec](../../../../docs/specs/platform-packages.md): the extension contract and the documentation standard
- [Package README](../../README.md) and the TypeDoc API reference (`npm run docs --workspace=@marinoscar/platform-api`)
- Sibling slices: [core](../core/README.md), [doctor](../doctor/README.md), [otel-core](../otel-core/README.md), [testing](../testing/README.md)
- The same slice in other packages: [contract](../../../platform-contract/src/telemetry/README.md), [web](../../../platform-web/src/telemetry/README.md), [cli](../../../platform-cli/src/telemetry/README.md), [infra](../../../platform-infra/src/telemetry/README.md)

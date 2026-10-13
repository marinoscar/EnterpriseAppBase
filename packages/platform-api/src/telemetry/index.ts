// `@marinoscar/platform-api/telemetry`: the telemetry slice (epic #528, packaged
// by issue #703). Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ------------------------------------------
export { TelemetryModule } from './telemetry.module';
export {
  TELEMETRY_ASSISTANT_EXTRA_INSTRUCTIONS,
  TELEMETRY_METRIC_FRESH_MS,
  TELEMETRY_OPTIONS,
  TELEMETRY_VERDICT_THRESHOLDS,
  defaultTelemetryActorId,
  resolveAssistantExtraInstructions,
  resolveMetricFreshMs,
  resolveVerdictThresholds,
} from './telemetry.options';
export type {
  ResolvedTelemetryModuleOptions,
  TelemetryAssistantOptions,
  TelemetryDashboardOptions,
  TelemetryMetricsOptions,
  TelemetryModuleOptions,
  VerdictThresholdsOverride,
} from './telemetry.options';

// ---- the dashboard's verdict: thresholds (rung 1) and policy (rung 3) -------------
export { DefaultVerdictPolicy, VERDICT_POLICY } from './dashboard/verdict-policy';
export type { VerdictPolicy } from './dashboard/verdict-policy';
export {
  DASHBOARD_VERDICT_THRESHOLDS,
  DEFAULT_VERDICT_THRESHOLDS,
  VERDICT_LEVELS,
  computeVerdict,
} from './dashboard/telemetry-dashboard.verdict';
export type {
  DashboardVerdict,
  VerdictCollectorThresholds,
  VerdictErrorLogThresholds,
  VerdictInput,
  VerdictLevel,
  VerdictLevelThresholds,
  VerdictThresholds,
  VerdictUnknownRouteThresholds,
} from './dashboard/telemetry-dashboard.verdict';

// ---- the host ports: one token per app capability ----------------------------------
export {
  TELEMETRY_AI,
  TELEMETRY_APP_INFO,
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_STORE,
} from './ports';
export type {
  TelemetryAiError,
  TelemetryAiInputMessage,
  TelemetryAiPort,
  TelemetryAiResponse,
  TelemetryAiSession,
  TelemetryAiTool,
  TelemetryAiToolCallRecord,
  TelemetryAiToolContext,
  TelemetryAiToolDefinition,
  TelemetryAiToolLoopRequest,
  TelemetryAiToolLoopResult,
  TelemetryAiToolStep,
  TelemetryAppInfo,
  TelemetryAuditEvent,
  TelemetryAuditSink,
  TelemetryCredentialInfo,
  TelemetryCredentialStore,
  TelemetryDeployInfo,
  TelemetryFeatureFlag,
  TelemetryJobExecutionProfile,
  TelemetryJobHandler,
  TelemetryJobRecord,
  TelemetryJobsPort,
  TelemetrySettingsProvenance,
  TelemetrySettingsRow,
  TelemetrySettingsStore,
} from './ports';
export { TelemetryAiEnabledGuard } from './assistant/telemetry-ai-enabled.guard';

// ---- permissions and the settings namespace, as data for the app's registries -----
export {
  TELEMETRY_HOST_PERMISSIONS,
  TELEMETRY_PERMISSIONS,
  TELEMETRY_PERMISSION_DECLARATIONS,
} from './telemetry.permissions';
export type { TelemetryPermissionDeclaration } from './telemetry.permissions';
export {
  TELEMETRY_SETTINGS_DEFAULTS,
  TELEMETRY_SETTINGS_DESCRIPTION,
  TELEMETRY_SETTINGS_NAMESPACE,
  mergeTelemetrySettings,
} from './telemetry.settings';
export type { TelemetrySettingsPatch } from './telemetry.settings';
// The namespace's schema is the contract's (#702).
export { TELEMETRY_LIMITS, telemetrySettingsSchema } from '@marinoscar/platform-contract/telemetry';
export type { TelemetrySettings } from '@marinoscar/platform-contract/telemetry';

// ---- the services the module exports (what the app may inject) -------------------
// Every other provider is internal; an app's test reaches one through the
// configured module's `providers` (the reference app: `telemetryProviders` in
// apps/api/src/platform/telemetry/telemetry.config.ts).
export { GreptimeClient } from './stores/greptime/greptime.client';
export type { GreptimePool } from './stores/greptime/greptime.client';
export type { HostCheckOptions } from './stores/greptime/greptime-host';
export { TelemetrySettingsService } from './telemetry-settings.service';
export { TelemetryQueryService } from './query/telemetry-query.service';
export type { TelemetryQueryRunOptions, TelemetryQuerySource } from './query/telemetry-query.service';
export { TelemetrySchemaService } from './query/telemetry-schema.service';
export { TELEMETRY_ASSISTANT_AUDIT_ACTION } from './assistant/telemetry-assistant.service';

// ---- the telemetry store port and its registry (rung 2; PP-14.11) ----------------
// What the services depend on instead of `GreptimeClient`: the connection
// (`TelemetryStore`), the SQL spelling (`TelemetrySqlDialect`) and the
// `registerTelemetryStore` registry; `greptime` is the built-in implementation.
// The kit is `@marinoscar/platform-api/telemetry/testing`.
export {
  BUILTIN_TELEMETRY_STORE_ID,
  TELEMETRY_SQL_DIALECT,
  TELEMETRY_STORE,
  describeTelemetryStore,
  quoteSqlIdent,
  quoteSqlLiteral,
  registerTelemetryStore,
  requireTelemetryStore,
  rowsAsObjects,
  telemetryStoreCredentialPurpose,
  telemetryStoreIds,
  telemetryStoreKind,
} from './stores/telemetry-store';
export type {
  TelemetryField,
  TelemetryPingResult,
  TelemetryQueryOptions,
  TelemetryQueryResult,
  TelemetryRetentionControl,
  TelemetrySchemaSnapshot,
  TelemetrySqlDialect,
  TelemetryStore,
  TelemetryStoreBuildContext,
  TelemetryStoreBuildInput,
  TelemetryStoreDefinition,
  TelemetryStoreInstance,
  TelemetryStoreQueryOptions,
} from './stores/telemetry-store';
export {
  TelemetryMultiStatementError,
  TelemetryNotConfiguredError,
  TelemetryQueryAbortedError,
  TelemetryQueryFailedError,
  TelemetryQueryTimeoutError,
  TelemetryStoreError,
} from './stores/telemetry-store.errors';
export { GREPTIME_SQL_DIALECT } from './stores/greptime/greptime.dialect';
export { TELEMETRY_STORE_SETTINGS_KEY } from './stores/telemetry-store.resolver';
export { TELEMETRY_STORE_UPDATE_AUDIT_ACTION } from './stores/telemetry-store-settings.service';

// ---- the job types (permanent strings; both server-only) --------------------------
export { TELEMETRY_RETENTION_TYPE } from './handlers/telemetry-retention.handler';
// The credential purpose of the GreptimeDB passwords, for the app's credential
// purpose manifest (#735).
export { TELEMETRY_GREPTIME_CREDENTIAL_PURPOSE } from './connection/telemetry-connection.schema';
export { TELEMETRY_STACK_DEPLOY_TYPE } from './stack/telemetry-stack-deploy.handler';

// ---- errors and the SQL guard -------------------------------------------------------
export { TELEMETRY_ERROR_REASONS, TelemetryHttpError } from './query/telemetry-query.errors';
export type { TelemetryErrorReason } from './query/telemetry-query.errors';
export { analyzeStatement } from './query/sql-guard';
export type { AnalyzedStatement, TelemetryStatementKind } from './query/sql-guard';

// ---- the metric catalog and its group registry (rung 2) ---------------------------
export {
  METRIC_FILTER_COLUMNS,
  METRIC_GROUPS,
  METRIC_GROUP_ID_PATTERN,
  METRIC_GROUP_LABELS,
  isMetricGroup,
  metricGroupIds,
  metricGroupRegistry,
  metricGroups,
  registerMetricGroups,
} from './metrics/metric-catalog';
export { METRIC_FRESH_MS } from './metrics/metric-group';
export { MetricGroupRegistry, registerMetricGroup } from './metrics/metric-group-registry.service';
export type { MetricGroupDefinition } from './metrics/metric-group-registry.service';
export type {
  BucketAggregate,
  CounterFamily,
  GaugeFamily,
  HistogramFamily,
  MetricFamily,
  MetricFilterKey,
  MetricGroup,
  MetricGroupDef,
  MetricPredicate,
  MetricRatio,
  MetricRef,
  MetricTableDerived,
  MetricTablePart,
  MetricTableSpec,
  MetricUnit,
  MetricVerdictThresholds,
  SeriesAggregate,
  TileAggregate,
} from './metrics/metric-catalog';

// ---- metric units (rung 2; PP-14.18) ------------------------------------------------
// The platform's fifteen units register through `registerMetricUnit`; an app adds
// `usd`, `tokens`, ... before the group that uses them.
export { isMetricUnit, metricUnitIds, metricUnitRegistry, registerMetricUnit } from './metrics/metric-unit.registry';
export type { MetricUnitDef } from './metrics/metric-unit.registry';

// ---- the guarded query facade (what a panel's `data` and an assistant tool's `run` receive; PP-14.18) ----
export { FACADE_DEFAULT_ROWS, FACADE_MAX_ROWS, FACADE_MAX_STATEMENTS, TelemetryFacadeLimitError } from './query/telemetry-query-facade';
export type { TelemetryFacadeResult, TelemetryQueryFacade, TelemetrySqlBuilders } from './query/telemetry-query-facade';

// ---- dashboard panels (rung 2; PP-14.18) ----------------------------------------------
// `api` and `logs` register through `registerDashboardPanel` like an app's panel.
export { dashboardPanelRegistry, isBuiltinDashboardPanel, registerDashboardPanel } from './dashboard/panels/dashboard-panels';
export type { DashboardPanelContext, DashboardPanelDef, DashboardPanelWindow } from './dashboard/panels/dashboard-panels';
export { PANEL_TIME_BUDGET_MS } from './dashboard/panels/telemetry-dashboard-panel.service';

// ---- assistant tools (rung 2; PP-14.18) ------------------------------------------------
export { registerTelemetryAssistantTool, telemetryAssistantToolRegistry } from './assistant/telemetry-assistant-tool.registry';
export type { AnyTelemetryAssistantToolDef, TelemetryAssistantToolContext, TelemetryAssistantToolDef } from './assistant/telemetry-assistant-tool.registry';
export type { TelemetryAssistantPromptExtension } from './assistant/telemetry-assistant.service';

// ---- the dashboard ------------------------------------------------------------------
export { LOGS_TABLE, REQUIRED_LOG_COLUMNS, REQUIRED_TRACE_COLUMNS, TRACES_TABLE } from './dashboard/telemetry-dashboard.sql';

// ---- `MetricGroupIds`: an augmentation target, declared here, never re-exported (#865) ----

/**
 * The augmentable set of group ids: the platform's six here; an app adds its
 * own by module augmentation (the reference app: `app-registrations/telemetry.ts`):
 *
 * ```ts
 * declare module '@marinoscar/platform-api/telemetry' {
 *   interface MetricGroupIds { coach: true }
 * }
 * ```
  *
  * @stability stable
 */
export interface MetricGroupIds {
  /** hostmetrics: CPU, memory, load, filesystems, disk and network IO. */
  host: true;
  /** The postgresql receiver: connections, size, commits, cache hits. */
  database: true;
  /** `app.jobs.*` and `app.backup.*`: depth, age, settle rate, duration. */
  queue: true;
  /** `app.nodes.*`: fleet health and per-node vitals. */
  nodes: true;
  /** httpcheck and nginx: status per URL, latency, TLS, edge traffic. */
  uptime: true;
  /** The collector's and GreptimeDB's own counters, and `up`. */
  pipeline: true;
}

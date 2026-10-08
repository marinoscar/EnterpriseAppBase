// `@marinoscar/platform-api/telemetry`: the telemetry slice (epic #528, packaged
// by issue #703). Documented in ./README.md. Explicit named exports only.

// ---- the module and its options (rung 1) ------------------------------------------
export { TelemetryModule } from './telemetry.module';
export {
  TELEMETRY_METRIC_FRESH_MS,
  TELEMETRY_OPTIONS,
  TELEMETRY_VERDICT_THRESHOLDS,
  defaultTelemetryActorId,
  resolveMetricFreshMs,
  resolveVerdictThresholds,
} from './telemetry.options';
export type {
  ResolvedTelemetryModuleOptions,
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
export { GreptimeClient } from './greptime/greptime.client';
export type {
  GreptimePool,
  TelemetryField,
  TelemetryPingResult,
  TelemetryQueryOptions,
  TelemetryQueryResult,
} from './greptime/greptime.client';
export type { HostCheckOptions } from './greptime/greptime-host';
export { TelemetrySettingsService } from './telemetry-settings.service';
export { TelemetryQueryService } from './query/telemetry-query.service';
export type { TelemetryQueryRunOptions, TelemetryQuerySource } from './query/telemetry-query.service';
export { TelemetrySchemaService } from './query/telemetry-schema.service';
export { TELEMETRY_ASSISTANT_AUDIT_ACTION } from './assistant/telemetry-assistant.service';

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
  MetricGroupIds,
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

// ---- the dashboard ------------------------------------------------------------------
export { LOGS_TABLE, REQUIRED_LOG_COLUMNS, REQUIRED_TRACE_COLUMNS, TRACES_TABLE } from './dashboard/telemetry-dashboard.sql';

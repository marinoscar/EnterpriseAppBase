// `@marinoscar/platform-web/telemetry/headless`: the telemetry UI's client,
// hooks, config context, route guard, app adapters, theme tokens and pure
// helpers, with no component (issue #704). Imports nothing from an `@mui/*`
// component module (`@mui/material/styles` only, for the token contract);
// `test/telemetry/boundaries.test.ts` enforces it. Documented in ../README.md.

// The wire types (aliased from `@marinoscar/platform-contract/telemetry`),
// the web's display constants and the pure helpers of the two services.
export * from './services/telemetry.js';
export * from './services/telemetryDashboard.js';

// The client over the platform host's transport.
export { createTelemetryClient, useTelemetryClient } from './services/client.js';
export type { TelemetryClient, TelemetryRequestOptions, TelemetryStackDeployAccepted } from './services/client.js';

// `GET /telemetry/config`, once per shell.
export {
  TELEMETRY_CONFIG_DISABLED,
  TelemetryConfigContext,
  isTelemetryOn,
  useTelemetryConfig,
  useTelemetryConfigQuery,
  useTelemetryFeatures,
} from './context/telemetryConfig.js';
export type { TelemetryFeatureFlags, UseTelemetryConfigReturn } from './context/telemetryConfig.js';
export { TelemetryConfigProvider } from './context/TelemetryConfigProvider.js';
export type { TelemetryConfigProviderProps } from './context/TelemetryConfigProvider.js';
export { RequireTelemetryEnabled } from './guards/RequireTelemetryEnabled.js';
export type { RequireTelemetryEnabledProps } from './guards/RequireTelemetryEnabled.js';

// What the app hands in (AI on/off, the model catalogue, its spinner).
export {
  DEFAULT_TELEMETRY_WEB_ADAPTERS,
  TelemetryWebAdaptersProvider,
  useTelemetryWebAdapters,
} from './adapters/TelemetryWebAdapters.js';
export type {
  TelemetryAiEnabledState,
  TelemetryAssistantModelOption,
  TelemetryAssistantModelsState,
  TelemetryWebAdapters,
} from './adapters/TelemetryWebAdapters.js';

// The hooks behind the three pages.
export { useTelemetryAdmin } from './hooks/useTelemetryAdmin.js';
export type { UseTelemetryAdminReturn } from './hooks/useTelemetryAdmin.js';
export { useTelemetryConnection } from './hooks/useTelemetryConnection.js';
export type { UseTelemetryConnectionReturn } from './hooks/useTelemetryConnection.js';
export {
  TELEMETRY_STACK_ACTIVE_POLL_MS,
  TELEMETRY_STACK_IDLE_POLL_MS,
  isDeployActive,
  useTelemetryStack,
} from './hooks/useTelemetryStack.js';
export type { UseTelemetryStackOptions, UseTelemetryStackReturn } from './hooks/useTelemetryStack.js';
export {
  telemetryErrorTitle,
  toTelemetryError,
  useTelemetryAssistantModel,
  useTelemetryQuery,
  useTelemetrySchema,
} from './hooks/useTelemetryExplorer.js';
export type { TelemetryErrorInfo, UseTelemetryQueryReturn, UseTelemetrySchemaReturn } from './hooks/useTelemetryExplorer.js';
export {
  ASSISTANT_HISTORY_ANSWER_MAX,
  ASSISTANT_HISTORY_TURNS,
  ASSISTANT_QUESTION_MAX,
  answerAsHistory,
  buildAssistantHistory,
  useTelemetryAssistant,
} from './hooks/useTelemetryAssistant.js';
export type {
  AssistantMessage,
  AssistantReplyError,
  AssistantReplyMessage,
  AssistantUserMessage,
  UseTelemetryAssistantOptions,
  UseTelemetryAssistantReturn,
} from './hooks/useTelemetryAssistant.js';
export { useTelemetryAssistantAvailable } from './hooks/useTelemetryAssistantAvailable.js';
export {
  useDashboardEvents,
  useDashboardFilters,
  useDashboardMetricGroups,
  useDashboardMetrics,
  useDashboardSummary,
  useDashboardTimeseries,
  useDashboardTop,
} from './hooks/useTelemetryDashboard.js';
export type { DashboardEventsResource, DashboardResource } from './hooks/useTelemetryDashboard.js';

// Pure helpers apps reuse.
export { formatBytes, formatDuration } from './lib/format.js';
export {
  TELEMETRY_DASHBOARD_PATH,
  TELEMETRY_EXPLORER_PATH,
  TELEMETRY_SETTINGS_PATH,
  explorerSqlUrl,
} from './lib/explorerHandoff.js';
export { METRIC_SECTION_TITLES, metricSectionTitle } from './lib/metrics/metricSections.js';

// The theme-token contract (`palette.status`, `palette.chart.series`).
export { telemetryTokens, useTelemetryTokens, withTelemetryTokens } from '../theme/telemetryTokens.js';
export type { TelemetryChartTokens, TelemetryStatusTokens, TelemetryTokens } from '../theme/telemetryTokens.js';

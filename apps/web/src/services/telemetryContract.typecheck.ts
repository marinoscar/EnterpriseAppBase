/**
 * Compile-time proof that the web's telemetry types cannot drift from the
 * contract (issue #702). Type-only: nothing imports this file, nothing of it
 * reaches the bundle; `npm run typecheck` checks it (the test folder is not
 * part of that run, so the assertions live here, next to the services).
 *
 * - `Equal<Web, Contract>`: the web name is exactly the contract's
 *   `z.infer` type.
 * - `Extends<Contract, Web>`: the web type is deliberately LOOSER (a field
 *   optional or a string open-ended, so a server ahead of or behind this
 *   build still renders); every payload the API sends is still accepted.
 * - `Extends<Web, Contract>`: the web type is deliberately NARROWER (a
 *   per-panel or per-kind response, the connection form's two shapes);
 *   everything it describes is a valid wire value.
 *
 * Each difference is named in the type's own comment in `telemetry.ts` /
 * `telemetryDashboard.ts`. A change on either side that breaks a relation
 * fails the typecheck here.
 */
import type * as C from '@marinoscar/platform-contract/telemetry';

import type * as T from './telemetry';
import type * as D from './telemetryDashboard';

type Equal<X, Y> = (<V>() => V extends X ? 1 : 2) extends <V>() => V extends Y ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type Expect<V extends true> = V;

/** Every relation between a web telemetry type and its contract type. */
export type TelemetryContractAssertions = [
  // ---- services/telemetry.ts: exactly the contract ----
  Expect<Equal<T.TelemetryPublicConfig, C.TelemetryPublicConfig>>,
  Expect<Equal<T.TelemetrySettings, C.TelemetrySettings>>,
  Expect<Equal<T.TelemetryAdminConfig, C.TelemetryConfigResponse>>,
  Expect<Equal<T.TelemetryStatus, C.TelemetryStatus>>,
  Expect<Equal<T.TelemetrySettingsUpdate, C.UpdateTelemetryConfigInput>>,
  Expect<Equal<T.TelemetryConnectionSource, C.TelemetryConnectionSource>>,
  Expect<Equal<T.TelemetryConnectionHostMode, C.TelemetryConnectionHostMode>>,
  Expect<Equal<T.TelemetryCredentialStatus, C.TelemetryCredentialStatus>>,
  Expect<Equal<T.TelemetryDeploymentConnection, C.TelemetryDeploymentConnection>>,
  Expect<Equal<T.TelemetryConnection, C.TelemetryConnectionResponse>>,
  Expect<Equal<T.TelemetryConnectionProbe, C.TelemetryConnectionProbe>>,
  Expect<Equal<T.TelemetryConnectionSkipped, C.TelemetryConnectionSkipped>>,
  Expect<Equal<T.TelemetryConnectionTestResult, C.TelemetryConnectionTestResult>>,
  Expect<Equal<T.TelemetryStackAgent, C.TelemetryStackAgentState>>,
  Expect<Equal<T.TelemetryStackServiceState, C.TelemetryStackServiceState>>,
  Expect<Equal<T.TelemetryStackServiceHealth, C.TelemetryStackServiceHealth>>,
  Expect<Equal<T.TelemetryColumnType, C.TelemetryColumnType>>,
  Expect<Equal<T.TelemetrySemanticType, C.TelemetrySemanticType>>,
  Expect<Equal<T.TelemetryExportFormat, C.TelemetryExportFormat>>,
  Expect<Equal<T.TelemetryAssistantTool, C.TelemetryAssistantToolName>>,
  Expect<Equal<T.TelemetryReportStatus, C.TelemetryAssistantReportStatus>>,
  Expect<Equal<T.TelemetryFindingSeverity, C.TelemetryAssistantSeverity>>,
  Expect<Equal<T.TelemetryReportConfidence, C.TelemetryAssistantConfidence>>,
  Expect<Equal<T.TelemetryReportFinding, C.TelemetryAssistantFinding>>,
  Expect<Equal<T.TelemetryReportQuery, C.TelemetryAssistantQuery>>,
  Expect<Equal<T.TelemetryAssistantReport, C.TelemetryAssistantReport>>,
  Expect<Equal<T.TelemetryAssistantTurn, C.TelemetryAssistantTurn>>,
  Expect<Equal<T.TelemetryAssistantRequest, C.TelemetryAssistantRequest>>,

  // ---- services/telemetry.ts: deliberately looser (open-ended names, absent report) ----
  Expect<Extends<C.TelemetryStackService, T.TelemetryStackService>>,
  Expect<Extends<C.TelemetryStackDeploy, T.TelemetryStackDeploy>>,
  Expect<Extends<C.TelemetryStackStatus, T.TelemetryStack>>,
  Expect<Extends<C.TelemetryColumn, T.TelemetryColumn>>,
  Expect<Extends<C.TelemetrySchemaColumn, T.TelemetrySchemaColumn>>,
  Expect<Extends<C.TelemetrySchemaTable, T.TelemetrySchemaTable>>,
  Expect<Extends<C.TelemetrySchema, T.TelemetrySchema>>,
  Expect<Extends<C.TelemetryQueryResult, T.TelemetryQueryResult>>,
  Expect<Extends<C.TelemetryAssistantStepEvent, T.TelemetryAssistantStep>>,
  Expect<Extends<C.TelemetryAssistantAnswerEvent, T.TelemetryAssistantAnswer>>,

  // ---- services/telemetry.ts: deliberately narrower (the form's two shapes) ----
  Expect<Extends<T.TelemetryConnectionAutomaticInput, C.UpdateTelemetryConnectionRequest>>,
  Expect<Extends<T.TelemetryConnectionCustomInput, C.UpdateTelemetryConnectionRequest>>,
  Expect<Extends<(typeof T.TELEMETRY_EXPORT_MENU_ORDER)[number], C.TelemetryExportFormat>>,
  Expect<Extends<C.TelemetryExportFormat, (typeof T.TELEMETRY_EXPORT_MENU_ORDER)[number]>>,

  // ---- services/telemetryDashboard.ts: exactly the contract ----
  Expect<Equal<D.DashboardRange, C.DashboardRange>>,
  Expect<Equal<D.DashboardSeverity, C.DashboardEventSeverity>>,
  Expect<Equal<D.DashboardBuckets, C.DashboardBucketCount>>,
  Expect<Equal<D.DashboardQuery, C.TelemetryDashboardQuery>>,
  Expect<Equal<D.DashboardMetricsQuery, Omit<C.TelemetryDashboardMetricsQuery, 'group'>>>,
  Expect<Equal<D.DashboardEnvelope, C.TelemetryDashboardEnvelope>>,
  Expect<Equal<D.DashboardVerdictLevel, C.VerdictLevel>>,
  Expect<Equal<D.DashboardTile, C.TelemetryDashboardTile>>,
  Expect<Equal<D.DashboardUnknownRoute, C.TelemetryDashboardUnknownRoute>>,
  Expect<Equal<D.DashboardApiBucket, C.TelemetryDashboardApiBucket>>,
  Expect<Equal<D.DashboardLogsBucket, C.TelemetryDashboardLogsBucket>>,
  Expect<Equal<D.DashboardTimeseriesPanel, C.DashboardPanel>>,
  Expect<Equal<D.DashboardTopError, C.TelemetryDashboardTopError>>,
  Expect<Equal<D.DashboardTopKind, C.DashboardTopKind>>,
  Expect<Equal<D.DashboardEvent, C.TelemetryDashboardEvent>>,
  Expect<Equal<D.DashboardEvents, C.TelemetryDashboardEvents>>,
  Expect<Equal<D.DashboardFilters, C.TelemetryDashboardFilters>>,
  Expect<Equal<D.DashboardMetricGroup, C.MetricGroupId>>,
  Expect<Equal<D.DashboardMetricGroupMeta, C.TelemetryDashboardMetricGroup>>,
  Expect<Equal<D.DashboardMetricUnit, C.MetricUnit>>,
  Expect<Equal<D.DashboardMetricPoint, C.TelemetryDashboardMetricPoint>>,
  Expect<Equal<D.DashboardMetricSeries, C.TelemetryDashboardMetricSeries>>,
  Expect<Equal<D.DashboardMetricColumn, C.TelemetryDashboardMetricColumn>>,
  Expect<Equal<D.DashboardMetricCell, C.TelemetryDashboardMetricCell>>,
  Expect<Equal<D.DashboardMetricTable, C.TelemetryDashboardMetricTable>>,
  Expect<Equal<D.DashboardMetrics, C.TelemetryDashboardMetrics>>,

  // ---- services/telemetryDashboard.ts: deliberately looser (fields a newer API added) ----
  Expect<Extends<C.TelemetryDashboardUnknownRoutes, D.DashboardUnknownRoutes>>,
  Expect<Extends<C.TelemetryDashboardSummary, D.DashboardSummary>>,
  Expect<Extends<C.TelemetryDashboardTopRoute, D.DashboardTopRoute>>,

  // ---- services/telemetryDashboard.ts: deliberately narrower (per panel, per kind, severity list) ----
  Expect<Extends<D.DashboardApiTimeseries, C.TelemetryDashboardTimeseries>>,
  Expect<Extends<D.DashboardLogsTimeseries, C.TelemetryDashboardTimeseries>>,
  Expect<Extends<Required<D.DashboardTopRoute>, C.TelemetryDashboardTopRoute>>,
  Expect<Extends<Omit<D.DashboardTopRoutes, 'items'> & { items: Required<D.DashboardTopRoute>[] }, C.TelemetryDashboardTop>>,
  Expect<Extends<D.DashboardTopErrors, C.TelemetryDashboardTop>>,
  Expect<Equal<Omit<D.DashboardEventsQuery, 'severity'>, Omit<C.TelemetryDashboardEventsQuery, 'severity'>>>,
];

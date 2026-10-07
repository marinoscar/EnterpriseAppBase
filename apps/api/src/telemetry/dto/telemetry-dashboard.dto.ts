import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  createTelemetryDashboardMetricsQuerySchema,
  createTelemetryDashboardMetricsSchema,
  metricGroupQuerySchema,
  telemetryDashboardEventsQuerySchema,
  telemetryDashboardEventsSchema,
  telemetryDashboardFiltersSchema,
  telemetryDashboardMetricGroupsSchema,
  telemetryDashboardQuerySchema,
  telemetryDashboardSummarySchema,
  telemetryDashboardTimeseriesQuerySchema,
  telemetryDashboardTimeseriesSchema,
  telemetryDashboardTopQuerySchema,
  telemetryDashboardTopSchema,
} from '@marinoscar/platform-contract/telemetry';

import { isMetricGroup, METRIC_GROUPS, metricGroupIds } from '../metrics/metric-catalog';

// =============================================================================
// Telemetry dashboard — request and response shapes (issue #577, epic #576)
// =============================================================================
//
//   GET /api/admin/telemetry/dashboard/summary     → TelemetryDashboardSummaryDto
//   GET /api/admin/telemetry/dashboard/timeseries  → TelemetryDashboardTimeseriesDto
//   GET /api/admin/telemetry/dashboard/top         → TelemetryDashboardTopDto
//   GET /api/admin/telemetry/dashboard/events      → TelemetryDashboardEventsDto
//   GET /api/admin/telemetry/dashboard/filters     → TelemetryDashboardFiltersDto
//   GET /api/admin/telemetry/dashboard/metrics     → TelemetryDashboardMetricsDto (#601)
//   GET /api/admin/telemetry/dashboard/metric-groups → TelemetryDashboardMetricGroupsDto (#680)
//
// The schemas and constants live in `@marinoscar/platform-contract/telemetry`
// (#702), shared with the web app; this file wraps them as nestjs-zod DTOs and
// re-exports the names services import.
//
// The one thing built here is `/metrics`' `group`: the contract types it as
// any metric group id (the set is open), and this API knows its registered
// set. The query value is checked against the LIVE metric-group registry (so a
// group a test registers with `withTemporaryEntries` is accepted) and
// documented as the enum of the ids registered at import time; the response's
// `group` is that enum. In a running API the two agree: every group registers
// at import time and the registry is frozen at bootstrap.
// =============================================================================

export {
  DASHBOARD_BUCKET_COUNTS,
  DASHBOARD_CURSOR_MAX,
  DASHBOARD_FILTER_VALUE_MAX,
  DASHBOARD_FUTURE_SKEW_MS,
  DASHBOARD_MAX_SPAN_MS,
  DASHBOARD_PANELS,
  DASHBOARD_RANGE_MS,
  DASHBOARD_RANGES,
  DASHBOARD_TOP_KINDS,
  DEFAULT_DASHBOARD_RANGE,
  apiBucketSchema,
  dashboardEventSchema,
  logsBucketSchema,
  metricSeriesSchema,
  metricTableSchema,
  refineWindow,
  telemetryDashboardMetricGroupSchema,
  telemetryDashboardTileSchema,
  telemetryDashboardUnknownRoutesSchema,
  topErrorSchema,
  topRouteSchema,
  unknownRouteSchema,
} from '@marinoscar/platform-contract/telemetry';
export {
  telemetryDashboardEventsQuerySchema,
  telemetryDashboardEventsSchema,
  telemetryDashboardFiltersSchema,
  telemetryDashboardMetricGroupsSchema,
  telemetryDashboardQuerySchema,
  telemetryDashboardSummarySchema,
  telemetryDashboardTimeseriesQuerySchema,
  telemetryDashboardTimeseriesSchema,
  telemetryDashboardTopQuerySchema,
  telemetryDashboardTopSchema,
};
export type {
  DashboardRange,
  TelemetryDashboardEvents,
  TelemetryDashboardEventsQuery,
  TelemetryDashboardFilters,
  TelemetryDashboardMetricGroup,
  TelemetryDashboardMetricGroups,
  TelemetryDashboardQuery,
  TelemetryDashboardSummary,
  TelemetryDashboardTile,
  TelemetryDashboardTimeseries,
  TelemetryDashboardTimeseriesQuery,
  TelemetryDashboardTop,
  TelemetryDashboardTopQuery,
  TelemetryDashboardUnknownRoutes,
} from '@marinoscar/platform-contract/telemetry';

export class TelemetryDashboardQueryDto extends createZodDto(telemetryDashboardQuerySchema) {}
export class TelemetryDashboardTimeseriesQueryDto extends createZodDto(telemetryDashboardTimeseriesQuerySchema) {}
export class TelemetryDashboardTopQueryDto extends createZodDto(telemetryDashboardTopQuerySchema) {}
export class TelemetryDashboardEventsQueryDto extends createZodDto(telemetryDashboardEventsQuerySchema) {}

export const telemetryDashboardMetricsQuerySchema = createTelemetryDashboardMetricsQuerySchema(
  metricGroupQuerySchema({ documented: METRIC_GROUPS, isKnown: isMetricGroup, knownIds: metricGroupIds }),
);
export class TelemetryDashboardMetricsQueryDto extends createZodDto(telemetryDashboardMetricsQuerySchema) {}
export type TelemetryDashboardMetricsQuery = z.infer<typeof telemetryDashboardMetricsQuerySchema>;

export class TelemetryDashboardSummaryDto extends createZodDto(telemetryDashboardSummarySchema) {}
export class TelemetryDashboardTimeseriesDto extends createZodDto(telemetryDashboardTimeseriesSchema) {}
export class TelemetryDashboardTopDto extends createZodDto(telemetryDashboardTopSchema) {}
export class TelemetryDashboardEventsDto extends createZodDto(telemetryDashboardEventsSchema) {}
export class TelemetryDashboardFiltersDto extends createZodDto(telemetryDashboardFiltersSchema) {}

export const telemetryDashboardMetricsSchema = createTelemetryDashboardMetricsSchema(z.enum(METRIC_GROUPS));
export class TelemetryDashboardMetricsDto extends createZodDto(telemetryDashboardMetricsSchema) {}
export type TelemetryDashboardMetrics = z.infer<typeof telemetryDashboardMetricsSchema>;

export class TelemetryDashboardMetricGroupsDto extends createZodDto(telemetryDashboardMetricGroupsSchema) {}

/**
 * The app's MSW telemetry fixtures (`mocks/fixtures/telemetry*.ts`) are valid
 * wire payloads of `@marinoscar/platform-contract/telemetry` (#702): parsed by
 * the contract's schemas, each comes back unchanged. The page-wiring tests
 * answer the packaged telemetry pages (#704) with these fixtures, so a stale
 * one would make them test a shape the API never sends. The package checks
 * its own copies in `packages/platform-web/test/telemetry/services/`.
 */
import {
  telemetryConfigResponseSchema,
  telemetryConnectionResponseSchema,
  telemetryConnectionTestResultSchema,
  telemetryDashboardEventsSchema,
  telemetryDashboardFiltersSchema,
  telemetryDashboardMetricGroupsSchema,
  telemetryDashboardMetricsSchema,
  telemetryDashboardSummarySchema,
  telemetryDashboardTimeseriesSchema,
  telemetryDashboardTopSchema,
  telemetryDeploymentConnectionSchema,
  telemetryPublicConfigSchema,
  telemetryQueryResultSchema,
  telemetrySchemaSchema,
  telemetryStackStatusSchema,
  telemetryStatusSchema,
} from '@marinoscar/platform-contract/telemetry';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as fixtures from './fixtures/telemetry';
import * as dashboardFixtures from './fixtures/telemetryDashboard';

/** Parse with the contract schema: the fixture must come back unchanged. */
function roundTrip(schema: z.ZodType, fixture: unknown): void {
  const result = schema.safeParse(fixture);
  expect(result.error?.issues ?? []).toEqual([]);
  expect(result.data).toEqual(fixture);
}

describe("the app's telemetry fixtures are valid contract payloads", () => {
  const cases: Array<[string, z.ZodType, unknown]> = [
    ['mockTelemetryPublicConfigDisabled', telemetryPublicConfigSchema, fixtures.mockTelemetryPublicConfigDisabled],
    ['mockTelemetryPublicConfigEnabled', telemetryPublicConfigSchema, fixtures.mockTelemetryPublicConfigEnabled],
    ['mockTelemetryAdminConfig', telemetryConfigResponseSchema, fixtures.mockTelemetryAdminConfig],
    ['mockTelemetryStatus', telemetryStatusSchema, fixtures.mockTelemetryStatus],
    ['mockTelemetryStatusUnconfigured', telemetryStatusSchema, fixtures.mockTelemetryStatusUnconfigured],
    ['mockTelemetrySchema', telemetrySchemaSchema, fixtures.mockTelemetrySchema],
    ['mockTelemetryQueryResult', telemetryQueryResultSchema, fixtures.mockTelemetryQueryResult],
    ['mockTelemetryDeployment', telemetryDeploymentConnectionSchema, fixtures.mockTelemetryDeployment],
    ['mockTelemetryConnectionAutomaticStored', telemetryConnectionResponseSchema, fixtures.mockTelemetryConnectionAutomaticStored],
    ['mockTelemetryConnectionAutomaticEnvironment', telemetryConnectionResponseSchema, fixtures.mockTelemetryConnectionAutomaticEnvironment],
    ['mockTelemetryConnectionCustomStored', telemetryConnectionResponseSchema, fixtures.mockTelemetryConnectionCustomStored],
    ['mockTelemetryConnectionAutomaticProblem', telemetryConnectionResponseSchema, fixtures.mockTelemetryConnectionAutomaticProblem],
    ['mockTelemetryConnectionNone', telemetryConnectionResponseSchema, fixtures.mockTelemetryConnectionNone],
    ['mockTelemetryConnectionTestResult', telemetryConnectionTestResultSchema, fixtures.mockTelemetryConnectionTestResult],
    ['mockTelemetryStackRunning', telemetryStackStatusSchema, fixtures.mockTelemetryStackRunning],
    ['mockTelemetryStackMissing', telemetryStackStatusSchema, fixtures.mockTelemetryStackMissing],
    ['mockTelemetryStackUnavailable', telemetryStackStatusSchema, fixtures.mockTelemetryStackUnavailable],
    ['mockTelemetryStackAgentDown', telemetryStackStatusSchema, fixtures.mockTelemetryStackAgentDown],
    ['mockDashboardSummary', telemetryDashboardSummarySchema, dashboardFixtures.mockDashboardSummary],
    ['mockDashboardApiSeries', telemetryDashboardTimeseriesSchema, dashboardFixtures.mockDashboardApiSeries],
    ['mockDashboardLogsSeries', telemetryDashboardTimeseriesSchema, dashboardFixtures.mockDashboardLogsSeries],
    ['mockDashboardTopRoutes', telemetryDashboardTopSchema, dashboardFixtures.mockDashboardTopRoutes],
    ['mockDashboardTopErrors', telemetryDashboardTopSchema, dashboardFixtures.mockDashboardTopErrors],
    ['mockDashboardEventsPage1', telemetryDashboardEventsSchema, dashboardFixtures.mockDashboardEventsPage1],
    ['mockDashboardEventsPage2', telemetryDashboardEventsSchema, dashboardFixtures.mockDashboardEventsPage2],
    ['mockDashboardFilters', telemetryDashboardFiltersSchema, dashboardFixtures.mockDashboardFilters],
    ['mockDashboardMetricGroups', telemetryDashboardMetricGroupsSchema, { data: dashboardFixtures.mockDashboardMetricGroups }],
    ...Object.entries(dashboardFixtures.mockDashboardMetrics).map(
      ([group, metrics]): [string, z.ZodType, unknown] => [`mockDashboardMetrics.${group}`, telemetryDashboardMetricsSchema, metrics],
    ),
  ];

  it('covers every exported fixture value', () => {
    const exported = (module: Record<string, unknown>) =>
      Object.entries(module)
        .filter(([, value]) => typeof value === 'object' && value !== null)
        .map(([name]) => name);
    const covered = new Set(cases.map(([name]) => name.split('.')[0]));
    const aliases = new Set(['mockTelemetryConnectionStored', 'mockTelemetryConnectionEnvironment']);
    expect([...exported(fixtures), ...exported(dashboardFixtures)].filter((name) => !covered.has(name) && !aliases.has(name))).toEqual([]);
  });

  it.each(cases)('%s parses unchanged', (_name, schema, fixture) => {
    roundTrip(schema, fixture);
  });

  it('a generated dashboard event parses too', () => {
    roundTrip(telemetryDashboardEventsSchema, { ...dashboardFixtures.mockDashboardEventsPage1, items: [dashboardFixtures.mockDashboardEvent(3)] });
  });
});

/**
 * The web's telemetry fixtures are valid wire payloads, and the telemetry
 * client takes its shapes and values from `@marinoscar/platform-contract/telemetry`
 * without bundling zod (issue #702).
 *
 * The compile-time half (each web type equals, or is a documented looser or
 * narrower view of, the contract type) is `src/services/telemetryContract.typecheck.ts`,
 * checked by `npm run typecheck`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DASHBOARD_EVENT_SEVERITIES,
  DASHBOARD_RANGE_MS as CONTRACT_DASHBOARD_RANGE_MS,
  DASHBOARD_RANGES as CONTRACT_DASHBOARD_RANGES,
  TELEMETRY_CONNECTION_DEFAULTS as CONTRACT_CONNECTION_DEFAULTS,
  TELEMETRY_EXPORT_FORMATS as CONTRACT_EXPORT_FORMATS,
  TELEMETRY_LIMITS as CONTRACT_LIMITS,
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

import * as fixtures from '../mocks/fixtures/telemetry';
import * as dashboardFixtures from '../mocks/fixtures/telemetryDashboard';
import {
  TELEMETRY_CONNECTION_DEFAULTS,
  TELEMETRY_EXPORT_FORMATS,
  TELEMETRY_EXPORT_LABELS,
  TELEMETRY_EXPORT_MENU_ORDER,
  TELEMETRY_LIMITS,
} from '../../services/telemetry';
import { DASHBOARD_RANGE_MS, DASHBOARD_RANGES, DASHBOARD_SEVERITIES } from '../../services/telemetryDashboard';

/** Parse with the contract schema: the fixture must come back unchanged. */
function roundTrip(schema: z.ZodType, fixture: unknown): void {
  const result = schema.safeParse(fixture);
  expect(result.error?.issues ?? []).toEqual([]);
  expect(result.data).toEqual(fixture);
}

describe('telemetry fixtures are valid contract payloads', () => {
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

describe('telemetry constants come from the contract', () => {
  it('re-exports the contract values themselves', () => {
    expect(TELEMETRY_LIMITS).toBe(CONTRACT_LIMITS);
    expect(TELEMETRY_CONNECTION_DEFAULTS).toBe(CONTRACT_CONNECTION_DEFAULTS);
    expect(DASHBOARD_RANGES).toBe(CONTRACT_DASHBOARD_RANGES);
    expect(DASHBOARD_RANGE_MS).toBe(CONTRACT_DASHBOARD_RANGE_MS);
    expect(DASHBOARD_SEVERITIES).toBe(DASHBOARD_EVENT_SEVERITIES);
  });

  it('keeps the export menu order over exactly the wire formats', () => {
    expect(TELEMETRY_EXPORT_FORMATS).toEqual(['csv', 'xlsx', 'parquet', 'ndjson']);
    expect(TELEMETRY_EXPORT_FORMATS).toBe(TELEMETRY_EXPORT_MENU_ORDER);
    expect([...TELEMETRY_EXPORT_MENU_ORDER].sort()).toEqual([...CONTRACT_EXPORT_FORMATS].sort());
    expect(Object.keys(TELEMETRY_EXPORT_LABELS).sort()).toEqual([...CONTRACT_EXPORT_FORMATS].sort());
  });
});

describe('the telemetry client never bundles zod', () => {
  const root = resolve(__dirname, '../../..');
  const contractConstants = readFileSync(
    resolve(root, '../../packages/platform-contract/src/telemetry/constants.ts'),
    'utf8',
  );
  const zodFree = new Set([...contractConstants.matchAll(/^export const (\w+)/gm)].map((match) => match[1]));

  it.each(['src/services/telemetry.ts', 'src/services/telemetryDashboard.ts'])(
    '%s imports only types and zod-free constants from the contract',
    (file) => {
      const source = readFileSync(resolve(root, file), 'utf8');
      const valueImports = [...source.matchAll(/^import \{([^}]*)\} from '@marinoscar\/platform-contract\/telemetry';/gm)]
        .flatMap((match) => match[1]!.split(','))
        .map((name) => name.trim())
        .filter((name) => name !== '' && !name.startsWith('type '))
        .map((name) => name.split(/\s+as\s+/)[0]!);
      expect(valueImports.length).toBeGreaterThan(0);
      expect(valueImports.filter((name) => !zodFree.has(name))).toEqual([]);
      expect(source).not.toMatch(/from 'zod'/);
    },
  );
});

/**
 * Resolving a group's presentation into what a section draws (PP-14.18).
 */
import { PLATFORM_METRIC_PRESENTATIONS } from '@marinoscar/platform-contract/telemetry';
import { describe, expect, it } from 'vitest';

import {
  colorOfToken,
  normalizeTopN,
  planTiles,
  presentationFor,
  sectionPlan,
  withVirtualColumns,
} from '../../../src/telemetry/headless/lib/metrics/presentation.js';
import type {
  DashboardMetricTable,
  DashboardMetrics,
} from '../../../src/telemetry/headless/services/telemetryDashboard.js';
import { telemetryTokens } from '../../../src/telemetry/theme/telemetryTokens.js';
import { createTheme } from '@mui/material/styles';
import { mockDashboardMetrics } from '../fixtures/telemetryDashboard.js';

const TABLE: DashboardMetricTable = {
  key: 'features',
  label: 'Features',
  columns: [
    { key: 'key', label: 'Feature', unit: 'text' },
    { key: 'failed', label: 'Failed', unit: 'count' },
    { key: 'total', label: 'Total', unit: 'count' },
    { key: 'cost', label: 'Cost', unit: 'usd' },
  ],
  rows: [
    { key: 'search', failed: 5, total: 50, cost: 10 },
    { key: 'export', failed: 0, total: 0, cost: 4 },
    { key: 'share', failed: null, total: 20, cost: 3 },
  ],
};

describe('presentationFor', () => {
  it("prefers the served presentation, then the platform's own, then nothing", () => {
    const served = { tiles: [{ metric: 'a' }] };
    expect(presentationFor('host', served)).toBe(served);
    expect(presentationFor('host')).toBe(PLATFORM_METRIC_PRESENTATIONS.host);
    expect(presentationFor('host', null)).toBe(PLATFORM_METRIC_PRESENTATIONS.host);
    expect(presentationFor('activity')).toBeUndefined();
    expect(presentationFor('constructor')).toBeUndefined();
    expect(presentationFor('__proto__')).toBeUndefined();
  });
});

describe('sectionPlan', () => {
  const data = mockDashboardMetrics.host;

  it('defaults to every tile, one chart per series key and every table when there is no presentation', () => {
    const plan = sectionPlan(data, undefined);
    expect(plan.tiles.map((tile) => tile.metric)).toEqual(data.tiles.map((tile) => tile.key));
    expect(plan.charts.map((chart) => chart.keys)).toEqual([
      ['cpuUtilization'],
      ['memoryUtilization'],
      ['filesystemUtilization'],
    ]);
    expect(plan.tables.map((table) => table.key)).toEqual(data.tables.map((table) => table.key));
    expect(plan.virtualColumns).toEqual([]);
  });

  it('draws exactly a part the presentation names, an empty list included, and defaults the parts it leaves out', () => {
    const plan = sectionPlan(data, { series: [], tiles: [{ metric: 'cpuUtilization' }] });
    expect(plan.tiles).toEqual([{ metric: 'cpuUtilization' }]);
    expect(plan.charts).toEqual([]);
    expect(plan.tables.map((table) => table.key)).toEqual(data.tables.map((table) => table.key));
  });

  it('turns a bare Top N into "Top N and All"', () => {
    expect(normalizeTopN(5)).toEqual({ options: [5, 'all'], default: 5 });
    expect(normalizeTopN({ options: [10, 20], default: 20 })).toEqual({
      options: [10, 20],
      default: 20,
    });
    expect(normalizeTopN(undefined)).toBeUndefined();
    expect(
      sectionPlan(data, { tables: [{ metric: 'filesystems', topN: 3, sort: 'problems-first' }] })
        .tables[0]
    ).toEqual({
      key: 'filesystems',
      topN: { options: [3, 'all'], default: 3 },
      sort: 'problems-first',
    });
  });
});

describe('planTiles', () => {
  const data: DashboardMetrics = mockDashboardMetrics.host;

  it("keeps the plan's order, skips a tile the response lacks, and returns an untouched tile as is", () => {
    const plan = sectionPlan(data, {
      tiles: [{ metric: 'load1m' }, { metric: 'absent' }, { metric: 'cpuUtilization' }],
    });
    const tiles = planTiles(data, plan);
    expect(tiles.map((tile) => tile.key)).toEqual(['load1m', 'cpuUtilization']);
    expect(tiles[0]).toBe(data.tiles.find((tile) => tile.key === 'load1m'));
  });

  it('applies a label and a unit override without mutating the response', () => {
    const plan = sectionPlan(data, {
      tiles: [{ metric: 'cpuUtilization', label: 'Processor', unit: 'usd' }],
    });
    const [tile] = planTiles(data, plan);
    expect(tile).toMatchObject({
      key: 'cpuUtilization',
      label: 'Processor',
      unit: 'usd',
      value: 24.1,
    });
    expect(data.tiles.find((candidate) => candidate.key === 'cpuUtilization')).toMatchObject({
      label: 'CPU utilization',
      unit: '%',
    });
  });
});

describe('withVirtualColumns', () => {
  it('computes a ratio as a percentage, "—" (null) where an input is missing or the divisor is zero', () => {
    const result = withVirtualColumns(
      TABLE,
      [{ id: 'failRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'total'] }],
      3_600_000
    );
    expect(result.columns.at(-1)).toEqual({ key: 'failRate', label: 'Failure rate', unit: '%' });
    expect(result.rows.map((row) => row.failRate)).toEqual([10, null, null]);
    expect(TABLE.columns).toHaveLength(4);
    expect(TABLE.rows[0]).not.toHaveProperty('failRate');
  });

  it("computes a delta in the first input's unit and a rate per second over the window", () => {
    const delta = withVirtualColumns(
      TABLE,
      [{ id: 'ok', label: 'OK', expression: 'delta', of: ['total', 'failed'] }],
      1000
    );
    expect(delta.columns.at(-1)!.unit).toBe('count');
    expect(delta.rows.map((row) => row.ok)).toEqual([45, 0, null]);

    const rate = withVirtualColumns(
      TABLE,
      [{ id: 'perSecond', label: 'Per second', expression: 'rate', of: ['total'] }],
      10_000
    );
    expect(rate.columns.at(-1)).toEqual({ key: 'perSecond', label: 'Per second', unit: 'per_s' });
    expect(rate.rows.map((row) => row.perSecond)).toEqual([5, 0, 2]);
    expect(
      withVirtualColumns(
        TABLE,
        [{ id: 'perSecond', label: 'x', expression: 'rate', of: ['total'] }],
        0
      ).rows[0]!.perSecond
    ).toBeNull();
  });

  it('uses the declared unit', () => {
    const result = withVirtualColumns(
      TABLE,
      [
        {
          id: 'perFail',
          label: 'Cost per failure',
          expression: 'ratio',
          of: ['cost', 'failed'],
          unit: 'usd',
        },
      ],
      1
    );
    expect(result.columns.at(-1)!.unit).toBe('usd');
  });

  it('applies only to the table it names, only when every input column is there, and never replaces a column', () => {
    const column = {
      id: 'failRate',
      label: 'x',
      expression: 'ratio' as const,
      of: ['failed', 'total'],
    };
    expect(withVirtualColumns(TABLE, [{ ...column, table: 'other' }], 1)).toBe(TABLE);
    expect(withVirtualColumns(TABLE, [{ ...column, of: ['failed', 'nope'] }], 1)).toBe(TABLE);
    expect(withVirtualColumns(TABLE, [{ ...column, id: 'total' }], 1)).toBe(TABLE);
    expect(withVirtualColumns(TABLE, [], 1)).toBe(TABLE);
    expect(withVirtualColumns(TABLE, [{ ...column, table: 'features' }], 1)).not.toBe(TABLE);
  });
});

describe('colorOfToken', () => {
  const tokens = telemetryTokens(createTheme());

  it('maps status tokens to palette.status and series tokens to palette.chart.series, wrapping', () => {
    expect(colorOfToken('ok', tokens)).toBe(tokens.status.ok);
    expect(colorOfToken('crit', tokens)).toBe(tokens.status.crit);
    expect(colorOfToken('neutral', tokens)).toBe(tokens.status.neutral);
    expect(colorOfToken('series-1', tokens)).toBe(tokens.chart.series[0]);
    expect(colorOfToken('series-3', tokens)).toBe(tokens.chart.series[2]);
    const short = { ...tokens, chart: { series: ['#111', '#222'] } };
    expect(colorOfToken('series-3', short)).toBe('#111');
  });
});

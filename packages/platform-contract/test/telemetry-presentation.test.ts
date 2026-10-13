// The telemetry presentation contract (PP-14.18): units, group presentation,
// dashboard panels and the open assistant tool names. A presentation is DATA:
// these tests pin that it is strict, bounded, and carries nothing executable.
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BUILTIN_METRIC_UNITS,
  BUILTIN_TELEMETRY_ASSISTANT_TOOLS,
  DASHBOARD_PANEL_ID_PATTERN,
  METRIC_PRESENTATION_LIMITS,
  METRIC_UNITS,
  METRIC_UNIT_ID_PATTERN,
  PLATFORM_METRIC_GROUPS,
  PLATFORM_METRIC_PRESENTATIONS,
  PRESENTATION_COLOR_TOKENS,
  TELEMETRY_ASSISTANT_TOOLS,
  TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN,
  metricGroupPresentationSchema,
  metricSeriesSchema,
  metricUnitDescriptorSchema,
  telemetryDashboardMetricGroupSchema,
  telemetryDashboardPanelDataSchema,
  telemetryDashboardPanelsSchema,
} from '../src/telemetry/index.js';
import type { MetricUnit, TelemetryAssistantStepEvent, TelemetryAssistantToolName } from '../src/telemetry/index.js';

describe('metric units', () => {
  it('keeps the original list under its original name, as the built-in set', () => {
    expect(METRIC_UNITS).toBe(BUILTIN_METRIC_UNITS);
    expect(BUILTIN_METRIC_UNITS).toHaveLength(15);
    for (const unit of BUILTIN_METRIC_UNITS) expect(METRIC_UNIT_ID_PATTERN.test(unit)).toBe(true);
  });

  it('is open: a series or a column accepts an app unit id and refuses a malformed one', () => {
    const series = { key: 'aiSpend', label: 'AI spend', dimension: null, groupBy: null, points: [] };
    expect(metricSeriesSchema.safeParse({ ...series, unit: 'usd' }).success).toBe(true);
    expect(metricSeriesSchema.safeParse({ ...series, unit: 'bytes/s' }).success).toBe(true);
    for (const unit of ['USD', '', ' usd', 'a'.repeat(33), 'usd;drop', '<b>']) {
      expect(metricSeriesSchema.safeParse({ ...series, unit }).success).toBe(false);
    }
    expectTypeOf<'usd'>().toExtend<MetricUnit>();
    expectTypeOf<'bytes'>().toExtend<MetricUnit>();
  });

  it('describes how an app unit is formatted', () => {
    expect(metricUnitDescriptorSchema.parse({ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 })).toEqual({
      id: 'usd',
      label: 'US dollars',
      format: 'currency',
      currency: 'USD',
      decimals: 2,
    });
    expect(metricUnitDescriptorSchema.parse({ id: 'nudges', label: 'Nudges', format: 'number', suffix: ' nudges' }).suffix).toBe(' nudges');
  });

  it.each([
    ['a currency without its code', { id: 'usd', label: 'USD', format: 'currency' }],
    ['a currency code on another format', { id: 'x', label: 'X', format: 'number', currency: 'USD' }],
    ['a lowercase currency code', { id: 'usd', label: 'USD', format: 'currency', currency: 'usd' }],
    ['a suffix on a percent', { id: 'x', label: 'X', format: 'percent', suffix: '!' }],
    ['seven decimals', { id: 'x', label: 'X', format: 'number', decimals: 7 }],
    ['an unknown format', { id: 'x', label: 'X', format: 'html' }],
    ['an unknown field', { id: 'x', label: 'X', format: 'number', render: 'alert(1)' }],
  ])('refuses %s', (_name, unit) => {
    expect(metricUnitDescriptorSchema.safeParse(unit).success).toBe(false);
  });
});

describe('metricGroupPresentationSchema', () => {
  it('accepts the owner example: a coloured tile, a top-5 table, a ratio column', () => {
    const presentation = {
      tiles: [{ metric: 'aiSpend', label: 'AI spend', unit: 'usd', color: 'warn' }],
      series: [{ title: 'Sign-ins', metrics: ['authLogins'], colors: { failed: 'crit', succeeded: 'ok' } }],
      tables: [{ metric: 'features', topN: 5, columns: [{ key: 'key' }, { key: 'failRate' }] }],
      virtualColumns: [{ id: 'failRate', label: 'Failure rate', expression: 'ratio', of: ['failed', 'total'], table: 'features' }],
    };
    expect(metricGroupPresentationSchema.parse(presentation)).toEqual(presentation);
  });

  it('accepts the empty presentation and each part alone', () => {
    expect(metricGroupPresentationSchema.parse({})).toEqual({});
    expect(metricGroupPresentationSchema.parse({ series: [] })).toEqual({ series: [] });
  });

  it('validates every presentation of the six platform groups', () => {
    expect(Object.keys(PLATFORM_METRIC_PRESENTATIONS)).toEqual([...PLATFORM_METRIC_GROUPS]);
    for (const group of PLATFORM_METRIC_GROUPS) {
      expect(metricGroupPresentationSchema.safeParse(PLATFORM_METRIC_PRESENTATIONS[group]).success).toBe(true);
    }
  });

  it('is data only: a colour is a theme token, never CSS, and unknown fields are refused', () => {
    const tile = (extra: object) => ({ tiles: [{ metric: 'a', ...extra }] });
    expect(metricGroupPresentationSchema.safeParse(tile({ color: '#ff0000' })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(tile({ color: 'red; background: url(x)' })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(tile({ render: '() => alert(1)' })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(tile({ sx: { color: 'red' } })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse({ onClick: 'x' }).success).toBe(false);
    for (const token of PRESENTATION_COLOR_TOKENS) expect(metricGroupPresentationSchema.safeParse(tile({ color: token })).success).toBe(true);
  });

  it('refuses a metric key that is not a plain identifier', () => {
    for (const metric of ['', '1abc', 'a b', 'a;b', '<script>', 'a'.repeat(65)]) {
      expect(metricGroupPresentationSchema.safeParse({ tiles: [{ metric }] }).success).toBe(false);
    }
    expect(metricGroupPresentationSchema.safeParse({ tiles: [{ metric: 'queueDepth.pending' }] }).success).toBe(true);
  });

  it('is bounded', () => {
    const L = METRIC_PRESENTATION_LIMITS;
    const many = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));
    expect(metricGroupPresentationSchema.safeParse({ tiles: many(L.tiles, (i) => ({ metric: `m${i}` })) }).success).toBe(true);
    expect(metricGroupPresentationSchema.safeParse({ tiles: many(L.tiles + 1, (i) => ({ metric: `m${i}` })) }).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse({ series: many(L.charts + 1, () => ({ title: 't', metrics: ['a'] })) }).success).toBe(false);
    expect(
      metricGroupPresentationSchema.safeParse({ series: [{ title: 't', metrics: many(L.chartMetrics + 1, (i) => `m${i}`) }] }).success,
    ).toBe(false);
    expect(metricGroupPresentationSchema.safeParse({ tables: many(L.tables + 1, () => ({ metric: 't' })) }).success).toBe(false);
    expect(
      metricGroupPresentationSchema.safeParse({ tables: [{ metric: 't', columns: many(L.columns + 1, (i) => ({ key: `c${i}` })) }] }).success,
    ).toBe(false);
    expect(metricGroupPresentationSchema.safeParse({ tiles: [{ metric: 'a', label: 'x'.repeat(L.label + 1) }] }).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse({ tables: [{ metric: 't', topN: L.topNMax + 1 }] }).success).toBe(false);
    const colors = Object.fromEntries(many(L.chartColors + 1, (i): [string, string] => [`v${i}`, 'ok']));
    expect(metricGroupPresentationSchema.safeParse({ series: [{ title: 't', metrics: ['a'], colors }] }).success).toBe(false);
  });

  it('checks the shape of Top N, display kinds and virtual column inputs', () => {
    const table = (extra: object) => ({ tables: [{ metric: 't', ...extra }] });
    expect(metricGroupPresentationSchema.safeParse(table({ topN: { options: [5, 'all'], default: 5 } })).success).toBe(true);
    expect(metricGroupPresentationSchema.safeParse(table({ topN: { options: [5, 10], default: 20 } })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(table({ topN: 0 })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(table({ sort: 'random' })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(table({ columns: [{ key: 'a', display: { kind: 'html', value: '<b>' } }] })).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(table({ columns: [{ key: 'a', display: { kind: 'status', okText: '', badText: 'x' } }] })).success).toBe(false);
    const virtual = (expression: string, of: string[]) => ({ virtualColumns: [{ id: 'v', label: 'V', expression, of }] });
    expect(metricGroupPresentationSchema.safeParse(virtual('ratio', ['a'])).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(virtual('delta', ['a', 'b'])).success).toBe(true);
    expect(metricGroupPresentationSchema.safeParse(virtual('rate', ['a', 'b'])).success).toBe(false);
    expect(metricGroupPresentationSchema.safeParse(virtual('rate', ['a'])).success).toBe(true);
    expect(metricGroupPresentationSchema.safeParse(virtual('eval', ['a', 'b'])).success).toBe(false);
  });
});

describe('the metric-group listing', () => {
  it('carries an optional presentation and the descriptors of the app units it uses', () => {
    const base = { id: 'activity', label: 'Activity', title: 'App activity', order: 70 };
    expect(telemetryDashboardMetricGroupSchema.parse(base)).toEqual(base);
    const full = {
      ...base,
      presentation: { tiles: [{ metric: 'aiSpend', unit: 'usd' }] },
      units: [{ id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD' }],
    };
    expect(telemetryDashboardMetricGroupSchema.parse(full)).toEqual(full);
  });
});

describe('dashboard panels', () => {
  it('matches ids against the panel pattern', () => {
    for (const id of ['api', 'logs', 'signups', 'ai-spend', 'a_b']) expect(DASHBOARD_PANEL_ID_PATTERN.test(id)).toBe(true);
    for (const id of ['A', 'a', '1x', 'a b', 'a/b', '../x', 'a'.repeat(49)]) expect(DASHBOARD_PANEL_ID_PATTERN.test(id)).toBe(false);
  });

  it('lists panels and wraps a panel payload', () => {
    expect(telemetryDashboardPanelsSchema.parse({ data: [{ id: 'signups', label: 'Sign-ups', order: 100, builtin: false }] }).data).toHaveLength(1);
    expect(telemetryDashboardPanelsSchema.safeParse({ data: [{ id: 'Bad Id', label: 'x', order: 1, builtin: true }] }).success).toBe(false);
    const read = { id: 'signups', generatedAt: '2026-01-01T00:00:00.000Z', payload: { total: 3, days: [1, 2] } };
    expect(telemetryDashboardPanelDataSchema.parse(read)).toEqual(read);
  });
});

describe('assistant tool names', () => {
  it('keeps the eight built-in names under the original constant', () => {
    expect(TELEMETRY_ASSISTANT_TOOLS).toBe(BUILTIN_TELEMETRY_ASSISTANT_TOOLS);
    expect(TELEMETRY_ASSISTANT_TOOLS).toHaveLength(8);
    for (const name of TELEMETRY_ASSISTANT_TOOLS) expect(TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN.test(name)).toBe(true);
  });

  it('takes any well-formed name, and a step event may name an app tool', () => {
    for (const name of ['top_features', 'a1']) expect(TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN.test(name)).toBe(true);
    for (const name of ['Top', 'top-features', '1x', 'a', 'x'.repeat(49), 'a b']) expect(TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN.test(name)).toBe(false);
    expectTypeOf<'top_features'>().toExtend<TelemetryAssistantToolName>();
    const step: TelemetryAssistantStepEvent = { index: 0, tool: 'top_features', durationMs: 4 };
    expect(step.tool).toBe('top_features');
  });
});

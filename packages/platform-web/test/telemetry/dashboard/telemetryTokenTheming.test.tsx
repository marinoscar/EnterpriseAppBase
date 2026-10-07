/**
 * The telemetry token contract is real (issue #686): a theme that overrides
 * `palette.status.crit` and `palette.chart.series` recolours the API
 * timeline's 5xx bars, the log chart's error band and a metric chart's first
 * line — and the base theme still gives the colours the palette gave before.
 *
 * jsdom has no layout, so `@mui/x-charts` is stubbed to record the series
 * each chart is handed; the colours under test are those series' `color`s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { lightTestTheme as lightTheme } from '../harness.js';
import { withTelemetryTokens } from '../../../src/telemetry/theme/telemetryTokens.js';
import { ApiTimelineChart } from '../../../src/telemetry/ui/components/dashboard/ApiTimelineChart.js';
import { LogSeverityChart } from '../../../src/telemetry/ui/components/dashboard/LogSeverityChart.js';
import { MetricSeriesChart } from '../../../src/telemetry/ui/components/dashboard/metrics/MetricSeriesChart.js';
import { mockDashboardMetrics } from '../fixtures/telemetryDashboard.js';
import type { DashboardApiBucket, DashboardLogsBucket } from '../../../src/telemetry/headless/services/telemetryDashboard.js';

type RecordedSeries = { id: string; color?: string };

const recorded = vi.hoisted(() => ({ series: [] as RecordedSeries[][] }));

vi.mock('@mui/x-charts/ChartsDataProvider', () => ({
  ChartsDataProvider: ({ series }: { series: RecordedSeries[] }) => {
    recorded.series.push(series);
    return null;
  },
}));
vi.mock('@mui/x-charts/BarChart', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BarChart: ({ series }: { series: RecordedSeries[] }) => {
    recorded.series.push(series);
    return null;
  },
}));
vi.mock('@mui/x-charts/LineChart', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  LineChart: ({ series }: { series: RecordedSeries[] }) => {
    recorded.series.push(series);
    return null;
  },
}));

const CRIT = '#b00020';
const SERIES = ['#0057b8', '#ffd700', '#7a1fa2'];
const customTheme = withTelemetryTokens(
  createTheme({ palette: { status: { crit: CRIT }, chart: { series: SERIES } } }),
);

const apiBuckets: DashboardApiBucket[] = [
  { t: '2026-01-01T00:00:00Z', s2xx: 10, s3xx: 1, s4xx: 2, s5xx: 3, p95Ms: 120 },
  { t: '2026-01-01T00:01:00Z', s2xx: 12, s3xx: 0, s4xx: 1, s5xx: 0, p95Ms: 90 },
];
const logBuckets: DashboardLogsBucket[] = [
  { t: '2026-01-01T00:00:00Z', error: 2, warn: 3, info: 4, other: 1 },
  { t: '2026-01-01T00:01:00Z', error: 0, warn: 1, info: 2, other: 0 },
];
const timeline = {
  height: 200,
  spanMs: 3_600_000,
  compact: false,
  zoom: { drag: false, tap: false },
  onZoomBuckets: () => {},
};

function renderIn(theme: Theme, ui: ReactNode) {
  recorded.series = [];
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
  expect(recorded.series.length).toBeGreaterThan(0);
  return recorded.series[recorded.series.length - 1];
}

const colorOf = (series: RecordedSeries[], id: string) => series.find((s) => s.id === id)?.color;

describe('telemetry charts under a custom-token theme (#686)', () => {
  beforeEach(() => {
    recorded.series = [];
  });

  it('draws the 5xx bars in palette.status.crit', () => {
    const series = renderIn(customTheme, <ApiTimelineChart buckets={apiBuckets} {...timeline} />);
    expect(colorOf(series, 's5xx')).toBe(CRIT);
    expect(colorOf(series, 's2xx')).toBe(customTheme.palette.success.main);
  });

  it('draws the error log band in palette.status.crit', () => {
    const series = renderIn(
      customTheme,
      <LogSeverityChart buckets={logBuckets} severities={['error', 'warn', 'info']} {...timeline} />,
    );
    expect(colorOf(series, 'error')).toBe(CRIT);
    expect(colorOf(series, 'other')).toBe(customTheme.palette.grey[500]);
  });

  it('draws metric lines from palette.chart.series, in order', () => {
    const series = renderIn(
      customTheme,
      <MetricSeriesChart title="CPU and memory" series={mockDashboardMetrics.host.series.slice(0, 2)} height={200} spanMs={3_600_000} compact={false} />,
    );
    expect(series.map((s) => s.color)).toEqual(SERIES.slice(0, series.length));
  });

  it('keeps the base theme on the palette colours it used before the tokens', () => {
    const api = renderIn(lightTheme, <ApiTimelineChart buckets={apiBuckets} {...timeline} />);
    expect(colorOf(api, 's2xx')).toBe(lightTheme.palette.success.main);
    expect(colorOf(api, 's3xx')).toBe(lightTheme.palette.info.main);
    expect(colorOf(api, 's4xx')).toBe(lightTheme.palette.warning.main);
    expect(colorOf(api, 's5xx')).toBe(lightTheme.palette.error.main);

    const logs = renderIn(
      lightTheme,
      <LogSeverityChart buckets={logBuckets} severities={['error', 'warn', 'info']} {...timeline} />,
    );
    expect(logs.map((s) => s.color)).toEqual([
      lightTheme.palette.error.main,
      lightTheme.palette.warning.main,
      lightTheme.palette.info.main,
      lightTheme.palette.grey[500],
    ]);

    const lines = renderIn(
      lightTheme,
      <MetricSeriesChart title="CPU and memory" series={mockDashboardMetrics.host.series.slice(0, 2)} height={200} spanMs={3_600_000} compact={false} />,
    );
    expect(lines.map((s) => s.color)).toEqual([lightTheme.palette.primary.main, lightTheme.palette.secondary.main]);
  });
});

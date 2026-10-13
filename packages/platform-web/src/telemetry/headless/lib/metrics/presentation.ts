/**
 * Resolving a metric group's presentation for the dashboard (PP-14.18).
 *
 * The API serves each group's `presentation` (data only: tiles, charts, tables,
 * computed columns). This file turns it, and the response it is applied to,
 * into the plan the section draws, with the dashboard's defaults for whatever the
 * presentation leaves out. Pure functions; no React, no MUI.
 */
import { PLATFORM_METRIC_PRESENTATIONS } from '@marinoscar/platform-contract/telemetry';
import type {
  MetricGroupPresentation,
  PresentationColumn,
  PresentationSeries,
  PresentationTable,
  PresentationTableSort,
  PresentationTile,
  PresentationTopN,
  PresentationVirtualColumn,
  ThemeColorToken,
} from '@marinoscar/platform-contract/telemetry';

import type { TelemetryTokens } from '../../../theme/telemetryTokens.js';
import { toNumber } from '../format.js';
import type {
  DashboardMetricCell,
  DashboardMetricGroup,
  DashboardMetricSeries,
  DashboardMetricTable,
  DashboardMetrics,
  DashboardTile,
} from '../../services/telemetryDashboard.js';

/**
 * The presentation to draw for `group`: the one the API served; else, for a
 * platform group, the platform's own (so a section looks the same against an API
 * that predates presentations); else none (the dashboard's defaults).
 *
 * @param group - the group id.
 * @param served - the `presentation` of the group's `/metric-groups` entry.
 * @returns the presentation, or `undefined` for the defaults.
 *
 * @stability experimental
 */
export function presentationFor(
  group: DashboardMetricGroup,
  served?: MetricGroupPresentation | null,
): MetricGroupPresentation | undefined {
  if (served) return served;
  return Object.prototype.hasOwnProperty.call(PLATFORM_METRIC_PRESENTATIONS, group)
    ? PLATFORM_METRIC_PRESENTATIONS[group as keyof typeof PLATFORM_METRIC_PRESENTATIONS]
    : undefined;
}

/**
 * The CSS colour of a presentation colour token under the telemetry theme
 * tokens: `ok`, `warn`, `crit`, `info`, `neutral` are `palette.status`, and
 * `series-N` is the Nth `palette.chart.series` colour (wrapping).
 *
 * @param token - the token a presentation named.
 * @param tokens - the theme's telemetry tokens.
 * @returns the colour string.
 *
 * @stability experimental
 */
export function colorOfToken(token: ThemeColorToken, tokens: TelemetryTokens): string {
  const series = /^series-(\d)$/.exec(token);
  if (series) {
    const palette = tokens.chart.series;
    return palette[(Number(series[1]) - 1) % palette.length]!;
  }
  return tokens.status[token as keyof TelemetryTokens['status']];
}

// ---- the section plan ----------------------------------------------------------------

/** One chart of a section. */
export interface ChartPlan {
  title: string;
  /** Series keys, in legend order; every series of a key (one per `groupBy`) is drawn. */
  keys: string[];
  /** Theme colour tokens by `groupBy` value. */
  colors?: Record<string, ThemeColorToken>;
}

/** One column of a table in a section. */
export interface ColumnPlan extends PresentationColumn {}

/** One table of a section. */
export interface TablePlan {
  key: string;
  label?: string;
  columns?: ColumnPlan[];
  sort?: PresentationTableSort;
  topN?: { options: readonly (number | 'all')[]; default: number | 'all' };
}

/** What a section draws. */
export interface SectionPlan {
  tiles: PresentationTile[];
  charts: ChartPlan[];
  tables: TablePlan[];
  virtualColumns: PresentationVirtualColumn[];
}

/** The series label without its `groupBy` suffix (`Disk IO: read` → `Disk IO`). */
function familyLabel(series: DashboardMetricSeries): string {
  const suffix = series.groupBy === null ? '' : `: ${series.groupBy}`;
  return suffix && series.label.endsWith(suffix) ? series.label.slice(0, -suffix.length) : series.label;
}

/** A "Top N" given as a bare number offers that many rows, or all of them. */
export function normalizeTopN(topN: PresentationTopN | undefined): TablePlan['topN'] {
  if (topN === undefined) return undefined;
  return typeof topN === 'number' ? { options: [topN, 'all'], default: topN } : topN;
}

/**
 * What a section draws for a response: each part of the presentation that is
 * present is exactly what is drawn (an empty list draws nothing); each part it
 * leaves out takes the default: every tile in the response's order, one chart per
 * series key, every table.
 *
 * @param data - the group's `/metrics` response.
 * @param presentation - the group's presentation, or `undefined` for all defaults.
 * @returns the plan.
 *
 * @stability experimental
 */
export function sectionPlan(data: DashboardMetrics, presentation: MetricGroupPresentation | undefined): SectionPlan {
  const seriesKeys = [...new Set(data.series.map((series) => series.key))];
  return {
    tiles: presentation?.tiles ?? data.tiles.map((tile): PresentationTile => ({ metric: tile.key })),
    charts:
      presentation?.series?.map(
        (chart: PresentationSeries): ChartPlan => ({
          title: chart.title,
          keys: chart.metrics,
          ...(chart.colors ? { colors: chart.colors } : {}),
        }),
      ) ??
      seriesKeys.map((key) => ({
        title: familyLabel(data.series.find((series) => series.key === key) as DashboardMetricSeries),
        keys: [key],
      })),
    tables:
      presentation?.tables?.map(
        (table: PresentationTable): TablePlan => ({
          key: table.metric,
          ...(table.label ? { label: table.label } : {}),
          ...(table.columns ? { columns: table.columns } : {}),
          ...(table.sort ? { sort: table.sort } : {}),
          ...(table.topN !== undefined ? { topN: normalizeTopN(table.topN) } : {}),
        }),
      ) ?? data.tables.map((table): TablePlan => ({ key: table.key })),
    virtualColumns: presentation?.virtualColumns ?? [],
  };
}

/**
 * The section's tiles, in the plan's order, that the response carries, with the
 * plan's label and unit applied. A tile with no override is the response's own
 * object.
 *
 * @param data - the `/metrics` response.
 * @param plan - the section plan.
 * @returns the tiles to draw.
 *
 * @stability experimental
 */
export function planTiles(data: DashboardMetrics, plan: SectionPlan): DashboardTile[] {
  const byKey = new Map(data.tiles.map((tile) => [tile.key, tile]));
  return plan.tiles.flatMap((spec) => {
    const tile = byKey.get(spec.metric);
    if (!tile) return [];
    return spec.label !== undefined || spec.unit !== undefined
      ? [{ ...tile, ...(spec.label !== undefined ? { label: spec.label } : {}), ...(spec.unit !== undefined ? { unit: spec.unit } : {}) }]
      : [tile];
  });
}

/**
 * A table with the presentation's virtual columns appended: `ratio` (`a / b` as
 * a percentage), `delta` (`a - b`), `rate` (`a` per second over `spanMs`). A row
 * where an input is not a number, or a ratio's divisor is zero, gets `null`.
 * Returns `table` itself when no virtual column applies.
 *
 * @param table - a response table.
 * @param virtualColumns - the presentation's computed columns.
 * @param spanMs - the window's length, for `rate`.
 * @returns the table to draw.
 *
 * @stability experimental
 */
export function withVirtualColumns(
  table: DashboardMetricTable,
  virtualColumns: readonly PresentationVirtualColumn[],
  spanMs: number,
): DashboardMetricTable {
  const present = new Set(table.columns.map((column) => column.key));
  const applicable = virtualColumns.filter(
    (column) => (column.table === undefined || column.table === table.key) && column.of.every((input) => present.has(input)) && !present.has(column.id),
  );
  if (applicable.length === 0) return table;

  const unitOf = (key: string) => table.columns.find((column) => column.key === key)?.unit ?? 'count';
  const compute = (column: PresentationVirtualColumn, row: Record<string, DashboardMetricCell>): number | null => {
    const a = toNumber(row[column.of[0]!] as number | string | null | undefined);
    if (a === null) return null;
    if (column.expression === 'rate') return spanMs > 0 ? round(a / (spanMs / 1000)) : null;
    const b = toNumber(row[column.of[1]!] as number | string | null | undefined);
    if (b === null) return null;
    if (column.expression === 'delta') return round(a - b);
    return b === 0 ? null : round((a / b) * 100);
  };
  const defaultUnit = (column: PresentationVirtualColumn) =>
    column.unit ?? (column.expression === 'ratio' ? '%' : column.expression === 'rate' ? 'per_s' : unitOf(column.of[0]!));

  return {
    ...table,
    columns: [...table.columns, ...applicable.map((column) => ({ key: column.id, label: column.label, unit: defaultUnit(column) }))],
    rows: table.rows.map((row) => ({ ...row, ...Object.fromEntries(applicable.map((column) => [column.id, compute(column, row)])) })),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The comparator for `sort: 'value-desc'` over `table`: the first column after
 * the key, largest first, rows with no number last. Stable (equal values keep
 * the API's order). `undefined` when the table has no value column.
 *
 * @param table - the response table the rows belong to.
 * @returns the comparator, or `undefined`.
 *
 * @stability experimental
 */
export function byFirstValueDesc(
  table: DashboardMetricTable,
): ((a: Record<string, DashboardMetricCell>, b: Record<string, DashboardMetricCell>) => number) | undefined {
  const column = table.columns.find((candidate) => candidate.key !== 'key')?.key;
  if (column === undefined) return undefined;
  const value = (row: Record<string, DashboardMetricCell>): number | null => toNumber(row[column] as number | string | null | undefined);
  return (a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  };
}

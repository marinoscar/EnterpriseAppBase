import type { AlertComparator, MetricThresholdConfig } from '@marinoscar/platform-contract/alerts';

import type { TelemetryQueryFacade } from '../../telemetry/index';
import type { AlertMetricTable } from '../alerts.types';

// =============================================================================
// The one statement a `metric_threshold` rule runs (issue #1047)
// =============================================================================
//
// EVERY value that reaches the SQL goes through the facade's builders
// (`sql.ident` for a column, `sql.literal` for a filter value, `sql.timestamp`
// for the window): nothing from a rule's config is concatenated. The only
// other interpolated numbers are integers this file computes itself from the
// validated window. Column names a rule names (`groupBy`, a filter's `attr`)
// are additionally required to be columns of the resolved table.
// =============================================================================

/** The suffixes the store appends to a metric's table name, by unit or kind. */
export const METRIC_TABLE_SUFFIXES = ['', '_total', '_bytes', '_seconds', '_ratio', '_percent'] as const;

/**
 * The table a metric name or table name resolves to: the name with `.` turned
 * into `_`, as is, or with one of the store's unit suffixes.
 *
 * @param metric - a dotted metric name (`app.jobs.settled`) or a table name.
 * @param tables - the store's metric tables.
 * @returns the table, or `null` when the store has none.
 *
 * @stability experimental
 */
export function resolveMetricTable(
  metric: string,
  tables: ReadonlyMap<string, AlertMetricTable>,
): AlertMetricTable | null {
  const base = metric.replace(/\./g, '_');
  for (const suffix of METRIC_TABLE_SUFFIXES) {
    const table = tables.get(`${base}${suffix}`);
    if (table) return table;
  }
  return null;
}

/**
 * Whether `value` breaches `threshold` under `comparator`.
 *
 * @param value - the observed value.
 * @param comparator - the rule's comparator.
 * @param threshold - the rule's threshold.
 * @returns the verdict.
 *
 * @stability experimental
 */
export function compareValue(value: number, comparator: AlertComparator, threshold: number): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    case 'neq':
      return value !== threshold;
  }
}

/**
 * Builds the statement for one rule over one table. Throws when a named
 * column is not a column of the table.
 *
 * @param config - the rule's parsed config.
 * @param table - the resolved metric table.
 * @param query - the facade (its builders quote; its dialect spells the columns).
 * @param now - the end of the window.
 * @returns one SELECT. The result columns are the `groupBy` columns (as text), then `value`.
 *
 * @stability experimental
 */
export function buildMetricThresholdSql(
  config: MetricThresholdConfig,
  table: AlertMetricTable,
  query: Pick<TelemetryQueryFacade, 'sql' | 'dialect'>,
  now: Date,
): string {
  const { sql, dialect } = query;
  const groupBy = config.groupBy ?? [];
  const filters = config.filters ?? [];

  for (const column of [...groupBy, ...filters.map((f) => f.attr)]) {
    if (!table.columns.has(column)) {
      throw new Error(`The metric table "${table.name}" has no column "${column}".`);
    }
  }
  if (!Number.isInteger(config.windowSeconds) || config.windowSeconds < 1) {
    throw new RangeError('windowSeconds must be a positive integer');
  }

  const from = new Date(now.getTime() - config.windowSeconds * 1000);
  const ts = dialect.timestampColumn;
  const value = sql.ident(dialect.valueColumn);

  const where = [
    sql.between(ts, from, now),
    ...filters.map((f) => `${sql.ident(f.attr)} ${f.op === 'eq' ? '=' : '<>'} ${sql.literal(f.value)}`),
  ].join(' AND ');

  const groupSelect = groupBy.map((column) => `${dialect.castText(sql.ident(column))} AS ${sql.ident(column)}`);
  const groupRef = groupBy.map((column) => sql.ident(column));
  const tail = groupRef.length > 0 ? ` GROUP BY ${groupRef.join(', ')}` : '';

  if (config.aggregation === 'rate') {
    // A counter's increase per series (max - min over the window), summed across
    // the series that share the group, per minute. Resets inside the window are
    // not corrected for: a reset reads as a smaller increase, never a false one.
    const seriesColumns = [...new Set([...table.tags, ...groupBy])];
    const inner =
      `SELECT ${[...seriesColumns.map((c) => sql.ident(c)), `MAX(${value}) - MIN(${value}) AS ${sql.ident('inc')}`].join(', ')} ` +
      `FROM ${sql.ident(table.name)} WHERE ${where}` +
      (seriesColumns.length > 0 ? ` GROUP BY ${seriesColumns.map((c) => sql.ident(c)).join(', ')}` : '');
    const minutes = config.windowSeconds / 60;
    const outerSelect = [
      ...groupBy.map((column) => `${dialect.castText(sql.ident(column))} AS ${sql.ident(column)}`),
      `SUM(${sql.ident('inc')}) / ${minutes} AS ${sql.ident('value')}`,
    ];
    return `SELECT ${outerSelect.join(', ')} FROM (${inner}) AS ${sql.ident('series')}${tail}`;
  }

  const aggregate = {
    avg: `AVG(${value})`,
    max: `MAX(${value})`,
    min: `MIN(${value})`,
    sum: `SUM(${value})`,
    last: `last_value(${value} ORDER BY ${sql.ident(ts)})`,
  }[config.aggregation];

  return (
    `SELECT ${[...groupSelect, `${aggregate} AS ${sql.ident('value')}`].join(', ')} ` +
    `FROM ${sql.ident(table.name)} WHERE ${where}${tail}`
  );
}

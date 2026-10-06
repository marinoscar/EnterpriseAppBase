import type { TelemetrySchema } from '../dto/telemetry-query.dto';
import './metric-group.manifest';
import { HOST_TABLES, METRIC_UNITS } from './metric-catalog.helpers';
import { metricGroupRegistry, type MetricGroup, type MetricGroupDef } from './metric-group.registry';

// =============================================================================
// The metric catalog (issue #601, epic #576)
// =============================================================================
//
// A DECLARATIVE list of the metric families the Telemetry Dashboard reads from
// the Prometheus-style metric tables the collector and the API write
// (docs/specs/telemetry.md §11.3 and §11.13), grouped into the platform's six
// groups (an app may register more):
//
//   host      hostmetrics: CPU, memory, load, filesystems, disk and network IO
//   database  the postgresql receiver: connections, size, commits, cache hits
//   queue     app.jobs.* and app.backup.*: depth, age, settle rate, duration
//   nodes     app.nodes.*: fleet health and per-node vitals
//   uptime    httpcheck and nginx: status per URL, latency, TLS, edge traffic
//   pipeline  the collector's and GreptimeDB's own counters, and `up`
//
// Nothing here runs SQL: `metric-sql.ts` renders a family into a statement,
// and `metric-group.ts` turns the rows into tiles, series and tables. A family
// whose table, or one of whose `requiredColumns`, is absent from the store is
// SKIPPED (reported in `skipped`), never an error: every table appears only
// once its source has written a row.
//
// Every metric table has `greptime_timestamp` (time index) and
// `greptime_value` (Float64); every other column is a String tag, and a
// series is one combination of tag values. Semantics:
//
//   gauge      a level. Per timestamp the rows are combined across series
//              (`seriesAggregate`: sum for "how many", max for "the worst"),
//              then per bucket (`bucketAggregate`).
//   counter    cumulative (`_total`). The increase between consecutive points
//              of ONE series (`lag` over every tag column) is summed; a drop
//              is a reset and counts the new value (Prometheus semantics); the
//              first point of a series in the window has no predecessor and
//              contributes nothing (conservative: never an invented spike).
//   histogram  cumulative `_bucket` counters with a string `le` tag; the
//              quantile is interpolated from the increases per `le`.
//
// API gauges are reported identically by every replica (docs §11.13), so
// they are never summed across replicas on purpose; replicas export at
// different instants, so per-timestamp rows rarely mix two replicas.
//
// THE GROUPS ARE A REGISTRY (issue #680). Each group is declared in
// `groups/<id>.metric-group.ts` with its families, ratios and tables, and
// registered by `metric-group.manifest.ts` (imported above, so any consumer of
// this file sees the registry filled): the platform's six in the order above,
// then the app's own `APP_METRIC_GROUPS` (`app-registrations/telemetry.ts`).
// This file keeps the shapes, the units, the filter columns, table discovery
// and the derived views every consumer already imports (`METRIC_GROUPS`,
// `METRIC_FAMILIES`, `familiesOf`, …).
// =============================================================================

export {
  APP_FILTERS,
  eq,
  HOST_FILTERS,
  HOST_TABLES,
  LARGEST_TABLES_MAX_ROWS,
  METRIC_FILTER_COLUMNS,
  METRIC_UNITS,
} from './metric-catalog.helpers';
export {
  METRIC_GROUP_ID_PATTERN,
  metricGroupRegistry,
  registerMetricGroups,
  type MetricGroup,
  type MetricGroupDef,
  type MetricGroupIds,
} from './metric-group.registry';

export type MetricUnit = (typeof METRIC_UNITS)[number];

/** The request filters a family may honour (`METRIC_FILTER_COLUMNS` maps each to its column). */
export type MetricFilterKey = 'service' | 'instance' | 'host';

export const METRIC_TIME_COLUMN = 'greptime_timestamp';
export const METRIC_VALUE_COLUMN = 'greptime_value';

/** A fixed label predicate. Values are catalog constants, never request input. */
export interface MetricPredicate {
  column: string;
  op: '=' | '<>';
  value: string;
}

export type SeriesAggregate = 'sum' | 'max' | 'min' | 'avg';
export type BucketAggregate = 'avg' | 'max' | 'min';
/** How a family's groups combine into one tile. */
export type TileAggregate = 'sum' | 'max' | 'min' | 'countPositive' | 'countZero';

export interface MetricVerdictThresholds {
  degraded: number;
  critical: number;
  /** `above`: value >= threshold fires; `below`: value < threshold fires. */
  direction: 'above' | 'below';
}

interface MetricFamilyBase {
  key: string;
  group: MetricGroup;
  label: string;
  table: string;
  unit: MetricUnit;
  /** Tag columns the family reads, beyond the time and value columns. Absent → skipped. */
  requiredColumns: readonly string[];
  /** Fixed label predicates. */
  where?: readonly MetricPredicate[];
  /** The label column series are split by (one series per value). */
  groupBy?: string;
  /** Which request filters apply. */
  filters: readonly MetricFilterKey[];
  /** How groups combine into the tile (default: `sum`). */
  tileAggregate?: TileAggregate;
  /** One tile per listed group value instead of one combined tile. */
  tileGroups?: readonly string[];
  /** Emit a tile (default true). */
  tile?: boolean;
  /** Emit series (default true). */
  series?: boolean;
  /** The verdict thresholds the summary applies to this family (documentary; the rule lives in the verdict). */
  verdict?: MetricVerdictThresholds;
}

export interface GaugeFamily extends MetricFamilyBase {
  kind: 'gauge';
  /** Per-row value expression (fixed SQL over `greptime_value`); default the value itself. */
  valueSql?: string;
  seriesAggregate: SeriesAggregate;
  bucketAggregate: BucketAggregate;
  /** Display multiplier (ratio → %: 100). */
  scale?: number;
  /** `ageHours`: the value is a Unix-seconds instant, shown as hours before the bucket end (or now). */
  transform?: 'ageHours';
}

export interface CounterFamily extends MetricFamilyBase {
  kind: 'counter';
  /** `per_s` / `per_min`: increase over time; `count`: the increase itself. */
  rate: 'per_s' | 'per_min' | 'count';
  /** Display multiplier applied after the rate. */
  scale?: number;
}

export interface HistogramFamily extends MetricFamilyBase {
  kind: 'histogram';
  /** The quantile shown, e.g. 0.95. */
  quantile: number;
  /** Display multiplier (s → ms: 1000). */
  scale?: number;
}

export type MetricFamily = GaugeFamily | CounterFamily | HistogramFamily;

/** A reference to (some groups of) a family, for ratios. */
export interface MetricRef {
  family: string;
  /** Only these group values (default: every group). */
  groups?: readonly string[];
}

/** A family derived from others: `sum(numerator) / sum(denominator) * scale`, bucket by bucket. */
export interface MetricRatio {
  key: string;
  group: MetricGroup;
  label: string;
  unit: MetricUnit;
  numerator: readonly MetricRef[];
  /** The denominator; `numerator` is added to it when `addNumerator` (hit / (hit + read)). */
  denominator: readonly MetricRef[];
  addNumerator?: boolean;
  scale: number;
  verdict?: MetricVerdictThresholds;
}

/** One column of a per-key table, read as the latest (or max/min/increase/count) value per key. */
export interface MetricTablePart {
  column: string;
  label: string;
  unit: MetricUnit;
  table: string;
  /** Tag columns needed beyond the key column. */
  requiredColumns?: readonly string[];
  valueSql?: string;
  where?: readonly MetricPredicate[];
  /** Per timestamp across series sharing the key. */
  seriesAggregate: SeriesAggregate;
  /** Over the window: the latest value, an extreme, the counter increase, or the number of timestamps. */
  over: 'last' | 'max' | 'min' | 'increase' | 'count';
  scale?: number;
}

/** A computed column of a table: `numerator / denominator * scale` (both are part columns). */
export interface MetricTableDerived {
  column: string;
  label: string;
  unit: MetricUnit;
  numerator: string;
  denominator: string;
  scale: number;
}

export interface MetricTableSpec {
  key: string;
  group: MetricGroup;
  label: string;
  /** The label column every part is keyed by (one row per value). */
  keyColumn: string;
  keyLabel: string;
  filters: readonly MetricFilterKey[];
  parts: readonly MetricTablePart[];
  derived?: readonly MetricTableDerived[];
  /** Order rows by the first part's value, descending (the statement then has ONE part). */
  orderByValue?: boolean;
  /** Extra per-key columns from a histogram family (quantile per key). */
  histogram?: { column: string; label: string; family: string };
  /** Extra per-URL status columns from `httpcheck_status` / `httpcheck_error`. */
  httpcheck?: boolean;
  /** Rows this table returns at most; default `METRIC_TABLE_MAX_ROWS` (#632). */
  maxRows?: number;
}

/** Where `/filters` reads the distinct host names from: small, always written by hostmetrics. */
export const HOST_DISTINCT_TABLE = HOST_TABLES.load1m;

export const HTTPCHECK_STATUS_TABLE = 'httpcheck_status';
export const HTTPCHECK_ERROR_TABLE = 'httpcheck_error';

// ---- derived views ---------------------------------------------------------------
//
// Snapshots of the registry taken when this module is evaluated, which is
// after the manifest has registered every platform and app group. The
// registry is frozen once the application has bootstrapped, so in a running
// API they never go stale. The lookups below read the registry itself, so a
// group a test adds with `withTemporaryEntries` is served too.

function frozen<T>(items: T[]): readonly T[] {
  return Object.freeze(items);
}

/** Every registered group id, in dashboard order. Non-empty (the platform registers six). */
export const METRIC_GROUPS = Object.freeze(metricGroupRegistry.ids()) as unknown as readonly [
  MetricGroup,
  ...MetricGroup[],
];

/** The API label of every group (the dashboard section title is `MetricGroupDef.title`). */
export const METRIC_GROUP_LABELS: Readonly<Record<MetricGroup, string>> = Object.freeze(
  Object.fromEntries(metricGroupRegistry.list().map((g) => [g.id, g.label])) as Record<MetricGroup, string>
);

export const METRIC_FAMILIES: readonly MetricFamily[] = frozen(metricGroupRegistry.list().flatMap((g) => [...g.families]));
export const METRIC_RATIOS: readonly MetricRatio[] = frozen(metricGroupRegistry.list().flatMap((g) => [...(g.ratios ?? [])]));
export const METRIC_TABLES: readonly MetricTableSpec[] = frozen(metricGroupRegistry.list().flatMap((g) => [...(g.tables ?? [])]));

// ---- lookups (live) ----------------------------------------------------------------

/** Every registered group, in dashboard order, read live from the registry. */
export function metricGroups(): MetricGroupDef[] {
  return metricGroupRegistry.list();
}

/** Every registered group id, in dashboard order, read live from the registry. */
export function metricGroupIds(): MetricGroup[] {
  return metricGroupRegistry.ids() as MetricGroup[];
}

/** Whether `id` names a registered group. */
export function isMetricGroup(id: unknown): id is MetricGroup {
  return typeof id === 'string' && metricGroupRegistry.has(id);
}

export function familiesOf(group: MetricGroup): MetricFamily[] {
  return [...(metricGroupRegistry.get(group)?.families ?? [])];
}

export function ratiosOf(group: MetricGroup): MetricRatio[] {
  return [...(metricGroupRegistry.get(group)?.ratios ?? [])];
}

export function tablesOf(group: MetricGroup): MetricTableSpec[] {
  return [...(metricGroupRegistry.get(group)?.tables ?? [])];
}

export function familyByKey(key: string): MetricFamily | undefined {
  for (const group of metricGroupRegistry.list()) {
    const family = group.families.find((f) => f.key === key);
    if (family) return family;
  }
  return undefined;
}

// ---- what the store has ----------------------------------------------------------

/** One metric table as the store describes it. */
export interface MetricTableInfo {
  columns: ReadonlySet<string>;
  /** Tag columns: every series-identifying column (the `lag` partition of a counter). */
  tags: readonly string[];
}

/** Discovered metric tables, by name. A table absent here does not exist (yet). */
export type MetricTables = ReadonlyMap<string, MetricTableInfo>;

/**
 * Every table of the schema that looks like a metric table (has the time and
 * value columns), with its tag columns: `semantic_type = 'TAG'` where the
 * store reports it, else every column but the time and value.
 */
export function metricTablesOf(schema: TelemetrySchema): MetricTables {
  const tables = new Map<string, MetricTableInfo>();
  for (const table of schema.tables) {
    const names = new Set(table.columns.map((c) => c.name));
    if (!names.has(METRIC_TIME_COLUMN) || !names.has(METRIC_VALUE_COLUMN)) continue;
    const reported = table.columns.some((c) => c.semanticType);
    const tags = table.columns
      .filter((c) =>
        reported
          ? String(c.semanticType).toUpperCase() === 'TAG'
          : c.name !== METRIC_TIME_COLUMN && c.name !== METRIC_VALUE_COLUMN
      )
      .map((c) => c.name)
      .sort();
    tables.set(table.name, { columns: names, tags });
  }
  return tables;
}

/** The table's info when it exists with every required column, else null. */
export function tableWith(
  tables: MetricTables,
  table: string,
  required: readonly string[]
): MetricTableInfo | null {
  const info = tables.get(table);
  if (!info) return null;
  return required.every((c) => info.columns.has(c)) ? info : null;
}

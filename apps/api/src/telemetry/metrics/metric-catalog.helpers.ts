import { DASHBOARD_VERDICT_THRESHOLDS } from '../dashboard/telemetry-dashboard.verdict';
import type { MetricFilterKey, MetricPredicate } from './metric-catalog';

// =============================================================================
// Metric catalog: shared runtime constants (issue #680)
// =============================================================================
//
// A LEAF. The metric-group declarations (`groups/*.metric-group.ts`) and the
// registry (`metric-group.registry.ts`) need a few runtime values the catalog
// used to hold inline: the display units, the filter sets, the host table
// names, the `eq` predicate helper and the verdict thresholds. They live here
// so neither has to import `metric-catalog.ts` at runtime: that file imports
// the manifest that registers the groups, so a group (or the registry) that
// imported it back would read its derived views half-built. The only imports
// from `metric-catalog.ts` are type-only, which TypeScript erases.
// `metric-catalog.spec.ts` loads every group file in isolation to prove it.
//
// `metric-catalog.ts` re-exports everything here, so every existing consumer
// keeps its import.
// =============================================================================

/** Display units of tiles, series and table columns. */
export const METRIC_UNITS = [
  '%',
  'bytes',
  'bytes/s',
  'count',
  'per_s',
  'per_min',
  'ms',
  'seconds',
  'hours',
  'days',
  'cores',
  'load',
  'timestamp',
  'text',
  'boolean',
] as const;

/** The request filters a family may honour, and the column each one matches. */
export const METRIC_FILTER_COLUMNS: Record<MetricFilterKey, string> = {
  service: 'service_name',
  instance: 'app_instance_id',
  host: 'host_name',
};

/** API tables (`app_*`): the service and the instance id. Their `host_name` is the API container, not a host. */
export const APP_FILTERS: readonly MetricFilterKey[] = ['service', 'instance'];
/** Tables the collector scraped itself: `host_name` is the real host. */
export const HOST_FILTERS: readonly MetricFilterKey[] = ['host'];

export const HOST_TABLES = {
  cpuUtilization: 'system_cpu_utilization_ratio',
  memoryUtilization: 'system_memory_utilization_ratio',
  load1m: 'system_cpu_load_average_1m',
  filesystemUtilization: 'system_filesystem_utilization_ratio',
  filesystemUsage: 'system_filesystem_usage_bytes',
  diskIo: 'system_disk_io_bytes_total',
  networkIo: 'system_network_io_bytes_total',
} as const;

/** Rows of `largestTables`: every table of a realistic schema; bounded so a runaway schema can't blow the payload (#632). */
export const LARGEST_TABLES_MAX_ROWS = 500;

/** The dashboard's verdict thresholds, which several families declare (documentary). */
export const T = DASHBOARD_VERDICT_THRESHOLDS;

/** A fixed label predicate. Values are catalog constants, never request input. */
export const eq = (column: string, value: string): MetricPredicate => ({ column, op: '=', value });

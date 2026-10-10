/**
 * Telemetry Dashboard API client — issue #578, epic #576.
 *
 * The wire shapes are `@marinoscar/platform-contract/telemetry` (#702), the
 * same zod schemas `packages/platform-api/src/telemetry/dto/telemetry-dashboard.dto.ts`
 * wraps:
 *
 *   - `GET /admin/telemetry/dashboard/summary`     (`telemetry:query`)
 *   - `GET /admin/telemetry/dashboard/timeseries`  (`telemetry:query`, `panel=api|logs`)
 *   - `GET /admin/telemetry/dashboard/top`         (`telemetry:query`, `kind=routes|errors`)
 *   - `GET /admin/telemetry/dashboard/events`      (`telemetry:query`)
 *   - `GET /admin/telemetry/dashboard/filters`     (`telemetry:query`)
 *   - `GET /admin/telemetry/dashboard/metrics`     (`telemetry:query`, `group=host|database|…`, #601/#602)
 *
 * The browser only presents. The verdict, its reasons, the tiles, what a
 * "route" is and how severities are banded are all decided by the API; the SQL
 * it ran comes back in `sql` so a panel can offer "open in explorer" (#579).
 *
 * This file aliases the contract's types to the names the components use and
 * re-exports its zod-free constants (`import type` and constants only, so zod
 * never reaches the bundle). Where a web type deliberately differs from the
 * wire it is derived from the contract type and says why;
 * `src/__tests__/services/telemetryContract.test.ts` pins each relation.
 */
import {
  DASHBOARD_EVENT_SEVERITIES,
  DASHBOARD_FILTER_VALUE_MAX,
  DASHBOARD_MAX_SPAN_MS,
  DASHBOARD_RANGE_MS,
  DASHBOARD_RANGES,
  DASHBOARD_SEARCH_MAX_LENGTH,
  DEFAULT_DASHBOARD_RANGE,
} from '@marinoscar/platform-contract/telemetry';
import type {
  DashboardBucketCount,
  DashboardEventSeverity,
  DashboardRange as ContractDashboardRange,
  DashboardTopKind as ContractDashboardTopKind,
  DashboardPanel,
  MetricGroupId,
  MetricUnit,
  TelemetryDashboardApiBucket,
  TelemetryDashboardEnvelope,
  TelemetryDashboardEvent,
  TelemetryDashboardEvents,
  TelemetryDashboardEventsQuery,
  TelemetryDashboardFilters,
  TelemetryDashboardLogsBucket,
  TelemetryDashboardMetricCell,
  TelemetryDashboardMetricColumn,
  TelemetryDashboardMetricGroup,
  TelemetryDashboardMetricPoint,
  TelemetryDashboardMetrics,
  TelemetryDashboardMetricSeries,
  TelemetryDashboardMetricsQuery,
  TelemetryDashboardMetricTable,
  TelemetryDashboardQuery,
  TelemetryDashboardSummary,
  TelemetryDashboardTile,
  TelemetryDashboardTimeseries,
  TelemetryDashboardTop,
  TelemetryDashboardTopError,
  TelemetryDashboardTopRoute,
  TelemetryDashboardUnknownRoute,
  TelemetryDashboardUnknownRoutes,
  VerdictLevel,
} from '@marinoscar/platform-contract/telemetry';

// =============================================================================
// Request
// =============================================================================

export { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE, DASHBOARD_RANGE_MS };
/**
 * A relative dashboard window: `15m`, `1h`, `6h`, `24h` or `7d`.
 *
 * @stability experimental
 */
export type DashboardRange = ContractDashboardRange;

/**
 * Display labels of the relative windows (web only).
 *
 * @stability experimental
 */
export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  '15m': 'Last 15 minutes',
  '1h': 'Last hour',
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

/**
 * The severities `events` filters on (the contract's `DASHBOARD_EVENT_SEVERITIES`).
 *
 * @stability experimental
 */
export const DASHBOARD_SEVERITIES = DASHBOARD_EVENT_SEVERITIES;
/**
 * A log severity the event panels filter on (`error`, `warn`, `info`).
 *
 * @stability experimental
 */
export type DashboardSeverity = DashboardEventSeverity;
/**
 * What the events feed asks for until the user picks (web only; the API's own default is the same).
 *
 * @stability experimental
 */
export const DEFAULT_DASHBOARD_SEVERITIES: DashboardSeverity[] = ['error', 'warn'];

/** The longest `q` the events route accepts. */
export { DASHBOARD_SEARCH_MAX_LENGTH };

/** The longest absolute window, and the longest filter value, the dashboard routes accept. */
export { DASHBOARD_MAX_SPAN_MS, DASHBOARD_FILTER_VALUE_MAX };

/**
 * How many time buckets a timeseries asks for.
 *
 * @stability experimental
 */
export type DashboardBuckets = DashboardBucketCount;

/**
 * The query every endpoint shares. `range` XOR `from` + `to`.
 *
 * @stability experimental
 */
export type DashboardQuery = TelemetryDashboardQuery;

/**
 * `/metrics` also takes `host` (a value of `/filters` `hosts`). It applies to
 * the collector-scraped tables only, so it is sent to `/metrics` alone.
 * `group` is not part of it: {@link TelemetryClient.getDashboardMetrics} takes it separately.
 *
 * @stability experimental
 */
export type DashboardMetricsQuery = Omit<TelemetryDashboardMetricsQuery, 'group'>;

/**
 * The events query. INTENTIONALLY DIFFERENT from the wire: `severity` is a
 * list here, serialised to the wire's comma-separated string by
 * {@link dashboardSearchParams}.
 *
 * @stability experimental
 */
export type DashboardEventsQuery = Omit<TelemetryDashboardEventsQuery, 'severity'> & {
  /** The severities to include; serialised as a comma-separated list. */
  severity?: DashboardSeverity[];
};


// =============================================================================
// Responses
// =============================================================================

/**
 * What every dashboard response except `/metrics` starts with: the resolved window and bucket size, when the store was read, whether a row cap cut a list short, and the statements run.
 *
 * @stability experimental
 */
export type DashboardEnvelope = TelemetryDashboardEnvelope;

/**
 * The summary's verdict: `healthy`, `degraded`, `critical` or `no_data`.
 *
 * @stability experimental
 */
export type DashboardVerdictLevel = VerdictLevel;

/**
 * A tile. `value` may be a string (`int8`/`numeric`, or a timestamp's ISO text).
 *
 * @stability experimental
 */
export type DashboardTile = TelemetryDashboardTile;

/**
 * One unknown API route of the summary (#650): a method + path no route of the running API matches.
 *
 * @stability experimental
 */
export type DashboardUnknownRoute = TelemetryDashboardUnknownRoute;

/**
 * Requests to API routes that do not exist (#650). INTENTIONALLY LOOSER than
 * the wire: `sql` is optional so a web build ahead of its API renders (the
 * "Open in Explorer" action is then disabled). The contract's type is
 * assignable to it.
 *
 * @stability experimental
 */
export type DashboardUnknownRoutes = Omit<TelemetryDashboardUnknownRoutes, 'sql'> & {
  /** The explorer statements behind the block, primary first (a list here). */
  sql?: string[];
};

/**
 * `GET …/summary`, with the looser {@link DashboardUnknownRoutes}.
 *
 * @stability experimental
 */
export type DashboardSummary = Omit<TelemetryDashboardSummary, 'unknownRoutes'> & {
  /** #650. Absent when the store cannot tell unknown routes apart yet: unknown, not zero. */
  unknownRoutes?: DashboardUnknownRoutes;
};

/**
 * One API timeline bucket: request counts by status class and latency.
 *
 * @stability experimental
 */
export type DashboardApiBucket = TelemetryDashboardApiBucket;

/**
 * One log timeline bucket: record counts by severity.
 *
 * @stability experimental
 */
export type DashboardLogsBucket = TelemetryDashboardLogsBucket;

/**
 * `GET …/timeseries?panel=api`. INTENTIONALLY NARROWER than the wire (whose
 * `buckets` is a union for either panel): the panel requested decides the
 * bucket shape. Assignable to the contract's type.
 *
 * @stability experimental
 */
export type DashboardApiTimeseries = Omit<TelemetryDashboardTimeseries, 'panel' | 'buckets'> & {
  /** The API timeline. */
  panel: 'api';
  /** The API buckets, oldest first. */
  buckets: DashboardApiBucket[];
};

/**
 * `GET …/timeseries?panel=logs`; narrowed like {@link DashboardApiTimeseries}.
 *
 * @stability experimental
 */
export type DashboardLogsTimeseries = Omit<TelemetryDashboardTimeseries, 'panel' | 'buckets'> & {
  /** The log timeline. */
  panel: 'logs';
  /** The log buckets, oldest first. */
  buckets: DashboardLogsBucket[];
};

/**
 * Which timeline `GET …/timeseries` draws: `api` or `logs`.
 *
 * @stability experimental
 */
export type DashboardTimeseriesPanel = DashboardPanel;
/**
 * The `GET …/timeseries` answer for `panel`: {@link DashboardApiTimeseries} or {@link DashboardLogsTimeseries}.
 *
 * @stability experimental
 */
export type DashboardTimeseries<P extends DashboardTimeseriesPanel> = P extends 'api'
  ? DashboardApiTimeseries
  : DashboardLogsTimeseries;

/**
 * One route of `top?kind=routes`. INTENTIONALLY LOOSER than the wire:
 * `clientErrors`, `unknownRequests` and `unknown` (#650) are optional so a web
 * build ahead of its API renders; the API always sends them. The contract's
 * type is assignable to it.
 *
 * @stability experimental
 */
export type DashboardTopRoute = Omit<TelemetryDashboardTopRoute, 'clientErrors' | 'unknownRequests' | 'unknown'> &
  Partial<Pick<TelemetryDashboardTopRoute, 'clientErrors' | 'unknownRequests' | 'unknown'>>;

/**
 * One row of the top failing errors.
 *
 * @stability experimental
 */
export type DashboardTopError = TelemetryDashboardTopError;

/**
 * Which list `GET …/top` returns: `routes` or `errors`.
 *
 * @stability experimental
 */
export type DashboardTopKind = ContractDashboardTopKind;

/**
 * `GET …/top?kind=routes`; narrowed like {@link DashboardApiTimeseries}.
 *
 * @stability experimental
 */
export type DashboardTopRoutes = Omit<TelemetryDashboardTop, 'kind' | 'items'> & {
  /** The top failing routes. */
  kind: 'routes';
  /** The routes, worst first. */
  items: DashboardTopRoute[];
};

/**
 * `GET …/top?kind=errors`; narrowed like {@link DashboardApiTimeseries}.
 *
 * @stability experimental
 */
export type DashboardTopErrors = Omit<TelemetryDashboardTop, 'kind' | 'items'> & {
  /** The top errors. */
  kind: 'errors';
  /** The errors, most frequent first. */
  items: DashboardTopError[];
};

/**
 * The `GET …/top` answer for `kind`: {@link DashboardTopRoutes} or {@link DashboardTopErrors}.
 *
 * @stability experimental
 */
export type DashboardTop<K extends DashboardTopKind> = K extends 'routes'
  ? DashboardTopRoutes
  : DashboardTopErrors;

/**
 * One log event. `severity` is lower-case text (`error`, `warn`, `info`, `debug`, …).
 *
 * @stability experimental
 */
export type DashboardEvent = TelemetryDashboardEvent;

/**
 * `GET …/events`: a page of log and span events, newest first, with the next cursor.
 *
 * @stability experimental
 */
export type DashboardEvents = TelemetryDashboardEvents;

/**
 * `GET …/filters`: the services, instances and hosts seen in the window (the filter bar's choices).
 *
 * @stability experimental
 */
export type DashboardFilters = TelemetryDashboardFilters;

// ---- metrics (#601 API, #602 web) ---------------------------------------------

/**
 * A metric group id, as `/metric-groups` lists it (#680): the platform's six
 * (`host`, `database`, `queue`, `nodes`, `uptime`, `pipeline`) and any the
 * application registers. The page renders whatever the API lists.
 *
 * @stability experimental
 */
export type DashboardMetricGroup = MetricGroupId;

/**
 * One entry of `GET …/metric-groups` (#680): a dashboard section, in `order`.
 *
 * @stability experimental
 */
export type DashboardMetricGroupMeta = TelemetryDashboardMetricGroup;

/**
 * The display unit of a tile, series or table column (the contract's `METRIC_UNITS`).
 *
 * @stability experimental
 */
export type DashboardMetricUnit = MetricUnit;

/**
 * One point of a metric series: a bucket start and its value.
 *
 * @stability experimental
 */
export type DashboardMetricPoint = TelemetryDashboardMetricPoint;

/**
 * One metric line: its key, label, unit and points (optionally one per `groupBy` value).
 *
 * @stability experimental
 */
export type DashboardMetricSeries = TelemetryDashboardMetricSeries;

/**
 * One column of a metric table: key, label and unit.
 *
 * @stability experimental
 */
export type DashboardMetricColumn = TelemetryDashboardMetricColumn;

/**
 * One cell of a metric table row (a number, a string, a boolean or `null`).
 *
 * @stability experimental
 */
export type DashboardMetricCell = TelemetryDashboardMetricCell;

/**
 * One metric table: columns and rows (for example disks, or databases).
 *
 * @stability experimental
 */
export type DashboardMetricTable = TelemetryDashboardMetricTable;

/**
 * `GET …/metrics?group=…`: one metric group's tiles, series and tables.
 *
 * @stability experimental
 */
export type DashboardMetrics = TelemetryDashboardMetrics;

// =============================================================================
// Calls
// =============================================================================

/**
 * Serialise a dashboard query. Absent values are left out, never sent empty.
 *
 * @stability experimental
 */
export function dashboardSearchParams(
  query: DashboardQuery &
    Partial<Pick<DashboardEventsQuery, 'severity' | 'q' | 'cursor'>> &
    Partial<Pick<DashboardMetricsQuery, 'host'>>,
  extra: Record<string, string> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  if (query.from && query.to) {
    params.set('from', query.from);
    params.set('to', query.to);
  } else if (query.range) {
    params.set('range', query.range);
  }
  if (query.service) params.set('service', query.service);
  if (query.instance) params.set('instance', query.instance);
  if (query.host) params.set('host', query.host);
  if (query.buckets) params.set('buckets', query.buckets);
  if (query.severity && query.severity.length > 0) params.set('severity', query.severity.join(','));
  if (query.q) params.set('q', query.q);
  if (query.cursor) params.set('cursor', query.cursor);
  return params;
}

/**
 * `sql` as a list, primary first — what a panel's actions (#579) receive.
 *
 * @stability experimental
 */
export function sqlList(sql: string | string[] | undefined | null): string[] {
  if (!sql) return [];
  return (Array.isArray(sql) ? sql : [sql]).filter((statement) => statement.trim() !== '');
}

// The telemetry slice's plain values (issue #702). Zod-free by rule: a browser
// that only needs a limit, an enum list or a type never pulls the schemas, and
// with them zod, into its bundle (test/no-zod-in-constants.test.ts).
//
// Every number and list here is the one the schemas validate with: the
// schemas import them, so a limit cannot drift between what the API enforces
// and what the web form offers. Moved verbatim from the API's DTO files and
// the web's hand-written mirrors; no value changed.

// =============================================================================
// Settings (`telemetry` system-settings namespace)
// =============================================================================

/**
 * `telemetry.instanceId`: 1-63 characters, lowercase letters, digits, `.`,
 * `_` or `-`, starting with a letter or digit (a DNS label's bound, valid
 * unquoted in a PromQL matcher and a SQL literal alike).
 *
 * @stability stable
 */
export const TELEMETRY_INSTANCE_ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/**
 * The inclusive bounds of every numeric `telemetry` setting:
 * `retentionDays`, `query.maxRows`, `query.timeoutSeconds`,
 * `assistant.maxResultRowsToModel` and `assistant.maxSteps`. The settings
 * schema is built from these numbers.
 *
 * @stability stable
 */
export const TELEMETRY_LIMITS = {
  /** `retentionDays`, in days. */
  retentionDays: {
    /** Fewest accepted. */
    min: 1,
    /** Most accepted. */
    max: 3650,
  },
  /** `query.maxRows`, in rows. */
  maxRows: {
    /** Fewest accepted. */
    min: 1,
    /** Most accepted. */
    max: 100000,
  },
  /** `query.timeoutSeconds`, in seconds. */
  timeoutSeconds: {
    /** Fewest accepted. */
    min: 1,
    /** Most accepted. */
    max: 120,
  },
  /** `assistant.maxResultRowsToModel`, in rows. */
  maxResultRowsToModel: {
    /** Fewest accepted. */
    min: 1,
    /** Most accepted. */
    max: 100,
  },
  /** `assistant.maxSteps`, in tool-call rounds (the AI runtime's own loop ceiling). */
  maxSteps: {
    /** Fewest accepted. */
    min: 1,
    /** Most accepted. */
    max: 20,
  },
} as const;

// =============================================================================
// Explorer (`/api/admin/telemetry/query`, `/schema`, `/export`)
// =============================================================================

/**
 * The longest SQL text `POST /api/admin/telemetry/query` and `/export`
 * accept. Telemetry queries are hand-written or model-written, never
 * generated in bulk.
 *
 * @stability stable
 */
export const TELEMETRY_SQL_MAX_LENGTH = 20_000;

/**
 * The absolute ceiling a query's `maxRows` may ask for; the
 * `telemetry.query.maxRows` setting clamps it further.
 *
 * @stability stable
 */
export const TELEMETRY_QUERY_MAX_ROWS_CEILING = 100_000;

/**
 * The simplified PostgreSQL-wire type of a query result column. `int8` and
 * `numeric` values arrive as strings, `timestamp`/`date`/`time` as the
 * server's text, `json` parsed and `bytea` as base64.
 *
 * @stability stable
 */
export const TELEMETRY_COLUMN_TYPES = [
  'bool',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8',
  'numeric',
  'text',
  'bytea',
  'date',
  'time',
  'timestamp',
  'json',
  'unknown',
] as const;

/**
 * One of {@link TELEMETRY_COLUMN_TYPES}.
 *
 * @stability stable
 */
export type TelemetryColumnType = (typeof TELEMETRY_COLUMN_TYPES)[number];

/**
 * GreptimeDB's role for a schema column, as `GET /api/admin/telemetry/schema`
 * reports it in `semanticType` (which is typed as a string on the wire).
 *
 * @stability stable
 */
export const TELEMETRY_SEMANTIC_TYPES = ['TAG', 'FIELD', 'TIMESTAMP'] as const;

/**
 * One of {@link TELEMETRY_SEMANTIC_TYPES}.
 *
 * @stability stable
 */
export type TelemetrySemanticType = (typeof TELEMETRY_SEMANTIC_TYPES)[number];

/**
 * The formats `POST /api/admin/telemetry/export` produces, in the order the
 * wire enum has always listed them. A menu that wants another order keeps its
 * own display list over this one.
 *
 * @stability stable
 */
export const TELEMETRY_EXPORT_FORMATS = ['csv', 'ndjson', 'xlsx', 'parquet'] as const;

/**
 * One of {@link TELEMETRY_EXPORT_FORMATS}.
 *
 * @stability stable
 */
export type TelemetryExportFormat = (typeof TELEMETRY_EXPORT_FORMATS)[number];

// =============================================================================
// GreptimeDB connection (`/api/admin/telemetry/connection`)
// =============================================================================

/**
 * Where the connection in force comes from: `stored` (saved on the admin
 * page), `environment` (the deployment's own GreptimeDB) or `none`.
 *
 * @stability stable
 */
export const TELEMETRY_CONNECTION_SOURCES = ['stored', 'environment', 'none'] as const;

/**
 * One of {@link TELEMETRY_CONNECTION_SOURCES}.
 *
 * @stability stable
 */
export type TelemetryConnectionSource = (typeof TELEMETRY_CONNECTION_SOURCES)[number];

/**
 * `auto`: the GreptimeDB deployed with the application; `custom`: a host an
 * administrator chose.
 *
 * @stability stable
 */
export const TELEMETRY_CONNECTION_HOST_MODES = ['auto', 'custom'] as const;

/**
 * One of {@link TELEMETRY_CONNECTION_HOST_MODES}.
 *
 * @stability stable
 */
export type TelemetryConnectionHostMode = (typeof TELEMETRY_CONNECTION_HOST_MODES)[number];

/**
 * GreptimeDB's Postgres-wire port and database when nothing says otherwise:
 * what a custom connection that omits them gets.
 *
 * @stability stable
 */
export const TELEMETRY_CONNECTION_DEFAULTS = {
  /** GreptimeDB's Postgres-wire default port. */
  pgPort: 4003,
  /** GreptimeDB's default database. */
  database: 'public',
} as const;

/**
 * A connection's database name: a plain identifier, because retention
 * interpolates it unquoted into `ALTER DATABASE`.
 *
 * @stability stable
 */
export const TELEMETRY_DATABASE_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A connection's hostname: RFC 1123 labels, plus `_` (Docker Compose service
 * names use it). No scheme, port or path. An IP address is accepted
 * separately.
 *
 * @stability stable
 */
export const TELEMETRY_HOSTNAME_PATTERN: RegExp =
  /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$/;

// =============================================================================
// Telemetry services (`/api/admin/telemetry/stack`)
// =============================================================================

/**
 * Whether the API can reach the deployment agent that manages the telemetry
 * containers: `available`, `unavailable` (configured, not reachable),
 * `unauthorized` (it refused the API's token) or `not_configured`.
 *
 * @stability stable
 */
export const TELEMETRY_STACK_AGENT_STATES = ['available', 'unavailable', 'unauthorized', 'not_configured'] as const;

/**
 * One of {@link TELEMETRY_STACK_AGENT_STATES}.
 *
 * @stability stable
 */
export type TelemetryStackAgentState = (typeof TELEMETRY_STACK_AGENT_STATES)[number];

/**
 * A telemetry container's state, as the deployment agent reports it;
 * `missing` when it has never been created.
 *
 * @stability stable
 */
export const TELEMETRY_STACK_SERVICE_STATES = [
  'running',
  'restarting',
  'exited',
  'created',
  'paused',
  'dead',
  'missing',
] as const;

/**
 * One of {@link TELEMETRY_STACK_SERVICE_STATES}.
 *
 * @stability stable
 */
export type TelemetryStackServiceState = (typeof TELEMETRY_STACK_SERVICE_STATES)[number];

/**
 * A telemetry container's health check result (absent, `null`, when it has
 * none or is not running).
 *
 * @stability stable
 */
export const TELEMETRY_STACK_SERVICE_HEALTH = ['healthy', 'unhealthy', 'starting'] as const;

/**
 * One of {@link TELEMETRY_STACK_SERVICE_HEALTH}.
 *
 * @stability stable
 */
export type TelemetryStackServiceHealth = (typeof TELEMETRY_STACK_SERVICE_HEALTH)[number];

/**
 * The status of the latest stack deploy job: the queue's own statuses.
 *
 * @stability stable
 */
export const TELEMETRY_STACK_DEPLOY_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

/**
 * One of {@link TELEMETRY_STACK_DEPLOY_STATUSES}.
 *
 * @stability stable
 */
export type TelemetryStackDeployStatus = (typeof TELEMETRY_STACK_DEPLOY_STATUSES)[number];

// =============================================================================
// Dashboard (`/api/admin/telemetry/dashboard/*`)
// =============================================================================

/**
 * The relative windows every dashboard route accepts as `range`.
 *
 * @stability stable
 */
export const DASHBOARD_RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;

/**
 * One of {@link DASHBOARD_RANGES}.
 *
 * @stability stable
 */
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/**
 * The length of each {@link DASHBOARD_RANGES} window, in milliseconds.
 *
 * @stability stable
 */
export const DASHBOARD_RANGE_MS: Record<DashboardRange, number> = {
  /** 15 minutes. */
  '15m': 15 * 60_000,
  /** 1 hour. */
  '1h': 60 * 60_000,
  /** 6 hours. */
  '6h': 6 * 60 * 60_000,
  /** 24 hours. */
  '24h': 24 * 60 * 60_000,
  /** 7 days. */
  '7d': 7 * 24 * 60 * 60_000,
};

/**
 * The window a dashboard route reads when the query names none.
 *
 * @stability stable
 */
export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '1h';

/**
 * The longest absolute window (`from` to `to`) a dashboard route accepts: 30 days.
 *
 * @stability stable
 */
export const DASHBOARD_MAX_SPAN_MS = 30 * 24 * 60 * 60_000;

/**
 * How far past now `to` may be (clock skew between browser and server): 1 minute.
 *
 * @stability stable
 */
export const DASHBOARD_FUTURE_SKEW_MS = 60_000;

/**
 * The target bucket counts a dashboard route accepts as `buckets` (strings:
 * every query value arrives as one).
 *
 * @stability stable
 */
export const DASHBOARD_BUCKET_COUNTS = ['30', '60'] as const;

/**
 * One of {@link DASHBOARD_BUCKET_COUNTS}.
 *
 * @stability stable
 */
export type DashboardBucketCount = (typeof DASHBOARD_BUCKET_COUNTS)[number];

/**
 * The longest `service`, `instance` or `host` filter value.
 *
 * @stability stable
 */
export const DASHBOARD_FILTER_VALUE_MAX = 200;

/**
 * The longest `cursor` the events route accepts.
 *
 * @stability stable
 */
export const DASHBOARD_CURSOR_MAX = 512;

/**
 * The longest `q` (log body search) the events route accepts.
 *
 * @stability stable
 */
export const DASHBOARD_SEARCH_MAX_LENGTH = 200;

/**
 * The severities the events route filters on, in `severity`'s comma list.
 *
 * @stability stable
 */
export const DASHBOARD_EVENT_SEVERITIES = ['error', 'warn', 'info'] as const;

/**
 * One of {@link DASHBOARD_EVENT_SEVERITIES}.
 *
 * @stability stable
 */
export type DashboardEventSeverity = (typeof DASHBOARD_EVENT_SEVERITIES)[number];

/**
 * The `timeseries` route's panels: `api` (status classes, p95) or `logs`
 * (severity bands).
 *
 * @stability stable
 */
export const DASHBOARD_PANELS = ['api', 'logs'] as const;

/**
 * One of {@link DASHBOARD_PANELS}.
 *
 * @stability stable
 */
export type DashboardPanel = (typeof DASHBOARD_PANELS)[number];

/**
 * The pattern every dashboard panel id matches (`api`, `signups`): a lowercase
 * letter, then up to 47 lowercase letters, digits, `_` or `-`. The panel set is
 * open: the platform registers `api` and `logs`, an app registers its own
 * (`registerDashboardPanel`).
 *
 * @stability stable
 */
export const DASHBOARD_PANEL_ID_PATTERN: RegExp = /^[a-z][a-z0-9_-]{1,47}$/;

/**
 * The most bytes a dashboard panel's `payload` may serialise to.
 *
 * @stability stable
 */
export const DASHBOARD_PANEL_PAYLOAD_MAX_BYTES = 262_144;

/**
 * The `top` route's kinds: `routes` (by 5xx, then 4xx except 401, then p95)
 * or `errors` (log messages).
 *
 * @stability stable
 */
export const DASHBOARD_TOP_KINDS = ['routes', 'errors'] as const;

/**
 * One of {@link DASHBOARD_TOP_KINDS}.
 *
 * @stability stable
 */
export type DashboardTopKind = (typeof DASHBOARD_TOP_KINDS)[number];

/**
 * The summary's overall verdict levels, in increasing severity, `no_data`
 * last.
 *
 * @stability stable
 */
export const VERDICT_LEVELS = ['healthy', 'degraded', 'critical', 'no_data'] as const;

/**
 * One of {@link VERDICT_LEVELS}.
 *
 * @stability stable
 */
export type VerdictLevel = (typeof VERDICT_LEVELS)[number];

/**
 * The display units the platform registers itself, as the `unit` of metric
 * tiles, series and table columns (`/metrics`). The live set is the API's unit
 * registry (`registerMetricUnit`): an app adds its own (`usd`, `tokens`), and
 * the wire accepts any id matching {@link METRIC_UNIT_ID_PATTERN}.
 *
 * @stability stable
 */
export const BUILTIN_METRIC_UNITS = [
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

/**
 * The platform's own display units; the same list as
 * {@link BUILTIN_METRIC_UNITS}, kept under its original name.
 *
 * @deprecated Use {@link BUILTIN_METRIC_UNITS}; the unit set is open since an
 *   app can register its own.
 * @stability stable
 */
export const METRIC_UNITS = BUILTIN_METRIC_UNITS;

/**
 * One of {@link BUILTIN_METRIC_UNITS}.
 *
 * @stability stable
 */
export type BuiltinMetricUnit = (typeof BUILTIN_METRIC_UNITS)[number];

/**
 * A metric unit id: a built-in one or any id an app registered. The union keeps
 * the built-in ids in autocompletion and accepts any other string.
 *
 * @stability stable
 */
export type MetricUnit = BuiltinMetricUnit | (string & {});

/**
 * The pattern every metric unit id matches: a lowercase letter or `%`, then up
 * to 31 lowercase letters, digits, `_`, `/`, `%` or `-`.
 *
 * @stability stable
 */
export const METRIC_UNIT_ID_PATTERN: RegExp = /^[a-z%][a-z0-9_/%-]{0,31}$/;

/**
 * How the web formats a value of a unit: `number` (grouped digits, `decimals`,
 * `suffix`), `percent`, `bytes` (binary units), `duration-ms`, `duration-s`,
 * `currency` (ISO 4217 `currency`), and the non-numeric `text`, `boolean` and
 * `timestamp`.
 *
 * @stability stable
 */
export const METRIC_UNIT_FORMATS = [
  'number',
  'percent',
  'bytes',
  'duration-ms',
  'duration-s',
  'currency',
  'text',
  'boolean',
  'timestamp',
] as const;

/**
 * One of {@link METRIC_UNIT_FORMATS}.
 *
 * @stability stable
 */
export type MetricUnitFormat = (typeof METRIC_UNIT_FORMATS)[number];

/**
 * The bounds of a unit descriptor and of a group's presentation. The schemas
 * are built from these numbers, so what the API enforces is what the web may
 * rely on.
 *
 * @stability stable
 */
export const METRIC_PRESENTATION_LIMITS = {
  /** The longest unit `label` or `suffix`, in characters. */
  unitLabel: 40,
  /** The longest unit `suffix`. */
  unitSuffix: 12,
  /** The most fraction digits a unit may ask for. */
  unitDecimals: 6,
  /** The longest label, title or status word in a presentation. */
  label: 80,
  /** The longest metric, table or column key. */
  key: 64,
  /** The most tiles. */
  tiles: 24,
  /** The most charts (`series` entries). */
  charts: 8,
  /** The most metrics in one chart. */
  chartMetrics: 8,
  /** The most colour overrides in one chart. */
  chartColors: 8,
  /** The most tables. */
  tables: 8,
  /** The most columns in one table. */
  columns: 24,
  /** The most virtual columns. */
  virtualColumns: 8,
  /** The most options in a table's "Top N" select. */
  topNOptions: 6,
  /** The largest N. */
  topNMax: 500,
} as const;

/**
 * The colours a presentation may name: a STATUS colour (`ok`, `warn`, `crit`,
 * `info`, `neutral`: what a value means) or a categorical chart SERIES colour
 * (`series-1` to `series-8`). They are theme tokens (`palette.status`,
 * `palette.chart.series`), never a CSS colour, so an app restyles them in its
 * theme and a presentation cannot inject a style.
 *
 * @stability stable
 */
export const PRESENTATION_COLOR_TOKENS = [
  'ok',
  'warn',
  'crit',
  'info',
  'neutral',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
  'series-7',
  'series-8',
] as const;

/**
 * One of {@link PRESENTATION_COLOR_TOKENS}.
 *
 * @stability stable
 */
export type ThemeColorToken = (typeof PRESENTATION_COLOR_TOKENS)[number];

/**
 * The expressions of a virtual table column: `ratio` (`a / b` as a percentage),
 * `delta` (`a - b`) and `rate` (`a` per second over the window).
 *
 * @stability stable
 */
export const VIRTUAL_COLUMN_EXPRESSIONS = ['ratio', 'delta', 'rate'] as const;

/**
 * One of {@link VIRTUAL_COLUMN_EXPRESSIONS}.
 *
 * @stability stable
 */
export type VirtualColumnExpression = (typeof VIRTUAL_COLUMN_EXPRESSIONS)[number];

/**
 * How a presentation renders a table cell: `utilization-bar` (a percentage as
 * a bar), `status` (a boolean as an icon and a word) or `fraction` (`used / total`).
 *
 * @stability stable
 */
export const PRESENTATION_COLUMN_DISPLAYS = ['utilization-bar', 'status', 'fraction'] as const;

/**
 * One of {@link PRESENTATION_COLUMN_DISPLAYS}.
 *
 * @stability stable
 */
export type PresentationColumnDisplay = (typeof PRESENTATION_COLUMN_DISPLAYS)[number];

/**
 * The pattern every metric group id matches (lower snake case). Group ids are
 * an open set: the platform registers six, an app may register more.
 *
 * @stability stable
 */
export const METRIC_GROUP_ID_PATTERN: RegExp = /^[a-z][a-z0-9_]*$/;

/**
 * The metric groups the platform itself registers, in dashboard order. The
 * live set is whatever `GET /api/admin/telemetry/dashboard/metric-groups`
 * lists.
 *
 * @stability stable
 */
export const PLATFORM_METRIC_GROUPS = ['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline'] as const;

// =============================================================================
// Group presentation: the data a metric group's dashboard section is drawn from
// (PP-14.18)
// =============================================================================
//
// DATA ONLY: ids, labels and the closed vocabularies above (a theme colour
// TOKEN, a column display KIND, a virtual-column EXPRESSION). No function, no
// component, no CSS. The zod schemas that validate these shapes are in
// `presentation.ts`; a compile-time proof there keeps the two the same type.
// The shapes live here, zod-free, so the web (which draws them) and the six
// platform presentations below never pull zod into a browser bundle.
// =============================================================================

/**
 * A metric unit: its `id`, a human `label`, and how the web formats a value of
 * it (`format`, plus `currency` for `currency`, `decimals` and `suffix` for
 * `number`).
 *
 * @example
 * ```ts
 * { id: 'usd', label: 'US dollars', format: 'currency', currency: 'USD', decimals: 2 }
 * ```
 *
 * @stability experimental
 */
export interface MetricUnitDescriptor {
  /** The id a family, ratio, table column or presentation names as its `unit`. */
  id: string;
  /** A human name (`US dollars`). */
  label: string;
  /** How a value is formatted. */
  format: MetricUnitFormat;
  /** The ISO 4217 code of a `currency` unit (`USD`). Required for `currency`, refused otherwise. */
  currency?: string;
  /** Fraction digits to show (0 to 6). Default: the format's own. */
  decimals?: number;
  /** Text after a `number` value (`/s`, ` nudges`). */
  suffix?: string;
}

/**
 * One headline tile: the metric (a family or ratio key, with the
 * `.<tileGroup>` suffix of a family that emits one tile per group value), and
 * optionally its label, unit and colour.
 *
 * @stability experimental
 */
export interface PresentationTile {
  /** The family or ratio key (or `<family>.<value>` of a family with `tileGroups`). */
  metric: string;
  /** Replaces the tile's label. */
  label?: string;
  /** Replaces the tile's unit (a registered unit id). */
  unit?: string;
  /** Draws the value in this theme colour. */
  color?: ThemeColorToken;
}

/**
 * One line chart: the metrics (family or ratio keys) drawn together, and a
 * colour per `groupBy` value (a status colour for an outcome, say).
 *
 * @stability experimental
 */
export interface PresentationSeries {
  /** The chart's title: its accessible name. */
  title: string;
  /** The family or ratio keys drawn, in legend order. They share one unit. */
  metrics: string[];
  /** Theme colours by `groupBy` value (`succeeded: 'ok'`); other lines take the series palette. */
  colors?: Record<string, ThemeColorToken>;
}

/**
 * A table's "Top N" row limit: a number N (offers `Top N` and `All`, starting at
 * N), or `{ options, default }` for a select with several counts.
 *
 * @stability experimental
 */
export type PresentationTopN =
  | number
  | {
      /** The counts offered, ascending, optionally ending in `'all'`. */
      options: Array<number | 'all'>;
      /** The count shown until the viewer chooses (one of `options`). */
      default: number | 'all';
    };

/**
 * How one table cell is drawn instead of by its unit: `utilization-bar` (a
 * percentage as a bar, warning from `warnAt`, critical from `criticalAt`),
 * `status` (a boolean as an icon AND a word; `invert` reads `false` as good)
 * or `fraction` (`used / total` of two columns).
 *
 * @stability experimental
 */
export type PresentationColumnDisplayDef =
  | { kind: 'utilization-bar'; warnAt?: number; criticalAt?: number }
  | {
      kind: 'status';
      /** The word for a good value (`Up`). */
      okText: string;
      /** The word for a bad value (`Down`). */
      badText: string;
      /** Read `false` as good (a "none eligible" flag). */
      invert?: boolean;
    }
  | {
      kind: 'fraction';
      /** The two columns shown as `first / second`. */
      of: [string, string];
    };

/**
 * One column of a table: a response column key (or a virtual column id, or a
 * `fraction` column's own key), its header and how it is drawn. A column the
 * response lacks is skipped, never drawn empty.
 *
 * @stability experimental
 */
export interface PresentationColumn {
  /** A response column key, a virtual column id, or a free key for a `fraction` column. */
  key: string;
  /** Replaces the column's header. */
  label?: string;
  /** Draws the cell as a bar, a status or a fraction instead of by its unit. */
  display?: PresentationColumnDisplayDef;
}

/**
 * One per-key table of a group: the table key, its row limit, its row order
 * (`problems-first` puts failing rows, `up === false` or a flag, first) and
 * its columns (default: every column of the response).
 *
 * @stability experimental
 */
export interface PresentationTable {
  /** The group's table key. */
  metric: string;
  /** Replaces the table's title. */
  label?: string;
  /** A "Top N" row limit. Absent: every row is drawn. */
  topN?: PresentationTopN;
  /** `problems-first`: failing rows before healthy ones; stable otherwise. Absent: the API's order. */
  sort?: 'problems-first';
  /** The columns, in order. Absent: every column of the response. */
  columns?: PresentationColumn[];
}

/**
 * A column computed in the browser from other columns of a table's rows:
 * `ratio` (`a / b` as a percentage), `delta` (`a - b`), `rate` (`a` per second
 * over the window). A row where an input is missing, or a ratio's divisor is
 * zero, reads "—".
 *
 * @stability experimental
 */
export interface PresentationVirtualColumn {
  /** The column id: a key for `columns`. */
  id: string;
  /** The header. */
  label: string;
  /** What it computes. */
  expression: VirtualColumnExpression;
  /** The input columns: two for `ratio` and `delta`, one for `rate`. */
  of: string[];
  /** Only this table (default: every table that has every input column). */
  table?: string;
  /** The result's unit (default: `%` for a ratio, `per_s` for a rate, the first input's for a delta). */
  unit?: string;
}

/**
 * How a metric group's dashboard section looks. Every part is optional: an
 * omitted part gets the default (every tile, one chart per series key, every
 * table); a present part, even an empty array, is exactly what is drawn.
 *
 * @example
 * ```ts
 * const presentation: MetricGroupPresentation = {
 *   tiles: [{ metric: 'aiSpend', label: 'AI spend', unit: 'usd', color: 'warn' }],
 *   tables: [{ metric: 'features', topN: 5 }],
 * };
 * ```
 *
 * @stability experimental
 */
export interface MetricGroupPresentation {
  /** The headline tiles, in order. */
  tiles?: PresentationTile[];
  /** The line charts, in order. */
  series?: PresentationSeries[];
  /** The tables, in order. */
  tables?: PresentationTable[];
  /** Columns computed in the browser. */
  virtualColumns?: PresentationVirtualColumn[];
}

/**
 * The presentation of the six platform groups, keyed by group id. The
 * platform's metric-group declarations take theirs from here, and the web falls
 * back to these when an API does not serve a presentation, so a section looks
 * the same against any API version.
 *
 * @stability experimental
 */
export const PLATFORM_METRIC_PRESENTATIONS: Readonly<
  Record<(typeof PLATFORM_METRIC_GROUPS)[number], MetricGroupPresentation>
> = Object.freeze({
  host: {
    tiles: [
      { metric: 'cpuUtilization' },
      { metric: 'memoryUtilization' },
      { metric: 'load1m' },
      { metric: 'filesystemUtilization' },
    ],
    series: [{ title: 'CPU and memory utilization', metrics: ['cpuUtilization', 'memoryUtilization'] }],
    tables: [
      {
        metric: 'filesystems',
        columns: [
          { key: 'key' },
          { key: 'utilizationPct', display: { kind: 'utilization-bar' } },
          { key: 'usedBytes' },
          { key: 'freeBytes' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  database: {
    tiles: [{ metric: 'dbConnectionUtilization' }, { metric: 'dbSize' }, { metric: 'dbCommits' }, { metric: 'dbCacheHitRatio' }],
    series: [{ title: 'Connections and the connection limit', metrics: ['dbConnections', 'dbConnectionMax'] }],
    tables: [{ metric: 'largestTables', topN: { options: [10, 20, 50, 'all'], default: 10 } }],
  },
  queue: {
    tiles: [
      { metric: 'queueDepth.pending' },
      { metric: 'oldestPendingAge' },
      { metric: 'jobFailureRatio' },
      { metric: 'jobDurationP95' },
      { metric: 'backupAge' },
    ],
    series: [
      {
        title: 'Jobs settled per minute by outcome',
        metrics: ['jobsSettled'],
        colors: { succeeded: 'ok', failed: 'crit' },
      },
    ],
    tables: [{ metric: 'jobTypes' }],
  },
  nodes: {
    tiles: [
      { metric: 'nodesByHealth.healthy' },
      { metric: 'nodesByHealth.stale' },
      { metric: 'nodesByHealth.offline' },
      { metric: 'noEligibleNode' },
    ],
    series: [],
    tables: [
      {
        metric: 'nodes',
        columns: [
          { key: 'key' },
          { key: 'cpuCores' },
          { key: 'rssBytes' },
          { key: 'heapPct', display: { kind: 'utilization-bar' } },
          { key: 'stateDirFreePct' },
          { key: 'slots', label: 'Slots used', display: { kind: 'fraction', of: ['slotsUsed', 'slotsTotal'] } },
          { key: 'lastSeenAt' },
        ],
      },
      {
        metric: 'noEligibleNodeTypes',
        sort: 'problems-first',
        columns: [
          { key: 'key' },
          {
            key: 'noEligibleNode',
            label: 'Eligible node',
            display: { kind: 'status', okText: 'Available', badText: 'None eligible', invert: true },
          },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  uptime: {
    tiles: [{ metric: 'nginxConnections.active' }, { metric: 'nginxRequests' }, { metric: 'tlsDaysLeft' }, { metric: 'httpDuration' }],
    series: [{ title: 'nginx connections by state', metrics: ['nginxConnections'] }],
    tables: [
      {
        metric: 'uptimeTargets',
        sort: 'problems-first',
        columns: [
          { key: 'key' },
          { key: 'up', display: { kind: 'status', okText: 'Up', badText: 'Down' } },
          { key: 'statusCode' },
          { key: 'durationMs' },
          { key: 'tlsDaysLeft' },
          { key: 'failedChecks' },
          { key: 'checks' },
          { key: 'lastError' },
          { key: 'lastSeenAt' },
        ],
      },
    ],
  },
  pipeline: {
    tiles: [{ metric: 'exporterFailed' }, { metric: 'exporterQueueUtilization' }, { metric: 'receiverRefused' }, { metric: 'scrapeTargetsDown' }],
    series: [],
    tables: [
      {
        metric: 'scrapeTargets',
        sort: 'problems-first',
        columns: [{ key: 'key' }, { key: 'up', display: { kind: 'status', okText: 'Up', badText: 'Down' } }, { key: 'lastSeenAt' }],
      },
    ],
  },
});



// =============================================================================
// Assistant (`/api/admin/telemetry/assistant/stream`)
// =============================================================================

/**
 * The longest question the assistant accepts, in characters (after trimming).
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_QUESTION_MAX = 4_000;

/**
 * The most earlier turns a request may carry in `history`.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS = 20;

/**
 * The longest `content` of one `history` turn, in characters.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX = 8_000;

/**
 * Who wrote a `history` turn.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_TURN_ROLES = ['user', 'assistant'] as const;

/**
 * The tools the platform gives the assistant; each `step` event names one. An
 * app adds its own (`registerTelemetryAssistantTool`): a step event's `tool`
 * may be any name matching {@link TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN}.
 *
 * @stability stable
 */
export const BUILTIN_TELEMETRY_ASSISTANT_TOOLS = [
  'list_tables',
  'describe_table',
  'run_query',
  'get_app_context',
  'health_overview',
  'get_trace',
  'metrics_overview',
  'compare_nodes',
] as const;

/**
 * The platform's own assistant tools; the same list as
 * {@link BUILTIN_TELEMETRY_ASSISTANT_TOOLS}, kept under its original name.
 *
 * @deprecated Use {@link BUILTIN_TELEMETRY_ASSISTANT_TOOLS}; the tool set is
 *   open since an app can register its own.
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_TOOLS = BUILTIN_TELEMETRY_ASSISTANT_TOOLS;

/**
 * One of {@link BUILTIN_TELEMETRY_ASSISTANT_TOOLS}.
 *
 * @stability stable
 */
export type BuiltinTelemetryAssistantToolName = (typeof BUILTIN_TELEMETRY_ASSISTANT_TOOLS)[number];

/**
 * A tool the assistant called: a built-in one or an app's. The union keeps the
 * built-in names in autocompletion and accepts any other string.
 *
 * @stability stable
 */
export type TelemetryAssistantToolName = BuiltinTelemetryAssistantToolName | (string & {});

/**
 * The pattern every assistant tool name matches: a lowercase letter, then up to
 * 47 lowercase letters, digits or `_` (a valid function name for every model
 * provider).
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_TOOL_NAME_PATTERN: RegExp = /^[a-z][a-z0-9_]{1,47}$/;

/**
 * The longest `extraInstructions` an app may append to the assistant's system
 * prompt, in characters.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_EXTRA_INSTRUCTIONS_MAX = 4_000;

/**
 * The outcome of an investigation, in its report's `status`.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_REPORT_STATUSES = ['issue_found', 'no_issue_found', 'inconclusive', 'no_data'] as const;

/**
 * One of {@link TELEMETRY_ASSISTANT_REPORT_STATUSES}.
 *
 * @stability stable
 */
export type TelemetryAssistantReportStatus = (typeof TELEMETRY_ASSISTANT_REPORT_STATUSES)[number];

/**
 * A report finding's severity, most severe first.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

/**
 * One of {@link TELEMETRY_ASSISTANT_SEVERITIES}.
 *
 * @stability stable
 */
export type TelemetryAssistantSeverity = (typeof TELEMETRY_ASSISTANT_SEVERITIES)[number];

/**
 * How sure a report is of its root cause.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_CONFIDENCES = ['high', 'medium', 'low'] as const;

/**
 * One of {@link TELEMETRY_ASSISTANT_CONFIDENCES}.
 *
 * @stability stable
 */
export type TelemetryAssistantConfidence = (typeof TELEMETRY_ASSISTANT_CONFIDENCES)[number];

// =============================================================================
// Types
// =============================================================================

/**
 * The entries of a telemetry enum schema, as `z.enum` types them: each value
 * keyed by itself (`TelemetryEnumEntries<DashboardRange>` is
 * `{ '15m': '15m', … }`). Named so a schema's type reads as a reference.
 *
 * @stability stable
 */
export type TelemetryEnumEntries<T extends string> = { [K in T]: K };

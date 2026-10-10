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
 * The display units of metric tiles, series and table columns (`/metrics`).
 *
 * @stability stable
 */
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

/**
 * One of {@link METRIC_UNITS}.
 *
 * @stability stable
 */
export type MetricUnit = (typeof METRIC_UNITS)[number];

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
 * The tools the assistant may call; each `step` event names one.
 *
 * @stability stable
 */
export const TELEMETRY_ASSISTANT_TOOLS = [
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
 * One of {@link TELEMETRY_ASSISTANT_TOOLS}.
 *
 * @stability stable
 */
export type TelemetryAssistantToolName = (typeof TELEMETRY_ASSISTANT_TOOLS)[number];

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

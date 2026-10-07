// =============================================================================
// Telemetry dashboard (issue #577; moved here from the API's
// `telemetry/dto/telemetry-dashboard.dto.ts` by #702)
// =============================================================================
//
//   GET /api/admin/telemetry/dashboard/summary       → telemetryDashboardSummarySchema
//   GET /api/admin/telemetry/dashboard/timeseries    → telemetryDashboardTimeseriesSchema
//   GET /api/admin/telemetry/dashboard/top           → telemetryDashboardTopSchema
//   GET /api/admin/telemetry/dashboard/events        → telemetryDashboardEventsSchema
//   GET /api/admin/telemetry/dashboard/filters       → telemetryDashboardFiltersSchema
//   GET /api/admin/telemetry/dashboard/metrics       → telemetryDashboardMetricsSchema (#601)
//   GET /api/admin/telemetry/dashboard/metric-groups → telemetryDashboardMetricGroupsSchema (#680)
//
// Common query: `range` (15m|1h|6h|24h|7d, default 1h) OR `from`+`to` (ISO,
// from < to, to <= now + 1 min, span <= 30 days); `service`, `instance`
// (checked by the service against the values seen in the range);
// `buckets` (30|60, default 60). Every query value arrives as a string.
//
// METRIC GROUP IDS ARE AN OPEN SET (#680): the platform registers six and an
// app may register more, so the contract types `group` as an id (a string
// matching `METRIC_GROUP_ID_PATTERN`). A server that knows its registered set
// builds its own `/metrics` schemas with `createTelemetryDashboardMetricsQuerySchema`
// and `createTelemetryDashboardMetricsSchema`, passing the group schema it
// documents and checks (the API passes one read from its live registry).
//
// ⚠ OpenAPI is generated from these schemas. Field order, `.describe()` texts
// and enum order are part of the published document.
// =============================================================================

import { z } from 'zod';

import {
  DASHBOARD_BUCKET_COUNTS,
  DASHBOARD_CURSOR_MAX,
  DASHBOARD_EVENT_SEVERITIES,
  DASHBOARD_FILTER_VALUE_MAX,
  DASHBOARD_FUTURE_SKEW_MS,
  DASHBOARD_MAX_SPAN_MS,
  DASHBOARD_PANELS,
  DASHBOARD_RANGES,
  DASHBOARD_SEARCH_MAX_LENGTH,
  DASHBOARD_TOP_KINDS,
  METRIC_GROUP_ID_PATTERN,
  METRIC_UNITS,
  VERDICT_LEVELS,
} from './constants.js';

// ---- queries -----------------------------------------------------------------

const commonShape = {
  range: z.enum(DASHBOARD_RANGES).optional().describe('Relative window ending now. Default `1h`. Not with `from`/`to`.'),
  from: z.iso.datetime({ offset: true }).optional().describe('Absolute window start (ISO 8601). Requires `to`.'),
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Absolute window end (ISO 8601), at most 1 minute in the future. Requires `from`; span <= 30 days.'),
  service: z
    .string()
    .min(1)
    .max(DASHBOARD_FILTER_VALUE_MAX)
    .optional()
    .describe('Only this service. Must be one of `/filters` `services` for the range.'),
  instance: z
    .string()
    .min(1)
    .max(DASHBOARD_FILTER_VALUE_MAX)
    .optional()
    .describe('Only this instance (`app.instance.id`). Must be one of `/filters` `instances` for the range.'),
  buckets: z.enum(DASHBOARD_BUCKET_COUNTS).optional().describe('Target number of buckets: `30` or `60` (default).'),
};

/**
 * The window fields {@link refineWindow} reads.
 *
 * @stability stable
 */
export interface DashboardWindowInput {
  /** A relative window. */
  range?: string;
  /** An absolute window start. */
  from?: string;
  /** An absolute window end. */
  to?: string;
}

/**
 * The cross-field rules of a dashboard window, as a `superRefine`: `range`
 * or `from`+`to` (never both, never one of the pair), `from < to`, `to` at
 * most 1 minute in the future and a span of at most 30 days. Every dashboard
 * query schema applies it; an app's own dashboard query applies it too.
 *
 * @stability stable
 */
export function refineWindow(value: DashboardWindowInput, ctx: z.RefinementCtx): void {
  const hasFrom = value.from !== undefined;
  const hasTo = value.to !== undefined;

  if (value.range !== undefined && (hasFrom || hasTo)) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'Use either `range` or `from`/`to`, not both.' });
    return;
  }
  if (hasFrom !== hasTo) {
    ctx.addIssue({ code: 'custom', path: [hasFrom ? 'to' : 'from'], message: '`from` and `to` go together.' });
    return;
  }
  if (!hasFrom) return;

  const from = Date.parse(value.from as string);
  const to = Date.parse(value.to as string);
  if (!(from < to)) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: '`from` must be before `to`.' });
    return;
  }
  if (to > Date.now() + DASHBOARD_FUTURE_SKEW_MS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: '`to` may be at most 1 minute in the future.' });
  }
  if (to - from > DASHBOARD_MAX_SPAN_MS) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'The window may span at most 30 days.' });
  }
}

/**
 * The query every dashboard route shares: `range` or `from`+`to`, `service`,
 * `instance` and `buckets`, with {@link refineWindow}.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardQuerySchema = z.object(commonShape).superRefine(refineWindow);

/**
 * The query every dashboard route shares.
 *
 * @stability stable
 */
export type TelemetryDashboardQuery = z.infer<typeof telemetryDashboardQuerySchema>;

/**
 * `GET …/dashboard/timeseries` query: the common query plus `panel`
 * (`api` or `logs`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardTimeseriesQuerySchema = z
  .object({ ...commonShape, panel: z.enum(DASHBOARD_PANELS).describe('`api` (status classes, p95) or `logs` (severity bands).') })
  .superRefine(refineWindow);

/**
 * `GET …/dashboard/timeseries` query.
 *
 * @stability stable
 */
export type TelemetryDashboardTimeseriesQuery = z.infer<typeof telemetryDashboardTimeseriesQuerySchema>;

/**
 * `GET …/dashboard/top` query: the common query plus `kind` (`routes` or
 * `errors`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardTopQuerySchema = z
  .object({ ...commonShape, kind: z.enum(DASHBOARD_TOP_KINDS).describe('`routes` (by 5xx, then 4xx except 401, then p95) or `errors` (log messages).') })
  .superRefine(refineWindow);

/**
 * `GET …/dashboard/top` query.
 *
 * @stability stable
 */
export type TelemetryDashboardTopQuery = z.infer<typeof telemetryDashboardTopQuerySchema>;

const SEVERITY_LIST = new RegExp(
  `^(${DASHBOARD_EVENT_SEVERITIES.join('|')})(,(${DASHBOARD_EVENT_SEVERITIES.join('|')}))*$`,
);

/**
 * `GET …/dashboard/events` query: the common query plus `severity` (a comma
 * list of {@link DASHBOARD_EVENT_SEVERITIES}), `q` (a log body substring) and
 * `cursor`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardEventsQuerySchema = z
  .object({
    ...commonShape,
    severity: z
      .string()
      .regex(SEVERITY_LIST, 'A comma-separated list of error, warn, info.')
      .optional()
      .describe('Comma-separated severities: `error`, `warn`, `info`. Default `error,warn`.'),
    q: z
      .string()
      .max(DASHBOARD_SEARCH_MAX_LENGTH)
      .optional()
      .describe('Case-insensitive substring of the log body (at most 200 characters; `%` and `_` are literal).'),
    cursor: z
      .string()
      .max(DASHBOARD_CURSOR_MAX)
      .optional()
      .describe('`nextCursor` of the previous page.'),
  })
  .superRefine(refineWindow);

/**
 * `GET …/dashboard/events` query.
 *
 * @stability stable
 */
export type TelemetryDashboardEventsQuery = z.infer<typeof telemetryDashboardEventsQuerySchema>;

/** `a`, `a or b`, `a, b or c`. */
function orList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * A metric group id as the contract knows it: any lower snake-case id
 * ({@link METRIC_GROUP_ID_PATTERN}). The set is open; a server checks it
 * against what it registered.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricGroupIdSchema = z.string().regex(METRIC_GROUP_ID_PATTERN);

/**
 * A metric group id.
 *
 * @stability stable
 */
export type MetricGroupId = z.infer<typeof metricGroupIdSchema>;

/**
 * What {@link metricGroupQuerySchema} checks and documents.
 *
 * @stability stable
 */
export interface MetricGroupQueryOptions<G extends string> {
  /** The ids published in the OpenAPI document (the enum and the description), in dashboard order. */
  documented: readonly G[];
  /** Whether `id` is a registered group, read live. */
  isKnown: (id: unknown) => id is G;
  /** The registered ids, read live, for the error message. */
  knownIds: () => readonly string[];
}

/**
 * The `/metrics` `group` query value of a server with a registry: checked
 * against the LIVE set (`isKnown`), so a group registered after the schema
 * was built is accepted, and DOCUMENTED as the enum of `documented`, exactly
 * as a `z.enum` would be, so the OpenAPI document reads the same.
 *
 * @extensionPoint schema
 * @stability stable
 */
export function metricGroupQuerySchema<G extends string>(options: MetricGroupQueryOptions<G>): z.ZodType<G, string> {
  const { documented, isKnown, knownIds } = options;
  return z
    .string()
    .refine(isKnown, {
      error: () => `Invalid option: expected one of ${knownIds().map((id) => `"${id}"`).join('|')}`,
    })
    .meta({ enum: [...documented] })
    .describe(`The metric group: ${orList(documented.map((id) => `\`${id}\``))}.`) as unknown as z.ZodType<G, string>;
}

/**
 * Builds the `GET …/dashboard/metrics` query schema around a `group` schema:
 * the common query plus `group` and `host`, with {@link refineWindow}.
 *
 * @extensionPoint schema
 * @stability stable
 */
export function createTelemetryDashboardMetricsQuerySchema<G extends z.ZodType<string, string>>(group: G) {
  return z
    .object({
      ...commonShape,
      group,
      host: z
        .string()
        .min(1)
        .max(DASHBOARD_FILTER_VALUE_MAX)
        .optional()
        .describe('Only this host (`host_name`). Must be one of `/filters` `hosts` for the range.'),
    })
    .superRefine(refineWindow);
}

/**
 * `GET …/dashboard/metrics` query, with `group` any metric group id
 * ({@link metricGroupIdSchema}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardMetricsQuerySchema = createTelemetryDashboardMetricsQuerySchema(metricGroupIdSchema);

/**
 * `GET …/dashboard/metrics` query.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricsQuery = z.infer<typeof telemetryDashboardMetricsQuerySchema>;

// ---- responses ---------------------------------------------------------------

const envelope = {
  range: z.object({
    from: z.string().describe('Window start, ISO 8601.'),
    to: z.string().describe('Window end (exclusive), ISO 8601.'),
    bucketSeconds: z.number().int().describe('Bucket size used for series and sparklines.'),
  }),
  generatedAt: z.string().describe('When the telemetry store was read (results are cached for 15 s).'),
  truncated: z.boolean().describe('A row cap cut a list short.'),
  sql: z
    .union([z.string(), z.array(z.string())])
    .describe('The exact statement(s) run, primary first.'),
};

/**
 * The fields every dashboard response except `/metrics` starts with:
 * `range` (`from`, `to`, `bucketSeconds`), `generatedAt`, `truncated` and
 * `sql` (the statement or statements run, primary first).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardEnvelopeSchema = z.object(envelope);

/**
 * The fields every dashboard response except `/metrics` starts with.
 *
 * @stability stable
 */
export type TelemetryDashboardEnvelope = z.infer<typeof telemetryDashboardEnvelopeSchema>;

const tileValue = z.union([z.number(), z.string()]).nullable();

/**
 * One tile: `key`, `label`, `value`, `previous` (the previous window of equal
 * length), `unit` and `sparkline` (one value per bucket, `null` a gap).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardTileSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: tileValue.describe('Current window value; null when there is nothing to measure.'),
  previous: tileValue.describe('Same measure over the previous window of equal length.'),
  unit: z
    .string()
    .describe(
      '`req/min`, `%`, `ms`, `count`, `bytes` or `timestamp`; metric tiles (`/metrics`) also use ' +
        '`bytes/s`, `per_s`, `per_min`, `seconds`, `hours`, `days`, `cores` and `load`.',
    ),
  sparkline: z.array(z.number().nullable()).describe('One value per bucket of the window; null where unmeasurable.'),
});

/**
 * One tile.
 *
 * @stability stable
 */
export type TelemetryDashboardTile = z.infer<typeof telemetryDashboardTileSchema>;

/**
 * One unknown API route of the summary (#650): `method`, the normalized
 * `route`, `count`, and how many were `bearer` or `anonymous`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const unknownRouteSchema = z.object({
  method: z.string().nullable(),
  route: z
    .string()
    .nullable()
    .describe('The request path with numeric/UUID/hex segments normalized to `:id` (a route shape, not a value).'),
  count: z.number().describe('Requests to this unknown route in the window.'),
  bearer: z.number().describe('Of those, requests carrying an `Authorization: Bearer` header (the application\'s own clients).'),
  anonymous: z.number().describe('Of those, requests without a bearer (typically internet scanners).'),
});

/**
 * One unknown API route of the summary.
 *
 * @stability stable
 */
export type TelemetryDashboardUnknownRoute = z.infer<typeof unknownRouteSchema>;

/**
 * Requests to API routes that do not exist (#650): totals, the previous
 * window's, the top routes and the statements run.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardUnknownRoutesSchema = z
  .object({
    requests: z.number().describe('Requests answered by the not-found handler (404, no matched route) in the window.'),
    bearer: z.number().describe('Of those, requests with an `Authorization: Bearer` header. Any of these degrades the verdict.'),
    anonymous: z.number().describe('Of those, requests without a bearer. Counted, never alarming.'),
    previousRequests: z.number().describe('`requests` over the previous window of equal length.'),
    previousBearer: z.number().describe('`bearer` over the previous window of equal length.'),
    topRoutes: z
      .array(unknownRouteSchema)
      .describe('Most-hit unknown routes by `METHOD /normalized-path`, bearer requests first (at most 5).'),
    truncated: z.boolean().describe('More unknown routes exist than `topRoutes` lists.'),
    sql: z
      .array(z.string())
      .describe(
        'The exact statements run for this block, per-route list first, then the window totals ' +
          '(the same text that also appears in the summary\'s `sql`), for "Open in Explorer".',
      ),
  })
  .describe(
    'Requests to API routes that do not exist (issue #650). Absent when the store has no ' +
      '`span_attributes.app.route.matched` column yet (no unknown route recorded since the API started ' +
      'writing it): the figure is then unknown, not zero.',
  );

/**
 * Requests to API routes that do not exist.
 *
 * @stability stable
 */
export type TelemetryDashboardUnknownRoutes = z.infer<typeof telemetryDashboardUnknownRoutesSchema>;

/**
 * `GET …/dashboard/summary`: the envelope plus `verdict` (`level` and
 * `reasons`), `tiles`, `runtime` (optional) and `unknownRoutes` (optional).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardSummarySchema = z.object({
  ...envelope,
  verdict: z.object({
    level: z.enum(VERDICT_LEVELS),
    reasons: z.array(z.string()),
  }),
  tiles: z
    .array(telemetryDashboardTileSchema)
    .describe(
      'Fixed tiles: `requestsPerMin`, `errorRatePct`, `p95Ms`, `errorLogs`, `warnLogs`, `unknownRoutes` ' +
        '(requests to unknown API routes; value null when the store cannot tell yet, see `unknownRoutes`) and `lastDataAt`.',
    ),
  runtime: z
    .array(telemetryDashboardTileSchema)
    .optional()
    .describe('Heap used and event-loop delay p99, when the runtime metric tables exist. Not filtered by instance.'),
  unknownRoutes: telemetryDashboardUnknownRoutesSchema.optional(),
});

/**
 * `GET …/dashboard/summary`.
 *
 * @stability stable
 */
export type TelemetryDashboardSummary = z.infer<typeof telemetryDashboardSummarySchema>;

/**
 * One `api` timeseries bucket: `t`, the status classes and `p95Ms`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const apiBucketSchema = z.object({
  t: z.string(),
  s2xx: z.number(),
  s3xx: z.number(),
  s4xx: z.number(),
  s5xx: z.number(),
  p95Ms: z.number().nullable(),
});

/**
 * One `api` timeseries bucket.
 *
 * @stability stable
 */
export type TelemetryDashboardApiBucket = z.infer<typeof apiBucketSchema>;

/**
 * One `logs` timeseries bucket: `t` and the severity bands.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const logsBucketSchema = z.object({
  t: z.string(),
  error: z.number(),
  warn: z.number(),
  info: z.number(),
  other: z.number(),
});

/**
 * One `logs` timeseries bucket.
 *
 * @stability stable
 */
export type TelemetryDashboardLogsBucket = z.infer<typeof logsBucketSchema>;

/**
 * `GET …/dashboard/timeseries`: the envelope plus `panel` and `buckets` (api
 * buckets for `api`, logs buckets for `logs`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardTimeseriesSchema = z.object({
  ...envelope,
  panel: z.enum(DASHBOARD_PANELS),
  buckets: z.union([z.array(apiBucketSchema), z.array(logsBucketSchema)]),
});

/**
 * `GET …/dashboard/timeseries`.
 *
 * @stability stable
 */
export type TelemetryDashboardTimeseries = z.infer<typeof telemetryDashboardTimeseriesSchema>;

/**
 * One route of `top?kind=routes`: request counts, 5xx `errors`, 4xx
 * `clientErrors`, `unknownRequests`, `unknown` and `p95Ms`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const topRouteSchema = z.object({
  method: z.string().nullable(),
  route: z.string().nullable().describe('The request path with numeric/UUID/hex segments normalized to `:id`.'),
  count: z.number(),
  errors: z.number().describe('5xx responses.'),
  errorRatePct: z.number(),
  clientErrors: z.number().describe('4xx responses except 401 (an expired access token is routine), unknown routes included.'),
  unknownRequests: z
    .number()
    .describe('Requests answered by the not-found handler: no API route matches this method and path. 0 when the store cannot tell yet.'),
  unknown: z.boolean().describe('`unknownRequests > 0`: this method + path is not a route of the running API build.'),
  p95Ms: z.number().nullable(),
});

/**
 * One route of `top?kind=routes`.
 *
 * @stability stable
 */
export type TelemetryDashboardTopRoute = z.infer<typeof topRouteSchema>;

/**
 * One error message of `top?kind=errors`: `message`, `count`, first and last
 * seen, a sample trace and the `service`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const topErrorSchema = z.object({
  message: z.string().nullable(),
  count: z.number(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  sampleTraceId: z.string().nullable(),
  service: z.string().nullable(),
});

/**
 * One error message of `top?kind=errors`.
 *
 * @stability stable
 */
export type TelemetryDashboardTopError = z.infer<typeof topErrorSchema>;

/**
 * `GET …/dashboard/top`: the envelope plus `kind` and `items` (routes for
 * `routes`, errors for `errors`).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardTopSchema = z.object({
  ...envelope,
  kind: z.enum(DASHBOARD_TOP_KINDS),
  items: z.union([z.array(topRouteSchema), z.array(topErrorSchema)]),
});

/**
 * `GET …/dashboard/top`.
 *
 * @stability stable
 */
export type TelemetryDashboardTop = z.infer<typeof telemetryDashboardTopSchema>;

/**
 * One log event: `timestamp` (full precision, UTC), `severity`, `service`,
 * `body`, `traceId` and `spanId`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const dashboardEventSchema = z.object({
  timestamp: z.string().describe('Full precision (up to nanoseconds), UTC.'),
  severity: z.string(),
  service: z.string().nullable(),
  body: z.string().nullable(),
  traceId: z.string().nullable(),
  spanId: z.string().nullable(),
});

/**
 * One log event.
 *
 * @stability stable
 */
export type TelemetryDashboardEvent = z.infer<typeof dashboardEventSchema>;

/**
 * `GET …/dashboard/events`: the envelope plus `items` and `nextCursor`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardEventsSchema = z.object({
  ...envelope,
  items: z.array(dashboardEventSchema),
  nextCursor: z.string().nullable(),
});

/**
 * `GET …/dashboard/events`.
 *
 * @stability stable
 */
export type TelemetryDashboardEvents = z.infer<typeof telemetryDashboardEventsSchema>;

/**
 * `GET …/dashboard/filters`: the envelope plus the `services`, `instances`
 * and `hosts` seen in the window.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardFiltersSchema = z.object({
  ...envelope,
  services: z.array(z.string()),
  instances: z.array(z.string()),
  hosts: z
    .array(z.string())
    .describe('Host names (`host_name`) seen in the host metrics — the values `/metrics` `host` accepts.'),
});

/**
 * `GET …/dashboard/filters`.
 *
 * @stability stable
 */
export type TelemetryDashboardFilters = z.infer<typeof telemetryDashboardFiltersSchema>;

// ---- metrics (#601) ------------------------------------------------------------

const metricUnit = z.enum(METRIC_UNITS);

/**
 * One point of a metric series: `t` (bucket start) and `v` (`null` where
 * nothing was measured).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricPointSchema = z.object({ t: z.string().describe('Bucket start, ISO 8601.'), v: z.number().nullable() });

/**
 * One point of a metric series.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricPoint = z.infer<typeof metricPointSchema>;

/**
 * One metric series: `key`, `label`, `unit`, `dimension`, `groupBy` and
 * `points` (one per bucket).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricSeriesSchema = z.object({
  key: z.string().describe('The catalog family or ratio key.'),
  label: z.string(),
  unit: metricUnit,
  dimension: z.string().nullable().describe('The label column the family is split by (e.g. `mountpoint`), or null.'),
  groupBy: z.string().nullable().describe("This series' value of `dimension` (e.g. `/`), or null."),
  points: z
    .array(metricPointSchema)
    .describe('One point per bucket of the window; null where nothing was measured.'),
});

/**
 * One metric series.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricSeries = z.infer<typeof metricSeriesSchema>;

/**
 * One column of a metric table: `key`, `label` and `unit`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricColumnSchema = z.object({ key: z.string(), label: z.string(), unit: metricUnit });

/**
 * One column of a metric table.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricColumn = z.infer<typeof metricColumnSchema>;

/**
 * One cell of a metric table row: a string, number, boolean or `null`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * One cell of a metric table row.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricCell = z.infer<typeof metricCellSchema>;

/**
 * One per-key metric table: `key`, `label`, `columns` and `rows`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricTableSchema = z.object({
  key: z.string(),
  label: z.string(),
  columns: z.array(metricColumnSchema),
  rows: z
    .array(z.record(z.string(), metricCellSchema))
    .describe(
      'One row per key; `key` holds the key column, then one entry per column. At most 50 rows ' +
        '(500 for `largestTables`); `truncated` says a cap cut the list.'
    ),
});

/**
 * One per-key metric table.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricTable = z.infer<typeof metricTableSchema>;

/**
 * Builds the `GET …/dashboard/metrics` response schema around a `group`
 * schema: `range`, `generatedAt`, `truncated`, `sql`, `group`, `available`,
 * `tiles`, `series`, `tables` and `skipped`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export function createTelemetryDashboardMetricsSchema<G extends z.ZodType<string>>(group: G) {
  return z.object({
    range: envelope.range,
    generatedAt: envelope.generatedAt,
    truncated: z.boolean().describe('A series, table or histogram row cap cut a list short.'),
    sql: z.array(z.string()).describe('The exact statements run, in order — for "Open in Explorer".'),
    group,
    available: z.boolean().describe('At least one family or table of the group has its table in the store.'),
    tiles: z.array(telemetryDashboardTileSchema),
    series: z.array(metricSeriesSchema),
    tables: z.array(metricTableSchema),
    skipped: z
      .array(z.string())
      .describe('Catalog keys (families, ratios, tables) skipped because a table or column they need is absent.'),
  });
}

/**
 * `GET …/dashboard/metrics`, with `group` any metric group id
 * ({@link metricGroupIdSchema}).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardMetricsSchema = createTelemetryDashboardMetricsSchema(metricGroupIdSchema);

/**
 * `GET …/dashboard/metrics`.
 *
 * @stability stable
 */
export type TelemetryDashboardMetrics = z.infer<typeof telemetryDashboardMetricsSchema>;

// ---- metric groups (#680) ------------------------------------------------------

/**
 * One registered metric group: `id`, `label`, `title` and `order`.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardMetricGroupSchema = z.object({
  id: z.string().describe('The group id: the `/metrics` `group` value and the section anchor.'),
  label: z.string().describe('The API label (e.g. `Host`).'),
  title: z.string().describe('The dashboard section title (e.g. `Infrastructure`).'),
  order: z.number().describe('Dashboard order, ascending; `data` is already sorted by it (ties by id).'),
});

/**
 * One registered metric group.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricGroup = z.infer<typeof telemetryDashboardMetricGroupSchema>;

/**
 * `GET …/dashboard/metric-groups`: `data`, every registered group in
 * dashboard order.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const telemetryDashboardMetricGroupsSchema = z.object({
  data: z
    .array(telemetryDashboardMetricGroupSchema)
    .describe('Every registered metric group (the platform\'s and the app\'s), in dashboard order.'),
});

/**
 * `GET …/dashboard/metric-groups`.
 *
 * @stability stable
 */
export type TelemetryDashboardMetricGroups = z.infer<typeof telemetryDashboardMetricGroupsSchema>;

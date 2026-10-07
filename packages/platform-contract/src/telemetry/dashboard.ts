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
import { wireEnum } from './enum.js';

// ---- queries -----------------------------------------------------------------

const commonShape = {
  /** Relative window ending now. Default `1h`. Not with `from`/`to`. */
  range: wireEnum(DASHBOARD_RANGES).optional().describe('Relative window ending now. Default `1h`. Not with `from`/`to`.'),
  /** Absolute window start (ISO 8601). Requires `to`. */
  from: z.iso.datetime({ offset: true }).optional().describe('Absolute window start (ISO 8601). Requires `to`.'),
  /** Absolute window end (ISO 8601), at most 1 minute in the future. Requires `from`; span at most 30 days. */
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Absolute window end (ISO 8601), at most 1 minute in the future. Requires `from`; span <= 30 days.'),
  /** Only this service. Must be one of `/filters` `services` for the range. */
  service: z
    .string()
    .min(1)
    .max(DASHBOARD_FILTER_VALUE_MAX)
    .optional()
    .describe('Only this service. Must be one of `/filters` `services` for the range.'),
  /** Only this instance (`app.instance.id`). Must be one of `/filters` `instances` for the range. */
  instance: z
    .string()
    .min(1)
    .max(DASHBOARD_FILTER_VALUE_MAX)
    .optional()
    .describe('Only this instance (`app.instance.id`). Must be one of `/filters` `instances` for the range.'),
  /** Target number of buckets: `30` or `60` (default). */
  buckets: wireEnum(DASHBOARD_BUCKET_COUNTS).optional().describe('Target number of buckets: `30` or `60` (default).'),
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
  .object({
    ...commonShape,
    /** `api` (status classes, p95) or `logs` (severity bands). */
    panel: wireEnum(DASHBOARD_PANELS).describe('`api` (status classes, p95) or `logs` (severity bands).'),
  })
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
  .object({
    ...commonShape,
    /** `routes` (by 5xx, then 4xx except 401, then p95) or `errors` (log messages). */
    kind: wireEnum(DASHBOARD_TOP_KINDS).describe('`routes` (by 5xx, then 4xx except 401, then p95) or `errors` (log messages).'),
  })
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
    /** Comma-separated severities: `error`, `warn`, `info`. Default `error,warn`. */
    severity: z
      .string()
      .regex(SEVERITY_LIST, 'A comma-separated list of error, warn, info.')
      .optional()
      .describe('Comma-separated severities: `error`, `warn`, `info`. Default `error,warn`.'),
    /** Case-insensitive substring of the log body (at most 200 characters; `%` and `_` are literal). */
    q: z
      .string()
      .max(DASHBOARD_SEARCH_MAX_LENGTH)
      .optional()
      .describe('Case-insensitive substring of the log body (at most 200 characters; `%` and `_` are literal).'),
    /** `nextCursor` of the previous page. */
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
      /** The metric group: the schema passed in. */
      group,
      /** Only this host (`host_name`). Must be one of `/filters` `hosts` for the range. */
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
  /** Window start, ISO 8601. */
  range: z.object({
    /** Window start, ISO 8601. */
    from: z.string().describe('Window start, ISO 8601.'),
    /** Window end (exclusive), ISO 8601. */
    to: z.string().describe('Window end (exclusive), ISO 8601.'),
    /** Bucket size used for series and sparklines. */
    bucketSeconds: z.number().int().describe('Bucket size used for series and sparklines.'),
  }),
  /** When the telemetry store was read (results are cached for 15 s). */
  generatedAt: z.string().describe('When the telemetry store was read (results are cached for 15 s).'),
  /** A row cap cut a list short. */
  truncated: z.boolean().describe('A row cap cut a list short.'),
  /** The exact statement(s) run, primary first. */
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
  /** Stable tile key. */
  key: z.string(),
  /** Display label. */
  label: z.string(),
  /** Current window value; null when there is nothing to measure. */
  value: tileValue.describe('Current window value; null when there is nothing to measure.'),
  /** Same measure over the previous window of equal length. */
  previous: tileValue.describe('Same measure over the previous window of equal length.'),
  /** `req/min`, `%`, `ms`, `count`, `bytes` or `timestamp`; metric tiles (`/metrics`) also use `bytes/s`, `per_s`, `per_min`, `seconds`, `hours`, `days`, `cores` and `load`. */
  unit: z
    .string()
    .describe(
      '`req/min`, `%`, `ms`, `count`, `bytes` or `timestamp`; metric tiles (`/metrics`) also use ' +
        '`bytes/s`, `per_s`, `per_min`, `seconds`, `hours`, `days`, `cores` and `load`.',
    ),
  /** One value per bucket of the window; null where unmeasurable. */
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
  /** The HTTP method, or `null`. */
  method: z.string().nullable(),
  /** The request path with numeric/UUID/hex segments normalized to `:id` (a route shape, not a value). */
  route: z
    .string()
    .nullable()
    .describe('The request path with numeric/UUID/hex segments normalized to `:id` (a route shape, not a value).'),
  /** Requests to this unknown route in the window. */
  count: z.number().describe('Requests to this unknown route in the window.'),
  /** Of those, requests carrying an `Authorization: Bearer` header (the application's own clients). */
  bearer: z.number().describe('Of those, requests carrying an `Authorization: Bearer` header (the application\'s own clients).'),
  /** Of those, requests without a bearer (typically internet scanners). */
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
    /** Requests answered by the not-found handler (404, no matched route) in the window. */
    requests: z.number().describe('Requests answered by the not-found handler (404, no matched route) in the window.'),
    /** Of those, requests with an `Authorization: Bearer` header. Any of these degrades the verdict. */
    bearer: z.number().describe('Of those, requests with an `Authorization: Bearer` header. Any of these degrades the verdict.'),
    /** Of those, requests without a bearer. Counted, never alarming. */
    anonymous: z.number().describe('Of those, requests without a bearer. Counted, never alarming.'),
    /** `requests` over the previous window of equal length. */
    previousRequests: z.number().describe('`requests` over the previous window of equal length.'),
    /** `bearer` over the previous window of equal length. */
    previousBearer: z.number().describe('`bearer` over the previous window of equal length.'),
    /** Most-hit unknown routes by `METHOD /normalized-path`, bearer requests first (at most 5). */
    topRoutes: z
      .array(unknownRouteSchema)
      .describe('Most-hit unknown routes by `METHOD /normalized-path`, bearer requests first (at most 5).'),
    /** More unknown routes exist than `topRoutes` lists. */
    truncated: z.boolean().describe('More unknown routes exist than `topRoutes` lists.'),
    /** The exact statements run for this block, per-route list first, then the window totals (the same text that also appears in the summary's `sql`), for "Open in Explorer". */
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
  /** The overall health verdict. */
  verdict: z.object({
    /** How healthy the window is. */
    level: wireEnum(VERDICT_LEVELS),
    /** Why, one line per rule that fired. */
    reasons: z.array(z.string()),
  }),
  /** Fixed tiles: `requestsPerMin`, `errorRatePct`, `p95Ms`, `errorLogs`, `warnLogs`, `unknownRoutes` (requests to unknown API routes; value null when the store cannot tell yet, see `unknownRoutes`) and `lastDataAt`. */
  tiles: z
    .array(telemetryDashboardTileSchema)
    .describe(
      'Fixed tiles: `requestsPerMin`, `errorRatePct`, `p95Ms`, `errorLogs`, `warnLogs`, `unknownRoutes` ' +
        '(requests to unknown API routes; value null when the store cannot tell yet, see `unknownRoutes`) and `lastDataAt`.',
    ),
  /** Heap used and event-loop delay p99, when the runtime metric tables exist. Not filtered by instance. */
  runtime: z
    .array(telemetryDashboardTileSchema)
    .optional()
    .describe('Heap used and event-loop delay p99, when the runtime metric tables exist. Not filtered by instance.'),
  /** Requests to unknown API routes; absent while the store cannot tell. */
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
  /** Bucket start, ISO 8601. */
  t: z.string(),
  /** 2xx responses. */
  s2xx: z.number(),
  /** 3xx responses. */
  s3xx: z.number(),
  /** 4xx responses. */
  s4xx: z.number(),
  /** 5xx responses. */
  s5xx: z.number(),
  /** 95th percentile latency in ms, or `null` with no requests. */
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
  /** Bucket start, ISO 8601. */
  t: z.string(),
  /** Error-level log records. */
  error: z.number(),
  /** Warn-level log records. */
  warn: z.number(),
  /** Info-level log records. */
  info: z.number(),
  /** Records of any other (or no) severity. */
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
  /** The panel requested. */
  panel: wireEnum(DASHBOARD_PANELS),
  /** One entry per bucket: api buckets for `api`, logs buckets for `logs`. */
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
  /** The HTTP method, or `null`. */
  method: z.string().nullable(),
  /** The request path with numeric/UUID/hex segments normalized to `:id`. */
  route: z.string().nullable().describe('The request path with numeric/UUID/hex segments normalized to `:id`.'),
  /** Requests in the window. */
  count: z.number(),
  /** 5xx responses. */
  errors: z.number().describe('5xx responses.'),
  /** `errors` as a percentage of `count`. */
  errorRatePct: z.number(),
  /** 4xx responses except 401 (an expired access token is routine), unknown routes included. */
  clientErrors: z.number().describe('4xx responses except 401 (an expired access token is routine), unknown routes included.'),
  /** Requests answered by the not-found handler: no API route matches this method and path. 0 when the store cannot tell yet. */
  unknownRequests: z
    .number()
    .describe('Requests answered by the not-found handler: no API route matches this method and path. 0 when the store cannot tell yet.'),
  /** `unknownRequests > 0`: this method + path is not a route of the running API build. */
  unknown: z.boolean().describe('`unknownRequests > 0`: this method + path is not a route of the running API build.'),
  /** 95th percentile latency in ms, or `null`. */
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
  /** The grouped log message, or `null`. */
  message: z.string().nullable(),
  /** Occurrences in the window. */
  count: z.number(),
  /** First occurrence in the window, or `null`. */
  firstSeen: z.string().nullable(),
  /** Last occurrence in the window, or `null`. */
  lastSeen: z.string().nullable(),
  /** A trace of one occurrence, or `null`. */
  sampleTraceId: z.string().nullable(),
  /** The service that logged it, or `null`. */
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
  /** The kind requested. */
  kind: wireEnum(DASHBOARD_TOP_KINDS),
  /** Routes for `routes`, error messages for `errors`. */
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
  /** Full precision (up to nanoseconds), UTC. */
  timestamp: z.string().describe('Full precision (up to nanoseconds), UTC.'),
  /** Lower-case severity text (`error`, `warn`, `info`, `debug`, …). */
  severity: z.string(),
  /** The emitting service, or `null`. */
  service: z.string().nullable(),
  /** The log body, or `null`. */
  body: z.string().nullable(),
  /** The trace it belongs to, or `null`. */
  traceId: z.string().nullable(),
  /** The span it belongs to, or `null`. */
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
  /** The events, newest first. */
  items: z.array(dashboardEventSchema),
  /** The `cursor` of the next page, or `null` on the last. */
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
  /** Services seen in the window: the values `service` accepts. */
  services: z.array(z.string()),
  /** Instances (`app.instance.id`) seen in the window: the values `instance` accepts. */
  instances: z.array(z.string()),
  /** Host names (`host_name`) seen in the host metrics — the values `/metrics` `host` accepts. */
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

const metricUnit = wireEnum(METRIC_UNITS);

/**
 * One point of a metric series: `t` (bucket start) and `v` (`null` where
 * nothing was measured).
 *
 * @extensionPoint schema
 * @stability stable
 */
export const metricPointSchema = z.object({
  /** Bucket start, ISO 8601. */
  t: z.string().describe('Bucket start, ISO 8601.'),
  /** The value, or `null` where nothing was measured: a gap, not a zero. */
  v: z.number().nullable(),
});

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
  /** The catalog family or ratio key. */
  key: z.string().describe('The catalog family or ratio key.'),
  /** Display label. */
  label: z.string(),
  /** Display unit of `points`. */
  unit: metricUnit,
  /** The label column the family is split by (e.g. `mountpoint`), or null. */
  dimension: z.string().nullable().describe('The label column the family is split by (e.g. `mountpoint`), or null.'),
  /** This series' value of `dimension` (e.g. `/`), or null. */
  groupBy: z.string().nullable().describe("This series' value of `dimension` (e.g. `/`), or null."),
  /** One point per bucket of the window; null where nothing was measured. */
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
export const metricColumnSchema = z.object({
  /** The column key (a key of each row). */
  key: z.string(),
  /** Display label. */
  label: z.string(),
  /** Display unit of the column's values. */
  unit: metricUnit,
});

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
  /** The table key. */
  key: z.string(),
  /** Display label. */
  label: z.string(),
  /** The columns, `key` first. */
  columns: z.array(metricColumnSchema),
  /** One row per key; `key` holds the key column, then one entry per column. At most 50 rows (500 for `largestTables`); `truncated` says a cap cut the list. */
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
    /** The window read. */
    range: envelope.range,
    /** When the telemetry store was read. */
    generatedAt: envelope.generatedAt,
    /** A series, table or histogram row cap cut a list short. */
    truncated: z.boolean().describe('A series, table or histogram row cap cut a list short.'),
    /** The exact statements run, in order — for "Open in Explorer". */
    sql: z.array(z.string()).describe('The exact statements run, in order — for "Open in Explorer".'),
    /** The metric group served: the schema passed in. */
    group,
    /** At least one family or table of the group has its table in the store. */
    available: z.boolean().describe('At least one family or table of the group has its table in the store.'),
    /** The group's tiles. */
    tiles: z.array(telemetryDashboardTileSchema),
    /** The group's series. */
    series: z.array(metricSeriesSchema),
    /** The group's per-key tables. */
    tables: z.array(metricTableSchema),
    /** Catalog keys (families, ratios, tables) skipped because a table or column they need is absent. */
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
  /** The group id: the `/metrics` `group` value and the section anchor. */
  id: z.string().describe('The group id: the `/metrics` `group` value and the section anchor.'),
  /** The API label (e.g. `Host`). */
  label: z.string().describe('The API label (e.g. `Host`).'),
  /** The dashboard section title (e.g. `Infrastructure`). */
  title: z.string().describe('The dashboard section title (e.g. `Infrastructure`).'),
  /** Dashboard order, ascending; `data` is already sorted by it (ties by id). */
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
  /** Every registered metric group (the platform's and the app's), in dashboard order. */
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

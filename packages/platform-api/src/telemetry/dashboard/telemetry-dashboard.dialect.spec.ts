import { GREPTIME_SQL_DIALECT } from '../stores/greptime/greptime.dialect';
import type { TelemetrySqlDialect } from '../stores/telemetry-store';
import { METRIC_FAMILIES, metricTablesOf } from '../metrics/metric-catalog';
import { counterSeriesSql, gaugeSeriesSql } from '../metrics/metric-sql';
import { metricCatalogSchema } from '../testing/metric-schema.fixture';
import {
  apiTimeseriesSql,
  apiTotalsSql,
  distinctInstancesSql,
  distinctServicesSql,
  eventLoopDelayP99Sql,
  eventsSql,
  heapUsedSql,
  lastDataSql,
  logsTimeseriesSql,
  logsTotalsSql,
  topErrorsSql,
  topRoutesSql,
  topUnknownRoutesSql,
  unknownRoutesTotalsSql,
  type DashboardSqlFilters,
} from './telemetry-dashboard.sql';

// =============================================================================
// The dashboard SQL asks the dialect for its seven constructs (PP-14.11)
// =============================================================================
//
// Two guarantees: a builder given no dialect renders exactly what it rendered
// before the dialect existed (the snapshots in telemetry-dashboard.sql.spec.ts
// pin the text; here the default and the explicit built-in are shown identical),
// and a builder given another dialect renders ITS spellings and none of
// GreptimeDB's.
// =============================================================================

const FROM = new Date('2026-09-27T21:00:00.000Z');
const TO = new Date('2026-09-27T22:00:00.000Z');
const PREVIOUS_FROM = new Date('2026-09-27T20:00:00.000Z');
const WINDOW = { from: FROM, to: TO, bucketSeconds: 60 };
const FILTERS: DashboardSqlFilters = {
  service: 'my-api',
  instance: 'node-1',
  tracesHaveInstance: true,
  tracesHaveRouteMatched: true,
  tracesHaveBearer: true,
};
const BOTH = { traces: true, logs: true };

/** Spells every construct unlike GreptimeDB, with a marker per construct. */
const OTHER: TelemetrySqlDialect = {
  id: 'other',
  timestampColumn: 'event_ts',
  valueColumn: 'event_value',
  timeBucket: (column, seconds) => `BUCKET<${seconds}>(${column})`,
  percentile: (fraction, expr) => `PCT<${fraction}>(${expr})`,
  regexpReplaceAll: (expr, pattern, replacement) => `REGEX<${pattern}|${replacement}>(${expr})`,
  jsonString: (column, key) => `JSON<${key}>(${column})`,
  containsIgnoreCase: (expr, pattern) => `CONTAINS<${pattern}>(${expr})`,
  castText: (expr) => `TEXT(${expr})`,
  limit: (rows) => `FETCH FIRST ${rows} ROWS ONLY`,
};

/** What only GreptimeDB's spellings contain. */
const GREPTIME_ONLY = /date_bin|approx_percentile_cont|regexp_replace|json_get_string|ILIKE|AS STRING|\bLIMIT\b/;

type Builder = (dialect?: TelemetrySqlDialect) => string | null;

const BUILDERS: Array<[string, Builder]> = [
  ['apiTimeseries', (d) => apiTimeseriesSql(WINDOW, FILTERS, d)],
  ['apiTotals', (d) => apiTotalsSql(PREVIOUS_FROM, WINDOW, FILTERS, d)],
  ['topRoutes', (d) => topRoutesSql(WINDOW, FILTERS, undefined, d)],
  ['unknownRoutesTotals', (d) => unknownRoutesTotalsSql(PREVIOUS_FROM, WINDOW, FILTERS, d)],
  ['topUnknownRoutes', (d) => topUnknownRoutesSql(WINDOW, FILTERS, undefined, d)],
  ['logsTimeseries', (d) => logsTimeseriesSql(WINDOW, FILTERS, d)],
  ['logsTotals', (d) => logsTotalsSql(PREVIOUS_FROM, WINDOW, FILTERS, d)],
  ['topErrors', (d) => topErrorsSql(WINDOW, FILTERS, undefined, d)],
  ['events', (d) => eventsSql(WINDOW, FILTERS, { severities: ['error'], q: 'timeout' }, d)],
  ['lastData', (d) => lastDataSql(PREVIOUS_FROM, TO, FILTERS, BOTH, d)],
  ['distinctServices', (d) => distinctServicesSql(FROM, TO, BOTH, undefined, d)],
  ['distinctInstances', (d) => distinctInstancesSql(FROM, TO, BOTH, undefined, d)],
  ['heapUsed', (d) => heapUsedSql(PREVIOUS_FROM, TO, 60, 'my-api', d)],
  ['eventLoopDelayP99', (d) => eventLoopDelayP99Sql(PREVIOUS_FROM, TO, 60, 'my-api', d)],
];

describe.each(BUILDERS)('%s', (_name, build) => {
  it('renders the same text with no dialect as with the built-in one', () => {
    expect(build()).toBe(build(GREPTIME_SQL_DIALECT));
  });

  it('renders no GreptimeDB spelling when given another dialect', () => {
    const sql = build(OTHER) as string;

    expect(sql).not.toMatch(GREPTIME_ONLY);
    expect(sql).not.toContain('greptime_');
  });
});

describe('what each construct becomes', () => {
  it('buckets time with the dialect, after checking the size is one the dashboard offers', () => {
    expect(apiTimeseriesSql(WINDOW, {}, OTHER)).toContain('BUCKET<60>("timestamp") AS t');
    expect(() => apiTimeseriesSql({ ...WINDOW, bucketSeconds: 7 }, {}, OTHER)).toThrow(RangeError);
  });

  it('computes the p95 with the dialect, streams left out of the latency tiles only', () => {
    const totals = apiTotalsSql(PREVIOUS_FROM, WINDOW, {}, OTHER);
    expect(totals).toContain(`PCT<0.95>(CASE WHEN "span_attributes.url.path" LIKE '%/stream' THEN NULL ELSE "duration_nano" END)`);

    const routes = topRoutesSql(WINDOW, {}, undefined, OTHER);
    expect(routes).toContain('PCT<0.95>("duration_nano") AS p95_ns');
  });

  it('normalises routes, reads log attributes, searches and casts with the dialect', () => {
    expect(topRoutesSql(WINDOW, {}, undefined, OTHER)).toContain(`REGEX<`);
    expect(logsTotalsSql(PREVIOUS_FROM, WINDOW, { service: 'a' }, OTHER)).toContain(`JSON<service.name>(resource_attributes) = 'a'`);
    const events = eventsSql(WINDOW, {}, { severities: ['info'], q: '50%_off' }, OTHER);
    expect(events).toContain('CONTAINS<50\\%\\_off>(body)');
    expect(events).toContain('TEXT("timestamp") AS ts');
    expect(events).toContain('FETCH FIRST 51 ROWS ONLY');
  });

  it('reads the metric tables\' columns from the dialect', () => {
    const heap = heapUsedSql(PREVIOUS_FROM, TO, 60, null, OTHER);
    expect(heap).toContain('event_ts AS ts');
    expect(heap).toContain('sum(event_value) AS total');
    expect(heap).toContain(`"event_ts" >= '2026-09-27T20:00:00.000Z'`);
  });
});

describe('the metric catalog\'s series builders', () => {
  const tables = metricTablesOf(metricCatalogSchema());
  const window = { from: PREVIOUS_FROM, to: TO, bucketSeconds: 60 };
  const gauge = METRIC_FAMILIES.find((f) => f.kind === 'gauge')!;
  const counter = METRIC_FAMILIES.find((f) => f.kind === 'counter')!;

  it('buckets gauges and counters with the dialect', () => {
    expect(gaugeSeriesSql(gauge as never, tables.get(gauge.table) ?? null, window, {}, undefined, OTHER)).toContain('BUCKET<60>(ts) AS t');
    expect(counterSeriesSql(counter as never, tables.get(counter.table) ?? null, window, {}, undefined, OTHER)).toContain('BUCKET<60>(ts) AS t');
  });

  it('keeps date_bin by default', () => {
    const info = tables.get(gauge.table) ?? null;

    expect(gaugeSeriesSql(gauge as never, info, window, {})).toContain(`date_bin(INTERVAL '60 seconds', ts) AS t`);
    expect(gaugeSeriesSql(gauge as never, info, window, {})).toBe(
      gaugeSeriesSql(gauge as never, info, window, {}, undefined, GREPTIME_SQL_DIALECT),
    );
  });
});

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TEST_PERMISSIONS_HEADER } from '@marinoscar/platform-api/testing';
import {
  REQUIRED_LOG_COLUMNS,
  REQUIRED_TRACE_COLUMNS,
  TELEMETRY_PERMISSIONS,
  telemetryStoreIds,
  telemetryStoreKind,
} from '@marinoscar/platform-api/telemetry';
import { bootStubApp, describeTelemetryStoreConformance } from '@marinoscar/platform-api/telemetry/testing';

// The reference app's telemetry seam: importing it registers the example store, exactly as the app does.
import '../../../src/app-registrations/telemetry';
import { memoryTelemetryData } from '../../../src/platform-extensions/telemetry/memory-store';
import { runMemorySql } from '../../../src/platform-extensions/telemetry/memory-sql';

// =============================================================================
// An app-registered telemetry store, through the real telemetry module (PP-14.11)
// =============================================================================
//
// `memory` (platform-extensions/telemetry/memory-store.ts) is registered by the
// app's own seam, with no edit under packages/. Here the REAL
// `TelemetryModule.forRoot({ store: 'memory' })` is booted (the package's stub
// host ports stand in for the app's adapters, as in its conformance suite),
// fixture rows are loaded into the store, and:
//
//   - the dashboard summary computes its tiles from them, with the store's own
//     dialect (`bucket_start`, `percentile_of`, `regex_replace_all`, ...);
//   - the explorer runs a query over them, and the platform's guard still refuses
//     a write ABOVE the store;
//   - the status route and the store's admin route see it;
//   - the store passes the conformance kit.
// =============================================================================

const READ = TELEMETRY_PERMISSIONS.READ;
const WRITE = TELEMETRY_PERMISSIONS.WRITE;
const QUERY = TELEMETRY_PERMISSIONS.QUERY;

const NOW = Date.now();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const HOST_ATTRIBUTES = JSON.stringify({ 'service.name': 'my-api', 'app.instance.id': 'inst-1' });

/** Server spans: 8 requests, 2 of them 5xx, one slow, one to a numeric-id route; plus a non-server span. */
function traceRows() {
  const span = (minutes: number, status: number, path: string, durationMs: number, kind = 'SPAN_KIND_SERVER') => ({
    timestamp: minutesAgo(minutes),
    span_kind: kind,
    service_name: 'my-api',
    'span_attributes.http.response.status_code': status,
    'span_attributes.http.request.method': 'GET',
    'span_attributes.url.path': path,
    duration_nano: durationMs * 1_000_000,
    trace_id: `t${minutes}`,
    span_id: `s${minutes}`,
  });

  return [
    span(50, 200, '/api/users', 20),
    span(40, 200, '/api/users/42', 35),
    span(30, 200, '/api/users/43', 30),
    span(20, 404, '/api/missing', 5),
    span(15, 500, '/api/orders', 900),
    span(10, 503, '/api/orders', 400),
    span(5, 200, '/api/notifications/stream', 60_000),
    span(3, 200, '/api/users', 25),
    span(2, 200, '/api/users', 25, 'SPAN_KIND_INTERNAL'),
  ];
}

function logRows() {
  const log = (minutes: number, severity: number, body: string) => ({
    timestamp: minutesAgo(minutes),
    severity_number: severity,
    severity_text: severity >= 17 ? 'error' : severity >= 13 ? 'warn' : 'info',
    body,
    resource_attributes: HOST_ATTRIBUTES,
    trace_id: `t${minutes}`,
    span_id: `l${minutes}`,
  });

  return [
    log(45, 9, 'started'),
    log(25, 13, 'slow query on orders'),
    log(15, 17, 'orders failed: connection reset'),
    log(14, 17, 'orders failed: connection reset'),
    log(8, 17, 'payment gateway timeout'),
  ];
}

function loadFixture(): void {
  memoryTelemetryData.load('opentelemetry_traces', traceRows(), [...REQUIRED_TRACE_COLUMNS]);
  memoryTelemetryData.load('opentelemetry_logs', logRows(), [...REQUIRED_LOG_COLUMNS]);
}

/** The response body; the stub app has no `{ data }` envelope interceptor, a real app does. */
function body(response: { body: string }): any {
  const parsed = JSON.parse(response.body);
  return parsed.data ?? parsed;
}

async function get(app: NestFastifyApplication, url: string, permissions: string) {
  return app.inject({ method: 'GET', url, headers: { [TEST_PERMISSIONS_HEADER]: permissions } });
}

async function send(app: NestFastifyApplication, method: 'POST' | 'PUT', url: string, payload: unknown, permissions: string) {
  return app.inject({ method, url, payload: payload as never, headers: { [TEST_PERMISSIONS_HEADER]: permissions } });
}

describe('the registered store', () => {
  it('is in the registry beside the built-in, without a package edit', () => {
    expect(telemetryStoreIds()).toEqual(expect.arrayContaining(['greptime', 'memory']));
    expect(telemetryStoreKind.get('memory').label).toBe('In-memory (example)');
  });
});

describe('the telemetry slice on the memory store', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    loadFixture();
    app = await bootStubApp({
      store: 'memory',
      ports: { policy: { enabled: true, query: { maxRows: 100, timeoutSeconds: 5 } } },
    });
  });

  afterAll(async () => {
    await app.close();
    memoryTelemetryData.clear();
  });

  it('serves the dashboard summary computed from the rows, through the memory dialect', async () => {
    const response = await get(app, '/admin/telemetry/dashboard/summary?range=1h', QUERY);

    expect(response.statusCode).toBe(200);
    const data = body(response);
    const sql = (data.sql as string[]).join('\n');
    // The statements are spelled by the memory dialect, not GreptimeDB's.
    expect(sql).toContain('bucket_start(');
    expect(sql).toContain('percentile_of(0.95');
    expect(sql).not.toContain('date_bin');
    expect(sql).not.toContain('approx_percentile_cont');

    const tile = (key: string) => data.tiles.find((t: { key: string }) => t.key === key);
    // 8 server spans in the hour; 2 are 5xx (the INTERNAL span does not count).
    expect(tile('requestsPerMin').value).toBeGreaterThan(0);
    expect(tile('errorRatePct').value).toBe(25);
    expect(tile('errorLogs').value).toBe(3);
    expect(tile('warnLogs').value).toBe(1);
    // The slow stream route is left out of p95: the next-slowest request is 900 ms.
    expect(tile('p95Ms').value).toBe(900);
    expect(typeof tile('lastDataAt').value).toBe('string');
  });

  it('serves top routes with numeric ids normalised by the store', async () => {
    const response = await get(app, '/admin/telemetry/dashboard/top?kind=routes', QUERY);

    expect(response.statusCode).toBe(200);
    const data = body(response);
    const routes = (data.items as Array<{ route: string; requests: number; errors: number }>).map((r) => r.route);
    expect(routes).toContain('/api/users/:id');
    expect(routes).toContain('/api/orders');
    const orders = data.items.find((r: { route: string }) => r.route === '/api/orders');
    expect(orders.errors).toBe(2);
  });

  it('serves the filters (distinct services) and the events feed', async () => {
    const filters = body(await get(app, '/admin/telemetry/dashboard/filters', QUERY));
    expect(filters.services).toEqual(['my-api']);

    const events = await get(app, '/admin/telemetry/dashboard/events?severity=error&q=orders', QUERY);
    expect(events.statusCode).toBe(200);
    const items = body(events).items as Array<{ body: string; service: string }>;
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.body.includes('orders') && item.service === 'my-api')).toBe(true);
  });

  it('runs an explorer query over the rows', async () => {
    const response = await send(
      app,
      'POST',
      '/admin/telemetry/query',
      { sql: 'SELECT service_name, count(*) AS n FROM opentelemetry_traces GROUP BY service_name ORDER BY n DESC' },
      QUERY,
    );

    expect(response.statusCode).toBe(200);
    const data = body(response);
    expect(data.columns.map((c: { name: string }) => c.name)).toEqual(['service_name', 'n']);
    expect(data.rows).toEqual([['my-api', 9]]);
    expect(data.truncated).toBe(false);
  });

  it('keeps the explorer guard above the store: a write never reaches it', async () => {
    const response = await send(app, 'POST', '/admin/telemetry/query', { sql: 'DROP TABLE opentelemetry_logs' }, QUERY);

    expect(response.statusCode).toBe(400);
    expect(memoryTelemetryData.get('opentelemetry_logs')?.rows).toHaveLength(5);
  });

  it('answers a store error from the explorer as a failed query, not a 500', async () => {
    const response = await send(app, 'POST', '/admin/telemetry/query', { sql: 'SELECT nope FROM opentelemetry_logs' }, QUERY);

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(JSON.parse(response.body).message).toContain('does not exist');
  });

  it('lists the tables through the store schema', async () => {
    const response = await get(app, '/admin/telemetry/schema', QUERY);

    expect(response.statusCode).toBe(200);
    const names = body(response).tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(['opentelemetry_logs', 'opentelemetry_traces']);
  });

  it('reports the store on the status and config routes', async () => {
    const status = body(await get(app, '/admin/telemetry/status', READ));
    expect(status).toMatchObject({
      configured: true,
      reachable: true,
      version: 'in-memory telemetry store 1.0',
      database: 'memory',
      ttl: null,
    });
    expect(status.tables.map((t: { name: string }) => t.name)).toEqual(['opentelemetry_logs', 'opentelemetry_traces']);

    const config = body(await get(app, '/admin/telemetry/config', READ));
    expect(config.store).toEqual({ id: 'memory', label: 'In-memory (example)' });
    expect(config.available).toBe(true);
    // The store has no retention control, so retention cannot be applied.
    expect(config.retentionApplicable).toBe(false);
  });

  describe('its settings, through the generated-form route', () => {
    it('describes the form (settings, no secrets) and the registered stores', async () => {
      const response = await get(app, '/admin/telemetry/store', READ);

      expect(response.statusCode).toBe(200);
      const data = body(response);
      expect(data.active).toMatchObject({ id: 'memory', label: 'In-memory (example)' });
      expect(data.stores.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['greptime', 'memory']));
      expect(data.descriptor.fields.map((f: { name: string }) => f.name)).toEqual(['enabled', 'database', 'latencyMs']);
      expect(data.descriptor.fields.some((f: { kind: string }) => f.kind === 'secret')).toBe(false);
      expect(data.settings).toEqual({ enabled: true, database: 'memory', latencyMs: 0 });
      expect(data.ready).toBe(true);
    });

    it('refuses a save that does not parse, and a secret the store does not declare', async () => {
      const bad = await send(app, 'PUT', '/admin/telemetry/store', { settings: { latencyMs: -5 } }, WRITE);
      expect(bad.statusCode).toBe(400);
      expect(JSON.parse(bad.body).message).toContain('latencyMs');

      const undeclared = await send(app, 'PUT', '/admin/telemetry/store', { secrets: { apiKey: 'x' } }, WRITE);
      expect(undeclared.statusCode).toBe(400);
    });

    it('needs telemetry:write to save, and applies a save to the running store', async () => {
      const denied = await send(app, 'PUT', '/admin/telemetry/store', { settings: { database: 'renamed' } }, READ);
      expect(denied.statusCode).toBe(403);

      const saved = await send(app, 'PUT', '/admin/telemetry/store', { settings: { database: 'renamed' } }, WRITE);
      expect(saved.statusCode).toBe(200);
      expect(body(saved).settings.database).toBe('renamed');

      const status = body(await get(app, '/admin/telemetry/status', READ));
      expect(status.database).toBe('renamed');

      await send(app, 'PUT', '/admin/telemetry/store', { settings: { database: 'memory' } }, WRITE);
    });

    it('switches the store off from its settings, and the explorer answers 503', async () => {
      await send(app, 'PUT', '/admin/telemetry/store', { settings: { enabled: false } }, WRITE);

      const response = await send(app, 'POST', '/admin/telemetry/query', { sql: 'SELECT 1' }, QUERY);
      expect(response.statusCode).toBe(503);

      await send(app, 'PUT', '/admin/telemetry/store', { settings: { enabled: true } }, WRITE);
    });
  });
});

describe('the SQL subset of the store', () => {
  const tables = {
    get: (name: string) => memoryTelemetryData.get(name),
  };

  beforeAll(loadFixture);
  afterAll(() => memoryTelemetryData.clear());

  it('groups, orders and limits', () => {
    const result = runMemorySql(
      `SELECT "span_attributes.url.path" AS path, count(*) AS n FROM "opentelemetry_traces" ` +
        `WHERE "span_kind" = 'SPAN_KIND_SERVER' GROUP BY path ORDER BY n DESC, path LIMIT 2`,
      tables,
    );

    expect(result.fields.map((f) => f.name)).toEqual(['path', 'n']);
    expect(result.rows).toEqual([
      ['/api/orders', 2],
      ['/api/users', 2],
    ]);
  });

  it('unions distinct values and applies the ORDER BY and LIMIT to the union', () => {
    const result = runMemorySql(
      `SELECT service_name AS v FROM opentelemetry_traces UNION SELECT json_text(resource_attributes, 'service.name') AS v FROM opentelemetry_logs ORDER BY v LIMIT 5`,
      tables,
    );

    expect(result.rows).toEqual([['my-api']]);
  });

  it('refuses anything that is not one SELECT', () => {
    expect(() => runMemorySql("INSERT INTO opentelemetry_logs (body) VALUES ('x')", tables)).toThrow(/only SELECT/);
    expect(() => runMemorySql('SELECT 1; SELECT 2', tables)).toThrow(/Exactly one SQL statement/);
    expect(() => runMemorySql('SELECT 1 FROM nope', tables)).toThrow(/does not exist/);
  });

  it('treats NULL as unknown and sorts it last', () => {
    memoryTelemetryData.load('t', [{ a: 1 }, { a: null }, { a: 3 }]);

    expect(runMemorySql('SELECT a FROM t WHERE a > 0 ORDER BY a', tables).rows).toEqual([[1], [3]]);
    expect(runMemorySql('SELECT a FROM t ORDER BY a', tables).rows).toEqual([[1], [3], [null]]);
    expect(runMemorySql('SELECT count(*) AS n, count(a) AS c, sum(a) AS s FROM t', tables).rows).toEqual([[3, 2, 4]]);
  });
});

// The kit, on the registered store. `fixture` lets it run every dashboard statement over the dataset.
describeTelemetryStoreConformance('memory', {
  describe,
  it,
  expect,
  settings: {},
  writeStatements: ["INSERT INTO opentelemetry_logs (body) VALUES ('x')", 'DELETE FROM opentelemetry_logs', 'DROP TABLE opentelemetry_logs'],
  timeout: { statement: 'SELECT 1', timeoutMs: 20, settings: { latencyMs: 500 } },
  unconfigured: { settings: { enabled: false } },
  fixture: {
    prepare: () => loadFixture(),
    from: new Date(NOW - 60 * 60_000),
    to: new Date(NOW + 60_000),
  },
});

// The telemetry contract (issue #702): the limits and enums the API enforces
// and the web app offers, the settings namespace's parse and reject cases
// (moved from the API's telemetry-config.dto.spec.ts, which keeps its copy for
// the DTO wrapper), the dashboard window rules, the metric-group schema
// builders and the two no-secret proofs.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  DASHBOARD_BUCKET_COUNTS,
  DASHBOARD_EVENT_SEVERITIES,
  DASHBOARD_PANELS,
  DASHBOARD_RANGE_MS,
  DASHBOARD_RANGES,
  DASHBOARD_TOP_KINDS,
  DEFAULT_DASHBOARD_RANGE,
  METRIC_UNITS,
  PLATFORM_METRIC_GROUPS,
  TELEMETRY_ASSISTANT_CONFIDENCES,
  TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX,
  TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS,
  TELEMETRY_ASSISTANT_QUESTION_MAX,
  TELEMETRY_ASSISTANT_REPORT_STATUSES,
  TELEMETRY_ASSISTANT_SEVERITIES,
  TELEMETRY_ASSISTANT_TOOLS,
  TELEMETRY_CONNECTION_CARRIES_NO_SECRET,
  TELEMETRY_CONNECTION_DEFAULTS,
  TELEMETRY_CONNECTION_SOURCES,
  TELEMETRY_EXPORT_FORMATS,
  TELEMETRY_INSTANCE_ID_PATTERN,
  TELEMETRY_LIMITS,
  TELEMETRY_QUERY_MAX_ROWS_CEILING,
  TELEMETRY_SETTINGS_CARRIES_NO_SECRET,
  TELEMETRY_SQL_MAX_LENGTH,
  TELEMETRY_STACK_AGENT_STATES,
  TELEMETRY_STACK_SERVICE_HEALTH,
  TELEMETRY_STACK_SERVICE_STATES,
  VERDICT_LEVELS,
  createTelemetryDashboardMetricsQuerySchema,
  createTelemetryDashboardMetricsSchema,
  metricGroupQuerySchema,
  telemetryAssistantRequestSchema,
  telemetryConfigResponseSchema,
  telemetryConnectionValueSchema,
  telemetryDashboardEventsQuerySchema,
  telemetryDashboardMetricsQuerySchema,
  telemetryDashboardQuerySchema,
  telemetryExportRequestSchema,
  telemetryQueryRequestSchema,
  telemetrySettingsSchema,
  updateTelemetryConfigSchema,
  updateTelemetryConnectionSchema,
  type TelemetryConnectionCarriesNoSecret,
  type TelemetrySettings,
  type TelemetrySettingsCarriesNoSecret,
} from '../src/telemetry/index.js';

// The API's DEFAULT_SYSTEM_SETTINGS.telemetry.
const BODY: TelemetrySettings = {
  enabled: false,
  retentionDays: 30,
  instanceId: null,
  query: { maxRows: 10000, timeoutSeconds: 30 },
  assistant: {
    enabled: false,
    provider: null,
    modelId: null,
    shareResults: true,
    maxResultRowsToModel: 50,
    maxSteps: 15,
  },
};

describe('telemetry constants', () => {
  it('pins the settings limits', () => {
    expect(TELEMETRY_LIMITS).toEqual({
      retentionDays: { min: 1, max: 3650 },
      maxRows: { min: 1, max: 100000 },
      timeoutSeconds: { min: 1, max: 120 },
      maxResultRowsToModel: { min: 1, max: 100 },
      maxSteps: { min: 1, max: 20 },
    });
  });

  it('builds the settings schema from the limits', () => {
    const at = (path: (body: TelemetrySettings, value: number) => void, value: number) => {
      const body = structuredClone(BODY);
      path(body, value);
      return telemetrySettingsSchema.safeParse(body).success;
    };
    const fields: Array<[keyof typeof TELEMETRY_LIMITS, (body: TelemetrySettings, value: number) => void]> = [
      ['retentionDays', (b, v) => (b.retentionDays = v)],
      ['maxRows', (b, v) => (b.query.maxRows = v)],
      ['timeoutSeconds', (b, v) => (b.query.timeoutSeconds = v)],
      ['maxResultRowsToModel', (b, v) => (b.assistant.maxResultRowsToModel = v)],
      ['maxSteps', (b, v) => (b.assistant.maxSteps = v)],
    ];
    for (const [name, set] of fields) {
      const { min, max } = TELEMETRY_LIMITS[name];
      expect([at(set, min), at(set, max), at(set, min - 1), at(set, max + 1)], name).toEqual([true, true, false, false]);
    }
  });

  it('pins the explorer, connection and dashboard limits', () => {
    expect(TELEMETRY_SQL_MAX_LENGTH).toBe(20_000);
    expect(TELEMETRY_QUERY_MAX_ROWS_CEILING).toBe(100_000);
    expect(TELEMETRY_CONNECTION_DEFAULTS).toEqual({ pgPort: 4003, database: 'public' });
    expect(TELEMETRY_ASSISTANT_QUESTION_MAX).toBe(4_000);
    expect(TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS).toBe(20);
    expect(TELEMETRY_ASSISTANT_HISTORY_CONTENT_MAX).toBe(8_000);
    expect(DEFAULT_DASHBOARD_RANGE).toBe('1h');
    expect(DASHBOARD_RANGE_MS).toEqual({
      '15m': 900_000,
      '1h': 3_600_000,
      '6h': 21_600_000,
      '24h': 86_400_000,
      '7d': 604_800_000,
    });
  });

  it('pins every enum, in wire order', () => {
    expect(TELEMETRY_EXPORT_FORMATS).toEqual(['csv', 'ndjson', 'xlsx', 'parquet']);
    expect(TELEMETRY_CONNECTION_SOURCES).toEqual(['stored', 'environment', 'none']);
    expect(TELEMETRY_STACK_AGENT_STATES).toEqual(['available', 'unavailable', 'unauthorized', 'not_configured']);
    expect(TELEMETRY_STACK_SERVICE_STATES).toEqual(['running', 'restarting', 'exited', 'created', 'paused', 'dead', 'missing']);
    expect(TELEMETRY_STACK_SERVICE_HEALTH).toEqual(['healthy', 'unhealthy', 'starting']);
    expect(DASHBOARD_RANGES).toEqual(['15m', '1h', '6h', '24h', '7d']);
    expect(DASHBOARD_BUCKET_COUNTS).toEqual(['30', '60']);
    expect(DASHBOARD_PANELS).toEqual(['api', 'logs']);
    expect(DASHBOARD_TOP_KINDS).toEqual(['routes', 'errors']);
    expect(DASHBOARD_EVENT_SEVERITIES).toEqual(['error', 'warn', 'info']);
    expect(VERDICT_LEVELS).toEqual(['healthy', 'degraded', 'critical', 'no_data']);
    expect(PLATFORM_METRIC_GROUPS).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline']);
    expect(METRIC_UNITS).toEqual([
      '%', 'bytes', 'bytes/s', 'count', 'per_s', 'per_min', 'ms', 'seconds', 'hours', 'days', 'cores', 'load',
      'timestamp', 'text', 'boolean',
    ]);
    expect(TELEMETRY_ASSISTANT_TOOLS).toEqual([
      'list_tables', 'describe_table', 'run_query', 'get_app_context', 'health_overview', 'get_trace',
      'metrics_overview', 'compare_nodes',
    ]);
    expect(TELEMETRY_ASSISTANT_REPORT_STATUSES).toEqual(['issue_found', 'no_issue_found', 'inconclusive', 'no_data']);
    expect(TELEMETRY_ASSISTANT_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'info']);
    expect(TELEMETRY_ASSISTANT_CONFIDENCES).toEqual(['high', 'medium', 'low']);
  });

  it('carries the no-secret proofs of the settings namespace and the stored connection', () => {
    expect(TELEMETRY_SETTINGS_CARRIES_NO_SECRET).toBe(true);
    expect(TELEMETRY_CONNECTION_CARRIES_NO_SECRET).toBe(true);
    expectTypeOf<TelemetrySettingsCarriesNoSecret>().toEqualTypeOf<true>();
    expectTypeOf<TelemetryConnectionCarriesNoSecret>().toEqualTypeOf<true>();
  });
});

describe('updateTelemetryConfigSchema (PUT /api/admin/telemetry/config)', () => {
  it.each(['prod-eu', 'my-app', 'a', 'x.y_z-1', 'a'.repeat(63)])('accepts the instanceId %p', (instanceId) => {
    expect(updateTelemetryConfigSchema.parse({ ...BODY, instanceId })).toMatchObject({ instanceId });
    expect(TELEMETRY_INSTANCE_ID_PATTERN.test(instanceId)).toBe(true);
  });

  it('accepts null (back to the APP_SLUG default)', () => {
    expect(updateTelemetryConfigSchema.parse({ ...BODY, instanceId: null })).toMatchObject({ instanceId: null });
  });

  it('accepts a body without instanceId (a client that predates the field), leaving it absent', () => {
    const { instanceId: _omitted, ...withoutInstanceId } = BODY;
    expect(updateTelemetryConfigSchema.parse(withoutInstanceId)).not.toHaveProperty('instanceId');
  });

  it.each(['', 'Prod', '-prod', '.prod', 'has space', 'prod/eu', 'ünïcode', 'a'.repeat(64), 42])(
    'rejects the instanceId %p',
    (instanceId) => {
      expect(updateTelemetryConfigSchema.safeParse({ ...BODY, instanceId }).success).toBe(false);
    },
  );

  it('still requires every other field (full replace)', () => {
    const { enabled: _omitted, ...withoutEnabled } = BODY;
    expect(updateTelemetryConfigSchema.safeParse(withoutEnabled).success).toBe(false);
  });

  it('keeps instanceId required (nullable) in the stored namespace', () => {
    const { instanceId: _omitted, ...withoutInstanceId } = BODY;
    expect(telemetrySettingsSchema.safeParse(withoutInstanceId).success).toBe(false);
  });
});

describe('telemetryConfigResponseSchema', () => {
  it('carries instanceIdDefault and instanceIdEffective as strings', () => {
    const response = {
      ...BODY,
      available: true,
      retentionApplicable: true,
      instanceIdDefault: 'my-app',
      instanceIdEffective: 'my-app',
      version: 1,
      updatedAt: null,
      updatedBy: null,
    };
    expect(telemetryConfigResponseSchema.parse(response)).toEqual(response);
    expect(telemetryConfigResponseSchema.safeParse({ ...response, instanceIdEffective: undefined }).success).toBe(false);
  });
});

describe('explorer and assistant requests', () => {
  it('bounds the SQL text and the row cap', () => {
    expect(telemetryQueryRequestSchema.safeParse({ sql: 'SELECT 1' }).success).toBe(true);
    expect(telemetryQueryRequestSchema.safeParse({ sql: '' }).success).toBe(false);
    expect(telemetryQueryRequestSchema.safeParse({ sql: 'x'.repeat(TELEMETRY_SQL_MAX_LENGTH + 1) }).success).toBe(false);
    expect(telemetryQueryRequestSchema.safeParse({ sql: 'SELECT 1', maxRows: TELEMETRY_QUERY_MAX_ROWS_CEILING + 1 }).success).toBe(false);
    expect(telemetryExportRequestSchema.safeParse({ sql: 'SELECT 1', format: 'xlsx' }).success).toBe(true);
    expect(telemetryExportRequestSchema.safeParse({ sql: 'SELECT 1', format: 'pdf' }).success).toBe(false);
  });

  it('trims the question and bounds the history', () => {
    expect(telemetryAssistantRequestSchema.parse({ question: '  why?  ' })).toEqual({ question: 'why?' });
    expect(telemetryAssistantRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    const turns = Array.from({ length: TELEMETRY_ASSISTANT_HISTORY_MAX_TURNS + 1 }, () => ({ role: 'user', content: 'q' }));
    expect(telemetryAssistantRequestSchema.safeParse({ question: 'q', history: turns }).success).toBe(false);
  });
});

describe('connection', () => {
  it('normalizes an automatic host and applies the defaults', () => {
    expect(updateTelemetryConnectionSchema.parse({ host: '  ' })).toEqual({
      host: null,
      pgPort: 4003,
      database: 'public',
      readerUser: undefined,
      adminUser: undefined,
    });
  });

  it('requires the logins for a custom host', () => {
    const result = updateTelemetryConnectionSchema.safeParse({ host: 'greptime.internal' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual(['adminUser', 'readerUser']);
    expect(
      updateTelemetryConnectionSchema.parse({ host: 'greptime.internal', readerUser: 'reader', adminUser: '' }),
    ).toMatchObject({ host: 'greptime.internal', readerUser: 'reader', adminUser: null });
  });

  it('refuses a host with a scheme or a port, and a non-identifier database', () => {
    expect(updateTelemetryConnectionSchema.safeParse({ host: 'http://x', readerUser: 'r', adminUser: null }).success).toBe(false);
    expect(updateTelemetryConnectionSchema.safeParse({ host: 'x:4003', readerUser: 'r', adminUser: null }).success).toBe(false);
    expect(
      updateTelemetryConnectionSchema.safeParse({ host: '10.0.0.5', readerUser: 'r', adminUser: null, database: '1db' }).success,
    ).toBe(false);
  });

  it('strips the extra keys of an older automatic row', () => {
    expect(telemetryConnectionValueSchema.parse({ host: null, pgPort: 4003, readerUser: 'r' })).toEqual({ host: null });
  });
});

describe('dashboard queries', () => {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it('takes range or from+to, never both, never half a pair', () => {
    expect(telemetryDashboardQuerySchema.safeParse({ range: '6h' }).success).toBe(true);
    expect(telemetryDashboardQuerySchema.safeParse({ from: iso(-60_000), to: iso(0) }).success).toBe(true);
    expect(telemetryDashboardQuerySchema.safeParse({ range: '6h', from: iso(-60_000), to: iso(0) }).success).toBe(false);
    expect(telemetryDashboardQuerySchema.safeParse({ from: iso(-60_000) }).success).toBe(false);
    expect(telemetryDashboardQuerySchema.safeParse({ range: '2h' }).success).toBe(false);
  });

  it('bounds the window: from < to, to at most 1 minute ahead, at most 30 days', () => {
    expect(telemetryDashboardQuerySchema.safeParse({ from: iso(0), to: iso(-60_000) }).success).toBe(false);
    expect(telemetryDashboardQuerySchema.safeParse({ from: iso(-60_000), to: iso(5 * 60_000) }).success).toBe(false);
    expect(telemetryDashboardQuerySchema.safeParse({ from: iso(-31 * 86_400_000), to: iso(0) }).success).toBe(false);
  });

  it('takes a comma list of severities', () => {
    expect(telemetryDashboardEventsQuerySchema.safeParse({ severity: 'error,warn' }).success).toBe(true);
    expect(telemetryDashboardEventsQuerySchema.safeParse({ severity: 'error,debug' }).success).toBe(false);
    expect(telemetryDashboardEventsQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('types /metrics group as an open id by default', () => {
    expect(telemetryDashboardMetricsQuerySchema.safeParse({ group: 'coach' }).success).toBe(true);
    expect(telemetryDashboardMetricsQuerySchema.safeParse({ group: 'Not An Id' }).success).toBe(false);
  });

  it('builds a server-side group schema: checked live, documented as an enum', () => {
    const registered = new Set<string>(['host', 'database']);
    const group = metricGroupQuerySchema({
      documented: ['host', 'database'] as const,
      isKnown: (id: unknown): id is 'host' | 'database' => typeof id === 'string' && registered.has(id),
      knownIds: () => [...registered],
    });
    const query = createTelemetryDashboardMetricsQuerySchema(group);
    expect(query.parse({ group: 'host' })).toEqual({ group: 'host' });
    const refused = query.safeParse({ group: 'queue' });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe('Invalid option: expected one of "host"|"database"');
    registered.add('queue');
    expect(query.safeParse({ group: 'queue' }).success).toBe(true);

    const json = z.toJSONSchema(query, { io: 'input' }) as { properties: Record<string, { enum?: string[]; description?: string }> };
    expect(json.properties.group).toMatchObject({ enum: ['host', 'database'], description: 'The metric group: `host` or `database`.' });

    const response = createTelemetryDashboardMetricsSchema(z.enum(['host', 'database']));
    expect(response.shape.group.options).toEqual(['host', 'database']);
  });
});

import request from 'supertest';

import {
  GreptimeClient,
  REQUIRED_LOG_COLUMNS,
  REQUIRED_TRACE_COLUMNS,
  TelemetrySchemaService,
  TelemetrySettingsService,
} from '@marinoscar/platform-api/telemetry';
import { APP_ACTIVITY_METRIC_TAGS, appActivityMetricSchema } from '@marinoscar/platform-api/telemetry/testing';

import type { SystemTelemetryValue } from '../../src/common/schemas/settings.schema';
import { PLATFORM_APP_METRICS } from '@marinoscar/platform-api/host';
import { ACTIVITY_METRIC_GROUP } from '../../src/platform-extensions/telemetry/activity.metric-group';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

// =============================================================================
// The reference app's "App activity" metric group, through the real HTTP stack
// (PP-4.6)
// =============================================================================
//
// `ACTIVITY_METRIC_GROUP` is registered by `TelemetryModule.forRoot({
// metricGroups })` in `platform/telemetry/telemetry.config.ts`, with no web and
// no collector change. Through the REAL `AppModule`:
//
//   - `/metric-groups` lists it after the six platform groups;
//   - `/metrics?group=activity` is `available: false` with every family in
//     `skipped` while its tables do not exist (a fresh stack);
//   - with the tables present it renders a tile per family, sums a counter's
//     increases over the window and splits series by the declared `groupBy`;
//   - every table it reads is one the API's metrics declare
//     (`APP_METRIC_NAMES`, named by the spec's table rule), so the group never
//     reads a table nothing writes.
//
// No network: GreptimeDB, the policy and the schema are stubbed on the real
// providers, as in telemetry-dashboard.integration.spec.ts.
// =============================================================================

const BASE = '/api/admin/telemetry/dashboard';

const POLICY: SystemTelemetryValue = {
  enabled: true,
  retentionDays: 7,
  instanceId: null,
  query: { maxRows: 1000, timeoutSeconds: 15 },
  assistant: { enabled: false, provider: null, modelId: null, shareResults: false, maxResultRowsToModel: 20, maxSteps: 6 },
} as unknown as SystemTelemetryValue;

const BASE_SCHEMA = [
  { name: 'opentelemetry_traces', rows: null, columns: REQUIRED_TRACE_COLUMNS.map((name) => ({ name, type: 'string', semanticType: null })) },
  { name: 'opentelemetry_logs', rows: null, columns: REQUIRED_LOG_COLUMNS.map((name) => ({ name, type: 'string', semanticType: null })) },
];

/** A store instant as the reader returns it: UTC text, no zone. */
function storeInstant(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '').padEnd(26, '0');
}

/** The statement's rows, shaped `(t, g, v)` like every counter series. */
function series(rows: Array<[string, string, number]>) {
  return { fields: ['t', 'g', 'v'].map((name) => ({ name, dataTypeID: 25 })), rows };
}

async function boot(tables: ReturnType<typeof appActivityMetricSchema>['tables'], answer: (sql: string) => ReturnType<typeof series> | undefined) {
  const context = await createTestApp({ useMockDatabase: true } as never);
  const greptime = context.module.get(GreptimeClient);
  jest.spyOn(greptime, 'isConfigured').mockReturnValue(true);
  jest.spyOn(context.module.get(TelemetrySettingsService), 'getPolicy').mockResolvedValue(POLICY);
  jest.spyOn(context.module.get(TelemetrySchemaService), 'getSchema').mockResolvedValue({ tables: [...BASE_SCHEMA, ...tables] });
  jest.spyOn(greptime, 'queryReader').mockImplementation(async (sql: string) => answer(sql) ?? { fields: [], rows: [] });
  return context;
}

function prepare(context: TestContext) {
  resetPrismaMock();
  setupBaseMocks();
  context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
}

describe('the reference app group "activity" (a fresh stack: its tables do not exist yet)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await boot([], () => undefined);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await closeTestApp(context);
  });
  beforeEach(() => prepare(context));

  it('is listed by /metric-groups after the six platform groups', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/metric-groups`).set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data.map((g: { id: string }) => g.id)).toEqual(['host', 'database', 'queue', 'nodes', 'uptime', 'pipeline', 'activity']);
    expect(res.body.data.at(-1)).toEqual({ id: 'activity', label: 'App activity', title: 'App activity', order: 70 });
  });

  it('answers /metrics?group=activity as unavailable, every family skipped', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/metrics?group=activity`).set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data).toMatchObject({
      group: 'activity',
      available: false,
      tiles: [],
      skipped: ACTIVITY_METRIC_GROUP.families.map((family) => family.key),
    });
  });
});

describe('the reference app group "activity" (sign-ins and tokens flowing)', () => {
  let context: TestContext;
  // Five minutes ago, on a minute boundary: the store bins by `date_bin`, so a point is always bucket-aligned.
  const RECENT = storeInstant(new Date(Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000));

  beforeAll(async () => {
    context = await boot(appActivityMetricSchema().tables, (sql) => {
      if (sql.includes('FROM "app_auth_logins_total"')) {
        return series([
          [RECENT, 'success', 7],
          [RECENT, 'allowlist_rejected', 2],
        ]);
      }
      if (sql.includes('FROM "app_ai_tokens_total"')) {
        return series([
          [RECENT, 'input', 1200],
          [RECENT, 'output', 300],
        ]);
      }
      return undefined;
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await closeTestApp(context);
  });
  beforeEach(() => prepare(context));

  it('renders non-null tiles for the families with data and splits the series by their groupBy', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/metrics?group=activity`).set(authHeader(admin.accessToken)).expect(200);
    const data = res.body.data;
    const tile = (key: string) => data.tiles.find((t: { key: string }) => t.key === key);

    expect(data.available).toBe(true);
    expect(data.skipped).toEqual([]);
    expect(tile('authLogins')).toMatchObject({ value: 9, unit: 'count' });
    expect(tile('aiTokens')).toMatchObject({ value: 1500, unit: 'count' });
    expect(
      data.series
        .filter((s: { key: string }) => s.key === 'authLogins')
        .map((s: { groupBy: string }) => s.groupBy)
        .sort(),
    ).toEqual(['allowlist_rejected', 'success']);
  });
});

describe('every table the activity group reads is one the API writes', () => {
  it('names a counter declared in platform-app-metrics.ts, by the spec\'s table rule', () => {
    const tables = new Set(
      PLATFORM_APP_METRICS.filter((def) => def.kind === 'counter').map((def) => `${def.name.replace(/\./g, '_')}_total`),
    );

    for (const family of ACTIVITY_METRIC_GROUP.families) {
      expect(tables.has(family.table)).toBe(true);
      expect(Object.keys(APP_ACTIVITY_METRIC_TAGS)).toContain(family.table);
      for (const column of family.requiredColumns) expect(APP_ACTIVITY_METRIC_TAGS[family.table]).toContain(column);
    }
  });
});

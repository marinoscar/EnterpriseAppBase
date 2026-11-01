import { Injectable, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import {
  DEFAULT_VERDICT_THRESHOLDS,
  DefaultVerdictPolicy,
  GreptimeClient,
  METRIC_FRESH_MS,
  MetricGroupRegistry,
  REQUIRED_LOG_COLUMNS,
  REQUIRED_TRACE_COLUMNS,
  TELEMETRY_METRIC_FRESH_MS,
  TELEMETRY_VERDICT_THRESHOLDS,
  TelemetrySchemaService,
  TelemetrySettingsService,
  VERDICT_POLICY,
  metricGroupRegistry,
  registerMetricGroup,
  resolveMetricFreshMs,
  resolveVerdictThresholds,
  type DashboardVerdict,
  type MetricGroup,
  type MetricGroupDef,
  type TelemetryAiToolDefinition,
  type VerdictInput,
} from '@marinoscar/platform-api/telemetry';
import { COACH_METRIC_GROUP, COACH_METRIC_GROUP_ID } from '@marinoscar/platform-api/telemetry/testing';

import type { SystemTelemetryValue } from '../../src/common/schemas/settings.schema';
import { telemetryControllers, telemetryProviders } from '../../src/platform/telemetry/telemetry.config';
import { ActivityVerdictPolicy, ACTIVITY_QUIET_REASON } from '../../src/platform-extensions/telemetry/examples/activity-verdict-policy';
import { REFERENCE_VERDICT_THRESHOLDS } from '../../src/platform-extensions/telemetry/reference-verdict-thresholds';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

// =============================================================================
// The telemetry slice's extension points, through the real HTTP stack (#703)
// =============================================================================
//
// The app's binding (`platform/telemetry/telemetry.config.ts`) passes
// `APP_METRIC_GROUPS` to `TelemetryModule.forRoot({ metricGroups })`; here it
// holds a seventh, coach-shaped group. Through the REAL `AppModule`:
//
//   rung 2  the group is served by `/metrics?group=coach`, listed by
//           `/metric-groups`, accepted by the assistant's `metrics_overview`
//           tool, and documented in the route's `group` enum;
//   rung 3  overriding `VERDICT_POLICY` changes `/summary`'s verdict;
//   rung 1  overriding the resolved thresholds (`noDataMinutes`) changes both
//           `/summary`'s verdict and `TelemetryFreshnessDoctorCheck`; the
//           metrics freshness window (`forRoot({ metrics: { freshMs } })`,
//           resolved into `TELEMETRY_METRIC_FRESH_MS`) is what `/metrics`
//           reports as `freshMs`.
//
// No network: GreptimeDB, the policy and the schema are stubbed on the real
// providers, as in telemetry-dashboard.integration.spec.ts.
// =============================================================================

jest.mock('../../src/app-registrations/telemetry', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { COACH_METRIC_GROUP: group } = require('@marinoscar/platform-api/telemetry/testing');
  return { APP_METRIC_GROUPS: [group], APP_METRICS: [] };
});

const BASE = '/api/admin/telemetry/dashboard';

const POLICY: SystemTelemetryValue = {
  enabled: true,
  retentionDays: 7,
  instanceId: null,
  query: { maxRows: 1000, timeoutSeconds: 15 },
  assistant: {
    enabled: true,
    provider: 'openai',
    modelId: 'test-model',
    shareResults: true,
    maxResultRowsToModel: 20,
    maxSteps: 6,
  },
};

/** Telemetry last arrived ten minutes ago: `no_data` under the default five-minute rule. */
const TEN_MINUTES_AGO = () => new Date(Date.now() - 10 * 60_000).toISOString();

async function boot(overrideProviders: Array<{ provide: unknown; useValue: unknown }> = []) {
  const context = await createTestApp({ useMockDatabase: true, overrideProviders } as never);
  const greptime = context.module.get(GreptimeClient);
  jest.spyOn(greptime, 'isConfigured').mockReturnValue(true);
  jest.spyOn(context.module.get(TelemetrySettingsService), 'getPolicy').mockResolvedValue(POLICY);
  jest.spyOn(context.module.get(TelemetrySchemaService), 'getSchema').mockResolvedValue({
    tables: [
      { name: 'opentelemetry_traces', rows: null, columns: REQUIRED_TRACE_COLUMNS.map((name) => ({ name, type: 'string', semanticType: null })) },
      { name: 'opentelemetry_logs', rows: null, columns: REQUIRED_LOG_COLUMNS.map((name) => ({ name, type: 'string', semanticType: null })) },
    ],
  });
  jest.spyOn(greptime, 'queryReader').mockImplementation(async (sql: string) =>
    sql.includes('AS traces_last')
      ? { fields: [{ name: 'traces_last', dataTypeID: 25 }, { name: 'logs_last', dataTypeID: 25 }], rows: [[TEN_MINUTES_AGO(), TEN_MINUTES_AGO()]] }
      : { fields: [], rows: [] },
  );
  return context;
}

function prepare(context: TestContext) {
  resetPrismaMock();
  setupBaseMocks();
  context.prismaMock.auditEvent.create.mockResolvedValue({} as never);
}

describe('Telemetry extension points (rung 2: a seventh metric group)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await boot();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await closeTestApp(context);
  });
  beforeEach(() => prepare(context));

  it('serves the group at /metrics?group=coach (skipped cleanly: its tables do not exist yet)', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer())
      .get(`${BASE}/metrics?group=coach`)
      .set(authHeader(admin.accessToken))
      .expect(200);

    expect(res.body.data).toMatchObject({ group: 'coach', available: false });
    // Every family and ratio of the coach-shaped fixture, in declaration order.
    expect(res.body.data.skipped).toEqual([
      ...COACH_METRIC_GROUP.families.map((family) => family.key),
      ...(COACH_METRIC_GROUP.ratios ?? []).map((ratio) => ratio.key),
    ]);
  });

  it('still refuses an unknown group with the same 400', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer())
      .get(`${BASE}/metrics?group=nope`)
      .set(authHeader(admin.accessToken))
      .expect(400);

    expect(res.body.details.issues[0]).toMatchObject({ path: 'group' });
    expect(res.body.details.issues[0].message).toContain('"coach"');
  });

  it('lists the group in /metric-groups, after the six platform groups and the reference app group `activity`', async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer())
      .get(`${BASE}/metric-groups`)
      .set(authHeader(admin.accessToken))
      .expect(200);

    expect(res.body.data.map((g: { id: string }) => g.id)).toEqual([
      'host',
      'database',
      'queue',
      'nodes',
      'uptime',
      'pipeline',
      'activity',
      COACH_METRIC_GROUP_ID,
    ]);
    expect(res.body.data.at(-1)).toEqual({
      id: 'coach',
      label: COACH_METRIC_GROUP.label,
      title: COACH_METRIC_GROUP.title,
      order: COACH_METRIC_GROUP.order,
    });
  });

  it("is accepted by the assistant's metrics_overview tool", async () => {
    const tools: Array<TelemetryAiToolDefinition<never, unknown>> = [];
    const ai = {
      defineTool: (definition: TelemetryAiToolDefinition<never, unknown>) => {
        tools.push(definition);
        return definition;
      },
      forUser: () => ({
        runTools: async () => ({ final: { outputText: '{"sql":null,"explanation":"ok"}' }, steps: [], stopReason: 'completed' }),
      }),
      isAiError: () => false,
      assertEnabled: async () => undefined,
    };
    const { TelemetryAssistantService } = telemetryProviders;
    const get = <T>(token: unknown) => context.module.get<T>(token as never, { strict: false });
    const service = new TelemetryAssistantService(
      ai,
      get(GreptimeClient),
      get(TelemetrySettingsService),
      { run: jest.fn() },
      get(TelemetrySchemaService),
      { record: jest.fn() },
      { readFeatureFlag: jest.fn() },
      { slug: 'my-app', serviceName: () => 'my-app-api', apiVersion: () => '0', readDeployInfo: jest.fn() },
    );

    await service.stream('u1', { question: 'q' }, { emit: () => undefined });

    const metricsOverview = tools.find((tool) => tool.name === 'metrics_overview')!;
    const schema = metricsOverview.parameters as unknown as { safeParse(v: unknown): { success: boolean } };
    expect(schema.safeParse({ group: 'coach', window: '1h' }).success).toBe(true);
    expect(schema.safeParse({ group: 'nope', window: '1h' }).success).toBe(false);
    expect(metricsOverview.description).toContain(COACH_METRIC_GROUP.description);
  });

  it("documents the group in the route's OpenAPI enum (the documentation is built when forRoot runs)", () => {
    const { TelemetryDashboardController } = telemetryControllers as Record<string, { prototype: Record<string, object> }>;
    const params = Reflect.getMetadata('swagger/apiParameters', TelemetryDashboardController.prototype.metrics) as Array<{
      name: string;
      schema?: { enum?: string[] };
    }>;

    expect(params.find((p) => p.name === 'group')?.schema?.enum).toEqual([
      'host',
      'database',
      'queue',
      'nodes',
      'uptime',
      'pipeline',
      'activity',
      'coach',
    ]);
  });
});

describe('Telemetry extension points (rung 3: VERDICT_POLICY)', () => {
  let context: TestContext;
  const policyVerdict: DashboardVerdict = { level: 'critical', reasons: ['App policy: coach nudges stalled'] };

  beforeAll(async () => {
    context = await boot([{ provide: VERDICT_POLICY, useValue: { compute: () => policyVerdict } }]);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await closeTestApp(context);
  });
  beforeEach(() => prepare(context));

  it("the summary's verdict is the overriding policy's", async () => {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/summary`).set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data.verdict).toEqual(policyVerdict);
  });
});

describe('Telemetry extension points (rung 1: verdict thresholds)', () => {
  async function summaryAndFreshness(context: TestContext) {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer()).get(`${BASE}/summary`).set(authHeader(admin.accessToken)).expect(200);
    const freshness = await context.module.get(DoctorCheckRegistry).get('telemetry.freshness')!.run();
    return {
      verdict: res.body.data.verdict.level as string,
      freshness: freshness.status,
      threshold: (freshness.data as { thresholdMinutes?: number } | undefined)?.thresholdMinutes,
    };
  }

  it('with the defaults, ten quiet minutes are no_data and the freshness check warns', async () => {
    const context = await boot();
    try {
      prepare(context);
      const { verdict, freshness, threshold } = await summaryAndFreshness(context);
      expect(verdict).toBe('no_data');
      expect(freshness).toBe('warn');
      expect(threshold).toBe(5);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });

  it('noDataMinutes: 60 changes both the summary verdict and TelemetryFreshnessDoctorCheck', async () => {
    const context = await boot([
      { provide: TELEMETRY_VERDICT_THRESHOLDS, useValue: resolveVerdictThresholds({ noDataMinutes: 60 }) },
    ]);
    try {
      prepare(context);
      const { verdict, freshness, threshold } = await summaryAndFreshness(context);
      expect(verdict).toBe('healthy');
      expect(freshness).toBe('pass');
      expect(threshold).toBe(60);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });
});

describe('Telemetry extension points (rung 1: the metrics freshness window)', () => {
  async function freshMsOf(context: TestContext) {
    const admin = await createMockAdminUser(context);
    const res = await request(context.app.getHttpServer())
      .get(`${BASE}/metrics?group=coach`)
      .set(authHeader(admin.accessToken))
      .expect(200);
    return res.body.data.freshMs as number;
  }

  it('reports the default window, 150 s, when the app passes no `metrics` option', async () => {
    const context = await boot();
    try {
      prepare(context);
      expect(context.module.get(TELEMETRY_METRIC_FRESH_MS)).toBe(METRIC_FRESH_MS);
      expect(await freshMsOf(context)).toBe(150_000);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });

  it('metrics.freshMs: 300000 is the window /metrics reports', async () => {
    const context = await boot([{ provide: TELEMETRY_METRIC_FRESH_MS, useValue: resolveMetricFreshMs({ freshMs: 300_000 }) }]);
    try {
      prepare(context);
      expect(await freshMsOf(context)).toBe(300_000);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });
});

// =============================================================================
// The examples the slice README's catalog links to (PP-4.6)
// =============================================================================
//
//   MetricGroupRegistry.register / registerMetricGroup  from an app's own
//                                   `onModuleInit` (the registry is the same
//                                   static one `forRoot({ metricGroups })` fills)
//   VERDICT_POLICY                  `examples/activity-verdict-policy.ts`: an app
//                                   policy that delegates to DefaultVerdictPolicy
//                                   and adds one rule. Compiled and tested here,
//                                   deliberately NOT wired into telemetry.config.ts.
//   dashboard.verdictThresholds     `reference-verdict-thresholds.ts`, wired, and
//                                   equal to the platform defaults.
// =============================================================================

describe('Telemetry extension points: MetricGroupRegistry.register from onModuleInit', () => {
  /** A minimal app group; `coach` is already in the registry through the mocked app registrations above. */
  const GROUP: MetricGroupDef = {
    id: 'registrar_demo',
    label: 'Registrar demo',
    title: 'Registrar demo',
    order: 80,
    description: 'a group registered from onModuleInit',
    families: [
      {
        key: 'registrarDemoDepth',
        group: 'registrar_demo' as MetricGroup,
        label: 'Depth',
        table: 'app_jobs_queue_depth',
        kind: 'gauge',
        unit: 'count',
        requiredColumns: ['status'],
        seriesAggregate: 'sum',
        bucketAggregate: 'max',
        filters: ['service', 'instance'],
      },
    ],
  };

  @Injectable()
  class DemoGroupRegistrar implements OnModuleInit {
    constructor(private readonly groups: MetricGroupRegistry) {}

    onModuleInit(): void {
      registerMetricGroup(this.groups, GROUP);
    }
  }

  it('adds an app group before the registry freezes, and the registry then refuses a late one', async () => {
    // The real AppModule above froze the process-wide registry; the helper
    // unfreezes it for the callback and restores it afterwards.
    await withTemporaryEntries(metricGroupRegistry, [], async () => {
      const moduleRef = await Test.createTestingModule({ providers: [MetricGroupRegistry, DemoGroupRegistrar] }).compile();
      await moduleRef.init();

      const registry = moduleRef.get(MetricGroupRegistry);
      expect(registry.get('registrar_demo')).toBe(GROUP);
      expect(registry.list().at(-1)?.id).toBe('registrar_demo');
      // onApplicationBootstrap froze it: registering now is a bug, and says so.
      expect(() => registry.register({ ...GROUP, id: 'late', families: [{ ...GROUP.families[0], key: 'lateDepth', group: 'late' as MetricGroup }] })).toThrow(/frozen/i);

      await moduleRef.close();
    });
  });
});

describe('Telemetry extension points: the example verdict policy (compiled and tested, not wired)', () => {
  const INPUT: VerdictInput = {
    now: new Date('2026-10-07T12:00:00Z'),
    lastDataAt: new Date('2026-10-07T11:59:30Z'),
    requests: 0,
    errors5xx: 0,
    p95Ms: null,
    errorLogs: 0,
    previousErrorLogs: 0,
  };
  const policy = new ActivityVerdictPolicy(new DefaultVerdictPolicy());

  it('adds its rule to a healthy platform verdict: degraded, with its reason after the platform ones', () => {
    expect(policy.compute(INPUT, DEFAULT_VERDICT_THRESHOLDS)).toEqual({ level: 'degraded', reasons: [ACTIVITY_QUIET_REASON] });
  });

  it('is the platform verdict whenever requests were served', () => {
    const input = { ...INPUT, requests: 120 };
    expect(policy.compute(input, DEFAULT_VERDICT_THRESHOLDS)).toEqual(new DefaultVerdictPolicy().compute(input, DEFAULT_VERDICT_THRESHOLDS));
  });

  it('never lowers the platform level, and leaves no_data alone', () => {
    const noData = { ...INPUT, lastDataAt: null };
    expect(policy.compute(noData, DEFAULT_VERDICT_THRESHOLDS).level).toBe('no_data');
    expect(policy.compute(noData, DEFAULT_VERDICT_THRESHOLDS).reasons).not.toContain(ACTIVITY_QUIET_REASON);

    const disk = { ...INPUT, disk: { utilizationPct: 99, mountpoint: '/' } };
    expect(policy.compute(disk, DEFAULT_VERDICT_THRESHOLDS).level).toBe('critical');
  });

  it('is not what the reference app binds: the real summary verdict stays the platform one', async () => {
    const context = await boot();
    try {
      prepare(context);
      expect(context.module.get(VERDICT_POLICY)).toBeInstanceOf(DefaultVerdictPolicy);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });

  it('serves the example policy through the real summary route when bound with .overrideProvider', async () => {
    const context = await boot([{ provide: VERDICT_POLICY, useValue: policy }]);
    try {
      prepare(context);
      jest.spyOn(context.module.get(GreptimeClient), 'queryReader').mockResolvedValue({ fields: [], rows: [] });
      const admin = await createMockAdminUser(context);
      const res = await request(context.app.getHttpServer()).get(`${BASE}/summary`).set(authHeader(admin.accessToken)).expect(200);

      // No telemetry in the window is `no_data`, which the example leaves alone.
      expect(res.body.data.verdict.level).toBe('no_data');
      expect(res.body.data.verdict.reasons).not.toContain(ACTIVITY_QUIET_REASON);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });
});

describe('Telemetry extension points: the reference verdict thresholds (wired, behaviour-neutral)', () => {
  it('equals the platform defaults, so the dashboard verdict is unchanged', () => {
    expect(resolveVerdictThresholds(REFERENCE_VERDICT_THRESHOLDS)).toEqual(DEFAULT_VERDICT_THRESHOLDS);
    expect(REFERENCE_VERDICT_THRESHOLDS).toEqual(DEFAULT_VERDICT_THRESHOLDS);
  });

  it('is what the app boots with', async () => {
    const context = await boot();
    try {
      expect(context.module.get(TELEMETRY_VERDICT_THRESHOLDS)).toEqual(DEFAULT_VERDICT_THRESHOLDS);
    } finally {
      jest.restoreAllMocks();
      await closeTestApp(context);
    }
  });
});

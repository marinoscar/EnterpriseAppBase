import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { DoctorCheckRegistry, DoctorModule } from '../../src/doctor/index';
import { telemetryGate } from '../../src/otel-core/index';
import {
  GreptimeClient,
  MetricGroupRegistry,
  TELEMETRY_AI,
  TELEMETRY_APP_INFO,
  TELEMETRY_AUDIT_SINK,
  TELEMETRY_CREDENTIAL_STORE,
  TELEMETRY_JOBS,
  TELEMETRY_SETTINGS_DEFAULTS,
  TELEMETRY_SETTINGS_STORE,
  TELEMETRY_VERDICT_THRESHOLDS,
  TelemetryModule,
  TelemetrySettingsService,
  VERDICT_POLICY,
  DefaultVerdictPolicy,
  DEFAULT_VERDICT_THRESHOLDS,
  metricGroupRegistry,
} from '../../src/telemetry/index';
import { TEST_PERMISSIONS_HEADER, createTestPlatformHost } from '../../src/testing';

// =============================================================================
// TelemetryModule.forRoot boots with stub ports and no telemetry store (#703)
// =============================================================================
//
// The slice's whole provider graph resolves against six stub ports and an
// empty configuration (no GREPTIME_*, no stack agent, OTEL disabled): nothing
// is reachable, nothing throws, the routes answer, the five Doctor checks are
// registered, and the registries freeze on bootstrap. An app that does not
// run GreptimeDB still boots.
// =============================================================================

const registered: string[] = [];

/** The six host ports, as the smallest stubs that satisfy them. */
@Module({
  providers: [
    { provide: TELEMETRY_AUDIT_SINK, useValue: { record: async () => undefined } },
    {
      provide: TELEMETRY_SETTINGS_STORE,
      useValue: {
        getTelemetryPolicy: async () => structuredClone(TELEMETRY_SETTINGS_DEFAULTS),
        replaceTelemetryPolicy: async () => undefined,
        readPolicyProvenance: async () => null,
        readRow: async () => null,
        writeRow: async () => undefined,
        deleteRow: async () => undefined,
        readFeatureFlag: async () => false,
      },
    },
    {
      provide: TELEMETRY_CREDENTIAL_STORE,
      useValue: {
        getSecret: async () => null,
        setSecret: async () => undefined,
        deleteSecret: async () => undefined,
        describe: async () => null,
      },
    },
    {
      provide: TELEMETRY_JOBS,
      useValue: {
        enqueue: async () => ({ id: 'job-1', status: 'pending' }),
        enqueueHousekeepingJob: async () => undefined,
        registerHandler: (handler: { type: string }) => registered.push(handler.type),
        findLatest: async () => null,
        updatePayload: async () => undefined,
      },
    },
    {
      provide: TELEMETRY_AI,
      useValue: {
        forUser: () => ({ runTools: async () => ({ final: {}, steps: [], stopReason: 'completed' }) }),
        defineTool: (definition: unknown) => definition,
        isAiError: () => false,
        assertEnabled: async () => undefined,
      },
    },
    {
      provide: TELEMETRY_APP_INFO,
      useValue: {
        slug: 'stub-app',
        serviceName: () => 'stub-app-api',
        apiVersion: () => '0.0.0',
        readDeployInfo: async () => ({ status: 'absent', document: null }),
      },
    },
  ],
  exports: [
    TELEMETRY_AUDIT_SINK,
    TELEMETRY_SETTINGS_STORE,
    TELEMETRY_CREDENTIAL_STORE,
    TELEMETRY_JOBS,
    TELEMETRY_AI,
    TELEMETRY_APP_INFO,
  ],
})
class StubTelemetryHostModule {}

/** The configuration a deployment without GreptimeDB has: nothing. */
const EmptyConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  ignoreEnvFile: true,
  load: [() => ({ otel: { enabled: false } })],
});

describe('TelemetryModule.forRoot with stub ports and no store', () => {
  let app: NestFastifyApplication;
  const host = createTestPlatformHost();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        EmptyConfigModule,
        DoctorModule.forRoot({ host, supportBundle: false }),
        TelemetryModule.forRoot({ host, imports: [StubTelemetryHostModule] }),
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('boots: the GreptimeDB client reports no store, and the export gate stays closed', async () => {
    expect(app.get(GreptimeClient).isConfigured()).toBe(false);
    await expect(app.get(TelemetrySettingsService).refreshGate()).resolves.toBe(false);
    expect(telemetryGate.isEnabled()).toBe(false);
  });

  it('answers a route through the host access decorators', async () => {
    const res = await app.inject({ method: 'GET', url: '/telemetry/config', headers: { [TEST_PERMISSIONS_HEADER]: '' } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, enabled: false, assistantEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/telemetry/config' })).statusCode).toBe(401);
  });

  it('registers both server-only job handlers and the five telemetry Doctor checks', () => {
    expect(registered.sort()).toEqual(['telemetry.retention.apply', 'telemetry.stack.deploy']);
    expect(
      app
        .get(DoctorCheckRegistry)
        .list()
        .map((check) => check.id)
        .filter((id) => id.startsWith('telemetry.'))
        .sort(),
    ).toEqual(['telemetry.connection', 'telemetry.export', 'telemetry.freshness', 'telemetry.reachable', 'telemetry.tables']);
  });

  it('provides the default verdict policy and thresholds, and freezes the metric-group registry', () => {
    expect(app.get(VERDICT_POLICY)).toBe(app.get(DefaultVerdictPolicy));
    expect(app.get(TELEMETRY_VERDICT_THRESHOLDS)).toEqual(DEFAULT_VERDICT_THRESHOLDS);
    expect(app.get(MetricGroupRegistry).list()).toHaveLength(6);
    expect(metricGroupRegistry.frozen).toBe(true);
  });
});

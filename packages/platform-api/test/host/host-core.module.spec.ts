import 'reflect-metadata';

import { Controller, Get, Global, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';

import { HttpExceptionFilter, PlatformHostModule } from '../../src/core/index';
import { DoctorCheckRegistry, EgressRegistry, DEPLOYMENT_NETWORK_SOURCE } from '../../src/doctor/index';
import { AuthModule, Public } from '../../src/identity/index';
import { appMetricRegistry } from '../../src/otel-core/index';
import { SystemSettingsService, systemSettingsNamespaceRegistry } from '../../src/settings/index';
import { InMemoryAuditSink } from '../../src/testing/index';
import {
  AppMetricsService,
  EVENT_BUS,
  EVENT_BUS_SELECTION,
  InProcessEventBus,
  MAINTENANCE_SYSTEM_SETTINGS,
  MaintenanceGuard,
  DeploymentModeService,
  DeploymentNetworkService,
  MaintenanceModeService,
  PLATFORM_APP_METRICS,
  PLATFORM_HOST_CORE_OPTIONS,
  PlatformHostCoreModule,
  PostgresEventBus,
  TransformInterceptor,
  LoggingInterceptor,
  eventBusAdapterRegistry,
  registerEventBusAdapter,
  resolvePlatformHostCoreOptions,
  type EventBus,
  type PlatformHostCoreOptions,
} from '../../src/host/index';
import { withTemporaryEntries } from '../../src/core/registry/testing';
import { createEventBus } from '../../src/host/event-bus/event-bus.factory';
import { checkHostModuleGraph, discoverHostModuleGraph } from '../../src/host/testing/index';

// =============================================================================
// PlatformHostCoreModule (issue #867)
// =============================================================================
//
// The module's shape (global, the enhancers, the exports, a narrow import
// graph), the event bus it provides, and one request through a real Fastify
// app: the envelope, the request id and the maintenance guard in front of it.
// The reference app's integration suites (apps/api/test/maintenance/,
// test/openapi/) prove the same through the whole composed application.
// =============================================================================

const settingsState = { maintenance: { ...MAINTENANCE_SYSTEM_SETTINGS.defaults } };

/** The global settings slice, as far as maintenance reads it. */
@Global()
@Module({
  providers: [
    {
      provide: SystemSettingsService,
      useValue: {
        getMaintenancePolicy: async () => settingsState.maintenance,
        readNamespaceValue: async () => settingsState.maintenance,
        patchSettings: async () => undefined,
      },
    },
    DoctorCheckRegistry,
    EgressRegistry,
  ],
  exports: [SystemSettingsService, DoctorCheckRegistry, EgressRegistry],
})
class FakeSettingsModule {}

@Controller('probe')
class ProbeController {
  @Get()
  @Public()
  probe(): { hello: string } {
    return { hello: 'world' };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

function rootImports(eventBusAdapter?: string, extraOptions: PlatformHostCoreOptions = {}) {
  return [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ jwt: { secret: 'host-core-test-secret' } })] }),
    FakeSettingsModule,
    PlatformHostModule.forRoot({ audit: { useFactory: () => new InMemoryAuditSink() } }),
    PlatformHostCoreModule.forRoot({ eventBusAdapter, metricsGauges: false, ...extraOptions }),
  ];
}

async function compile(eventBusAdapter?: string, extra: unknown[] = [], extraOptions: PlatformHostCoreOptions = {}): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [...rootImports(eventBusAdapter, extraOptions), ...(extra as never[])] })
    // The identity guards on the maintenance controller (`@Auth()`) resolve
    // their own dependencies; this suite does not authenticate anyone.
    .useMocker(() => ({}))
    .compile();
}

describe('PlatformHostCoreModule', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('forRoot()', () => {
    const dynamic = PlatformHostCoreModule.forRoot();
    const provided = (dynamic.providers ?? []) as Array<{ provide?: unknown; useClass?: unknown; useExisting?: unknown }>;

    it('is global and registers the platform app metrics and the maintenance namespace first', () => {
      expect(dynamic.global).toBe(true);
      expect(appMetricRegistry.has(PLATFORM_APP_METRICS[0].key)).toBe(true);
      expect(appMetricRegistry.has('eventBusPublished')).toBe(true);
      expect(systemSettingsNamespaceRegistry.get('maintenance')).toBe(MAINTENANCE_SYSTEM_SETTINGS);
      // A second forRoot (or an app manifest that registered it) is a no-op.
      expect(() => PlatformHostCoreModule.forRoot()).not.toThrow();
    });

    it('registers MaintenanceGuard as the ONLY APP_GUARD, through useExisting', () => {
      const guards = provided.filter((p) => p.provide === APP_GUARD);
      expect(guards).toHaveLength(1);
      expect(guards[0].useExisting).toBe(MaintenanceGuard);
    });

    it('registers the exception filter and the two interceptors, the log line outside the envelope', () => {
      expect(provided.filter((p) => p.provide === APP_FILTER).map((p) => p.useClass)).toEqual([HttpExceptionFilter]);
      expect(provided.filter((p) => p.provide === APP_INTERCEPTOR).map((p) => p.useClass)).toEqual([
        LoggingInterceptor,
        TransformInterceptor,
      ]);
    });

    it('exports the bus, the selection, the metrics, the maintenance service and guard and its options', () => {
      expect(dynamic.exports).toEqual(
        expect.arrayContaining([EVENT_BUS, EVENT_BUS_SELECTION, AppMetricsService, MaintenanceModeService, MaintenanceGuard, PLATFORM_HOST_CORE_OPTIONS]),
      );
    });

    it('does not import AuthModule (the guard verifies the bearer with a JwtModule of its own) and does not re-export it', () => {
      const names = (dynamic.imports ?? []).map((entry) => (entry as { module?: { name?: string } }).module?.name);
      expect(names).toEqual(['OtelMetricsModule', 'JwtModule']);
      expect(discoverHostModuleGraph(dynamic).modules).not.toContain(AuthModule.name);
      expect((dynamic.exports ?? []).map((e) => (e as { name?: string }).name)).not.toContain('JwtModule');
    });

    it('validates its options', () => {
      expect(() => resolvePlatformHostCoreOptions({ eventBusAdapter: 1 as never })).toThrow(/eventBusAdapter/);
      expect(() => resolvePlatformHostCoreOptions({ metricsGauges: 'yes' as never })).toThrow(/metricsGauges/);
      expect(() => resolvePlatformHostCoreOptions({ eventBus: 'bus' as never })).toThrow(/exactly one of useExisting, useClass or useFactory/);
      expect(() => resolvePlatformHostCoreOptions({ eventBus: {} as never })).toThrow(/exactly one of/);
      expect(() => resolvePlatformHostCoreOptions({ eventBus: { useClass: InProcessEventBus, useFactory: () => ({}) } as never })).toThrow(/exactly one of/);
      expect(resolvePlatformHostCoreOptions({ eventBus: { useClass: InProcessEventBus } }).eventBus).toEqual({ useClass: InProcessEventBus });
      expect(Object.isFrozen(resolvePlatformHostCoreOptions())).toBe(true);
    });

    it('passes the host conformance walk, and a second forRoot fails it', () => {
      @Module({ imports: rootImports() })
      class OneHost {}
      expect(checkHostModuleGraph(discoverHostModuleGraph(OneHost))).toEqual([]);

      @Module({ imports: [...rootImports(), PlatformHostCoreModule.forRoot()] })
      class TwoHosts {}
      const messages = checkHostModuleGraph(discoverHostModuleGraph(TwoHosts)).map((f) => f.message);
      expect(messages.some((m) => m.includes('imported 2 time(s)'))).toBe(true);
      expect(messages.some((m) => m.includes('MaintenanceGuard is registered as APP_GUARD 2 time(s)'))).toBe(true);
    });
  });

  describe('the generic Doctor checks (#879)', () => {
    it('registers them in the order the report lists them, with the deployment facts bound', async () => {
      const moduleRef = await compile();
      await moduleRef.init();

      expect(
        moduleRef
          .get(DoctorCheckRegistry)
          .list()
          .map((check) => `${check.category}/${check.id}`),
      ).toEqual([
        'core/core.event-bus',
        'core/core.deployment-mode',
        'core/db.connection',
        'core/db.migrations',
        'core/secrets.encryption-key',
        'core/db.rls_role',
        'network/network.egress',
        'maintenance/maintenance.mode',
      ]);
      expect(moduleRef.get(DeploymentModeService).mode).toBe('self-hosted');
      expect(moduleRef.get(DEPLOYMENT_NETWORK_SOURCE)).toBeInstanceOf(DeploymentNetworkService);
      await moduleRef.close();
    });
  });

  describe('the event bus', () => {
    const saved = process.env.EVENT_BUS_ADAPTER;
    afterEach(() => {
      if (saved === undefined) delete process.env.EVENT_BUS_ADAPTER;
      else process.env.EVENT_BUS_ADAPTER = saved;
    });

    it('provides the in-process bus by default', async () => {
      delete process.env.EVENT_BUS_ADAPTER;
      const moduleRef = await compile();
      expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
      expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ adapter: 'in-process', recognised: true });
      await moduleRef.close();
    });

    it('reads EVENT_BUS_ADAPTER when no option is given, and falls back with one warning', async () => {
      process.env.EVENT_BUS_ADAPTER = 'redis';
      const moduleRef = await compile();
      expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
      expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ recognised: false, configured: 'redis' });
      expect(warn.mock.calls.filter(([m]) => String(m).includes('EVENT_BUS_ADAPTER'))).toHaveLength(1);
      await moduleRef.close();
    });

    describe('pluggable (PP-14.2, #920)', () => {
      const registered = (id: string, create: () => EventBus | Promise<EventBus>) => ({ id, label: `Test ${id}`, create });

      it('selects an adapter an app registered, by the eventBusAdapter option', async () => {
        const custom = new InProcessEventBus();
        const create = jest.fn(() => custom);
        await withTemporaryEntries(eventBusAdapterRegistry, [registered('custom-bus', create)], async () => {
          const moduleRef = await compile('custom-bus');
          expect(moduleRef.get<EventBus>(EVENT_BUS)).toBe(custom);
          expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ adapter: 'custom-bus', recognised: true });
          expect(create).toHaveBeenCalledTimes(1);
          expect(create.mock.calls[0]).toEqual([expect.objectContaining({ id: 'custom-bus' })]);
          await moduleRef.close();
        });
      });

      it('selects a registered adapter by EVENT_BUS_ADAPTER too, and awaits an async create', async () => {
        const custom = new InProcessEventBus();
        process.env.EVENT_BUS_ADAPTER = 'Async-Bus';
        await withTemporaryEntries(eventBusAdapterRegistry, [registered('async-bus', async () => custom)], async () => {
          const moduleRef = await compile();
          expect(moduleRef.get<EventBus>(EVENT_BUS)).toBe(custom);
          await moduleRef.close();
        });
      });

      it('fails the boot for an unregistered eventBusAdapter option, naming the id and the registered ones', async () => {
        await expect(compile('nope')).rejects.toThrow(/Unknown event bus adapter "nope".*in-process, postgres/);
      });

      it('still falls back, with one warning, for an unregistered EVENT_BUS_ADAPTER value', async () => {
        process.env.EVENT_BUS_ADAPTER = 'nope';
        const moduleRef = await compile();
        expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
        expect(warn.mock.calls.filter(([m]) => String(m).includes('in-process, postgres'))).toHaveLength(1);
        await moduleRef.close();
      });

      it('binds a whole bus with eventBus (useFactory), winning over eventBusAdapter and the environment', async () => {
        const bound = new InProcessEventBus();
        process.env.EVENT_BUS_ADAPTER = 'postgres';
        const moduleRef = await compile('also-ignored', [], { eventBus: { useFactory: () => bound } });
        expect(moduleRef.get<EventBus>(EVENT_BUS)).toBe(bound);
        expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ recognised: true, configured: 'eventBus binding' });
        await moduleRef.close();
      });

      it('binds eventBus with useClass and useExisting, instantiated once', async () => {
        const viaClass = await compile(undefined, [], { eventBus: { useClass: InProcessEventBus } });
        expect(viaClass.get<EventBus>(EVENT_BUS)).toBeInstanceOf(InProcessEventBus);
        await viaClass.close();

        const TOKEN = Symbol('existing-bus');
        const existing = new InProcessEventBus();
        @Global()
        @Module({ providers: [{ provide: TOKEN, useValue: existing }], exports: [TOKEN] })
        class ExistingBusModule {}
        const viaExisting = await compile(undefined, [ExistingBusModule], { eventBus: { useExisting: TOKEN } });
        expect(viaExisting.get<EventBus>(EVENT_BUS)).toBe(existing);
        await viaExisting.close();
      });

      it('reports a bound bus to the Doctor without the in-process advice', async () => {
        const moduleRef = await compile(undefined, [], { eventBus: { useFactory: () => new InProcessEventBus() } });
        await moduleRef.init();
        const check = moduleRef.get(DoctorCheckRegistry).list().find((c) => c.id === 'core.event-bus')!;
        expect((await check.run()).status).toBe('pass');
        await moduleRef.close();
      });

      it('exposes the built-ins through the same public registry', () => {
        expect(eventBusAdapterRegistry.ids()).toEqual(expect.arrayContaining(['in-process', 'postgres']));
        expect(() => registerEventBusAdapter(registered('postgres', () => new InProcessEventBus()))).toThrow(/postgres/);
      });
    });

    it('builds the Postgres adapter for postgres, and refuses postgres without a client', async () => {
      const selection = { adapter: 'postgres' as const, recognised: true, configured: 'postgres' };
      const bus = await createEventBus(selection, { $executeRaw: jest.fn() });
      expect(bus).toBeInstanceOf(PostgresEventBus);
      expect(bus.health().connected).toBe(false);
      expect(() => createEventBus(selection, undefined)).toThrow(/PLATFORM_PRISMA/);
    });
  });

  describe('one request through Fastify', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const moduleRef = await compile(undefined, [ProbeModule]);
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      app.setGlobalPrefix('api');
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      await app.close();
    });

    afterEach(() => {
      settingsState.maintenance = { ...MAINTENANCE_SYSTEM_SETTINGS.defaults };
      app.get(MaintenanceModeService).invalidateCache();
    });

    it('wraps the body in the { data } envelope and echoes the request id', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/probe', headers: { 'x-request-id': 'req-123' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { hello: 'world' }, meta: { timestamp: expect.any(String) } });
      expect(response.headers['x-request-id']).toBe('req-123');
    });

    it('answers the maintenance 503, through the exception filter, while a window is open', async () => {
      settingsState.maintenance = { ...settingsState.maintenance, enabled: true, allowAdmins: false };
      const response = await app.inject({ method: 'GET', url: '/api/probe' });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('30');
      expect(response.json()).toMatchObject({ statusCode: 503, details: { reason: 'MAINTENANCE_MODE' } });
    });
  });
});

it('PlatformHostCoreModule carries no static imports of its own (everything is in forRoot)', () => {
  expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, PlatformHostCoreModule) ?? []).toEqual([]);
});

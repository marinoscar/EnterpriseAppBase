import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PlatformHostModule } from '@marinoscar/platform-api/core';
import { DoctorCheckRegistry, EgressRegistry } from '@marinoscar/platform-api/doctor';
import {
  EVENT_BUS,
  EVENT_BUS_SELECTION,
  MAINTENANCE_SYSTEM_SETTINGS,
  PlatformHostCoreModule,
  eventBusAdapterRegistry,
  type EventBus,
  type PlatformHostCoreOptions,
} from '@marinoscar/platform-api/host';
import { describeEventBusConformance } from '@marinoscar/platform-api/host/testing';
import {
  IDENTITY_EVENT_BUS,
  PRINCIPAL_CACHE_CLOCK,
  PRINCIPAL_INVALIDATE_CHANNEL,
  PrincipalCache,
  PrincipalCacheModule,
  type PrincipalCacheKey,
} from '@marinoscar/platform-api/identity';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import { InMemoryAuditSink } from '@marinoscar/platform-api/testing';

// Registers the example adapter, exactly as the application does at import time.
import '../../../src/app-registrations/host';
import {
  RECORDING_EVENT_BUS_ID,
  RecordingEventBus,
} from '../../../src/platform-extensions/host/recording-event-bus';

// =============================================================================
// PP-14.2 — an app event bus adapter, selected by id or bound whole
// =============================================================================
//
// Boots the REAL `PlatformHostCoreModule.forRoot(...)` and a REAL platform
// consumer of `EVENT_BUS`: the identity slice's `PrincipalCache`, which
// invalidates a principal locally and publishes the invalidation to the other
// replicas on `auth.principal.invalidate`. The app binds its port the one-line
// way the reference app does (`IDENTITY_EVENT_BUS` -> `EVENT_BUS`), so what the
// cache publishes through is whatever bus the host core provides. If the app's
// adapter (or binding) did not reach the package's consumers, the cache would
// hold the default in-process bus and the recording bus would see nothing.
//
// Nothing here edits a package: the adapter is `src/platform-extensions/host/
// recording-event-bus.ts`, registered by `src/app-registrations/host.ts`.
// =============================================================================

const KEY: PrincipalCacheKey = { userId: 'user-1', orgId: 'org-1', tokenKind: 'session' };
const OTHER: PrincipalCacheKey = { userId: 'user-2', orgId: 'org-1', tokenKind: 'session' };
const principal = (id: string) => ({ id, email: `${id}@example.test`, roles: [], permissions: [] }) as never;

/** The global settings slice, as far as maintenance reads it. */
@Global()
@Module({
  providers: [
    {
      provide: SystemSettingsService,
      useValue: {
        getMaintenancePolicy: async () => ({ ...MAINTENANCE_SYSTEM_SETTINGS.defaults }),
        readNamespaceValue: async () => ({ ...MAINTENANCE_SYSTEM_SETTINGS.defaults }),
        patchSettings: async () => undefined,
      },
    },
    DoctorCheckRegistry,
    EgressRegistry,
  ],
  exports: [SystemSettingsService, DoctorCheckRegistry, EgressRegistry],
})
class FakeSettingsModule {}

/** The app's one-line port binding (`platform/identity/identity-host.module.ts`). */
@Global()
@Module({
  providers: [{ provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS }],
  exports: [IDENTITY_EVENT_BUS],
})
class IdentityBusPortModule {}

async function boot(options: PlatformHostCoreOptions): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ jwt: { secret: 'example-secret' } })] }),
      FakeSettingsModule,
      PlatformHostModule.forRoot({ audit: { useFactory: () => new InMemoryAuditSink() } }),
      PlatformHostCoreModule.forRoot({ metricsGauges: false, ...options }),
      IdentityBusPortModule,
      PrincipalCacheModule,
    ],
  })
    // The maintenance controller's `@Auth()` guards resolve their own dependencies; nobody signs in here.
    // The cache's optional clock stays absent (its default, `Date.now`).
    .useMocker((token) => (token === PRINCIPAL_CACHE_CLOCK ? undefined : {}))
    .compile();
  await moduleRef.init();
  return moduleRef;
}

/** Lets the bus's microtask deliveries run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** What every consumer-reaching assertion proves, for a bus however it was provided. */
async function expectCacheUsesBus(moduleRef: TestingModule, bus: RecordingEventBus): Promise<void> {
  const cache = moduleRef.get(PrincipalCache);

  // The consumer holds the app's bus, not a default one.
  expect(cache.busHealth().adapter).toBe(RECORDING_EVENT_BUS_ID);
  expect((cache as unknown as { bus: unknown }).bus).toBe(bus);

  // Publishing: an invalidation made here is on the app's bus.
  cache.set(KEY, principal('user-1'), cache.generation(KEY.userId));
  expect(cache.get(KEY)).toBeDefined();
  cache.invalidateUser('user-1');
  await flush();
  expect(cache.get(KEY)).toBeUndefined();
  expect(bus.on(PRINCIPAL_INVALIDATE_CHANNEL)).toEqual([
    { channel: PRINCIPAL_INVALIDATE_CHANNEL, payload: { userId: 'user-1' }, local: true },
  ]);

  // Delivery: a message "from another replica" reaches the cache's subscription.
  cache.set(OTHER, principal('user-2'), cache.generation(OTHER.userId));
  expect(cache.get(OTHER)).toBeDefined();
  bus.receiveRemote(PRINCIPAL_INVALIDATE_CHANNEL, { userId: 'user-2' });
  await flush();
  expect(cache.get(OTHER)).toBeUndefined();
}

describe('an app event bus adapter (PP-14.2, #920)', () => {
  const savedEnv = process.env.EVENT_BUS_ADAPTER;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.EVENT_BUS_ADAPTER;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedEnv === undefined) delete process.env.EVENT_BUS_ADAPTER;
    else process.env.EVENT_BUS_ADAPTER = savedEnv;
  });

  it('registers next to the built-ins, from the app, without a package edit', () => {
    expect(eventBusAdapterRegistry.ids()).toEqual(['in-process', 'postgres', RECORDING_EVENT_BUS_ID]);
  });

  describe('selected by id', () => {
    it('forRoot({ eventBusAdapter }) gives every consumer the app adapter', async () => {
      const moduleRef = await boot({ eventBusAdapter: RECORDING_EVENT_BUS_ID });
      const bus = moduleRef.get<EventBus>(EVENT_BUS);

      expect(bus).toBeInstanceOf(RecordingEventBus);
      expect(moduleRef.get(EVENT_BUS_SELECTION)).toMatchObject({ adapter: RECORDING_EVENT_BUS_ID, recognised: true });
      await expectCacheUsesBus(moduleRef, bus as RecordingEventBus);
      await moduleRef.close();
    });

    it('EVENT_BUS_ADAPTER selects it too', async () => {
      process.env.EVENT_BUS_ADAPTER = 'Recording';
      const moduleRef = await boot({});

      expect(moduleRef.get<EventBus>(EVENT_BUS)).toBeInstanceOf(RecordingEventBus);
      await moduleRef.close();
    });

    it('an unregistered id fails the boot, naming it and the registered ones', async () => {
      await expect(boot({ eventBusAdapter: 'redis' })).rejects.toThrow(
        /Unknown event bus adapter "redis".*in-process, postgres, recording/,
      );
    });
  });

  describe('bound whole with the eventBus PortBinding', () => {
    it('useFactory: wins over the adapter option, and reaches every consumer', async () => {
      const bound = new RecordingEventBus();
      const moduleRef = await boot({ eventBusAdapter: 'in-process', eventBus: { useFactory: () => bound } });

      expect(moduleRef.get<EventBus>(EVENT_BUS)).toBe(bound);
      await expectCacheUsesBus(moduleRef, bound);
      await moduleRef.close();
    });

    it('useClass: one instance, shared by the container and the consumer', async () => {
      const moduleRef = await boot({ eventBus: { useClass: RecordingEventBus } });
      const bus = moduleRef.get<EventBus>(EVENT_BUS);

      expect(bus).toBeInstanceOf(RecordingEventBus);
      await expectCacheUsesBus(moduleRef, bus as RecordingEventBus);
      await moduleRef.close();
    });
  });

  describe('without either, the default is unchanged', () => {
    it('provides the in-process bus to the same consumer', async () => {
      const moduleRef = await boot({});

      expect(moduleRef.get<EventBus>(EVENT_BUS).adapter).toBe('in-process');
      expect(moduleRef.get(PrincipalCache).busHealth().adapter).toBe('in-process');
      await moduleRef.close();
    });
  });

  describe('the conformance kit', () => {
    describe('on the example adapter, a fresh bus per case', () => {
      describeEventBusConformance(() => new RecordingEventBus(), { describe, it, expect });
    });

    describe('on the example adapter, one shared instance', () => {
      describeEventBusConformance(new RecordingEventBus(), { describe, it, expect });
    });
  });
});

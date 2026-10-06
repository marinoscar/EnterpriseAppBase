import 'reflect-metadata';

import { Controller, Get, INestApplication, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import {
  AUDIT_SINK,
  AuditSink,
  PLATFORM_PRISMA,
  PlatformHostModule,
  PrismaClientLike,
  SYSTEM_SETTINGS_STORE,
  SystemSettingsStore,
  definePlatformHost,
} from '../../../src/core';
import {
  InMemoryAuditSink,
  InMemorySystemSettingsStore,
  TEST_PERMISSIONS_HEADER,
  TEST_REQUIRED_PERMISSIONS_KEY,
  createTestPlatformHost,
} from '../../../src/testing';

const decorator = () => SetMetadata('probe', true);

describe('definePlatformHost', () => {
  it('accepts a host whose access functions return decorators, and freezes it', () => {
    const host = definePlatformHost({ access: { requirePermissions: decorator, requireAuthenticated: decorator } });

    expect(Object.isFrozen(host)).toBe(true);
    expect(Object.isFrozen(host.access)).toBe(true);
    expect(typeof host.access.requirePermissions(['a:read'])).toBe('function');
    expect(typeof host.access.requireAuthenticated()).toBe('function');
  });

  it('returns an already-defined host unchanged', () => {
    const host = definePlatformHost({ access: { requirePermissions: decorator, requireAuthenticated: decorator } });

    expect(definePlatformHost(host)).toBe(host);
  });

  it.each([
    ['no host', undefined],
    ['no access', {}],
    ['no requirePermissions', { access: { requireAuthenticated: decorator } }],
    ['no requireAuthenticated', { access: { requirePermissions: decorator } }],
    ['a non-function requirePermissions', { access: { requirePermissions: 'yes', requireAuthenticated: decorator } }],
  ])('throws with %s, saying a platform route is never public', (_name, host) => {
    expect(() => definePlatformHost(host as never)).toThrow(/never public/);
  });

  it('throws when requirePermissions or requireAuthenticated returns a non-function', () => {
    expect(() =>
      definePlatformHost({ access: { requirePermissions: () => undefined as never, requireAuthenticated: decorator } }),
    ).toThrow(/requirePermissions\(\) returned undefined, not a decorator/);
    expect(() =>
      definePlatformHost({ access: { requirePermissions: decorator, requireAuthenticated: () => ({}) as never } }),
    ).toThrow(/requireAuthenticated\(\) returned object, not a decorator/);
  });

  it('passes the permissions through and refuses an empty or invalid list later', () => {
    const seen: string[][] = [];
    const host = definePlatformHost({
      access: {
        requirePermissions: (permissions) => {
          seen.push([...permissions]);
          return decorator();
        },
        requireAuthenticated: decorator,
      },
    });

    host.access.requirePermissions(['a:read', 'b:write']);
    expect(seen.at(-1)).toEqual(['a:read', 'b:write']);
    expect(() => host.access.requirePermissions([])).toThrow(/no permission/);
    expect(() => host.access.requirePermissions([''])).toThrow(/invalid permission/);
  });

  it('re-checks the decorator on every later call', () => {
    let calls = 0;
    const host = definePlatformHost({
      access: {
        requirePermissions: () => (calls++ === 0 ? decorator() : (null as never)),
        requireAuthenticated: decorator,
      },
    });

    expect(() => host.access.requirePermissions(['a:read'])).toThrow(/returned null/);
  });
});

describe('the DI-time port tokens', () => {
  it('are Symbol.for keys, so two bundles agree on identity', () => {
    expect(AUDIT_SINK).toBe(Symbol.for('@marinoscar/platform/AUDIT_SINK'));
    expect(SYSTEM_SETTINGS_STORE).toBe(Symbol.for('@marinoscar/platform/SYSTEM_SETTINGS_STORE'));
    expect(PLATFORM_PRISMA).toBe(Symbol.for('@marinoscar/platform/PLATFORM_PRISMA'));
  });
});

describe('PlatformHostModule.forRoot', () => {
  @Injectable()
  class FakePrisma implements PrismaClientLike {
    async $queryRaw<T>(): Promise<T> {
      return [] as T;
    }
    async $executeRaw(): Promise<number> {
      return 0;
    }
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(this);
    }
    $extends(): unknown {
      return this;
    }
  }

  @Module({ providers: [FakePrisma], exports: [FakePrisma] })
  class FakePrismaModule {}

  @Injectable()
  class Consumer {
    constructor(
      @Inject(AUDIT_SINK) readonly audit: AuditSink,
      @Inject(SYSTEM_SETTINGS_STORE) readonly settings: SystemSettingsStore,
      @Inject(PLATFORM_PRISMA) readonly prisma: PrismaClientLike,
    ) {}
  }

  @Module({ providers: [Consumer] })
  class ConsumerModule {}

  it('is global and binds every port by useClass, useFactory and useExisting', async () => {
    const audit = new InMemoryAuditSink();
    const moduleRef = await Test.createTestingModule({
      imports: [
        PlatformHostModule.forRoot({
          audit: { useFactory: () => audit },
          settings: { useClass: InMemorySystemSettingsStore },
          prisma: { useExisting: FakePrisma },
          imports: [FakePrismaModule],
        }),
        ConsumerModule,
      ],
    }).compile();

    const consumer = moduleRef.get(Consumer);
    expect(consumer.audit).toBe(audit);
    expect(consumer.settings).toBeInstanceOf(InMemorySystemSettingsStore);
    expect(consumer.prisma).toBe(moduleRef.get(FakePrisma));
    await moduleRef.close();
  });

  it('leaves an unbound port out, so a consumer fails at boot naming the token', async () => {
    await expect(
      Test.createTestingModule({
        imports: [PlatformHostModule.forRoot({ audit: { useClass: InMemoryAuditSink } }), ConsumerModule],
      }).compile(),
    ).rejects.toThrow(/SYSTEM_SETTINGS_STORE/);
  });

  it('refuses a binding with no provider shape, or two', () => {
    expect(() => PlatformHostModule.forRoot({ audit: {} as never })).toThrow(/"audit" port needs exactly one/);
    expect(() =>
      PlatformHostModule.forRoot({ audit: { useClass: InMemoryAuditSink, useFactory: () => new InMemoryAuditSink() } as never }),
    ).toThrow(/useClass, useFactory/);
  });

  it('exports exactly the bound tokens', () => {
    const dynamic = PlatformHostModule.forRoot({ audit: { useClass: InMemoryAuditSink } });

    expect(dynamic.global).toBe(true);
    expect(dynamic.exports).toEqual([AUDIT_SINK]);
  });
});

describe('createTestPlatformHost (package tests only)', () => {
  const host = createTestPlatformHost();

  @Controller('probe')
  class ProbeController {
    @Get('settings')
    @(host.access.requirePermissions(['system_settings:read']))
    settings() {
      return { ok: true };
    }

    @Get('me')
    @(host.access.requireAuthenticated())
    me() {
      return { ok: true };
    }
  }

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (url: string, permissions?: string) =>
    (app as NestFastifyApplication).inject({
      method: 'GET',
      url,
      headers: permissions === undefined ? {} : { [TEST_PERMISSIONS_HEADER]: permissions },
    });

  it('answers 401 without the header, 403 without the permission, 200 with it', async () => {
    expect((await get('/probe/settings')).statusCode).toBe(401);
    expect((await get('/probe/settings', 'users:read')).statusCode).toBe(403);
    expect((await get('/probe/settings', 'users:read, system_settings:read')).statusCode).toBe(200);
  });

  it('requireAuthenticated admits any caller with the header', async () => {
    expect((await get('/probe/me')).statusCode).toBe(401);
    expect((await get('/probe/me', '')).statusCode).toBe(200);
  });

  it('records the required permissions as metadata', () => {
    expect(Reflect.getMetadata(TEST_REQUIRED_PERMISSIONS_KEY, ProbeController.prototype.settings)).toEqual([
      'system_settings:read',
    ]);
  });
});

describe('InMemoryAuditSink', () => {
  it('keeps copies of the recorded events, in order', async () => {
    const sink = new InMemoryAuditSink();
    const meta = { count: 1 };
    await sink.record({ action: 'a.done', actorUserId: 'u1', targetType: 't', targetId: '1', meta });
    await sink.record({ action: 'b.done', actorUserId: null, targetType: 't', targetId: '2' });
    meta.count = 99;

    expect(sink.events.map((e) => e.action)).toEqual(['a.done', 'b.done']);
    expect(sink.events[0]?.meta).toEqual({ count: 1 });
    sink.clear();
    expect(sink.events).toEqual([]);
  });
});

describe('InMemorySystemSettingsStore', () => {
  it('reads a namespace with the row version, and refuses an unknown one', async () => {
    const store = new InMemorySystemSettingsStore({ jobs: { enabled: true } }, 3);

    await expect(store.read('jobs')).resolves.toEqual({ value: { enabled: true }, version: 3 });
    await expect(store.read('nope')).rejects.toThrow('Unknown settings namespace "nope".');
  });

  it('merges a patch, bumps the version, and refuses a stale If-Match with a conflict', async () => {
    const store = new InMemorySystemSettingsStore({ jobs: { enabled: true, limit: 2 } });

    await expect(store.patch('jobs', { limit: 5 }, { actorUserId: 'u1', ifMatchVersion: 1 })).resolves.toEqual({
      value: { enabled: true, limit: 5 },
      version: 2,
    });
    await expect(store.patch('jobs', { limit: 7 }, { actorUserId: 'u1', ifMatchVersion: 1 })).rejects.toMatchObject({
      status: 409,
    });
    await expect(store.read('jobs')).resolves.toEqual({ value: { enabled: true, limit: 5 }, version: 2 });
    await expect(store.patch('jobs', { limit: 0 }, { actorUserId: 'u1' })).resolves.toMatchObject({ version: 3 });
  });
});

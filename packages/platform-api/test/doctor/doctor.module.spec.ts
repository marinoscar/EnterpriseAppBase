import 'reflect-metadata';

import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  DEFAULT_DOCTOR_PERMISSION,
  DOCTOR_MODULE_OPTIONS,
  DoctorCheck,
  DoctorCheckOutcome,
  DoctorCheckRegistry,
  DoctorModule,
  DoctorModuleOptions,
  DoctorService,
  PLATFORM_DOCTOR_CATEGORIES,
  ResolvedDoctorModuleOptions,
} from '../../src/doctor';
import { TEST_PERMISSIONS_HEADER, TEST_REQUIRED_PERMISSIONS_KEY, createTestPlatformHost } from '../../src/testing';

const host = createTestPlatformHost();

function makeCheck(id: string, category: string, run: () => Promise<DoctorCheckOutcome>): DoctorCheck {
  return { id, category, label: id, run };
}

/** A feature module of "the app": its checks self-register, without importing DoctorModule. */
function featureModule(checks: DoctorCheck[]) {
  @Injectable()
  class Contributor implements OnModuleInit {
    constructor(private readonly registry: DoctorCheckRegistry) {}
    onModuleInit(): void {
      for (const check of checks) this.registry.register(check);
    }
  }

  @Module({ providers: [Contributor] })
  class FeatureModule {}

  return FeatureModule;
}

async function boot(options: DoctorModuleOptions, checks: DoctorCheck[] = []) {
  const moduleRef = await Test.createTestingModule({
    imports: [DoctorModule.forRoot(options), featureModule(checks)],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('DoctorModule.forRoot', () => {
  describe('validation', () => {
    it('throws without a host, saying the route is never public', () => {
      expect(() => DoctorModule.forRoot({} as DoctorModuleOptions)).toThrow(/`host` is required.*never public/);
      expect(() => DoctorModule.forRoot(undefined as unknown as DoctorModuleOptions)).toThrow(/never public/);
    });

    it('throws with an empty access port', () => {
      expect(() => DoctorModule.forRoot({ host: { access: {} } as never })).toThrow(/never public/);
    });

    it('refuses a blank permission or path, and a non-positive timeout or TTL', () => {
      expect(() => DoctorModule.forRoot({ host, permission: ' ' })).toThrow(/`permission`/);
      expect(() => DoctorModule.forRoot({ host, path: '' })).toThrow(/`path`/);
      expect(() => DoctorModule.forRoot({ host, defaultTimeoutMs: 0 })).toThrow(/`defaultTimeoutMs`/);
      expect(() => DoctorModule.forRoot({ host, cacheTtlMs: -1 })).toThrow(/`cacheTtlMs`/);
    });
  });

  describe('shape', () => {
    it('is global and exports the registry, the service and the options', () => {
      const dynamic = DoctorModule.forRoot({ host });

      expect(dynamic.global).toBe(true);
      expect(dynamic.exports).toEqual([DoctorCheckRegistry, DoctorService, DOCTOR_MODULE_OPTIONS]);
    });

    it('creates a controller named DoctorController whose getReport requires the default permission', () => {
      const [controller] = DoctorModule.forRoot({ host }).controllers!;

      expect(controller!.name).toBe('DoctorController');
      expect(Reflect.getMetadata('path', controller!)).toBe('admin/doctor');
      expect(Reflect.getMetadata(TEST_REQUIRED_PERMISSIONS_KEY, controller!.prototype.getReport)).toEqual([
        DEFAULT_DOCTOR_PERMISSION,
      ]);
      expect(DEFAULT_DOCTOR_PERMISSION).toBe('system_settings:read');
    });

    it('applies a custom permission and path', () => {
      const [controller] = DoctorModule.forRoot({ host, permission: 'ops:read', path: 'ops/doctor' }).controllers!;

      expect(Reflect.getMetadata('path', controller!)).toBe('ops/doctor');
      expect(Reflect.getMetadata(TEST_REQUIRED_PERMISSIONS_KEY, controller!.prototype.getReport)).toEqual(['ops:read']);
    });

    it('provides the resolved options, defaults applied', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [DoctorModule.forRoot({ host })] }).compile();
      const options = moduleRef.get<ResolvedDoctorModuleOptions>(DOCTOR_MODULE_OPTIONS);

      expect(options).toMatchObject({
        permission: 'system_settings:read',
        path: 'admin/doctor',
        categoryOrder: [...PLATFORM_DOCTOR_CATEGORIES],
        defaultTimeoutMs: 5_000,
        cacheTtlMs: 15_000,
      });
      expect(Object.isFrozen(options)).toBe(true);
      await moduleRef.close();
    });
  });

  describe('over HTTP (test host)', () => {
    it('answers 401, 403 and 200, and reports a check an app module registered', async () => {
      const app = await boot({ host }, [
        makeCheck('core.database', 'core', async () => ({ status: 'pass', detail: 'Connected' })),
      ]);
      const get = (permissions?: string) =>
        app.inject({
          method: 'GET',
          url: '/api/admin/doctor',
          headers: permissions === undefined ? {} : { [TEST_PERMISSIONS_HEADER]: permissions },
        });

      expect((await get()).statusCode).toBe(401);
      expect((await get('users:read')).statusCode).toBe(403);
      const ok = await get('system_settings:read');
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ verdict: 'pass', checks: [{ id: 'core.database', status: 'pass' }] });
      await app.close();
    });

    it('rejects a malformed query with 400', async () => {
      const app = await boot({ host });
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/doctor?refresh=yes',
        headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' },
      });

      expect(response.statusCode).toBe(400);
      await app.close();
    });

    it('serves the route at a custom path', async () => {
      const app = await boot({ host, path: 'ops/health-report' });
      const response = await app.inject({
        method: 'GET',
        url: '/api/ops/health-report',
        headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });

    it('honours categoryOrder, defaultTimeoutMs and cacheTtlMs', async () => {
      let runs = 0;
      const app = await boot({ host, categoryOrder: ['billing', 'core'], defaultTimeoutMs: 20, cacheTtlMs: 60_000 }, [
        makeCheck('core.database', 'core', async () => ({ status: 'pass', detail: 'ok' })),
        makeCheck('billing.slow', 'billing', () => {
          runs += 1;
          return new Promise<DoctorCheckOutcome>(() => undefined);
        }),
      ]);
      const get = (query = '') =>
        app.inject({
          method: 'GET',
          url: `/api/admin/doctor${query}`,
          headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' },
        });

      const first = (await get()).json();
      expect(first.checks.map((c: { id: string }) => c.id)).toEqual(['billing.slow', 'core.database']);
      expect(first.checks[0]).toMatchObject({ status: 'fail', detail: 'Timed out after 20ms' });

      await get();
      expect(runs).toBe(1);
      await get('?refresh=true');
      expect(runs).toBe(2);
      await app.close();
    });

    it('still throws at boot on a duplicate check id, with the same message', async () => {
      const ok = async (): Promise<DoctorCheckOutcome> => ({ status: 'pass', detail: 'ok' });

      await expect(boot({ host }, [makeCheck('core.database', 'core', ok), makeCheck('core.database', 'core', ok)])).rejects.toThrow(
        'Duplicate doctor check id "core.database": Object and Object both register it. Check ids must be unique.',
      );
    });
  });

  describe('OpenAPI', () => {
    it('documents GET /api/admin/doctor under the Doctor tag, with the generated text', async () => {
      const app = await boot({ host });
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
      const operation = document.paths['/api/admin/doctor']?.get;

      expect(operation?.tags).toEqual(['Doctor']);
      expect(operation?.operationId).toBe('DoctorController_getReport');
      expect(operation?.description).toContain('cut off after 5000 ms');
      expect(operation?.description).toContain('**Cached** for 15 s');
      expect(operation?.description).toContain('Requires `system_settings:read`.');
      const category = operation?.parameters?.find((p) => 'name' in p && p.name === 'category');
      expect(category && 'description' in category ? category.description : '').toContain(
        `Shipped categories: ${PLATFORM_DOCTOR_CATEGORIES.join(', ')}.`,
      );
      await app.close();
    });
  });
});

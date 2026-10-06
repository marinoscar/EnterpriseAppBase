import 'reflect-metadata';

import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { supportBundleSchema } from '@marinoscar/platform-contract/doctor';
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

import { PlatformHostModule } from '../../../src/core';
import {
  DoctorCheck,
  DoctorCheckRegistry,
  DoctorModule,
  DoctorModuleOptions,
  SupportBundleRegistry,
  SupportBundleSection,
  omitSupportBundleSection,
} from '../../../src/doctor';
import {
  InMemoryAuditSink,
  TEST_PERMISSIONS_HEADER,
  TEST_REQUIRED_PERMISSIONS_KEY,
  createTestPlatformHost,
} from '../../../src/testing';

const host = createTestPlatformHost();
const ROUTE = '/api/admin/doctor/support-bundle';

/** The test host trusts a header; resolve the caller from the same header. */
function headerPrincipal(request: unknown) {
  const headers = (request as { headers: Record<string, string | undefined> }).headers;
  const permissions = (headers[TEST_PERMISSIONS_HEADER] ?? '').split(',').filter(Boolean);
  return { userId: 'user-7', permissions };
}

/** "The app": a check and a section that register themselves without importing DoctorModule. */
function appModule(sections: SupportBundleSection[]) {
  const check: DoctorCheck = {
    id: 'core.thing',
    category: 'core',
    label: 'Thing',
    run: async () => ({ status: 'pass', detail: 'answered from 10.9.8.7' }),
  };

  @Injectable()
  class Contributor implements OnModuleInit {
    constructor(
      private readonly checks: DoctorCheckRegistry,
      private readonly bundles: SupportBundleRegistry,
    ) {}
    onModuleInit(): void {
      this.checks.register(check);
      for (const section of sections) this.bundles.register(section);
    }
  }

  @Module({ providers: [Contributor] })
  class AppFeatureModule {}

  return AppFeatureModule;
}

async function boot(options: Partial<DoctorModuleOptions> = {}, sections: SupportBundleSection[] = []) {
  const audit = new InMemoryAuditSink();
  const moduleRef = await Test.createTestingModule({
    imports: [
      PlatformHostModule.forRoot({ audit: { useFactory: () => audit } }),
      DoctorModule.forRoot({ host, supportBundle: { appSlug: 'acme', principal: headerPrincipal }, ...options }),
      appModule(sections),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, audit };
}

const telemetrySection: SupportBundleSection<{ verdict: string }> = {
  id: 'telemetry',
  label: 'Telemetry',
  permission: 'telemetry:query',
  schema: z.object({ verdict: z.string() }).strict(),
  collect: async () => ({ verdict: 'ok' }),
};

describe('GET /api/admin/doctor/support-bundle (DoctorModule.forRoot, test host)', () => {
  it('creates SupportBundleController next to DoctorController, gated by the Doctor permission', () => {
    const controllers = DoctorModule.forRoot({ host }).controllers!;
    const controller = controllers[1]!;

    expect(controllers.map((c) => c.name)).toEqual(['DoctorController', 'SupportBundleController']);
    expect(Reflect.getMetadata('path', controller)).toBe('admin/doctor');
    expect(Reflect.getMetadata(TEST_REQUIRED_PERMISSIONS_KEY, controller.prototype.download)).toEqual(['system_settings:read']);
  });

  it('refuses 401 without a caller and 403 without the permission', async () => {
    const { app, audit } = await boot();

    expect((await app.inject({ method: 'GET', url: ROUTE })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: ROUTE, headers: { [TEST_PERMISSIONS_HEADER]: 'users:read' } })).statusCode).toBe(403);
    expect(audit.events).toEqual([]);
    await app.close();
  });

  it('sends a JSON attachment that parses with the contract, with the built-in sections', async () => {
    const { app, audit } = await boot({}, [telemetrySection]);

    const response = await app.inject({ method: 'GET', url: ROUTE, headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' } });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="support-bundle-acme-\d{8}T\d{6}Z\.json"$/);
    const bundle = supportBundleSchema.parse(JSON.parse(response.body));
    expect(Object.keys(bundle.sections).sort()).toEqual(['doctor', 'meta', 'telemetry']);
    expect(bundle.sections.telemetry).toEqual({ status: 'omitted', reason: 'requires the telemetry:query permission' });

    const doctor = bundle.sections.doctor as { status: 'ok'; data: { checks: Array<{ id: string; detail: string }> } };
    expect(doctor.data.checks).toEqual([expect.objectContaining({ id: 'core.thing', detail: 'answered from [ip]' })]);

    const meta = bundle.sections.meta as { status: 'ok'; data: { platformPackages: Record<string, string>; sections: string[] } };
    expect(meta.data.platformPackages['@marinoscar/platform-api']).toEqual(expect.any(String));
    expect([...meta.data.sections].sort()).toEqual(['doctor', 'meta', 'telemetry']);
    expect(response.body).not.toContain('user-7');

    expect(audit.events).toEqual([
      expect.objectContaining({ action: 'support_bundle:download', actorUserId: 'user-7', targetType: 'deployment', targetId: 'support_bundle' }),
    ]);
    await app.close();
  });

  it('includes a permission-gated section for a caller who holds it, and an omission it returns', async () => {
    const off: SupportBundleSection = {
      id: 'egress',
      label: 'Egress',
      schema: z.object({}).strict(),
      collect: async () => omitSupportBundleSection('not configured'),
    };
    const { app } = await boot({}, [telemetrySection, off]);

    const response = await app.inject({
      method: 'GET',
      url: ROUTE,
      headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read,telemetry:query' },
    });
    const bundle = supportBundleSchema.parse(JSON.parse(response.body));

    expect(bundle.sections.telemetry).toEqual({ status: 'ok', data: { verdict: 'ok' } });
    expect(bundle.sections.egress).toEqual({ status: 'omitted', reason: 'not configured' });
    await app.close();
  });

  it('refuses 403 when the caller cannot be resolved', async () => {
    const { app } = await boot({ supportBundle: { principal: () => null } });

    const response = await app.inject({ method: 'GET', url: ROUTE, headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' } });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('serves nothing with supportBundle: false, but still provides the registry', async () => {
    const dynamic = DoctorModule.forRoot({ host, supportBundle: false });
    const { app } = await boot({ supportBundle: false }, [telemetrySection]);

    expect(dynamic.controllers!.map((c) => c.name)).toEqual(['DoctorController']);
    expect((await app.inject({ method: 'GET', url: ROUTE, headers: { [TEST_PERMISSIONS_HEADER]: 'system_settings:read' } })).statusCode).toBe(404);
    expect(app.get(SupportBundleRegistry).list().map((s) => s.id)).toEqual(['telemetry']);
    await app.close();
  });

  it('validates its options', () => {
    expect(() => DoctorModule.forRoot({ host, supportBundle: { appSlug: 'My App' } })).toThrow(/appSlug/);
    expect(() => DoctorModule.forRoot({ host, supportBundle: { sectionTimeoutMs: 0 } })).toThrow(/sectionTimeoutMs/);
    expect(() => DoctorModule.forRoot({ host, supportBundle: { principal: 'x' as never } })).toThrow(/principal/);
    expect(() => DoctorModule.forRoot({ host, supportBundle: 'yes' as never })).toThrow(/supportBundle/);
  });

  it('is documented in OpenAPI under the Doctor tag, producing application/json', async () => {
    const { app } = await boot();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const operation = document.paths[ROUTE]?.get;

    expect(operation?.tags).toEqual(['Doctor']);
    expect(operation?.operationId).toBe('SupportBundleController_download');
    expect(Object.keys((operation?.responses['200'] as { content: object }).content)).toEqual(['application/json']);
    expect(operation?.description).toContain('Requires `system_settings:read`.');
    expect(operation?.description).toContain('support-bundle-acme-');
    await app.close();
  });
});

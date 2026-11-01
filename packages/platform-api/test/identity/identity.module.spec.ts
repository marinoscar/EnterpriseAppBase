import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';

import { DoctorCheckRegistry, DoctorModule } from '../../src/doctor/index';
import {
  Auth,
  AuthService,
  Public,
  IDENTITY_OPTIONS,
  IdentityModule,
  JwtAuthGuard,
  PrincipalCache,
  TenancyService,
  authProviderRegistry,
  identityConfiguration,
  requireJwtSecret,
  resolveIdentityModuleOptions,
  type ResolvedIdentityModuleOptions,
} from '../../src/identity/index';
import { createStubIdentityHost } from '../../src/identity/testing/index';
import { createTestPlatformHost } from '../../src/testing/index';
import { prismaMock, resetPrismaMock } from './support/prisma.mock';

// =============================================================================
// IdentityModule.forRoot boots with stub host ports and no app (#727)
// =============================================================================
//
// The whole identity provider graph resolves against the stub host
// (`createStubIdentityHost`, @marinoscar/platform-api/identity/testing) and
// identity's own configuration: the routes answer, the options are provided
// globally, the two server-only cleanup handlers register through the jobs
// port, every registered sign-in provider is listed, and the test login is
// refused in production. A missing JWT_SECRET fails the boot.
// =============================================================================

const ENV = {
  JWT_SECRET: 'identity-module-spec-secret-0123456789abcdef',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost/api/auth/google/callback',
};

async function boot(env: Record<string, string | undefined>, options: Parameters<typeof IdentityModule.forRoot>[0] = {}) {
  const host = createStubIdentityHost({ prisma: prismaMock, userSettings: { theme: 'system' } });
  const platformHost = createTestPlatformHost();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({ ...identityConfiguration(env), appUrl: 'http://localhost:3535' })] }),
      EventEmitterModule.forRoot(),
      DoctorModule.forRoot({ host: platformHost }),
      IdentityModule.forRoot({ ...options, imports: [host.module] }),
    ],
  }).compile();
  return { moduleRef, host };
}

describe('IdentityModule.forRoot', () => {
  beforeEach(() => resetPrismaMock());

  it('resolves the whole graph against the stub host and provides the options globally', async () => {
    const { moduleRef, host } = await boot(ENV);
    expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    expect(moduleRef.get(PrincipalCache)).toBeInstanceOf(PrincipalCache);
    expect(moduleRef.get(TenancyService).mode()).toBe('single');
    const options = moduleRef.get<ResolvedIdentityModuleOptions>(IDENTITY_OPTIONS);
    expect(options).toMatchObject({ defaultOrgRole: 'viewer', initialAdminEmailEnv: 'INITIAL_ADMIN_EMAIL', enableTestAuth: false });

    await moduleRef.init();
    // The two server-only cleanup job types register through IDENTITY_JOBS, with
    // their permanent type strings.
    expect(host.state.handlers.map((handler) => handler.type).sort()).toEqual(['auth.token.cleanup', 'device-auth.code.cleanup']);
    // The auth.* and tenancy.* Doctor checks register with the Doctor.
    const ids = moduleRef.get(DoctorCheckRegistry).list().map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining(['auth.jwt-secret', 'auth.providers', 'auth.initial-admin', 'auth.principal-cache', 'tenancy.mode']));
    await moduleRef.close();
  });

  it('serves its routes through the real guards: providers are public, /me needs a token', async () => {
    const { moduleRef } = await boot(ENV);
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const providers = await request(app.getHttpServer()).get('/api/auth/providers').expect(200);
      expect(providers.body).toEqual({ data: { providers: [{ name: 'google', enabled: true }] } });
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
      // A worker credential is refused outside /api/nodes before any lookup.
      await request(app.getHttpServer()).get('/api/users').set('Authorization', 'Bearer nod_anything').expect(403);
    } finally {
      await app.close();
    }
  });

  it('lists Google only when configured, in registration order', async () => {
    const { moduleRef } = await boot({ ...ENV, GOOGLE_CLIENT_SECRET: undefined });
    await expect(moduleRef.get(AuthService).getEnabledProviders()).resolves.toEqual([]);
    expect(authProviderRegistry.ids()[0]).toBe('google');
  });

  it('refuses to boot without JWT_SECRET, naming the variable (no fallback secret)', async () => {
    await expect(boot({ ...ENV, JWT_SECRET: undefined })).rejects.toThrow(/JWT_SECRET is not set/);
    expect(() => requireJwtSecret({ get: () => '  ' })).toThrow(/no built-in fallback/);
    expect(requireJwtSecret({ get: () => 'a-real-secret' })).toBe('a-real-secret');
  });

  it('mounts the test login only when asked, and never in production', async () => {
    const withLogin = await boot(ENV, { enableTestAuth: true });
    const app = withLogin.moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      // Mounted: a validation error, not a 404.
      await request(app.getHttpServer()).post('/api/auth/test/login').send({}).expect(400);
    } finally {
      await app.close();
    }
    expect(() => resolveIdentityModuleOptions({ enableTestAuth: true }, 'production')).toThrow(/refused in production/);
  });

  it('validates its options, naming the field', () => {
    expect(() => resolveIdentityModuleOptions({ defaultOrgRole: 'admin' })).toThrow(/system role/);
    expect(() => resolveIdentityModuleOptions({ defaultOrgRole: 'Not A Role' })).toThrow(/defaultOrgRole/);
    expect(() => resolveIdentityModuleOptions({ initialAdminEmailEnv: 'lower' })).toThrow(/initialAdminEmailEnv/);
    expect(resolveIdentityModuleOptions({ defaultOrgRole: 'contributor', initialAdminEmailEnv: 'BOOTSTRAP_ADMIN' })).toMatchObject({
      defaultOrgRole: 'contributor',
      initialAdminEmailEnv: 'BOOTSTRAP_ADMIN',
    });
  });

  it('guards an app controller with the slice decorators', async () => {
    @Controller('probe')
    class ProbeController {
      @Get('open') @Public() open() { return { ok: true }; }
      @Get('closed') @Auth() closed() { return { ok: true }; }
    }
    expect(Reflect.getMetadata('__guards__', ProbeController.prototype.closed)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata('isPublic', ProbeController.prototype.open)).toBe(true);
    expect(EventEmitter2).toBeDefined();
  });
});

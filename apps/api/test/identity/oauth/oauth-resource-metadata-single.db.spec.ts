// =============================================================================
// Protected resource metadata with exactly ONE registered resource (real Postgres, PP-15.6, #1184)
// =============================================================================
//
// The bare path `/api/oauth/.well-known/protected-resource` (published at `/.well-known/oauth-protected-resource`) answers
// the deployment's only resource, and 404s once there are two (proven in oauth-resource-metadata.db.spec.ts, which
// registers two). A registry is per process and frozen at boot, so the one-resource case is its own suite.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL;

import { randomUUID } from 'node:crypto';

import { Controller, Get, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { Auth, OAuthServerSettingsReader, registerOAuthProtectedResource, registerOAuthScope } from '@marinoscar/platform-api/identity';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-resource-metadata-single.db.spec');

registerOAuthScope({ id: 'osone_items:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthProtectedResource({ id: 'oauth-one', path: '/api/oauth-one', routePrefixes: ['/api/oauth-one'], scopes: ['osone_items:read'], name: 'The only resource' });

@Controller('oauth-one')
class OAuthOneController {
  @Get('items')
  @Auth({ permissions: ['users:read'] })
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [OAuthOneController] })
class OAuthOneModule {}

describeWithDb('OAuth protected resource metadata with one resource (real Postgres, #1184)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let actor: string;
  let appUrl: string;
  const http = () => request(app.getHttpServer());
  const run = randomUUID().slice(0, 8);

  async function setEnabled(enabled: boolean) {
    await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled } } as never, actor);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  beforeAll(async () => {
    client = createDbClient();
    actor = (await client.user.create({ data: { email: `osone-${run}@example.test`, isActive: true }, select: { id: true } })).id;
    const module = await Test.createTestingModule({ imports: [AppModule, OAuthOneModule] }).overrideProvider(JobWorker).useValue({}).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.register(multipart);
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    await setEnabled(true);
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setEnabled(false);
    } finally {
      await app?.close();
      await client.auditEvent.deleteMany({ where: { actorUserId: actor } });
      await client.user.deleteMany({ where: { id: actor } });
      await client.$disconnect();
    }
  });

  it('serves the only resource at the bare path, identical to its path form', async () => {
    const bare = await http().get('/api/oauth/.well-known/protected-resource').expect(200);
    const byPath = await http().get('/api/oauth/.well-known/protected-resource/api/oauth-one').expect(200);
    expect(bare.body).toEqual(byPath.body);
    expect(bare.body).toEqual({
      resource: `${appUrl}/api/oauth-one`,
      authorization_servers: [appUrl],
      scopes_supported: ['osone_items:read', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'The only resource',
    });
    expect(bare.headers['cache-control']).toBe('public, max-age=300');
    expect(bare.headers['access-control-allow-origin']).toBe('*');
  });

  it('404s while the server is disabled', async () => {
    await setEnabled(false);
    try {
      await http().get('/api/oauth/.well-known/protected-resource').expect(404);
    } finally {
      await setEnabled(true);
    }
  });

  it('the challenge of the only resource names its metadata URL', async () => {
    const res = await http().get('/api/oauth-one/items').expect(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource/api/oauth-one"`);
  });
});

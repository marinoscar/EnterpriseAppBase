// =============================================================================
// The OAuth server's database-tier conformance, audit and metrics (PP-15.8, #1186)
// =============================================================================
//
// Drives a real flow through the whole app with the test kit
// (`runOAuthAuthorizationCodeFlow`, `exchangeOAuthCode`, `mintOAuthTestToken`) and
// proves:
//   - `secret-egress`: no token, code, secret or hash in a grants or clients
//     response, an audit row or a captured log line (the suite's tenth check, which
//     needs a database; the unit-tier entry skips it with a pointer here);
//   - the audit actions `oauth:grant.create|update|revoke`, `oauth:consent.deny`
//     and `oauth:settings.update` are written, with no secret;
//   - the metrics carry only their declared, closed labels;
//   - the events fire after the commit with ids only;
//   - the kit's minted token is confined (403 outside its resource).
//
// THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { randomUUID } from 'node:crypto';

import { ConsoleLogger, Controller, Get, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { AppMetricsService } from '@marinoscar/platform-api/host';
import {
  Auth,
  AuthService,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import {
  checkOAuthSecretEgress,
  createOAuthTestClient,
  exchangeOAuthCode,
  mintOAuthTestToken,
  runOAuthAuthorizationCodeFlow,
} from '@marinoscar/platform-api/identity/testing';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-conformance.db.spec');

registerOAuthScope({ id: 'ocf:read', title: 'Read', description: 'Read.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthProtectedResource({ id: 'oauth-ocf', path: '/api/oauth-ocf', routePrefixes: ['/api/oauth-ocf'], scopes: ['ocf:read'], name: 'Conformance test resource' });

@Controller('oauth-ocf')
class OcfController {
  @Get('items')
  @Auth({ permissions: ['users:read'] })
  list() {
    return { ok: true };
  }
}
@Module({ controllers: [OcfController] })
class OcfModule {}

describeWithDb('OAuth server: secret egress, audit, metrics and events (real Postgres, #1186)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  const run = randomUUID().slice(0, 8);
  const suiteStart = new Date();
  const created = { users: [] as string[], roles: [] as string[], clients: [] as string[], permissions: [] as string[] };
  const logLines: string[] = [];
  const secrets: string[] = [];
  const metricCalls: Array<{ key: string; value: number | undefined; attributes: Record<string, unknown> | undefined }> = [];
  const events: Array<{ name: string; payload: unknown }> = [];
  let restoreLogger: () => void = () => undefined;
  let defaultOrgId: string;
  let userId: string;
  let appUrl: string;
  let session: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    if (!(await client.permission.findUnique({ where: { name: 'users:read' } }))) {
      created.permissions.push((await client.permission.create({ data: { name: 'users:read', scope: 'system' } })).id);
    }
    const roleId = (await client.role.create({ data: { name: `ocf_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId);
    const permission = await client.permission.findUniqueOrThrow({ where: { name: 'users:read' } });
    await client.rolePermission.create({ data: { roleId, permissionId: permission.id } });

    const module = await Test.createTestingModule({ imports: [AppModule, OcfModule] }).overrideProvider(JobWorker).useValue({}).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.register(multipart);
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const record = (level: string) => (...args: unknown[]) => void logLines.push(`${level} ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
    Logger.overrideLogger({ log: record('log'), error: record('error'), warn: record('warn'), debug: record('debug'), verbose: record('verbose'), fatal: record('fatal') });
    restoreLogger = () => Logger.overrideLogger(new ConsoleLogger());
    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');

    const metrics = app.get(AppMetricsService);
    const realAdd = metrics.add.bind(metrics);
    jest.spyOn(metrics, 'add').mockImplementation((key, value, attributes) => {
      metricCalls.push({ key: String(key), value, attributes });
      return realAdd(key, value, attributes);
    });
    const emitter = app.get(EventEmitter2);
    const realEmit = emitter.emit.bind(emitter);
    jest.spyOn(emitter, 'emit').mockImplementation(((name: string, payload: unknown) => {
      if (String(name).startsWith('identity.oauth.')) events.push({ name: String(name), payload });
      return realEmit(name, payload);
    }) as never);
    jest.spyOn(app.get(OAuthRateLimitService), 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    userId = (await client.user.create({ data: { email: `ocf-${run}@example.test`, isActive: true }, select: { id: true } })).id;
    created.users.push(userId);
    await client.membership.create({ data: { orgId: defaultOrgId, userId, roleId } });
    const graph = await client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    session = (await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId })).accessToken;
    secrets.push(session);
    await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled: true, allowedClientHosts: ['client.example.test'] } } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) {
        await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled: false, allowedClientHosts: [] } } as never, userId);
        app.get(OAuthServerSettingsReader).invalidate();
      }
    } finally {
      restoreLogger();
      await app?.close();
      await client.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: created.users } }, { targetType: { in: ['oauth_grant', 'oauth_client', 'oauth_settings'] }, createdAt: { gte: suiteStart } }] } });
      await client.oAuthClient.deleteMany({ where: { OR: [{ id: { in: created.clients } }, { createdAt: { gte: suiteStart } }] } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  it('a real flow leaks no secret into a grants response, an audit row or a log line (secret-egress), and writes the audit rows, events and metrics', async () => {
    const made = await createOAuthTestClient(client as never, { tokenEndpointAuthMethod: 'client_secret_post' });
    created.clients.push(made.id);
    secrets.push(made.secret!);
    const resource = `${appUrl}/api/oauth-ocf`;

    // approved (create), approved again (update), denied
    const first = await runOAuthAuthorizationCodeFlow(app, { client: made, user: { sessionToken: session }, scopes: ['ocf:read', 'offline_access'], resource });
    secrets.push(first.code!, first.pkce.verifier);
    expect(first.iss).toBe(appUrl);
    const exchanged = await exchangeOAuthCode(app, { client: made, code: first.code!, verifier: first.pkce.verifier });
    expect(exchanged.status).toBe(200);
    const access = exchanged.body.access_token as string;
    const refresh = exchanged.body.refresh_token as string;
    secrets.push(access, refresh);
    await http().get('/api/oauth-ocf/items').set(bearer(access)).expect(200);

    const again = await runOAuthAuthorizationCodeFlow(app, { client: made, user: { sessionToken: session }, scopes: ['ocf:read'], resource });
    secrets.push(again.code!, again.pkce.verifier);
    const denied = await runOAuthAuthorizationCodeFlow(app, { client: made, user: { sessionToken: session }, scopes: ['ocf:read'], resource, decision: 'deny' });
    expect(denied.redirectTo).toContain('error=access_denied');

    // the responses of the grants route, then revoke
    const responses: unknown[] = [];
    const list = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
    responses.push(list.body);
    const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId, clientId: made.id, revokedAt: null } });
    await http().delete(`/api/oauth/grants/${grant.id}`).set(bearer(session)).expect(204);
    await http().get('/api/oauth-ocf/items').set(bearer(access)).expect(401);

    const auditRows = await client.auditEvent.findMany({ where: { createdAt: { gte: suiteStart }, action: { startsWith: 'oauth:' } } });
    const actions = auditRows.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['oauth:grant.create', 'oauth:grant.update', 'oauth:consent.deny', 'oauth:grant.revoke', 'oauth:settings.update']));

    // secret-egress: the suite's tenth check, over this real evidence
    expect(checkOAuthSecretEgress({ secrets, responses, auditRows, logLines })).toEqual([]);

    // settings audit: names the fields, never a secret
    const settingsRow = auditRows.find((row) => row.action === 'oauth:settings.update')!;
    expect(settingsRow.actorUserId).toBe(userId);
    expect(JSON.stringify(settingsRow.meta)).toContain('enabled');

    // events: after the commit, ids and closed values only
    const created1 = events.find((event) => event.name === 'identity.oauth.grant.created');
    expect(created1?.payload).toMatchObject({ userId, clientId: made.id, resourceId: 'oauth-ocf', reason: 'created' });
    expect(events.find((event) => event.name === 'identity.oauth.grant.revoked')?.payload).toMatchObject({ grantId: grant.id, reason: 'user' });
    expect(JSON.stringify(events)).not.toMatch(/oat_|ort_|oac_/);

    // metrics: only the declared keys and labels, every label a closed value
    const oauth = metricCalls.filter((call) => call.key.startsWith('oauth'));
    expect(oauth.map((call) => call.key)).toEqual(expect.arrayContaining(['oauthAuthorizations', 'oauthTokensIssued']));
    const allowed: Record<string, string[]> = {
      oauthAuthorizations: ['outcome'],
      oauthTokensIssued: ['grant_type'],
      oauthTokenRefusals: ['reason'],
      oauthClientRegistrations: ['kind'],
    };
    for (const call of oauth) {
      expect(Object.keys(call.attributes ?? {})).toEqual(allowed[call.key]);
      expect(JSON.stringify(call.attributes)).not.toContain(made.clientId);
    }
    expect(oauth.filter((call) => call.key === 'oauthAuthorizations').map((call) => call.attributes?.outcome)).toEqual(expect.arrayContaining(['approved', 'denied']));
  });

  it('a token minted by the kit is confined: 403 outside its resource, 200 inside', async () => {
    const minted = await mintOAuthTestToken(client as never, { userId, resourceId: 'oauth-ocf', scopes: ['ocf:read'], appUrl, orgId: defaultOrgId });
    created.clients.push(minted.clientRowId);
    await http().get('/api/oauth-ocf/items').set(bearer(minted.token)).expect(200);
    await http().get('/api/users').set(bearer(minted.token)).expect(403);
    await http().get('/api/auth/me').set(bearer(minted.token)).expect(403);
  });

  it('a refused token request counts under its RFC 6749 error code only', async () => {
    const before = metricCalls.length;
    await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'ort_nope', client_id: 'oc_does_not_exist' }).expect(401);
    const refusal = metricCalls.slice(before).find((call) => call.key === 'oauthTokenRefusals');
    expect(refusal?.attributes).toEqual({ reason: 'invalid_client' });
  });
});

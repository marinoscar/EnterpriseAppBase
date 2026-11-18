// =============================================================================
// OAuth client identity and the client trust policy on real Postgres, through
// the whole app (PP-15.5, #1183)
// =============================================================================
//
// Boots the reference app and drives the three ways a client identifies itself
// AS A CLIENT WOULD, over HTTP: a Client ID Metadata Document URL (the CIMD
// transport and DNS resolver are SCRIPTED PORTS: no test touches the network),
// dynamic registration (`POST /api/oauth/register`) and a pre-registered client
// (the admin API). Plus the trust policy at `/authorize`, `/register` and
// `/token`, the metadata flags, the daily cleanup job, the admin RBAC matrix and
// the "no secret, no fetched body in the logs" rule.
//
// THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { createHash, randomUUID } from 'node:crypto';

import { ConsoleLogger, Controller, Get, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { PinnedGetError, type HostResolver, type PinnedGetRequest, type PinnedGetResponse, type PinnedGetTransport } from '@marinoscar/platform-api/core';
import {
  Auth,
  AuthService,
  CimdFetcher,
  ClientRefusalRecorder,
  OAuthClientCleanupHandler,
  OAuthClientCleanupTask,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import { createOAuthTestClient, createOAuthTestPkce, type OAuthTestClient } from '@marinoscar/platform-api/identity/testing';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-clients.db.spec');

// ---- the test-only resource, registered at import time (before the app boots) -------------

registerOAuthScope({ id: 'clitems:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthProtectedResource({
  id: 'oauth-cl-test',
  path: '/api/oauth-cl-test',
  routePrefixes: ['/api/oauth-cl-test'],
  scopes: ['clitems:read'],
  name: 'Client identity test resource',
});

@Controller('oauth-cl-test')
class OAuthClTestController {
  @Get('items')
  @Auth({ permissions: ['users:read'] })
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [OAuthClTestController] })
class OAuthClTestModule {}

// ---- scripted ports ------------------------------------------------------------------------

type Answer = PinnedGetResponse | Error;
const FETCH_MARKER = 'FETCHED-DOCUMENT-MARKER-TEXT';
const json = (body: unknown, headers: Record<string, string> = {}): PinnedGetResponse => ({ status: 200, headers, body: Buffer.from(JSON.stringify(body)) });

class ScriptedTransport implements PinnedGetTransport {
  readonly calls: string[] = [];
  private readonly answers = new Map<string, Answer>();
  set(url: string, answer: Answer): void {
    this.answers.set(url, answer);
  }
  async get(req: PinnedGetRequest): Promise<PinnedGetResponse> {
    this.calls.push(req.target.url.href);
    const answer = this.answers.get(req.target.url.href);
    if (!answer) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describeWithDb('OAuth client identity and the trust policy through the whole app (real Postgres, #1183)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  const run = randomUUID().slice(0, 8);
  const suiteStart = new Date();
  const created = { users: [] as string[], roles: [] as string[], clients: [] as string[], permissions: [] as string[], rolePermissions: [] as string[] };
  let defaultOrgId: string;
  let roleId: string;
  let viewerRoleId: string;
  let adminRoleId: string;
  let appUrl: string;
  let resourceUrl: string;
  let actorUserId: string;
  const logLines: string[] = [];
  const secrets: string[] = [];
  let restoreLogger: () => void = () => undefined;
  let limiterMode: 'off' | 'real' = 'off';
  const transport = new ScriptedTransport();
  let dnsAnswer: Array<{ address: string; family: 4 | 6 }> = [{ address: '93.184.216.34', family: 4 }];

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function makeUser(label: string, options: { admin?: boolean; viewer?: boolean } = {}) {
    const user = await client.user.create({ data: { email: `oclients-${label}-${run}@example.test`, isActive: true }, select: { id: true } });
    created.users.push(user.id);
    await client.membership.create({ data: { orgId: defaultOrgId, userId: user.id, roleId: options.viewer ? viewerRoleId : roleId } });
    if (options.admin) await client.userRole.create({ data: { userId: user.id, roleId: adminRoleId } });
    return user.id;
  }

  async function sessionToken(userId: string): Promise<string> {
    const graph = await client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId });
    secrets.push(tokens.accessToken);
    return tokens.accessToken;
  }

  /** Patches the `oauthServer` settings and drops the reader cache. */
  async function setSettings(patch: Record<string, unknown>) {
    await app.get(SystemSettingsService).patchSettings({ oauthServer: patch } as never, actorUserId);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  const DEFAULT_SETTINGS = { enabled: true, clientIdMetadataDocuments: true, dynamicClientRegistration: true, allowedClientHosts: [] as string[], allowAnyClientHost: false, allowLoopbackClients: true, dynamicClientUnusedDays: 7 };
  const resetSettings = () => setSettings(DEFAULT_SETTINGS);

  const pkce = createOAuthTestPkce();
  const authorizeQuery = (clientId: string, redirectUri: string, over: Record<string, string> = {}) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'clitems:read',
    state: 'state-1',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    resource: resourceUrl,
    ...over,
  });
  const authorize = (clientId: string, redirectUri: string, over: Record<string, string> = {}) => http().get('/api/oauth/authorize').query(authorizeQuery(clientId, redirectUri, over));
  const errorPage = (res: request.Response) => {
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location!);
    expect(`${url.origin}${url.pathname}`).toBe(`${appUrl}/oauth/error`);
    return { code: url.searchParams.get('code'), host: url.searchParams.get('host') };
  };
  const reachesConsent = (res: request.Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${appUrl}/oauth/consent?request=`);
  };

  const register = (body: Record<string, unknown>) => http().post('/api/oauth/register').send(body);
  const dcr = (over: Record<string, unknown> = {}) => ({ redirect_uris: ['https://dcr.example.test/callback'], client_name: 'Client Gamma', ...over });

  const refusedRows = (host: string) => client.auditEvent.findMany({ where: { action: 'oauth:client.refused', targetType: 'oauth_client', targetId: host } });

  // ---- CIMD documents ------------------------------------------------------------------------

  const CIMD_HOST = 'cimd.example.test';
  const cimdUrl = (name: string) => `https://${CIMD_HOST}/clients/${name}.json`;
  const cimdDoc = (name: string, over: Record<string, unknown> = {}) => ({
    client_id: cimdUrl(name),
    client_name: `Client ${FETCH_MARKER}`,
    redirect_uris: [`https://${CIMD_HOST}/callback`],
    ...over,
  });

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;

    // The permissions this suite relies on exist (a freshly migrated database may predate the seed).
    const ensurePermission = async (name: string) => {
      const existing = await client.permission.findUnique({ where: { name } });
      if (existing) return existing.id;
      const row = await client.permission.create({ data: { name, scope: 'system' } });
      created.permissions.push(row.id);
      return row.id;
    };
    const usersRead = await ensurePermission('users:read');
    const clientsRead = await ensurePermission('oauth_clients:read');
    const clientsWrite = await ensurePermission('oauth_clients:write');

    const admin = await client.role.findUnique({ where: { name: 'admin' } });
    adminRoleId = admin?.id ?? (await client.role.create({ data: { name: 'admin', scope: 'system' }, select: { id: true } })).id;
    for (const permissionId of [clientsRead, clientsWrite]) {
      const has = await client.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: adminRoleId, permissionId } } });
      if (!has) {
        await client.rolePermission.create({ data: { roleId: adminRoleId, permissionId } });
        created.rolePermissions.push(`${adminRoleId}:${permissionId}`);
      }
    }

    roleId = (await client.role.create({ data: { name: `oclients_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    viewerRoleId = (await client.role.create({ data: { name: `oclients_viewer_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId, viewerRoleId);
    await client.rolePermission.create({ data: { roleId, permissionId: usersRead } });
    await client.rolePermission.create({ data: { roleId: viewerRoleId, permissionId: usersRead } });

    const module = await Test.createTestingModule({ imports: [AppModule, OAuthClTestModule] })
      .overrideProvider(JobWorker)
      .useValue({})
      .compile();
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
    resourceUrl = `${appUrl}/api/oauth-cl-test`;

    // Scripted ports: no test of this suite touches the network.
    const fetcher = app.get(CimdFetcher) as unknown as { transport: PinnedGetTransport; resolver: HostResolver };
    fetcher.transport = transport;
    fetcher.resolver = { resolveAll: async () => dnsAnswer };

    // One source address in the suite: the limiter is off except in its own test.
    const limiter = app.get(OAuthRateLimitService);
    const real = limiter.consume.bind(limiter);
    jest.spyOn(limiter, 'consume').mockImplementation((key, limit, windowMs) => (limiterMode === 'real' ? real(key, limit, windowMs) : { allowed: true, retryAfterSeconds: 0 }));

    actorUserId = await makeUser('actor');
    await resetSettings();
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setSettings({ ...DEFAULT_SETTINGS, enabled: false });
    } finally {
      restoreLogger();
      await app?.close();
      await client.job.deleteMany({ where: { type: 'oauth.client.cleanup', createdAt: { gte: suiteStart } } });
      await client.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: created.users } }, { targetType: 'oauth_client', createdAt: { gte: suiteStart } }] } });
      await client.oAuthClient.deleteMany({ where: { OR: [{ id: { in: created.clients } }, { createdAt: { gte: suiteStart } }] } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      for (const key of created.rolePermissions) {
        const [rid, pid] = key.split(':');
        await client.rolePermission.deleteMany({ where: { roleId: rid, permissionId: pid } });
      }
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  beforeEach(async () => {
    limiterMode = 'off';
    dnsAnswer = [{ address: '93.184.216.34', family: 4 }];
    await resetSettings();
  });

  // ---------------------------------------------------------------------------------------------

  describe('Client ID Metadata Documents', () => {
    beforeEach(() => setSettings({ allowedClientHosts: [CIMD_HOST] }));

    it('fetches on the first authorize, stores the client, uses the cache the second time, refetches when expired and falls back to the stale copy on a failing refetch', async () => {
      const id = cimdUrl('happy');
      transport.set(id, json(cimdDoc('happy'), { 'cache-control': 'max-age=3600' }));
      const redirect = `https://${CIMD_HOST}/callback`;
      const before = transport.calls.length;

      reachesConsent(await authorize(id, redirect));
      expect(transport.calls.length - before).toBe(1);
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { clientId: id } });
      created.clients.push(row.id);
      expect(row).toMatchObject({ kind: 'cimd', host: CIMD_HOST, tokenEndpointAuthMethod: 'none', redirectUris: [redirect] });
      expect(row.metadataFetchedAt).not.toBeNull();
      const life = row.metadataExpiresAt!.getTime() - row.metadataFetchedAt!.getTime();
      expect(life).toBeGreaterThanOrEqual(5 * 60_000);
      expect(life).toBeLessThanOrEqual(24 * 3_600_000);

      // second authorize: the cache, no fetch
      reachesConsent(await authorize(id, redirect));
      expect(transport.calls.length - before).toBe(1);

      // expired cache: refetch (and the new name is stored)
      transport.set(id, json(cimdDoc('happy', { client_name: 'Renamed Client' }), { 'cache-control': 'max-age=3600' }));
      await client.oAuthClient.update({ where: { id: row.id }, data: { metadataExpiresAt: new Date(Date.now() - 1000) } });
      reachesConsent(await authorize(id, redirect));
      expect(transport.calls.length - before).toBe(2);
      expect((await client.oAuthClient.findUniqueOrThrow({ where: { id: row.id } })).name).toBe('Renamed Client');

      // expired cache and the refetch fails: the stale copy is used, with a warning
      transport.set(id, new PinnedGetError('network', 'down'));
      await client.oAuthClient.update({ where: { id: row.id }, data: { metadataExpiresAt: new Date(Date.now() - 1000) } });
      const warnsBefore = logLines.length;
      reachesConsent(await authorize(id, redirect));
      expect(transport.calls.length - before).toBe(3);
      expect(logLines.slice(warnsBefore).some((line) => line.startsWith('warn') && line.includes('cached copy'))).toBe(true);
    });

    it('without a cached copy, a failing fetch is the error page client_metadata_unavailable', async () => {
      const id = cimdUrl('unavailable');
      transport.set(id, new PinnedGetError('network', 'down'));
      expect(errorPage(await authorize(id, `https://${CIMD_HOST}/callback`)).code).toBe('client_metadata_unavailable');
      expect(await client.oAuthClient.findUnique({ where: { clientId: id } })).toBeNull();
    });

    it.each([
      ['a client_id that differs from the URL', 'mismatch', () => json(cimdDoc('mismatch', { client_id: cimdUrl('other') }))],
      ['no redirect_uris', 'noredirects', () => json(cimdDoc('noredirects', { redirect_uris: undefined }))],
      ['a body that is not JSON', 'notjson', () => ({ status: 200, headers: {}, body: Buffer.from(`<html>${FETCH_MARKER}</html>`) })],
      ['a body over 64 KiB', 'toobig', () => new PinnedGetError('too_large', 'big')],
      ['a body over 64 KiB that the transport did not cap', 'toobig2', () => ({ status: 200, headers: {}, body: Buffer.alloc(64 * 1024 + 1, 0x20) })],
      ['a slow server (timeout)', 'slow', () => new PinnedGetError('timeout', 'slow')],
      ['a redirect response', 'redirect', () => ({ status: 302, headers: { location: 'https://elsewhere.example.test/x' }, body: Buffer.alloc(0) })],
      ['a confidential client', 'confidential', () => json(cimdDoc('confidential', { token_endpoint_auth_method: 'private_key_jwt' }))],
    ])('refuses a document with %s: client_metadata_unavailable and no client row', async (_label, name, answer) => {
      const id = cimdUrl(name);
      transport.set(id, answer());
      expect(errorPage(await authorize(id, `https://${CIMD_HOST}/callback`)).code).toBe('client_metadata_unavailable');
      expect(await client.oAuthClient.findUnique({ where: { clientId: id } })).toBeNull();
    });

    it('refuses a host that resolves to a private or loopback address (the egress guard) without a request', async () => {
      for (const [name, address] of [['private', '10.0.0.7'], ['loopback', '127.0.0.1']] as const) {
        dnsAnswer = [{ address, family: 4 }];
        const id = cimdUrl(name);
        transport.set(id, json(cimdDoc(name)));
        const before = transport.calls.length;
        expect(errorPage(await authorize(id, `https://${CIMD_HOST}/callback`)).code).toBe('client_metadata_unavailable');
        expect(transport.calls.length).toBe(before);
      }
    });

    it('treats an http URL and a URL with a fragment as opaque ids: unknown_client, and nothing is fetched', async () => {
      const before = transport.calls.length;
      expect(errorPage(await authorize(`http://${CIMD_HOST}/clients/plain.json`, `https://${CIMD_HOST}/callback`)).code).toBe('unknown_client');
      expect(errorPage(await authorize(`${cimdUrl('frag')}#fragment`, `https://${CIMD_HOST}/callback`)).code).toBe('unknown_client');
      expect(transport.calls.length).toBe(before);
    });

    it('with metadata documents switched off, a URL client id is unknown and nothing is fetched', async () => {
      await setSettings({ clientIdMetadataDocuments: false });
      const id = cimdUrl('off');
      transport.set(id, json(cimdDoc('off')));
      const before = transport.calls.length;
      expect(errorPage(await authorize(id, `https://${CIMD_HOST}/callback`)).code).toBe('unknown_client');
      expect(transport.calls.length).toBe(before);
    });

    it('never fetches at the token endpoint', async () => {
      const id = cimdUrl('token');
      transport.set(id, json(cimdDoc('token')));
      const before = transport.calls.length;
      const res = await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'ort_none', client_id: id });
      expect(res.status).toBe(401);
      expect(transport.calls.length).toBe(before);
    });

    it('refuses a redirect URI on another host unless that host is allowed', async () => {
      const id = cimdUrl('crosshost');
      transport.set(id, json(cimdDoc('crosshost', { redirect_uris: ['https://callbacks.example.test/cb'] })));
      expect(errorPage(await authorize(id, 'https://callbacks.example.test/cb'))).toEqual({ code: 'client_not_allowed', host: CIMD_HOST });
      await setSettings({ allowedClientHosts: [CIMD_HOST, 'callbacks.example.test'] });
      reachesConsent(await authorize(id, 'https://callbacks.example.test/cb'));
      const row = await client.oAuthClient.findUnique({ where: { clientId: id } });
      if (row) created.clients.push(row.id);
    });
  });

  describe('the trust policy', () => {
    it('refuses a host that is not on the list: the page names the host, an audit row records it, once per host per hour, and nothing is fetched', async () => {
      await setSettings({ allowedClientHosts: [] });
      const host = `stranger-${run}.example.test`;
      const id = `https://${host}/meta.json`;
      transport.set(id, json({ client_id: id, client_name: 'X', redirect_uris: [`https://${host}/cb`] }));
      const before = transport.calls.length;
      expect(errorPage(await authorize(id, `https://${host}/cb`))).toEqual({ code: 'client_not_allowed', host });
      expect(errorPage(await authorize(id, `https://${host}/cb`))).toEqual({ code: 'client_not_allowed', host });
      expect(transport.calls.length).toBe(before);
      const rows = await refusedRows(host);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'oauth:client.refused', actorUserId: null, meta: { reason: 'host_not_allowed' } });

    });

    it('records a refused host again once the previous row is older than an hour', async () => {
      const host = `later-${run}.example.test`;
      const recorder = app.get(ClientRefusalRecorder);
      const t0 = Date.now();
      expect(await recorder.record(host, 'host_not_allowed', t0)).toBe(true);
      expect(await recorder.record(host, 'host_not_allowed', t0 + 59 * 60_000)).toBe(false);
      await client.auditEvent.updateMany({ where: { targetType: 'oauth_client', targetId: host }, data: { createdAt: new Date(t0 - 2 * 3_600_000) } });
      expect(await recorder.record(host, 'host_not_allowed', t0 + 61 * 60_000)).toBe(true);
      expect(await refusedRows(host)).toHaveLength(2);
    });

    it('proceeds for a host on the list and with allowAnyClientHost', async () => {
      const host = `listed-${run}.example.test`;
      const id = `https://${host}/meta.json`;
      transport.set(id, json({ client_id: id, client_name: 'Listed', redirect_uris: [`https://${host}/cb`] }));
      await setSettings({ allowedClientHosts: [host] });
      reachesConsent(await authorize(id, `https://${host}/cb`));

      const open = `open-${run}.example.test`;
      const openId = `https://${open}/meta.json`;
      transport.set(openId, json({ client_id: openId, client_name: 'Open', redirect_uris: [`https://${open}/cb`] }));
      await setSettings({ allowedClientHosts: [], allowAnyClientHost: true });
      reachesConsent(await authorize(openId, `https://${open}/cb`));
      for (const clientId of [id, openId]) {
        const row = await client.oAuthClient.findUnique({ where: { clientId } });
        if (row) created.clients.push(row.id);
      }
    });

    it('refuses a loopback native client while allowLoopbackClients is off, and admits it while on', async () => {
      const native = await createOAuthTestClient(client as never, { kind: 'dynamic', host: 'loopback', redirectUris: ['http://127.0.0.1/cb'] });
      created.clients.push(native.id);
      reachesConsent(await authorize(native.clientId, 'http://127.0.0.1:54321/cb'));
      await setSettings({ allowLoopbackClients: false });
      expect(errorPage(await authorize(native.clientId, 'http://127.0.0.1:54321/cb'))).toEqual({ code: 'client_not_allowed', host: 'loopback' });
    });

    it('a pre-registered client skips the host list', async () => {
      const registered = await createOAuthTestClient(client as never, { kind: 'registered', host: 'unlisted.example.test', redirectUris: ['https://unlisted.example.test/cb'] });
      created.clients.push(registered.id);
      reachesConsent(await authorize(registered.clientId, registered.redirectUri));
    });

    it('applies at /token: a dynamic client whose host was removed from the list stops authenticating', async () => {
      const host = `token-${run}.example.test`;
      const dyn = await createOAuthTestClient(client as never, { kind: 'dynamic', host, redirectUris: [`https://${host}/cb`] });
      created.clients.push(dyn.id);
      await setSettings({ allowedClientHosts: [host] });
      let res = await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'ort_none', client_id: dyn.clientId });
      expect(res.body.error).toBe('invalid_grant');
      await setSettings({ allowedClientHosts: [] });
      res = await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'ort_none', client_id: dyn.clientId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unauthorized_client');
    });
  });

  describe('dynamic client registration (RFC 7591)', () => {
    beforeEach(() => setSettings({ allowedClientHosts: ['dcr.example.test'] }));

    it('creates a public client', async () => {
      const res = await register(dcr({ redirect_uris: ['https://dcr.example.test/cb-public'], client_name: 'Public One' })).expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.data).toBeUndefined();
      expect(res.body).toMatchObject({
        client_id: expect.stringMatching(/^oc_/),
        client_name: 'Public One',
        token_endpoint_auth_method: 'none',
        redirect_uris: ['https://dcr.example.test/cb-public'],
        client_secret_expires_at: 0,
        client_id_issued_at: expect.any(Number),
        application_type: 'web',
      });
      expect(res.body).not.toHaveProperty('client_secret');
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { clientId: res.body.client_id } });
      created.clients.push(row.id);
      expect(row).toMatchObject({ kind: 'dynamic', host: 'dcr.example.test', secretHash: null });
    });

    it.each(['client_secret_post', 'client_secret_basic'])('creates a confidential client (%s) with a secret returned once and stored hashed', async (method) => {
      const res = await register(dcr({ redirect_uris: [`https://dcr.example.test/cb-${method}`], token_endpoint_auth_method: method })).expect(201);
      const secret = res.body.client_secret as string;
      secrets.push(secret);
      expect(secret.length).toBeGreaterThanOrEqual(32);
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { clientId: res.body.client_id } });
      created.clients.push(row.id);
      expect(row.secretHash).toBe(sha256(secret));
      expect(JSON.stringify(row)).not.toContain(secret);
    });

    it('registers a loopback native client without needing the host list', async () => {
      await setSettings({ allowedClientHosts: [] });
      const res = await register({ redirect_uris: ['http://127.0.0.1:7777/cb'], client_name: 'Native Tool' }).expect(201);
      expect(res.body.application_type).toBe('native');
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { clientId: res.body.client_id } });
      created.clients.push(row.id);
      expect(row.host).toBe('loopback');
    });

    it('accepts a reverse-domain custom scheme only for a native client', async () => {
      await setSettings({ allowedClientHosts: ['com.example.app'] });
      await register({ redirect_uris: ['com.example.app://cb'], application_type: 'web' }).expect(400);
      const ok = await register({ redirect_uris: ['com.example.app://cb'], application_type: 'native' }).expect(201);
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { clientId: ok.body.client_id } });
      created.clients.push(row.id);
    });

    it.each([
      ['mixed hosts', { redirect_uris: ['https://dcr.example.test/a', 'https://other.example.test/b'] }, 'invalid_redirect_uri'],
      ['a fragment', { redirect_uris: ['https://dcr.example.test/a#frag'] }, 'invalid_redirect_uri'],
      ['an http URI that is not loopback', { redirect_uris: ['http://dcr.example.test/a'] }, 'invalid_redirect_uri'],
      ['more than 10 redirect URIs', { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://dcr.example.test/${i}`) }, 'invalid_redirect_uri'],
      ['a redirect URI over 2,000 characters', { redirect_uris: [`https://dcr.example.test/${'a'.repeat(2000)}`] }, 'invalid_redirect_uri'],
      ['no redirect_uris', { redirect_uris: undefined }, 'invalid_redirect_uri'],
      ['a custom scheme without native', { redirect_uris: ['myapp://cb'] }, 'invalid_redirect_uri'],
      ['a name over 200 characters', { client_name: 'n'.repeat(201) }, 'invalid_client_metadata'],
      ['an unsupported auth method', { token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
      ['grant types without authorization_code', { grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    ])('refuses %s with %s', async (_label, over, error) => {
      const before = await client.oAuthClient.count({ where: { createdAt: { gte: suiteStart } } });
      const res = await register(dcr(over)).expect(400);
      expect(res.body.error).toBe(error);
      expect(await client.oAuthClient.count({ where: { createdAt: { gte: suiteStart } } })).toBe(before);
    });

    it('refuses a host that is not allowed with 403 invalid_client_metadata, and records the refusal', async () => {
      const host = `denied-${run}.example.test`;
      const res = await register(dcr({ redirect_uris: [`https://${host}/cb`] })).expect(403);
      expect(res.body).toEqual({ error: 'invalid_client_metadata', error_description: expect.stringContaining('host is not allowed on this deployment') });
      expect(await refusedRows(host)).toHaveLength(1);
    });

    it('returns the existing client for an identical public registration, and a new one for a different or confidential one', async () => {
      const body = dcr({ redirect_uris: ['https://dcr.example.test/cb-same-a', 'https://dcr.example.test/cb-same-b'], client_name: 'Same Client' });
      const first = await register(body).expect(201);
      const again = await register({ ...body, redirect_uris: [...body.redirect_uris].reverse() }).expect(201);
      expect(again.body.client_id).toBe(first.body.client_id);
      expect(again.body.client_id_issued_at).toBe(first.body.client_id_issued_at);
      const other = await register({ ...body, client_name: 'Other Name' }).expect(201);
      expect(other.body.client_id).not.toBe(first.body.client_id);
      const confidential = await register({ ...body, token_endpoint_auth_method: 'client_secret_post' }).expect(201);
      secrets.push(confidential.body.client_secret);
      expect(confidential.body.client_id).not.toBe(first.body.client_id);
      const rows = await client.oAuthClient.findMany({ where: { clientId: { in: [first.body.client_id, other.body.client_id, confidential.body.client_id] } } });
      created.clients.push(...rows.map((row) => row.id));
      expect(await client.oAuthClient.count({ where: { kind: 'dynamic', host: 'dcr.example.test', name: 'Same Client' } })).toBe(2);
    });

    it('is 404 while dynamic registration is off and while the server is disabled', async () => {
      await setSettings({ dynamicClientRegistration: false });
      await register(dcr()).expect(404);
      await setSettings({ dynamicClientRegistration: true, enabled: false });
      await register(dcr()).expect(404);
    });

    it('answers the CORS preflight with the wildcard and no credentials', async () => {
      const res = await http().options('/api/oauth/register').expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('content-type');
    });

    it('is rate limited to 10 per hour per address: 429 with Retry-After', async () => {
      limiterMode = 'real';
      const body = dcr({ redirect_uris: ['https://dcr.example.test/cb-flood'], client_name: 'Flood' });
      for (let i = 0; i < 10; i += 1) await register(body).expect(201);
      const res = await register(body).expect(429);
      expect(res.body.error).toBe('temporarily_unavailable');
      expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      const row = await client.oAuthClient.findFirst({ where: { name: 'Flood', kind: 'dynamic' } });
      if (row) created.clients.push(row.id);
    });
  });

  describe('authorization server metadata', () => {
    it('advertises registration_endpoint and client_id_metadata_document_supported exactly while their settings are on', async () => {
      const meta = () => http().get('/api/oauth/.well-known/authorization-server').expect(200).then((res) => res.body);
      let body = await meta();
      expect(body.registration_endpoint).toBe(`${appUrl}/api/oauth/register`);
      expect(body.client_id_metadata_document_supported).toBe(true);

      await setSettings({ dynamicClientRegistration: false });
      body = await meta();
      expect(body).not.toHaveProperty('registration_endpoint');
      expect(body.client_id_metadata_document_supported).toBe(true);

      await setSettings({ dynamicClientRegistration: true, clientIdMetadataDocuments: false });
      body = await meta();
      expect(body.registration_endpoint).toBe(`${appUrl}/api/oauth/register`);
      expect(body).not.toHaveProperty('client_id_metadata_document_supported');

      await setSettings({ dynamicClientRegistration: false, clientIdMetadataDocuments: false });
      body = await meta();
      expect(body).not.toHaveProperty('registration_endpoint');
      expect(body).not.toHaveProperty('client_id_metadata_document_supported');
    });
  });

  describe('oauth.client.cleanup', () => {
    const DAY = 24 * 3_600_000;
    const make = async (label: string, over: Record<string, unknown>) => {
      const row = await client.oAuthClient.create({
        data: { clientId: `oc_cl_${run}_${label}`, kind: 'dynamic', name: label, redirectUris: ['https://cleanup.example.test/cb'], tokenEndpointAuthMethod: 'none', host: 'cleanup.example.test', ...over } as never,
      });
      created.clients.push(row.id);
      return row;
    };

    it('deletes only unused dynamic clients: old and unused go; recent, used, granted, cimd and registered stay', async () => {
      const old = new Date(Date.now() - 10 * DAY);
      const gone = await make('old-unused', { createdAt: old });
      const goneStaleUse = await make('old-stale-use', { createdAt: old, lastUsedAt: new Date(Date.now() - 9 * DAY) });
      const recent = await make('recent', { createdAt: new Date(Date.now() - 2 * DAY) });
      const used = await make('old-used', { createdAt: old, lastUsedAt: new Date(Date.now() - 1 * DAY) });
      const granted = await make('old-granted', { createdAt: old });
      const cimd = await make('old-cimd', { createdAt: old, kind: 'cimd' });
      const registered = await make('old-registered', { createdAt: old, kind: 'registered' });
      await client.oAuthGrant.create({ data: { userId: actorUserId, orgId: defaultOrgId, clientId: granted.id, resource: resourceUrl, scopes: ['clitems:read'], revokedAt: new Date(), revokedReason: 'user' } });

      await app.get(OAuthClientCleanupHandler, { strict: false }).process({ id: 'cleanup-test' });
      const alive = new Set((await client.oAuthClient.findMany({ where: { id: { in: [gone, goneStaleUse, recent, used, granted, cimd, registered].map((row) => row.id) } }, select: { id: true } })).map((row) => row.id));
      expect(alive.has(gone.id)).toBe(false);
      expect(alive.has(goneStaleUse.id)).toBe(false);
      for (const kept of [recent, used, granted, cimd, registered]) expect(alive.has(kept.id)).toBe(true);
    });

    it('honours dynamicClientUnusedDays', async () => {
      const row = await make('three-days', { createdAt: new Date(Date.now() - 3 * DAY) });
      await app.get(OAuthClientCleanupHandler, { strict: false }).process({ id: 'cleanup-test' });
      expect(await client.oAuthClient.findUnique({ where: { id: row.id } })).not.toBeNull();
      await setSettings({ dynamicClientUnusedDays: 2 });
      await app.get(OAuthClientCleanupHandler, { strict: false }).process({ id: 'cleanup-test' });
      expect(await client.oAuthClient.findUnique({ where: { id: row.id } })).toBeNull();
    });

    it('the cron only enqueues a global job and deletes nothing inline', async () => {
      const row = await make('cron-victim', { createdAt: new Date(Date.now() - 30 * DAY) });
      await app.get(OAuthClientCleanupTask, { strict: false }).handleCron();
      const jobs = await client.job.findMany({ where: { type: 'oauth.client.cleanup', createdAt: { gte: suiteStart } } });
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.every((job) => job.orgId === null)).toBe(true);
      expect(await client.oAuthClient.findUnique({ where: { id: row.id } })).not.toBeNull();
      await app.get(OAuthClientCleanupTask, { strict: false }).handleCron(); // idempotent: still one pending
      expect(await client.job.count({ where: { type: 'oauth.client.cleanup', createdAt: { gte: suiteStart }, status: { in: ['pending', 'running'] } } })).toBeLessThanOrEqual(1);
    });
  });

  describe('the admin API', () => {
    let adminToken: string;
    let viewerToken: string;
    let contributorToken: string;
    const base = '/api/admin/oauth/clients';
    const body = { name: 'Admin Made', redirectUris: ['https://registered.example.test/cb'], tokenEndpointAuthMethod: 'client_secret_post' };

    beforeAll(async () => {
      adminToken = await sessionToken(await makeUser('admin', { admin: true }));
      viewerToken = await sessionToken(await makeUser('viewer', { viewer: true }));
      contributorToken = await sessionToken(await makeUser('contributor'));
    });

    it('RBAC matrix: admin allowed; contributor, viewer and anonymous refused on every route', async () => {
      const id = randomUUID();
      const routes: Array<[string, string, Record<string, unknown>]> = [
        ['get', base, {}],
        ['get', '/api/admin/oauth/refused-hosts', {}],
        ['get', '/api/admin/oauth/policy', {}],
        ['post', base, body],
        ['patch', `${base}/${id}`, { disabled: true }],
        ['post', `${base}/${id}/rotate-secret`, {}],
        ['delete', `${base}/${id}`, {}],
      ];
      for (const [method, path, payload] of routes) {
        const call = (token?: string) => {
          const req = (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path);
          return (token ? req.set(bearer(token)) : req).send(payload);
        };
        expect([method, path, (await call(contributorToken)).status]).toEqual([method, path, 403]);
        expect([method, path, (await call(viewerToken)).status]).toEqual([method, path, 403]);
        expect([method, path, (await call()).status]).toEqual([method, path, 401]);
      }
      await http().get(base).set(bearer(adminToken)).expect(200);
    });

    it('GET /refused-hosts aggregates the last 30 days of oauth:client.refused rows by host, newest first, at most 100', async () => {
      const day = 86_400_000;
      const now = Date.now();
      const hostA = `agg-a-${run}.example.test`;
      const hostB = `agg-b-${run}.example.test`;
      const hostOld = `agg-old-${run}.example.test`;
      const row = (targetId: string, ageMs: number, action = 'oauth:client.refused') =>
        client.auditEvent.create({ data: { action, targetType: 'oauth_client', targetId, actorUserId: null, meta: { reason: 'host_not_allowed' }, createdAt: new Date(now - ageMs) } });
      await row(hostA, 5 * day);
      await row(hostA, 2 * day);
      await row(hostA, 3 * day);
      await row(hostB, 1 * day);
      await row(hostOld, 31 * day);
      await row(`other-action-${run}.example.test`, 1 * day, 'oauth:client.create');

      const res = await http().get('/api/admin/oauth/refused-hosts').set(bearer(adminToken)).expect(200);
      const list = res.body.data as Array<{ host: string; count: number; lastSeenAt: string }>;
      const mine = list.filter((entry) => entry.host.startsWith('agg-') && entry.host.endsWith(`-${run}.example.test`));
      expect(mine.map((entry) => entry.host)).toEqual([hostB, hostA]);
      expect(mine[0]).toEqual({ host: hostB, count: 1, lastSeenAt: new Date(now - 1 * day).toISOString() });
      expect(mine[1]).toEqual({ host: hostA, count: 3, lastSeenAt: new Date(now - 2 * day).toISOString() });
      expect(list.length).toBeLessThanOrEqual(100);
      for (let i = 1; i < list.length; i++) expect(list[i - 1]!.lastSeenAt >= list[i]!.lastSeenAt).toBe(true);
      // nothing but host, count and time
      expect(Object.keys(list[0]!).sort()).toEqual(['count', 'host', 'lastSeenAt']);
      // the back-dated rows are older than the suite start: remove them here
      await client.auditEvent.deleteMany({ where: { targetType: 'oauth_client', targetId: { endsWith: `-${run}.example.test` } } });
    });

    it('GET /refused-hosts returns at most 100 hosts', async () => {
      const prefix = `cap-${run}`;
      await client.auditEvent.createMany({
        data: Array.from({ length: 105 }, (_, i) => ({ action: 'oauth:client.refused', targetType: 'oauth_client', targetId: `${prefix}-${i}.example.test`, actorUserId: null, meta: {} })),
      });
      const res = await http().get('/api/admin/oauth/refused-hosts').set(bearer(adminToken)).expect(200);
      expect(res.body.data).toHaveLength(100);
    });

    it('GET /policy returns the app\'s suggested client hosts (the reference app configures none)', async () => {
      const res = await http().get('/api/admin/oauth/policy').set(bearer(adminToken)).expect(200);
      expect(res.body.data).toEqual({ suggestedHosts: [] });
    });

    it('pre-registers a client: the secret is returned once and stored hashed; the list never shows it; the write is audited', async () => {
      const res = await http().post(base).set(bearer(adminToken)).send(body).expect(201);
      const data = res.body.data;
      secrets.push(data.clientSecret);
      expect(data).toMatchObject({ kind: 'registered', name: 'Admin Made', host: 'registered.example.test', tokenEndpointAuthMethod: 'client_secret_post', activeGrantCount: 0, disabled: false });
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { id: data.id } });
      created.clients.push(row.id);
      expect(row.secretHash).toBe(sha256(data.clientSecret));
      expect(row.clientId).toMatch(/^oc_/);

      const list = await http().get(`${base}?search=Admin Made`).set(bearer(adminToken)).expect(200);
      expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(data.id);
      expect(JSON.stringify(list.body)).not.toContain(data.clientSecret);
      expect(JSON.stringify(list.body)).not.toContain(row.secretHash!);

      const audit = await client.auditEvent.findFirst({ where: { action: 'oauth:client.create', targetId: row.id } });
      expect(audit).toMatchObject({ targetType: 'oauth_client', meta: { kind: 'registered', method: 'client_secret_post' } });
      expect(audit?.actorUserId).not.toBeNull();
    });

    it('validates the body: mixed hosts, http and a missing field are 400', async () => {
      await http().post(base).set(bearer(adminToken)).send({ ...body, redirectUris: ['https://a.example.test/x', 'https://b.example.test/y'] }).expect(400);
      await http().post(base).set(bearer(adminToken)).send({ ...body, redirectUris: ['http://a.example.test/x'] }).expect(400);
      await http().post(base).set(bearer(adminToken)).send({ redirectUris: ['https://a.example.test/x'] }).expect(400);
    });

    it('lists clients paged with kind, host, grant count and disabled state', async () => {
      const list = await http().get(`${base}?kind=registered&pageSize=2&page=1`).set(bearer(adminToken)).expect(200);
      expect(list.body.data.items.length).toBeLessThanOrEqual(2);
      expect(list.body.data).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number) });
      for (const item of list.body.data.items) {
        expect(item).toMatchObject({ kind: 'registered', host: expect.any(String), activeGrantCount: expect.any(Number), disabled: expect.any(Boolean) });
        expect(item).not.toHaveProperty('secretHash');
        expect(item).not.toHaveProperty('clientSecret');
      }
    });

    it('disabling a client makes its tokens 401 on the next call and revokes its grants (client_disabled); enabling does not resurrect them', async () => {
      const made = await http().post(base).set(bearer(adminToken)).send({ ...body, name: 'To Disable' }).expect(201);
      const { id, clientId, clientSecret } = made.body.data as { id: string; clientId: string; clientSecret: string };
      secrets.push(clientSecret);
      created.clients.push(id);

      // a full connection: authorize, consent, exchange
      const userId = await makeUser('connect');
      const flow = createOAuthTestPkce();
      secrets.push(flow.verifier);
      const redirectUri = body.redirectUris[0]!;
      const authorized = await http().get('/api/oauth/authorize').query(authorizeQuery(clientId, redirectUri, { code_challenge: flow.challenge }));
      reachesConsent(authorized);
      const requestId = new URL(authorized.headers.location!).searchParams.get('request')!;
      const session = await sessionToken(userId);
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
      const decision = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(200);
      const code = new URL(decision.body.data.redirectTo).searchParams.get('code')!;
      secrets.push(code);
      const tokens = await http().post('/api/oauth/token').type('form').send({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: flow.verifier, client_id: clientId, client_secret: clientSecret }).expect(200);
      secrets.push(tokens.body.access_token, tokens.body.refresh_token);
      await http().get('/api/oauth-cl-test/items').set(bearer(tokens.body.access_token)).expect(200);

      const patched = await http().patch(`${base}/${id}`).set(bearer(adminToken)).send({ disabled: true }).expect(200);
      expect(patched.body.data).toMatchObject({ disabled: true, activeGrantCount: 0 });
      await http().get('/api/oauth-cl-test/items').set(bearer(tokens.body.access_token)).expect(401);
      const refresh = await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token, client_id: clientId, client_secret: clientSecret });
      expect(refresh.status).toBe(400);
      expect(refresh.body.error).toBe('invalid_grant');
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { clientId: id } });
      expect(grant.revokedReason).toBe('client_disabled');
      expect(errorPage(await authorize(clientId, redirectUri)).code).toBe('unknown_client');
      expect(await client.auditEvent.count({ where: { action: 'oauth:client.disable', targetId: id } })).toBe(1);

      await http().patch(`${base}/${id}`).set(bearer(adminToken)).send({ disabled: false }).expect(200);
      expect(await client.auditEvent.count({ where: { action: 'oauth:client.enable', targetId: id } })).toBe(1);
      await http().get('/api/oauth-cl-test/items').set(bearer(tokens.body.access_token)).expect(401);
      reachesConsent(await authorize(clientId, redirectUri));
    });

    it('edits name and redirect URIs of a registered client only, and audits it', async () => {
      const made = await http().post(base).set(bearer(adminToken)).send({ ...body, name: 'To Edit', tokenEndpointAuthMethod: 'none' }).expect(201);
      const id = made.body.data.id as string;
      created.clients.push(id);
      const res = await http().patch(`${base}/${id}`).set(bearer(adminToken)).send({ name: 'Edited', redirectUris: ['https://elsewhere.example.test/cb'] }).expect(200);
      expect(res.body.data).toMatchObject({ name: 'Edited', host: 'elsewhere.example.test', redirectUris: ['https://elsewhere.example.test/cb'] });
      expect(await client.auditEvent.count({ where: { action: 'oauth:client.update', targetId: id } })).toBe(1);

      const dyn = await createOAuthTestClient(client as never, { kind: 'dynamic' });
      created.clients.push(dyn.id);
      await http().patch(`${base}/${dyn.id}`).set(bearer(adminToken)).send({ name: 'Nope' }).expect(400);
      await http().patch(`${base}/${dyn.id}`).set(bearer(adminToken)).send({ disabled: true }).expect(200);
      await http().patch(`${base}/${randomUUID()}`).set(bearer(adminToken)).send({ disabled: true }).expect(404);
      await http().patch(`${base}/${id}`).set(bearer(adminToken)).send({}).expect(400);
    });

    it('rotates a secret: the new one is returned once and works, the old one stops; a public client has none to rotate', async () => {
      const made = await http().post(base).set(bearer(adminToken)).send({ ...body, name: 'To Rotate', tokenEndpointAuthMethod: 'client_secret_basic' }).expect(201);
      const { id, clientId, clientSecret: oldSecret } = made.body.data as { id: string; clientId: string; clientSecret: string };
      created.clients.push(id);
      secrets.push(oldSecret);
      const basic = (secret: string) => ({ authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}` });
      const attempt = (secret: string) => http().post('/api/oauth/token').set(basic(secret)).type('form').send({ grant_type: 'refresh_token', refresh_token: 'ort_none' });
      expect((await attempt(oldSecret)).body.error).toBe('invalid_grant');

      const rotated = await http().post(`${base}/${id}/rotate-secret`).set(bearer(adminToken)).expect(200);
      const newSecret = rotated.body.data.clientSecret as string;
      secrets.push(newSecret);
      expect(newSecret).not.toBe(oldSecret);
      expect((await client.oAuthClient.findUniqueOrThrow({ where: { id } })).secretHash).toBe(sha256(newSecret));
      expect((await attempt(oldSecret)).status).toBe(401);
      expect((await attempt(newSecret)).body.error).toBe('invalid_grant');
      expect(await client.auditEvent.count({ where: { action: 'oauth:client.rotate_secret', targetId: id } })).toBe(1);

      const pub = await createOAuthTestClient(client as never, { kind: 'registered' });
      created.clients.push(pub.id);
      await http().post(`${base}/${pub.id}/rotate-secret`).set(bearer(adminToken)).expect(400);
      await http().post(`${base}/${randomUUID()}/rotate-secret`).set(bearer(adminToken)).expect(404);
    });

    it('deletes a client: its grants cascade, the delete is audited, an unknown id is 404', async () => {
      const made = await http().post(base).set(bearer(adminToken)).send({ ...body, name: 'To Delete', tokenEndpointAuthMethod: 'none' }).expect(201);
      const id = made.body.data.id as string;
      await client.oAuthGrant.create({ data: { userId: actorUserId, orgId: defaultOrgId, clientId: id, resource: resourceUrl, scopes: ['clitems:read'] } });
      await http().delete(`${base}/${id}`).set(bearer(adminToken)).expect(204);
      expect(await client.oAuthClient.findUnique({ where: { id } })).toBeNull();
      expect(await client.oAuthGrant.count({ where: { clientId: id } })).toBe(0);
      expect(await client.auditEvent.count({ where: { action: 'oauth:client.delete', targetId: id } })).toBe(1);
      await http().delete(`${base}/${id}`).set(bearer(adminToken)).expect(404);
    });
  });

  describe('logs', () => {
    it('carry no secret and no fetched document body', () => {
      const text = logLines.join('\n');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain(FETCH_MARKER);
      for (const secret of secrets) expect(text).not.toContain(secret);
    });
  });
});

// =============================================================================
// The OAuth authorization server core on real Postgres, through the whole app
// (PP-15.4, #1182)
// =============================================================================
//
// Boots the reference app (`AppModule`: the real guards, the principal cache,
// Fastify, the host's envelope interceptor and exception filter) over the
// migrated database, plus ONE test-only module: a protected resource
// `oauth-as-test` at `/api/oauth-as-test`. Then drives the endpoints AS A CLIENT
// WOULD, over HTTP: discovery, /authorize, the consent API with a session, the
// token endpoint with form bodies, a call to the resource, refresh rotation,
// reuse detection, revocation, the grants API, the rate limit, the events and
// the logs.
//
// `createOAuthTestClient()` and `createOAuthTestPkce()` are the helpers of
// `@marinoscar/platform-api/identity/testing`. THIS IS A `*.db.spec.ts`: skipped
// with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { createHash, randomUUID } from 'node:crypto';

import { ConsoleLogger, Controller, Get, Logger, Module, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import {
  Auth,
  AuthService,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PatService,
  PRINCIPAL_USER_INCLUDE,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import { createOAuthTestClient, createOAuthTestPkce, type OAuthTestClient } from '@marinoscar/platform-api/identity/testing';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-authorization-server.db.spec');

// ---- the test-only resource, registered at import time (before the app boots) -------------

registerOAuthScope({ id: 'asitems:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthScope({ id: 'asitems:write', title: 'Change items', description: 'Edit items.', permissions: ['users:write'], risk: 'elevated' });
registerOAuthProtectedResource({
  id: 'oauth-as-test',
  path: '/api/oauth-as-test',
  routePrefixes: ['/api/oauth-as-test'],
  scopes: ['asitems:read', 'asitems:write'],
  name: 'Authorization server test resource',
});

@Controller('oauth-as-test')
class OAuthAsTestController {
  @Get('items')
  @Auth({ permissions: ['users:read'] })
  list() {
    return { ok: true };
  }

  @Post('items')
  @Auth({ permissions: ['users:write'] })
  create() {
    return { created: true };
  }
}

@Module({ controllers: [OAuthAsTestController] })
class OAuthAsTestModule {}

// ---------------------------------------------------------------------------------------------

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describeWithDb('the OAuth authorization server core through the whole app (real Postgres, #1182)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let prisma: { $transaction: (...args: unknown[]) => Promise<unknown>; $on: (event: string, listener: (e: { query: string }) => void) => void };
  const run = randomUUID().slice(0, 8);
  const suiteStart = new Date();
  const created = { users: [] as string[], roles: [] as string[], clients: [] as string[], permissions: [] as string[] };
  let defaultOrgId: string;
  let roleId: string;
  let readOnlyRoleId: string;
  let appUrl: string;
  let resourceUrl: string;
  let readerUserId: string;
  const logLines: string[] = [];
  const secrets: string[] = [];
  let restoreLogger: () => void = () => undefined;
  let limiterMode: 'off' | 'real' = 'off';
  const queries: string[] = [];
  let counting = false;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const issuer = () => appUrl;

  async function makeUser(label: string, options: { readOnly?: boolean; active?: boolean } = {}) {
    const user = await client.user.create({ data: { email: `osas-${label}-${run}@example.test`, isActive: options.active ?? true }, select: { id: true } });
    created.users.push(user.id);
    await client.membership.create({ data: { orgId: defaultOrgId, userId: user.id, roleId: options.readOnly ? readOnlyRoleId : roleId } });
    return user.id;
  }

  async function sessionToken(userId: string): Promise<string> {
    const graph = await client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId });
    secrets.push(tokens.accessToken);
    return tokens.accessToken;
  }

  async function setEnabled(enabled: boolean) {
    await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled } } as never, created.users[0]!);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  async function newClient(options: Parameters<typeof createOAuthTestClient>[1] = {}): Promise<OAuthTestClient> {
    const made = await createOAuthTestClient(client as never, options);
    created.clients.push(made.id);
    if (made.secret) secrets.push(made.secret);
    return made;
  }

  const authorizeQuery = (c: OAuthTestClient, challenge: string, over: Record<string, string | undefined> = {}) => {
    const query: Record<string, string | undefined> = {
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      scope: 'asitems:read',
      state: 'state-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: resourceUrl,
      ...over,
    };
    return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as Record<string, string>;
  };

  const authorize = (c: OAuthTestClient, challenge: string, over: Record<string, string | undefined> = {}) =>
    http().get('/api/oauth/authorize').query(authorizeQuery(c, challenge, over));

  const requestIdOf = (location: string) => new URL(location).searchParams.get('request')!;

  /** authorize -> consent read -> approve; returns what the client then holds. */
  async function approveFlow(
    userId: string,
    c: OAuthTestClient,
    options: { scope?: string; resource?: string; decision?: Record<string, unknown> } = {},
  ) {
    const pkce = createOAuthTestPkce();
    secrets.push(pkce.verifier);
    const authorized = await authorize(c, pkce.challenge, { scope: options.scope ?? 'asitems:read', ...(options.resource ? { resource: options.resource } : {}) });
    expect(authorized.status).toBe(302);
    const requestId = requestIdOf(authorized.headers.location);
    const session = await sessionToken(userId);
    await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
    const decision = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send(options.decision ?? { decision: 'approve' });
    expect(decision.status).toBe(200);
    const redirect = new URL(decision.body.data.redirectTo);
    const code = redirect.searchParams.get('code')!;
    secrets.push(code);
    return { pkce, requestId, session, code, redirect, redirectTo: decision.body.data.redirectTo as string };
  }

  const tokenRequest = (body: Record<string, string | undefined>, headers: Record<string, string> = {}) =>
    http()
      .post('/api/oauth/token')
      .set(headers)
      .type('form')
      .send(Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as Record<string, string>);

  async function exchange(c: OAuthTestClient, flow: { code: string; pkce: { verifier: string } }, over: Record<string, string | undefined> = {}) {
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      code: flow.code,
      redirect_uri: c.redirectUri,
      code_verifier: flow.pkce.verifier,
      client_id: c.clientId,
      ...over,
    });
    if (res.status === 200) secrets.push(res.body.access_token, res.body.refresh_token);
    return res;
  }

  /** Awaits a response and asserts its status (for the helpers that are not a supertest chain). */
  const expectStatus = async (pending: Promise<request.Response>, status: number) => {
    const res = await pending;
    expect(res.status).toBe(status);
    return res;
  };

  const refreshRequest = (c: OAuthTestClient, refreshToken: string, over: Record<string, string | undefined> = {}) =>
    tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, ...over });

  /** A full connection: approved, exchanged; returns the tokens. */
  async function connect(userId: string, c: OAuthTestClient, options: Parameters<typeof approveFlow>[2] = {}) {
    const flow = await approveFlow(userId, c, options);
    const res = await exchange(c, flow);
    expect(res.status).toBe(200);
    const grantRow = await client.oAuthGrant.findFirstOrThrow({ where: { userId, clientId: c.id, revokedAt: null } });
    return { flow, access: res.body.access_token as string, refresh: res.body.refresh_token as string, grantId: grantRow.id, body: res.body };
  }

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    for (const name of ['users:read', 'users:write']) {
      const existing = await client.permission.findUnique({ where: { name } });
      if (!existing) created.permissions.push((await client.permission.create({ data: { name, scope: 'system' } })).id);
    }
    roleId = (await client.role.create({ data: { name: `osas_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    readOnlyRoleId = (await client.role.create({ data: { name: `osas_read_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId, readOnlyRoleId);
    for (const name of ['users:read', 'users:write']) {
      const permission = await client.permission.findUniqueOrThrow({ where: { name } });
      await client.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      if (name === 'users:read') await client.rolePermission.create({ data: { roleId: readOnlyRoleId, permissionId: permission.id } });
    }

    const module = await Test.createTestingModule({ imports: [AppModule, OAuthAsTestModule] })
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
    resourceUrl = `${appUrl}/api/oauth-as-test`;

    prisma = app.get(PLATFORM_PRISMA, { strict: false });
    prisma.$on('query', (event) => {
      // Transaction control (BEGIN, COMMIT, ROLLBACK) is not a query of the budget; every other statement is.
      if (counting && !/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(event.query)) queries.push(event.query);
    });

    // The rate limiter is in the app process and the suite is one source address: it is off except in its own tests.
    const limiter = app.get(OAuthRateLimitService);
    const real = limiter.consume.bind(limiter);
    jest.spyOn(limiter, 'consume').mockImplementation((key, limit, windowMs) => (limiterMode === 'real' ? real(key, limit, windowMs) : { allowed: true, retryAfterSeconds: 0 }));

    readerUserId = await makeUser('actor');
    await setEnabled(true);
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setEnabled(false);
    } finally {
      restoreLogger();
      await app?.close();
      await client.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: created.users } }, { targetType: 'oauth_grant', createdAt: { gte: suiteStart } }] } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      await client.oAuthClient.deleteMany({ where: { id: { in: created.clients } } });
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  // -------------------------------------------------------------------------------------------

  describe('metadata (RFC 8414)', () => {
    it('serves every field of the spec, un-enveloped, cacheable, with the issuer equal to APP_URL', async () => {
      const res = await http().get('/api/oauth/.well-known/authorization-server').expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body.data).toBeUndefined();
      expect(res.body).toEqual({
        issuer: appUrl,
        authorization_endpoint: `${appUrl}/api/oauth/authorize`,
        token_endpoint: `${appUrl}/api/oauth/token`,
        registration_endpoint: `${appUrl}/api/oauth/register`,
        revocation_endpoint: `${appUrl}/api/oauth/revoke`,
        scopes_supported: expect.arrayContaining(['asitems:read', 'asitems:write', 'offline_access']),
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
      });
      expect(new Set(res.body.scopes_supported).size).toBe(res.body.scopes_supported.length);
      expect(issuer().endsWith('/')).toBe(false);
    });

    it('advertises registration_endpoint and client_id_metadata_document_supported (PP-15.5; the toggles are proven in oauth-clients.db.spec.ts) and never jwks_uri', async () => {
      const res = await http().get('/api/oauth/.well-known/authorization-server').expect(200);
      expect(res.body).toHaveProperty('registration_endpoint');
      expect(res.body).toHaveProperty('client_id_metadata_document_supported');
      expect(res.body).not.toHaveProperty('jwks_uri');
    });
  });

  describe('/authorize validation (every row of the table)', () => {
    let c: OAuthTestClient;
    const pkce = createOAuthTestPkce();
    beforeAll(async () => {
      c = await newClient({ redirectUris: ['https://client.example.test/cb', 'http://127.0.0.1/cb', 'http://[::1]/cb', 'http://localhost/cb'] });
    });

    const location = (res: request.Response) => new URL(res.headers.location!);

    it('a valid request stores a 10-minute pending request and redirects to the consent page with only the id', async () => {
      const res = await authorize(c, pkce.challenge).expect(302);
      const url = location(res);
      expect(`${url.origin}${url.pathname}`).toBe(`${appUrl}/oauth/consent`);
      expect([...url.searchParams.keys()]).toEqual(['request']);
      const row = await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: url.searchParams.get('request')! } });
      expect(row).toMatchObject({ clientId: c.id, redirectUri: c.redirectUri, scope: 'asitems:read', state: 'state-1', resource: resourceUrl, codeChallenge: pkce.challenge, codeChallengeMethod: 'S256', status: 'pending', userId: null });
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
      expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    });

    it('1: while the server is disabled it redirects to the error page server_disabled; every other route is a 404', async () => {
      const user = await makeUser('disabled');
      const session = await sessionToken(user);
      await setEnabled(false);
      try {
        const res = await authorize(c, pkce.challenge).expect(302);
        expect(res.headers.location).toBe(`${appUrl}/oauth/error?code=server_disabled`);
        await http().get('/api/oauth/.well-known/authorization-server').expect(404);
        await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x', client_id: c.clientId }).expect(404);
        await http().post('/api/oauth/revoke').type('form').send({ token: 'x', client_id: c.clientId }).expect(404);
        await http().get(`/api/oauth/requests/${randomUUID()}`).set(bearer(session)).expect(404);
        await http().post(`/api/oauth/requests/${randomUUID()}/decision`).set(bearer(session)).send({ decision: 'deny' }).expect(404);
        await http().get('/api/oauth/grants').set(bearer(session)).expect(404);
        // a JSON body is a 404 too while disabled (the body rules stay out of the way)
        await http().post('/api/oauth/token').send({}).expect(404);
      } finally {
        await setEnabled(true);
      }
    });

    it('2: an unknown or disabled client is the error page unknown_client, never a redirect to redirect_uri', async () => {
      const disabled = await newClient({ disabled: true });
      for (const query of [authorizeQuery(c, pkce.challenge, { client_id: 'oc_does_not_exist' }), authorizeQuery(disabled, pkce.challenge), authorizeQuery(c, pkce.challenge, { client_id: undefined })]) {
        const res = await http().get('/api/oauth/authorize').query(query).expect(302);
        expect(res.headers.location).toBe(`${appUrl}/oauth/error?code=unknown_client`);
      }
    });

    it('3: a redirect URI that does not match is the error page invalid_redirect_uri; it NEVER redirects to it', async () => {
      for (const redirectUri of ['https://evil.example.test/cb', 'https://client.example.test/cb/x', 'https://client.example.test/CB', 'https://client.example.test/cb?x=1', 'https://client.example.test:8443/cb', undefined]) {
        const res = await authorize(c, pkce.challenge, { redirect_uri: redirectUri, response_type: 'token' }).expect(302);
        expect(res.headers.location).toBe(`${appUrl}/oauth/error?code=invalid_redirect_uri`);
      }
    });

    it.each([
      ['127.0.0.1', 'http://127.0.0.1:51234/cb'],
      ['[::1]', 'http://[::1]:51234/cb'],
      ['localhost', 'http://localhost:51234/cb'],
    ])('3: the loopback port is ignored for %s', async (_name, redirectUri) => {
      const res = await authorize(c, pkce.challenge, { redirect_uri: redirectUri }).expect(302);
      expect(location(res).pathname).toBe('/oauth/consent');
      const stored = await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestIdOf(res.headers.location!) } });
      expect(stored.redirectUri).toBe(redirectUri);
    });

    it('3: the loopback exception does not cross loopback names, paths or schemes', async () => {
      for (const redirectUri of ['http://localhost:51234/other', 'http://127.0.0.1.evil.example.test:1/cb', 'https://127.0.0.1:51234/cb']) {
        const res = await authorize(c, pkce.challenge, { redirect_uri: redirectUri }).expect(302);
        expect(res.headers.location).toBe(`${appUrl}/oauth/error?code=invalid_redirect_uri`);
      }
      const only = await newClient({ redirectUris: ['http://127.0.0.1/cb'] });
      const res = await authorize(only, pkce.challenge, { redirect_uri: 'http://localhost:51234/cb' }).expect(302);
      expect(res.headers.location).toBe(`${appUrl}/oauth/error?code=invalid_redirect_uri`);
    });

    it.each([
      ['4: response_type', { response_type: 'token' }, 'unsupported_response_type'],
      ['5: no code_challenge', { code_challenge: undefined }, 'invalid_request'],
      ['5: method plain', { code_challenge_method: 'plain' }, 'invalid_request'],
      ['5: no method', { code_challenge_method: undefined }, 'invalid_request'],
      ['6: no resource', { resource: undefined }, 'invalid_target'],
      ['6: a resource that is not registered', { resource: `${appUrl}/api/not-registered` }, 'invalid_target'],
      ['7: an unregistered scope', { scope: 'nope:read' }, 'invalid_scope'],
    ])('%s is a redirect to redirect_uri with error, state and iss', async (_label, over, error) => {
      const res = await authorize(c, pkce.challenge, over as Record<string, string | undefined>).expect(302);
      const url = location(res);
      expect(`${url.origin}${url.pathname}`).toBe(c.redirectUri);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ error, state: 'state-1', iss: issuer() });
      expect(url.searchParams.get('error_description')).toBeTruthy();
    });

    it('6: the resource is compared after normalising case, a trailing slash and a fragment', async () => {
      for (const resource of [`${resourceUrl}/`, `${resourceUrl}#frag`, resourceUrl.replace('https://', 'HTTPS://').replace(/\/\/([^/]+)/, (_m, host: string) => `//${host.toUpperCase()}`)]) {
        const res = await authorize(c, pkce.challenge, { resource }).expect(302);
        expect(location(res).pathname).toBe('/oauth/consent');
      }
    });

    it('7: no scope means the resource\'s default scopes', async () => {
      const res = await authorize(c, pkce.challenge, { scope: undefined }).expect(302);
      const stored = await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestIdOf(res.headers.location!) } });
      expect(stored.scope).toBe('asitems:read');
    });
  });

  describe('the consent API', () => {
    it('isNewToDeployment: true for a client under a day old; for an older one only until ANOTHER user holds an active grant', async () => {
      const c = await newClient();
      const alice = await makeUser('new-alice');
      const bob = await makeUser('new-bob');
      const readAs = async (userId: string): Promise<boolean> => {
        const pkce = createOAuthTestPkce();
        const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
        const read = await http().get(`/api/oauth/requests/${requestId}`).set(bearer(await sessionToken(userId))).expect(200);
        return read.body.data.client.isNewToDeployment as boolean;
      };

      // first seen just now: new, whoever reads
      expect(await readAs(alice)).toBe(true);
      await client.oAuthClient.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
      // old, but nobody holds a grant yet
      expect(await readAs(alice)).toBe(true);

      await approveFlow(bob, c);
      // another user (bob) now holds an active grant: no longer new to alice
      expect(await readAs(alice)).toBe(false);
      // bob's own grant does not count against bob: nobody ELSE holds one
      expect(await readAs(bob)).toBe(true);

      // a revoked grant does not count
      await client.oAuthGrant.updateMany({ where: { clientId: c.id, userId: bob }, data: { revokedAt: new Date() } });
      expect(await readAs(alice)).toBe(true);
    });

    it('a read binds the request to the first user; a second user gets 404; the same user can read again', async () => {
      const c = await newClient();
      const first = await makeUser('first');
      const second = await makeUser('second');
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      const firstSession = await sessionToken(first);
      const read = await http().get(`/api/oauth/requests/${requestId}`).set(bearer(firstSession)).expect(200);
      expect(read.body.data).toMatchObject({
        id: requestId,
        client: { name: 'Test Client', host: 'client.example.test', logoUri: null, kind: 'registered' },
        redirectHost: 'client.example.test',
        isLoopbackRedirect: false,
        resource: { id: 'oauth-as-test', name: 'Authorization server test resource' },
        offlineAccess: false,
        organizations: [],
      });
      expect(read.body.data.scopes).toEqual([
        { id: 'asitems:read', title: 'Read items', description: 'See items.', risk: 'low', grantable: true, required: true, alreadyGranted: false },
      ]);
      expect(Date.parse(read.body.data.expiresAt)).toBeGreaterThan(Date.now());
      expect((await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } })).userId).toBe(first);
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(await sessionToken(second))).expect(404);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(await sessionToken(second))).send({ decision: 'deny' }).expect(404);
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(firstSession)).expect(200);
    });

    it('an unknown id and a malformed id are 404; no session is 401', async () => {
      const user = await makeUser('unknownid');
      const session = await sessionToken(user);
      await http().get(`/api/oauth/requests/${randomUUID()}`).set(bearer(session)).expect(404);
      await http().get('/api/oauth/requests/not-a-uuid').set(bearer(session)).expect(404);
      await http().get(`/api/oauth/requests/${randomUUID()}`).expect(401);
    });

    it('is session-only: a personal access token and an oat_ token get 403 on both routes', async () => {
      const c = await newClient();
      const user = await makeUser('sessiononly');
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      const created_ = await app.get(PatService).createToken(user, { name: 'osas', durationValue: 1, durationUnit: 'days' }, { activeOrgId: defaultOrgId });
      secrets.push(created_.token);
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(created_.token)).expect(403);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(created_.token)).send({ decision: 'approve' }).expect(403);

      const other = await newClient();
      const connected = await connect(user, other);
      // an oat_ token is confined to its resource's routes by the guard: 403 on these routes as well
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(connected.access)).expect(403);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(connected.access)).send({ decision: 'approve' }).expect(403);
      await http().get('/api/oauth/grants').set(bearer(connected.access)).expect(403);
      // and the request was not touched
      expect((await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('pending');
    });

    it('an expired request is 410 on read and on decision; so is a decided one', async () => {
      const c = await newClient();
      const user = await makeUser('expired');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      await client.oAuthAuthorizationRequest.update({ where: { id: requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(410);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(410);

      const decided = await approveFlow(user, c);
      await http().get(`/api/oauth/requests/${decided.requestId}`).set(bearer(session)).expect(410);
      await http().post(`/api/oauth/requests/${decided.requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(410);
      expect(await client.oAuthAuthorizationCode.count({ where: { grant: { userId: user } } })).toBe(1);
    });

    it('approving a subset grants only the subset', async () => {
      const c = await newClient();
      const user = await makeUser('subset');
      const flow = await approveFlow(user, c, { scope: 'asitems:read asitems:write', decision: { decision: 'approve', scopes: ['asitems:read'] } });
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } });
      expect(grant.scopes).toEqual(['asitems:read']);
      expect(grant.orgId).toBe(defaultOrgId);
      const code = await client.oAuthAuthorizationCode.findFirstOrThrow({ where: { grantId: grant.id } });
      expect(code.scope).toBe('asitems:read');
      const res = await exchange(c, flow);
      expect(res.body.scope).toBe('asitems:read');
    });

    it('a scope the user holds no permission for is not grantable on the page, and is ignored when sent', async () => {
      const c = await newClient();
      const user = await makeUser('readonly', { readOnly: true });
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge, { scope: 'asitems:read asitems:write' })).headers.location!);
      const read = await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
      expect(read.body.data.scopes.map((s: { id: string; grantable: boolean }) => [s.id, s.grantable])).toEqual([['asitems:read', true], ['asitems:write', false]]);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', scopes: ['asitems:read', 'asitems:write'] }).expect(200);
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } });
      expect(grant.scopes).toEqual(['asitems:read']);
    });

    it('400 for a scope that was not requested, an unticked required scope and nothing grantable; the request stays pending', async () => {
      const c = await newClient();
      const user = await makeUser('badscopes');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge, { scope: 'asitems:read' })).headers.location!);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', scopes: ['asitems:write'] }).expect(400);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', scopes: [] }).expect(400);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'maybe' }).expect(400);
      expect((await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('pending');
      expect(await client.oAuthGrant.count({ where: { userId: user } })).toBe(0);
    });

    it('403 for an organization that is not an active membership of the caller', async () => {
      const c = await newClient();
      const user = await makeUser('wrongorg');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', orgId: randomUUID() }).expect(403);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', orgId: defaultOrgId }).expect(200);
    });

    it('deny marks the request denied and redirects access_denied with state and iss; no grant and no code', async () => {
      const c = await newClient();
      const user = await makeUser('deny');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      const res = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'deny' }).expect(200);
      const url = new URL(res.body.data.redirectTo);
      expect(`${url.origin}${url.pathname}`).toBe(c.redirectUri);
      expect(Object.fromEntries(url.searchParams)).toEqual({ error: 'access_denied', state: 'state-1', iss: issuer() });
      expect((await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('denied');
      expect(await client.oAuthGrant.count({ where: { userId: user, clientId: c.id } })).toBe(0);
      const audit = await client.auditEvent.findFirstOrThrow({ where: { action: 'oauth:consent.deny', actorUserId: user } });
      expect(audit.targetId).toBe(requestId);
    });

    it('the code carries the state and iss; approving again widens the same grant (union of scopes) and never skips the page', async () => {
      const c = await newClient();
      const user = await makeUser('widen');
      const first = await approveFlow(user, c, { scope: 'asitems:read' });
      expect(first.redirect.searchParams.get('state')).toBe('state-1');
      expect(first.redirect.searchParams.get('iss')).toBe(issuer());
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id, revokedAt: null } });

      // a second request: the page still shows it, marking what is already granted
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge, { scope: 'asitems:read asitems:write' })).headers.location!);
      const session = await sessionToken(user);
      const read = await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
      expect(read.body.data.scopes.map((s: { id: string; alreadyGranted: boolean }) => [s.id, s.alreadyGranted])).toEqual([['asitems:read', true], ['asitems:write', false]]);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(200);
      const grants = await client.oAuthGrant.findMany({ where: { userId: user, clientId: c.id, revokedAt: null } });
      expect(grants).toHaveLength(1);
      expect(grants[0]!.id).toBe(grant.id);
      expect([...grants[0]!.scopes].sort()).toEqual(['asitems:read', 'asitems:write']);
      expect(await client.auditEvent.count({ where: { action: 'oauth:grant.update', targetId: grant.id } })).toBe(1);
      expect(await client.auditEvent.count({ where: { action: 'oauth:grant.create', targetId: grant.id } })).toBe(1);
    });

    it('offline_access is not tickable: it is granted with the grant when requested', async () => {
      const c = await newClient();
      const user = await makeUser('offline');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge, { scope: 'asitems:read offline_access' })).headers.location!);
      const read = await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
      expect(read.body.data.offlineAccess).toBe(true);
      expect(read.body.data.scopes.map((s: { id: string }) => s.id)).toEqual(['asitems:read']);
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve', scopes: ['asitems:read'] }).expect(200);
      expect((await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } })).scopes.sort()).toEqual(['asitems:read', 'offline_access']);
    });
  });

  describe('the whole flow, as a client', () => {
    it('authorize -> approve -> token -> call the resource -> refresh -> call -> revoke -> 401', async () => {
      const c = await newClient({ redirectUris: ['http://127.0.0.1/cb'] });
      const user = await makeUser('flow');
      const pkce = createOAuthTestPkce();
      const authorized = await authorize(c, pkce.challenge, { redirect_uri: 'http://127.0.0.1:60001/cb' }).expect(302);
      const requestId = requestIdOf(authorized.headers.location!);
      const session = await sessionToken(user);
      await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
      const decision = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(200);
      const redirect = new URL(decision.body.data.redirectTo);
      expect(`${redirect.origin}${redirect.pathname}`).toBe('http://127.0.0.1:60001/cb');
      const code = redirect.searchParams.get('code')!;
      secrets.push(code, pkce.verifier);

      const tokens = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:60001/cb', // byte for byte, port included
        code_verifier: pkce.verifier,
        client_id: c.clientId,
        resource: resourceUrl,
      }).expect(200);
      secrets.push(tokens.body.access_token, tokens.body.refresh_token);
      expect(tokens.headers['cache-control']).toBe('no-store');
      expect(tokens.body).toEqual({
        access_token: expect.stringMatching(/^oat_[A-Za-z0-9_-]{40,}$/),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: expect.stringMatching(/^ort_[A-Za-z0-9_-]{40,}$/),
        scope: 'asitems:read',
      });

      await http().get('/api/oauth-as-test/items').set(bearer(tokens.body.access_token)).expect(200);
      // the scope bounds what the user may do
      await http().post('/api/oauth-as-test/items').set(bearer(tokens.body.access_token)).expect(403);

      const refreshed = await refreshRequest(c, tokens.body.refresh_token).expect(200);
      secrets.push(refreshed.body.access_token, refreshed.body.refresh_token);
      expect(refreshed.body.refresh_token).not.toBe(tokens.body.refresh_token);
      expect(refreshed.body.scope).toBe('asitems:read');
      await http().get('/api/oauth-as-test/items').set(bearer(refreshed.body.access_token)).expect(200);

      await http().post('/api/oauth/revoke').type('form').send({ token: refreshed.body.refresh_token, client_id: c.clientId }).expect(200).expect('');
      await http().get('/api/oauth-as-test/items').set(bearer(refreshed.body.access_token)).expect(401);
      await http().get('/api/oauth-as-test/items').set(bearer(tokens.body.access_token)).expect(401);
      await refreshRequest(c, refreshed.body.refresh_token).expect(400);
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } });
      expect(grant.revokedAt).not.toBeNull();
    });

    it('revoking an access token revokes only that token; the refresh token still works', async () => {
      const c = await newClient();
      const user = await makeUser('revokeaccess');
      const { access, refresh } = await connect(user, c);
      await http().post('/api/oauth/revoke').type('form').send({ token: access, token_type_hint: 'access_token', client_id: c.clientId }).expect(200).expect('');
      await http().get('/api/oauth-as-test/items').set(bearer(access)).expect(401);
      const refreshed = await refreshRequest(c, refresh).expect(200);
      secrets.push(refreshed.body.access_token, refreshed.body.refresh_token);
      await http().get('/api/oauth-as-test/items').set(bearer(refreshed.body.access_token)).expect(200);
    });

    it('revocation always answers 200 with an empty body, including for an unknown token and another client\'s token', async () => {
      const c = await newClient();
      const other = await newClient();
      const user = await makeUser('revokeother');
      const { access, refresh } = await connect(user, c);
      await http().post('/api/oauth/revoke').type('form').send({ token: 'ort_unknown', client_id: c.clientId }).expect(200).expect('');
      await http().post('/api/oauth/revoke').type('form').send({ token: refresh, client_id: other.clientId }).expect(200).expect('');
      await http().get('/api/oauth-as-test/items').set(bearer(access)).expect(200); // not revoked by a stranger
      await http().post('/api/oauth/revoke').type('form').send({ client_id: c.clientId }).expect(400);
    });

    it('a refresh token is issued only with offline_access or alwaysIssueRefreshToken', async () => {
      const c = await newClient();
      const user = await makeUser('norefresh');
      await app.get(SystemSettingsService).patchSettings({ oauthServer: { alwaysIssueRefreshToken: false } } as never, readerUserId);
      app.get(OAuthServerSettingsReader).invalidate();
      try {
        const without = await connect(user, c);
        expect(without.body.refresh_token).toBeUndefined();
        const user2 = await makeUser('norefresh2');
        const withOffline = await connect(user2, c, { scope: 'asitems:read offline_access' });
        expect(withOffline.body.refresh_token).toMatch(/^ort_/);
        expect(withOffline.body.scope).toBe('asitems:read offline_access');
      } finally {
        await app.get(SystemSettingsService).patchSettings({ oauthServer: { alwaysIssueRefreshToken: true } } as never, readerUserId);
        app.get(OAuthServerSettingsReader).invalidate();
      }
    });

    it('lifetimes come from the settings (access token minutes, refresh token days, the age cap)', async () => {
      const c = await newClient();
      const user = await makeUser('lifetimes');
      await app.get(SystemSettingsService).patchSettings({ oauthServer: { accessTokenTtlMinutes: 5, refreshTokenTtlDays: 2, refreshTokenMaxAgeDays: 1 } } as never, readerUserId);
      app.get(OAuthServerSettingsReader).invalidate();
      try {
        const { body, grantId } = await connect(user, c);
        expect(body.expires_in).toBe(300);
        const refreshRow = await client.oAuthToken.findFirstOrThrow({ where: { grantId, kind: 'refresh' } });
        const grant = await client.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } });
        // refreshTokenTtlDays 2 is capped at 1 day from the grant's creation
        expect(refreshRow.expiresAt.getTime()).toBeLessThanOrEqual(grant.createdAt.getTime() + 86_400_000 + 1000);
        expect(refreshRow.expiresAt.getTime()).toBeGreaterThan(grant.createdAt.getTime() + 86_400_000 - 60_000);
      } finally {
        await app.get(SystemSettingsService).patchSettings({ oauthServer: { accessTokenTtlMinutes: 60, refreshTokenTtlDays: 30, refreshTokenMaxAgeDays: 180 } } as never, readerUserId);
        app.get(OAuthServerSettingsReader).invalidate();
      }
    });
  });

  describe('PKCE', () => {
    it('a wrong verifier, a missing verifier and a verifier equal to the challenge are refused; the code survives for the right one', async () => {
      const c = await newClient();
      const user = await makeUser('pkce');
      const flow = await approveFlow(user, c);
      const wrong = createOAuthTestPkce();
      const bad = await expectStatus(exchange(c, flow, { code_verifier: wrong.verifier }), 400);
      expect(bad.body.error).toBe('invalid_grant');
      const missing = await expectStatus(exchange(c, flow, { code_verifier: undefined }), 400);
      expect(missing.body.error).toBe('invalid_request');
      const challengeAsVerifier = await expectStatus(exchange(c, flow, { code_verifier: createHash('sha256').update(flow.pkce.verifier).digest('base64url') }), 400);
      expect(challengeAsVerifier.body.error).toBe('invalid_grant');
      // a failed PKCE attempt does not consume the code
      await expectStatus(exchange(c, flow), 200);
    });

    it('the plain method is refused at /authorize (never stored)', async () => {
      const c = await newClient();
      const res = await authorize(c, createOAuthTestPkce().challenge, { code_challenge_method: 'plain' }).expect(302);
      expect(new URL(res.headers.location!).searchParams.get('error')).toBe('invalid_request');
      expect(await client.oAuthAuthorizationRequest.count({ where: { clientId: c.id } })).toBe(0);
    });
  });

  describe('the authorization code', () => {
    it('a code used twice revokes the grant: the first access token and refresh token stop working', async () => {
      const c = await newClient();
      const user = await makeUser('codetwice');
      const flow = await approveFlow(user, c);
      const first = await expectStatus(exchange(c, flow), 200);
      await http().get('/api/oauth-as-test/items').set(bearer(first.body.access_token)).expect(200);
      const second = await expectStatus(exchange(c, flow), 400);
      expect(second.body.error).toBe('invalid_grant');
      await http().get('/api/oauth-as-test/items').set(bearer(first.body.access_token)).expect(401);
      await refreshRequest(c, first.body.refresh_token).expect(400);
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } });
      expect(grant).toMatchObject({ revokedReason: 'reuse_detected' });
      expect(grant.revokedAt).not.toBeNull();
      expect(await client.oAuthToken.count({ where: { grantId: grant.id, revokedAt: null } })).toBe(0);
      expect(await client.auditEvent.count({ where: { action: 'oauth:token.reuse_detected', targetId: grant.id } })).toBe(1);
    });

    it('a code is refused for another client, another redirect URI, another resource and after 60 seconds', async () => {
      const c = await newClient();
      const other = await newClient();
      const user = await makeUser('codechecks');
      const flow = await approveFlow(user, c);
      expect((await expectStatus(exchange(other, flow), 400)).body.error).toBe('invalid_grant');
      expect((await expectStatus(exchange(c, flow, { redirect_uri: 'https://client.example.test/cb/' }), 400)).body.error).toBe('invalid_grant');
      expect((await expectStatus(exchange(c, flow, { resource: `${appUrl}/api/other` }), 400)).body.error).toBe('invalid_grant');
      await expectStatus(exchange(c, flow, { resource: `${resourceUrl}/` }), 200); // an equivalent resource is accepted
      const expiredUser = await makeUser('codeexpired');
      const late = await approveFlow(expiredUser, c);
      await client.oAuthAuthorizationCode.updateMany({ where: { grant: { userId: expiredUser } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await expectStatus(exchange(c, late), 400)).body.error).toBe('invalid_grant');
      expect((await expectStatus(exchange(c, { code: 'oac_not-a-code', pkce: flow.pkce }), 400)).body.error).toBe('invalid_grant');
    });

    it('the code lives 60 seconds and is stored only as a hash', async () => {
      const c = await newClient();
      const user = await makeUser('codehash');
      const flow = await approveFlow(user, c);
      const row = await client.oAuthAuthorizationCode.findFirstOrThrow({ where: { grant: { userId: user } } });
      expect(row.codeHash).toBe(sha256(flow.code));
      expect(JSON.stringify(row)).not.toContain(flow.code);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(60_000);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(55_000);
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('rotates: the old token is marked rotated and replaced; the new pair works', async () => {
      const c = await newClient();
      const user = await makeUser('rotate');
      const { refresh, grantId } = await connect(user, c);
      const next = await refreshRequest(c, refresh).expect(200);
      secrets.push(next.body.access_token, next.body.refresh_token);
      const oldRow = await client.oAuthToken.findUniqueOrThrow({ where: { tokenHash: sha256(refresh) } });
      const newRow = await client.oAuthToken.findUniqueOrThrow({ where: { tokenHash: sha256(next.body.refresh_token) } });
      expect(oldRow.rotatedAt).not.toBeNull();
      expect(oldRow.replacedById).toBe(newRow.id);
      expect(newRow).toMatchObject({ kind: 'refresh', grantId, rotatedAt: null, revokedAt: null });
      const again = await refreshRequest(c, next.body.refresh_token).expect(200);
      secrets.push(again.body.access_token, again.body.refresh_token);
    });

    it('the previous token works again only inside the 10-second grace window: it revokes the unused successor and issues a NEW pair', async () => {
      const c = await newClient();
      const user = await makeUser('grace');
      const { refresh, grantId } = await connect(user, c);
      const first = await refreshRequest(c, refresh).expect(200); // the response the client "lost"
      secrets.push(first.body.access_token, first.body.refresh_token);
      const retry = await refreshRequest(c, refresh).expect(200); // inside the window
      secrets.push(retry.body.access_token, retry.body.refresh_token);
      expect(retry.body.refresh_token).not.toBe(first.body.refresh_token);
      expect(retry.body.access_token).not.toBe(first.body.access_token);
      // the lost successor pair is dead; the new one lives
      await http().get('/api/oauth-as-test/items').set(bearer(first.body.access_token)).expect(401);
      await refreshRequest(c, first.body.refresh_token).expect(400);
      await http().get('/api/oauth-as-test/items').set(bearer(retry.body.access_token)).expect(200);
      // a failed attempt with the dead successor is not "reuse" of the live chain: the grant lives
      expect((await client.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } })).revokedAt).toBeNull();
      const old = await client.oAuthToken.findUniqueOrThrow({ where: { tokenHash: sha256(refresh) } });
      const live = await client.oAuthToken.findUniqueOrThrow({ where: { tokenHash: sha256(retry.body.refresh_token) } });
      expect(old.replacedById).toBe(live.id);
      await refreshRequest(c, retry.body.refresh_token).expect(200);
    });

    it('after the grace window the previous token is REUSE: the grant and every token of it die, audited', async () => {
      const c = await newClient();
      const user = await makeUser('reuse');
      const { refresh, grantId } = await connect(user, c);
      const next = await refreshRequest(c, refresh).expect(200);
      secrets.push(next.body.access_token, next.body.refresh_token);
      await client.oAuthToken.updateMany({ where: { tokenHash: sha256(refresh) }, data: { rotatedAt: new Date(Date.now() - 11_000) } });
      const reuse = await refreshRequest(c, refresh).expect(400);
      expect(reuse.body.error).toBe('invalid_grant');
      await http().get('/api/oauth-as-test/items').set(bearer(next.body.access_token)).expect(401);
      await refreshRequest(c, next.body.refresh_token).expect(400);
      const grant = await client.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } });
      expect(grant).toMatchObject({ revokedReason: 'reuse_detected' });
      expect(await client.oAuthToken.count({ where: { grantId, revokedAt: null } })).toBe(0);
      expect(await client.auditEvent.count({ where: { action: 'oauth:token.reuse_detected', targetId: grantId } })).toBe(1);
    });

    it('inside the grace window but with the successor ALREADY USED is reuse too', async () => {
      const c = await newClient();
      const user = await makeUser('graceused');
      const { refresh, grantId } = await connect(user, c);
      const first = await refreshRequest(c, refresh).expect(200);
      secrets.push(first.body.access_token, first.body.refresh_token);
      const second = await refreshRequest(c, first.body.refresh_token).expect(200); // the successor was used
      secrets.push(second.body.access_token, second.body.refresh_token);
      await refreshRequest(c, refresh).expect(400);
      expect((await client.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } })).revokedReason).toBe('reuse_detected');
      await http().get('/api/oauth-as-test/items').set(bearer(second.body.access_token)).expect(401);
    });

    it('scope may only narrow; the refresh token keeps what was granted', async () => {
      const c = await newClient();
      const user = await makeUser('narrow');
      const { refresh } = await connect(user, c, { scope: 'asitems:read asitems:write' });
      const narrowed = await refreshRequest(c, refresh, { scope: 'asitems:read' }).expect(200);
      secrets.push(narrowed.body.access_token, narrowed.body.refresh_token);
      expect(narrowed.body.scope).toBe('asitems:read');
      await http().post('/api/oauth-as-test/items').set(bearer(narrowed.body.access_token)).expect(403);
      const wider = await refreshRequest(c, narrowed.body.refresh_token, { scope: 'asitems:read asitems:write' }).expect(200);
      secrets.push(wider.body.access_token, wider.body.refresh_token);
      await http().post('/api/oauth-as-test/items').set(bearer(wider.body.access_token)).expect(201);
      const beyond = await refreshRequest(c, wider.body.refresh_token, { scope: 'asitems:read nope:more' }).expect(400);
      expect(beyond.body.error).toBe('invalid_scope');
    });

    it('answers invalid_grant, exactly, for every dead refresh token: unknown, expired, revoked, another client\'s, an access token, a disabled client', async () => {
      const c = await newClient();
      const other = await newClient();
      const user = await makeUser('dead');
      const { refresh, access, grantId } = await connect(user, c);
      const expectDead = async (res: request.Test) => {
        const done = await res.expect(400);
        expect(done.body.error).toBe('invalid_grant');
        expect(Object.keys(done.body).sort()).toEqual(['error', 'error_description']);
      };
      await expectDead(refreshRequest(c, 'ort_unknown'));
      await expectDead(refreshRequest(c, access)); // an access token is no refresh token
      await expectDead(refreshRequest(other, refresh)); // not this client's
      await client.oAuthToken.updateMany({ where: { tokenHash: sha256(refresh) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expectDead(refreshRequest(c, refresh)); // expired
      const user2 = await makeUser('dead2');
      const second = await connect(user2, c);
      await client.oAuthGrant.update({ where: { id: second.grantId }, data: { revokedAt: new Date(), revokedReason: 'user' } });
      await expectDead(refreshRequest(c, second.refresh)); // grant revoked
      const user3 = await makeUser('dead3');
      const third = await connect(user3, c);
      await client.oAuthClient.update({ where: { id: c.id }, data: { disabledAt: new Date() } });
      await expectDead(refreshRequest(c, third.refresh)); // client disabled
      expect(grantId).toBeTruthy();
    });
  });

  describe('the token endpoint\'s wire format', () => {
    it('accepts form bodies, refuses JSON and other types, answers RFC 6749 JSON with no data envelope and no-store', async () => {
      const c = await newClient();
      const ok = await tokenRequest({ grant_type: 'authorization_code', code: 'oac_x', redirect_uri: c.redirectUri, code_verifier: 'v'.repeat(43), client_id: c.clientId });
      expect(ok.status).toBe(400);
      expect(ok.body).toEqual({ error: 'invalid_grant', error_description: expect.any(String) });
      expect(ok.body.data).toBeUndefined();
      expect(ok.body.statusCode).toBeUndefined();
      expect(ok.headers['cache-control']).toBe('no-store');
      expect(ok.headers['access-control-allow-origin']).toBe('*');

      for (const send of [
        () => http().post('/api/oauth/token').send({ grant_type: 'refresh_token', refresh_token: 'x', client_id: c.clientId }),
        () => http().post('/api/oauth/token').set('content-type', 'text/plain').send('grant_type=refresh_token'),
        () => http().post('/api/oauth/token').send(),
        () => http().post('/api/oauth/revoke').send({ token: 'x', client_id: c.clientId }),
      ]) {
        const res = await send();
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'invalid_request', error_description: expect.any(String) });
      }
    });

    it('refuses a body over 16 KiB, a repeated parameter, a missing grant_type and an unknown grant type', async () => {
      const c = await newClient();
      const big = await http().post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: 'x'.repeat(20 * 1024), client_id: c.clientId });
      expect(big.status).toBe(400);
      expect(big.body.error).toBe('invalid_request');
      const repeated = await http().post('/api/oauth/token').set('content-type', 'application/x-www-form-urlencoded').send(`grant_type=refresh_token&grant_type=refresh_token&client_id=${c.clientId}`);
      expect(repeated.body.error).toBe('invalid_request');
      expect((await tokenRequest({ client_id: c.clientId })).body.error).toBe('invalid_request');
      const unsupported = await tokenRequest({ grant_type: 'password', client_id: c.clientId });
      expect(unsupported.status).toBe(400);
      expect(unsupported.body.error).toBe('unsupported_grant_type');
      expect((await tokenRequest({ grant_type: 'refresh_token' })).body.error).toBe('invalid_request'); // no client at all
    });

    it('answers the CORS preflight of a browser client', async () => {
      const res = await http().options('/api/oauth/token').set('origin', 'https://client.example.test').set('access-control-request-method', 'POST').expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toMatch(/authorization/);
    });
  });

  describe('iss', () => {
    it('is on every authorization response, success and error, and equals the metadata issuer', async () => {
      const metadata = await http().get('/api/oauth/.well-known/authorization-server').expect(200);
      const c = await newClient();
      const user = await makeUser('iss');
      const approved = await approveFlow(user, c);
      expect(approved.redirect.searchParams.get('iss')).toBe(metadata.body.issuer);

      const pkce = createOAuthTestPkce();
      const bad = await authorize(c, pkce.challenge, { response_type: 'token' }).expect(302);
      expect(new URL(bad.headers.location!).searchParams.get('iss')).toBe(metadata.body.issuer);

      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      const denied = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(await sessionToken(user))).send({ decision: 'deny' }).expect(200);
      expect(new URL(denied.body.data.redirectTo).searchParams.get('iss')).toBe(metadata.body.issuer);
    });
  });

  describe('client authentication', () => {
    it('client_secret_basic and client_secret_post authenticate a confidential client; a wrong or missing secret is 401 invalid_client', async () => {
      const basic = await newClient({ tokenEndpointAuthMethod: 'client_secret_basic' });
      const post = await newClient({ tokenEndpointAuthMethod: 'client_secret_post' });
      const user = await makeUser('confidential');
      const basicHeader = (id: string, secret: string) => ({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}` });

      const basicFlow = await approveFlow(user, basic);
      const wrongBasic = await tokenRequest({ grant_type: 'authorization_code', code: basicFlow.code, redirect_uri: basic.redirectUri, code_verifier: basicFlow.pkce.verifier }, basicHeader(basic.clientId, 'wrong-secret'));
      expect(wrongBasic.status).toBe(401);
      expect(wrongBasic.body.error).toBe('invalid_client');
      expect(wrongBasic.headers['www-authenticate']).toMatch(/^Basic/);
      // a wrong secret does not burn the code
      const okBasic = await tokenRequest({ grant_type: 'authorization_code', code: basicFlow.code, redirect_uri: basic.redirectUri, code_verifier: basicFlow.pkce.verifier }, basicHeader(basic.clientId, basic.secret!));
      expect(okBasic.status).toBe(200);
      secrets.push(okBasic.body.access_token, okBasic.body.refresh_token);
      // a secret in the body does not satisfy a client_secret_basic client, and no secret at all is refused
      expect((await refreshRequest(basic, okBasic.body.refresh_token, { client_secret: basic.secret })).status).toBe(401);
      expect((await refreshRequest(basic, okBasic.body.refresh_token)).status).toBe(401);

      const user2 = await makeUser('confidential2');
      const postFlow = await approveFlow(user2, post);
      const wrongPost = await exchange(post, postFlow, { client_secret: 'wrong' });
      expect(wrongPost.status).toBe(401);
      expect(wrongPost.body.error).toBe('invalid_client');
      expect((await exchange(post, postFlow)).status).toBe(401);
      const okPost = await exchange(post, postFlow, { client_secret: post.secret });
      expect(okPost.status).toBe(200);
      // and the confidential client's secret is stored only as a hash
      const row = await client.oAuthClient.findUniqueOrThrow({ where: { id: post.id } });
      expect(row.secretHash).toBe(sha256(post.secret!));
    });

    it('revocation authenticates a confidential client too', async () => {
      const c = await newClient({ tokenEndpointAuthMethod: 'client_secret_post' });
      const user = await makeUser('revokeconf');
      const flow = await approveFlow(user, c);
      const tokens = await exchange(c, flow, { client_secret: c.secret });
      await http().post('/api/oauth/revoke').type('form').send({ token: tokens.body.refresh_token, client_id: c.clientId, client_secret: 'wrong' }).expect(401);
      await http().get('/api/oauth-as-test/items').set(bearer(tokens.body.access_token)).expect(200);
      await http().post('/api/oauth/revoke').type('form').send({ token: tokens.body.refresh_token, client_id: c.clientId, client_secret: c.secret }).expect(200);
      await http().get('/api/oauth-as-test/items').set(bearer(tokens.body.access_token)).expect(401);
    });

    it('an unknown client is 401 invalid_client', async () => {
      const res = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'oc_nobody' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    });
  });

  describe('the grants API (Connected apps)', () => {
    it('lists only the caller\'s active grants, never a token; DELETE revokes only the caller\'s, and takes effect on the next request', async () => {
      const c = await newClient({ name: 'Client Gamma', logoUri: 'https://client.example.test/logo.png' });
      const mine = await makeUser('grantsmine');
      const theirs = await makeUser('grantstheirs');
      const connected = await connect(mine, c, { scope: 'asitems:read asitems:write' });
      const other = await connect(theirs, c);
      await http().get('/api/oauth-as-test/items').set(bearer(connected.access)).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 300)); // last_used_at is written fire-and-forget

      const session = await sessionToken(mine);
      const list = await http().get('/api/oauth/grants').set(bearer(session)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({
        id: connected.grantId,
        client: { name: 'Client Gamma', host: 'client.example.test', logoUri: 'https://client.example.test/logo.png' },
        resource: { id: 'oauth-as-test', name: 'Authorization server test resource' },
        scopes: [{ id: 'asitems:read', title: 'Read items' }, { id: 'asitems:write', title: 'Change items' }],
        organization: { id: defaultOrgId },
      });
      expect(list.body.data[0].lastUsedAt).not.toBeNull();
      const wire = JSON.stringify(list.body);
      for (const secret of [connected.access, connected.refresh, other.access, other.refresh, sha256(connected.access), sha256(connected.refresh)]) expect(wire).not.toContain(secret);

      // someone else's grant is a 404 and is untouched
      await http().delete(`/api/oauth/grants/${other.grantId}`).set(bearer(session)).expect(404);
      await http().get('/api/oauth-as-test/items').set(bearer(other.access)).expect(200);
      await http().delete('/api/oauth/grants/not-a-uuid').set(bearer(session)).expect(400);

      await http().delete(`/api/oauth/grants/${connected.grantId}`).set(bearer(session)).expect(204);
      await http().get('/api/oauth-as-test/items').set(bearer(connected.access)).expect(401); // the very next request
      await refreshRequest(c, connected.refresh).expect(400);
      expect((await http().get('/api/oauth/grants').set(bearer(session)).expect(200)).body.data).toHaveLength(0);
      await http().delete(`/api/oauth/grants/${connected.grantId}`).set(bearer(session)).expect(404);
      expect(await client.oAuthGrant.findUniqueOrThrow({ where: { id: connected.grantId } })).toMatchObject({ revokedReason: 'user' });
      const audit = await client.auditEvent.findFirstOrThrow({ where: { action: 'oauth:grant.revoke', targetId: connected.grantId } });
      expect(audit.actorUserId).toBe(mine);
      await http().get('/api/oauth/grants').expect(401);
    });

    it('a personal access token may list and revoke (spec: session or PAT)', async () => {
      const c = await newClient();
      const user = await makeUser('grantspat');
      const connected = await connect(user, c);
      const pat = await app.get(PatService).createToken(user, { name: 'osas-grants', durationValue: 1, durationUnit: 'days' }, { activeOrgId: defaultOrgId });
      secrets.push(pat.token);
      const list = await http().get('/api/oauth/grants').set(bearer(pat.token)).expect(200);
      expect(list.body.data).toHaveLength(1);
      await http().delete(`/api/oauth/grants/${connected.grantId}`).set(bearer(pat.token)).expect(204);
    });
  });

  describe('rate limits', () => {
    beforeAll(() => {
      limiterMode = 'real';
    });
    afterAll(() => {
      limiterMode = 'off';
    });

    it('/token answers 429 temporarily_unavailable with Retry-After after 60 requests per client in a minute', async () => {
      const c = await newClient();
      let last: request.Response | undefined;
      for (let i = 0; i < 61; i += 1) {
        last = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'ort_none', client_id: c.clientId });
        if (i < 60) expect(last.status).toBe(400);
      }
      expect(last!.status).toBe(429);
      expect(last!.body).toEqual({ error: 'temporarily_unavailable', error_description: expect.any(String) });
      expect(Number(last!.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(last!.headers['retry-after'])).toBeLessThanOrEqual(60);
      // another client is not affected
      const fresh = await newClient();
      expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'ort_none', client_id: fresh.clientId })).status).toBe(400);
    });

    it('/revoke is limited to 60 per minute per client', async () => {
      const c = await newClient();
      let last: request.Response | undefined;
      for (let i = 0; i < 61; i += 1) last = await http().post('/api/oauth/revoke').type('form').send({ token: 'ort_none', client_id: c.clientId });
      expect(last!.status).toBe(429);
      expect(last!.body.error).toBe('temporarily_unavailable');
      expect(last!.headers['retry-after']).toBeDefined();
    });

    it('/authorize is limited to 30 per minute per source address', async () => {
      const c = await newClient();
      const pkce = createOAuthTestPkce();
      // the limiter state is per key, and this key (the loopback address) is shared by the whole suite: spend what is left
      let limited: request.Response | undefined;
      for (let i = 0; i < 31 && !limited; i += 1) {
        const res = await authorize(c, pkce.challenge);
        if (res.status === 429) limited = res;
      }
      expect(limited).toBeDefined();
      expect(limited!.body).toEqual({ error: 'temporarily_unavailable', error_description: expect.any(String) });
      expect(limited!.headers['retry-after']).toBeDefined();
    });
  });

  describe('events and audit run after the commit', () => {
    it('a transaction that fails leaves no grant, no code, no audit row and no event; the request stays pending', async () => {
      const c = await newClient();
      const user = await makeUser('failtx');
      const session = await sessionToken(user);
      const pkce = createOAuthTestPkce();
      const requestId = requestIdOf((await authorize(c, pkce.challenge)).headers.location!);
      const emitter = app.get(EventEmitter2);
      const emit = jest.spyOn(emitter, 'emit');
      const original = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, options: unknown) =>
        original(async (tx: unknown) => {
          await fn(tx); // everything ran, then the transaction fails: it must all roll back
          throw new Error('simulated commit failure');
        }, options)) as never);
      try {
        await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(500);
        expect(emit.mock.calls.filter(([name]) => String(name).startsWith('identity.oauth.'))).toHaveLength(0);
      } finally {
        spy.mockRestore();
        emit.mockRestore();
      }
      expect(await client.oAuthGrant.count({ where: { userId: user } })).toBe(0);
      expect(await client.oAuthAuthorizationCode.count({ where: { grant: { userId: user } } })).toBe(0);
      expect(await client.auditEvent.count({ where: { actorUserId: user, action: { startsWith: 'oauth:' } } })).toBe(0);
      expect((await client.oAuthAuthorizationRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('pending');
      // and the same request can still be approved
      await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(200);
    });

    it('identity.oauth.grant.created fires after the grant committed, with ids only; .revoked on every revocation', async () => {
      const c = await newClient();
      const user = await makeUser('events');
      const emitter = app.get(EventEmitter2);
      const seen: Array<{ name: string; payload: Record<string, unknown>; committed: boolean }> = [];
      const emit = jest.spyOn(emitter, 'emit').mockImplementation(((name: string, payload: Record<string, unknown>) => {
        if (String(name).startsWith('identity.oauth.')) {
          // the listener runs synchronously: what it can see in the database is what is committed
          void client.oAuthGrant.findUnique({ where: { id: payload.grantId as string } }).then((row) => seen.push({ name, payload, committed: row !== null }));
        }
        return true;
      }) as never);
      try {
        const connected = await connect(user, c);
        await http().delete(`/api/oauth/grants/${connected.grantId}`).set(bearer(await sessionToken(user))).expect(204);
        await new Promise((resolve) => setTimeout(resolve, 200));
      } finally {
        emit.mockRestore();
      }
      expect(seen.map((entry) => entry.name)).toEqual(['identity.oauth.grant.created', 'identity.oauth.grant.revoked']);
      expect(seen.every((entry) => entry.committed)).toBe(true);
      expect(seen[0]!.payload).toEqual({ userId: user, grantId: expect.any(String), clientId: c.id, resourceId: 'oauth-as-test', reason: 'created' });
      expect(seen[1]!.payload).toEqual({ userId: user, grantId: seen[0]!.payload.grantId, clientId: c.id, resourceId: 'oauth-as-test', reason: 'user' });
    });

    it('a failed code exchange transaction leaves the code unconsumed and no tokens', async () => {
      const c = await newClient();
      const user = await makeUser('failexchange');
      const flow = await approveFlow(user, c);
      const original = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, options: unknown) =>
        original(async (tx: unknown) => {
          await fn(tx);
          throw new Error('simulated failure');
        }, options)) as never);
      try {
        const failed = await exchange(c, flow);
        expect(failed.status).toBe(500);
        expect(failed.body).toEqual({ error: 'server_error', error_description: expect.any(String) });
      } finally {
        spy.mockRestore();
      }
      const grant = await client.oAuthGrant.findFirstOrThrow({ where: { userId: user, clientId: c.id } });
      expect(await client.oAuthToken.count({ where: { grantId: grant.id } })).toBe(0);
      await expectStatus(exchange(c, flow), 200); // not consumed: a retry works
    });
  });

  describe('latency budget', () => {
    it('/token issues at most 6 queries (data statements; BEGIN and COMMIT are transaction control): the code exchange and the refresh', async () => {
      const c = await newClient();
      const user = await makeUser('budget');
      const flow = await approveFlow(user, c);
      // warm the settings cache and the grant row
      await app.get(OAuthServerSettingsReader).read();
      queries.length = 0;
      counting = true;
      const exchanged = await exchange(c, flow);
      counting = false;
      expect(exchanged.status).toBe(200);
      expect(queries.length).toBeLessThanOrEqual(6);
      const exchangeQueries = queries.length;

      queries.length = 0;
      counting = true;
      const refreshed = await refreshRequest(c, exchanged.body.refresh_token);
      counting = false;
      expect(refreshed.status).toBe(200);
      secrets.push(refreshed.body.access_token, refreshed.body.refresh_token);
      expect(queries.length).toBeLessThanOrEqual(6);
      expect(exchangeQueries).toBeGreaterThan(0);
    });
  });

  describe('secrets never reach a log line or an audit row', () => {
    it('no code, access token, refresh token, verifier, client secret, session token or token hash appears in anything logged or audited', async () => {
      const haystack = logLines.join('\n');
      expect(haystack).toContain('oauth token: authorization_code issued'); // the capture works
      expect(haystack).toContain('oauth token: reuse detected');
      const audit = JSON.stringify(
        await client.auditEvent.findMany({ where: { OR: [{ action: { startsWith: 'oauth:' } }, { targetType: 'oauth_grant' }] } }),
      );
      expect(audit).toContain('oauth:grant.create');
      const unique = [...new Set(secrets)].filter((secret) => secret && secret.length > 8);
      expect(unique.length).toBeGreaterThan(50);
      for (const secret of unique) {
        expect(haystack).not.toContain(secret);
        expect(audit).not.toContain(secret);
        expect(haystack).not.toContain(sha256(secret));
        expect(audit).not.toContain(sha256(secret));
      }
      expect(haystack).not.toMatch(/oat_[A-Za-z0-9_-]{20}/);
      expect(haystack).not.toMatch(/ort_[A-Za-z0-9_-]{20}/);
      expect(haystack).not.toMatch(/oac_[A-Za-z0-9_-]{20}/);
    });
  });
});

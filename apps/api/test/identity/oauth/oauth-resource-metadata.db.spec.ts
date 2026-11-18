// =============================================================================
// OAuth resource-server helpers through the whole app (real Postgres, PP-15.6, #1184)
// =============================================================================
//
// Boots the reference app (`AppModule`: the real JwtAuthGuard, PermissionsGuard, error filter and Fastify) with the REAL
// CORS configuration `main.ts` builds (`buildCorsOptions(raw, { openPaths: OAUTH_PUBLIC_CORS_PATHS })`, applied with
// `app.enableCors`), plus one test-only module: two protected resources and a few routes under the first. Proves:
//
//   - protected resource metadata (RFC 9728): the path form, `resource` = APP_URL + path byte for byte, one
//     authorization server, both following APP_URL, 404 for the bare path with two resources, for an unknown path and
//     while disabled;
//   - the 401 challenge on the resource's routes (no credential, a bad session, a bad PAT, an unknown, expired and
//     revoked `oat_`), and routes OUTSIDE every resource byte-identical to before (no header, same body);
//   - `403 insufficient_scope`: thrown directly, from `assertOAuthScopes`, and mapped from a `PermissionsGuard`
//     denial only when re-consent can fix it; a plain 403 for a PAT and for an unfixable denial;
//   - CORS: both documents cross-origin, a preflighted `POST /api/oauth/token`, `/register`, `/revoke`; the rest of
//     the API keeps the allowlist;
//   - a scripted client that knows only the resource URL: discovery from the 401 alone.
//
// THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Controller, Get, Module, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import type { Principal } from '@marinoscar/platform-api/core';
import {
  Auth,
  AuthService,
  CurrentPrincipal,
  InsufficientScopeException,
  OAUTH_PUBLIC_CORS_PATHS,
  OAuthServerSettingsReader,
  PatService,
  PRINCIPAL_USER_INCLUDE,
  assertOAuthScopes,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import { buildCorsOptions } from '@marinoscar/platform-api/host';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-resource-metadata.db.spec');

const ALLOWED_ORIGIN = 'https://allowed.example.test';
const THIRD_ORIGIN = 'https://third-party.example.test';
const SECRET_PERMISSION = 'system_settings:read'; // a permission no scope of the test resources grants

registerOAuthScope({ id: 'osmeta_items:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthScope({ id: 'osmeta_items:write', title: 'Change items', description: 'Edit items.', permissions: ['users:write'], risk: 'elevated' });
registerOAuthProtectedResource({
  id: 'oauth-meta',
  path: '/api/oauth-meta',
  routePrefixes: ['/api/oauth-meta'],
  scopes: ['osmeta_items:read', 'osmeta_items:write'],
  name: 'Metadata test resource',
  documentation: 'https://docs.example.test/meta',
});
registerOAuthProtectedResource({
  id: 'oauth-meta-b',
  path: '/api/oauth-meta-b',
  routePrefixes: ['/api/oauth-meta-b'],
  scopes: ['osmeta_items:read'],
  name: 'Second metadata test resource',
});

@Controller('oauth-meta')
class OAuthMetaController {
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

  /** Needs a permission NO scope grants: a plain 403 whatever the user holds. */
  @Get('secret')
  @Auth({ permissions: [SECRET_PERMISSION] })
  secret() {
    return { secret: true };
  }

  @Get('any')
  @Auth({ anyPermissions: [SECRET_PERMISSION, 'users:write'] })
  any() {
    return { any: true };
  }

  /** A resource's body-level gate. */
  @Post('gate')
  @Auth()
  gate(@CurrentPrincipal() principal: Principal) {
    assertOAuthScopes(principal, 'oauth-meta', ['osmeta_items:write']);
    return { passed: true };
  }

  @Get('throws')
  @Auth()
  throws() {
    throw new InsufficientScopeException({ resourceId: 'oauth-meta', requiredScopes: ['osmeta_items:write'] });
  }
}

@Controller('oauth-meta-b')
class OAuthMetaBController {
  @Get('anything')
  @Auth()
  anything() {
    return { ok: true };
  }
}

@Module({ controllers: [OAuthMetaController, OAuthMetaBController] })
class OAuthMetaModule {}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Parses `Bearer k="v", k2="v2"`; quoted-string values, backslash escapes undone. */
function parseChallenge(header: string | undefined): Record<string, string> {
  expect(header).toBeDefined();
  expect(header!.startsWith('Bearer ')).toBe(true);
  const out: Record<string, string> = {};
  for (const match of header!.slice('Bearer '.length).matchAll(/([a-z_]+)="((?:[^"\\]|\\.)*)"/g)) out[match[1]!] = match[2]!.replace(/\\(.)/g, '$1');
  return out;
}

describeWithDb('OAuth protected resource metadata, challenges and CORS through the whole app (real Postgres, #1184)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  const run = randomUUID().slice(0, 8);
  const created = { users: [] as string[], roles: [] as string[], permissions: [] as string[], clients: [] as string[] };
  let defaultOrgId: string;
  let roleId: string;
  let appUrl: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  /** What nginx does (infra/nginx/platform/oauth-server.conf): a root well-known URL to the API path. */
  const viaNginx = (url: string) =>
    url
      .replace(`${appUrl}/.well-known/oauth-protected-resource`, '/api/oauth/.well-known/protected-resource')
      .replace(`${appUrl}/.well-known/oauth-authorization-server`, '/api/oauth/.well-known/authorization-server');

  async function makeUser(label: string, options: { perms?: string[] } = {}) {
    const user = await client.user.create({ data: { email: `osmeta-${label}-${run}@example.test`, isActive: true }, select: { id: true } });
    created.users.push(user.id);
    let role = roleId;
    if (options.perms) {
      role = (await client.role.create({ data: { name: `osmeta_role_${label}_${run}`, scope: 'org' }, select: { id: true } })).id;
      created.roles.push(role);
      for (const name of options.perms) {
        const permission = await client.permission.findUniqueOrThrow({ where: { name } });
        await client.rolePermission.create({ data: { roleId: role, permissionId: permission.id } });
      }
    }
    await client.membership.create({ data: { orgId: defaultOrgId, userId: user.id, roleId: role } });
    return user.id;
  }

  async function makeToken(userId: string, options: { scopes?: string[]; expiresInMs?: number; revoked?: boolean } = {}) {
    const own = await client.oAuthClient.create({
      data: {
        clientId: `oc_${run}_${randomBytes(3).toString('hex')}`,
        kind: 'registered',
        name: 'Client Beta',
        redirectUris: ['https://client.example.test/cb'],
        tokenEndpointAuthMethod: 'none',
        host: 'client.example.test',
      },
    });
    created.clients.push(own.id);
    const scopes = options.scopes ?? ['osmeta_items:read'];
    const grant = await client.oAuthGrant.create({ data: { userId, orgId: defaultOrgId, clientId: own.id, resource: `${appUrl}/api/oauth-meta`, scopes } });
    const raw = `oat_${randomBytes(24).toString('base64url')}`;
    await client.oAuthToken.create({
      data: {
        kind: 'access',
        tokenHash: sha256(raw),
        tokenPrefix: raw.slice(4, 12),
        grantId: grant.id,
        scopes,
        expiresAt: new Date(Date.now() + (options.expiresInMs ?? 3_600_000)),
        ...(options.revoked ? { revokedAt: new Date() } : {}),
      },
    });
    return raw;
  }

  async function setEnabled(enabled: boolean) {
    await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled } } as never, created.users[0]!);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    for (const [name, scope] of [['users:read', 'system'], ['users:write', 'system'], [SECRET_PERMISSION, 'system']] as const) {
      const existing = await client.permission.findUnique({ where: { name } });
      if (!existing) created.permissions.push((await client.permission.create({ data: { name, scope } })).id);
    }
    roleId = (await client.role.create({ data: { name: `osmeta_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId);
    for (const name of ['users:read', 'users:write', SECRET_PERMISSION]) {
      const permission = await client.permission.findUniqueOrThrow({ where: { name } });
      await client.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }

    const module = await Test.createTestingModule({ imports: [AppModule, OAuthMetaModule] }).overrideProvider(JobWorker).useValue({}).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.register(multipart);
    app.setGlobalPrefix('api');
    // The CORS configuration main.ts builds, for a deployment whose CORS_ORIGIN lists one trusted origin.
    app.enableCors(buildCorsOptions(ALLOWED_ORIGIN, { openPaths: OAUTH_PUBLIC_CORS_PATHS }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    await makeUser('actor');
    await setEnabled(true);
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setEnabled(false);
    } finally {
      await app?.close();
      await client.auditEvent.deleteMany({ where: { actorUserId: { in: created.users } } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      await client.oAuthClient.deleteMany({ where: { id: { in: created.clients } } });
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------------

  describe('protected resource metadata (RFC 9728)', () => {
    it('serves the document of a resource at its path, with resource = APP_URL + path byte for byte', async () => {
      const res = await http().get('/api/oauth/.well-known/protected-resource/api/oauth-meta').expect(200);
      expect(res.body).toEqual({
        resource: `${appUrl}/api/oauth-meta`,
        authorization_servers: [appUrl],
        scopes_supported: ['osmeta_items:read', 'osmeta_items:write', 'offline_access'],
        bearer_methods_supported: ['header'],
        resource_name: 'Metadata test resource',
        resource_documentation: 'https://docs.example.test/meta',
      });
      expect(res.body.resource.endsWith('/')).toBe(false);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body.data).toBeUndefined(); // not enveloped
      const second = await http().get('/api/oauth/.well-known/protected-resource/api/oauth-meta-b').expect(200);
      expect(second.body.resource).toBe(`${appUrl}/api/oauth-meta-b`);
      expect(second.body).not.toHaveProperty('resource_documentation');
    });

    it('both URLs follow APP_URL', async () => {
      const config = app.get(ConfigService);
      const real = config.get.bind(config);
      const spy = jest.spyOn(config, 'get').mockImplementation(((key: string, ...rest: unknown[]) => (key === 'appUrl' ? 'https://moved.example.test/' : (real as any)(key, ...rest))) as never);
      try {
        const res = await http().get('/api/oauth/.well-known/protected-resource/api/oauth-meta').expect(200);
        expect(res.body.resource).toBe('https://moved.example.test/api/oauth-meta');
        expect(res.body.authorization_servers).toEqual(['https://moved.example.test']);
      } finally {
        spy.mockRestore();
      }
    });

    it('404s the bare path when two resources are registered, an unknown path, and a prefix of a real one', async () => {
      await http().get('/api/oauth/.well-known/protected-resource').expect(404);
      await http().get('/api/oauth/.well-known/protected-resource/api/nope').expect(404);
      await http().get('/api/oauth/.well-known/protected-resource/api').expect(404);
    });

    it('404s every document while the server is disabled, and serves them again once enabled', async () => {
      await setEnabled(false);
      try {
        await http().get('/api/oauth/.well-known/protected-resource/api/oauth-meta').expect(404);
        await http().get('/api/oauth/.well-known/authorization-server').expect(404);
      } finally {
        await setEnabled(true);
      }
      await http().get('/api/oauth/.well-known/protected-resource/api/oauth-meta').expect(200);
    });
  });

  describe('the 401 challenge on a protected resource', () => {
    it('a request with no credential is a 401 with a parseable challenge, without an error', async () => {
      const res = await http().get('/api/oauth-meta/items').expect(401);
      const challenge = parseChallenge(res.headers['www-authenticate']);
      expect(challenge).toEqual({ resource_metadata: `${appUrl}/.well-known/oauth-protected-resource/api/oauth-meta` });
      // the URL in the challenge resolves to the document (through nginx's mapping)
      const doc = await http().get(viaNginx(challenge['resource_metadata']!)).expect(200);
      expect(doc.body.resource).toBe(`${appUrl}/api/oauth-meta`);
    });

    it('the second resource gets its own metadata URL', async () => {
      const res = await http().get('/api/oauth-meta-b/anything').expect(401);
      expect(parseChallenge(res.headers['www-authenticate'])['resource_metadata']).toBe(`${appUrl}/.well-known/oauth-protected-resource/api/oauth-meta-b`);
    });

    it('a bad session token, a bad PAT and an unknown oat_ token each get the challenge with invalid_token', async () => {
      for (const token of ['not.a.jwt', 'pat_' + 'a'.repeat(64), 'oat_' + 'b'.repeat(32)]) {
        const res = await http().get('/api/oauth-meta/items').set(bearer(token)).expect(401);
        expect(parseChallenge(res.headers['www-authenticate'])).toMatchObject({ error: 'invalid_token', resource_metadata: expect.stringContaining('/.well-known/oauth-protected-resource/api/oauth-meta') });
      }
    });

    it('an expired and a revoked oat_ token are a 401 with error="invalid_token"', async () => {
      const user = await makeUser('expired');
      for (const options of [{ expiresInMs: -60_000 }, { revoked: true }]) {
        const token = await makeToken(user, options);
        const res = await http().get('/api/oauth-meta/items').set(bearer(token)).expect(401);
        expect(parseChallenge(res.headers['www-authenticate'])['error']).toBe('invalid_token');
      }
    });

    it('a valid token is admitted with no challenge', async () => {
      const user = await makeUser('valid');
      const res = await http().get('/api/oauth-meta/items').set(bearer(await makeToken(user))).expect(200);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('a route OUTSIDE every resource keeps its 401 exactly: no header, the same body (snapshot)', async () => {
      for (const authorization of [undefined, 'Bearer not.a.jwt', 'Bearer pat_' + 'a'.repeat(64)]) {
        const req = http().get('/api/users');
        const res = await (authorization ? req.set('authorization', authorization) : req);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toBeUndefined();
        const { timestamp, ...rest } = res.body;
        expect(typeof timestamp).toBe('string');
        expect(rest).toEqual({ statusCode: 401, code: 'UNAUTHORIZED', message: authorization?.startsWith('Bearer pat_') ? 'Invalid or expired personal access token' : 'Unauthorized', path: '/api/users' });
        expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'path', 'statusCode', 'timestamp']);
      }
    });

    it('while disabled, a 401 on the resource carries no challenge (the metadata would be a 404)', async () => {
      await setEnabled(false);
      try {
        const res = await http().get('/api/oauth-meta/items').expect(401);
        expect(res.headers['www-authenticate']).toBeUndefined();
      } finally {
        await setEnabled(true);
      }
    });
  });

  describe('403 insufficient_scope', () => {
    it('InsufficientScopeException answers the granted scopes together with the required ones', async () => {
      const user = await makeUser('throws');
      const res = await http().get('/api/oauth-meta/throws').set(bearer(await makeToken(user))).expect(403);
      expect(parseChallenge(res.headers['www-authenticate'])).toEqual({
        resource_metadata: `${appUrl}/.well-known/oauth-protected-resource/api/oauth-meta`,
        error: 'insufficient_scope',
        scope: 'osmeta_items:read osmeta_items:write',
      });
      expect(res.body.statusCode).toBe(403);
    });

    it('is a plain 403 for a PAT caller: no challenge', async () => {
      const user = await makeUser('pat');
      const pat = await app.get(PatService).createToken(user, { name: 'osmeta', durationValue: 1, durationUnit: 'days' }, { activeOrgId: defaultOrgId });
      const res = await http().get('/api/oauth-meta/throws').set(bearer(pat.token)).expect(403);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });

    it('assertOAuthScopes: refuses an oauth token without the scope (an HTTP 403, never a 200), admits one with it, ignores a PAT', async () => {
      const user = await makeUser('gate');
      const narrow = await http().post('/api/oauth-meta/gate').set(bearer(await makeToken(user))).expect(403);
      expect(parseChallenge(narrow.headers['www-authenticate'])['scope']).toBe('osmeta_items:read osmeta_items:write');
      await http().post('/api/oauth-meta/gate').set(bearer(await makeToken(user, { scopes: ['osmeta_items:read', 'osmeta_items:write'] }))).expect(201);
      const pat = await app.get(PatService).createToken(user, { name: 'osmeta-gate', durationValue: 1, durationUnit: 'days' }, { activeOrgId: defaultOrgId });
      await http().post('/api/oauth-meta/gate').set(bearer(pat.token)).expect(201);
    });

    it('a PermissionsGuard denial that re-consent can fix (the user holds the permission, a scope grants it) is insufficient_scope', async () => {
      const user = await makeUser('fixable');
      const res = await http().post('/api/oauth-meta/items').set(bearer(await makeToken(user))).expect(403);
      expect(parseChallenge(res.headers['www-authenticate'])).toMatchObject({ error: 'insufficient_scope', scope: 'osmeta_items:read osmeta_items:write' });
      // anyPermissions: one fixable alternative suffices
      const any = await http().get('/api/oauth-meta/any').set(bearer(await makeToken(user))).expect(403);
      expect(parseChallenge(any.headers['www-authenticate'])['error']).toBe('insufficient_scope');
    });

    it('a denial that re-consent cannot fix is a plain 403: the user lacks the permission, or no scope grants it', async () => {
      const readerOnly = await makeUser('readeronly', { perms: ['users:read'] });
      const lacking = await http().post('/api/oauth-meta/items').set(bearer(await makeToken(readerOnly))).expect(403);
      expect(lacking.headers['www-authenticate']).toBeUndefined();
      expect(lacking.body.message).toBe('Missing permissions: users:write');

      const holder = await makeUser('holder');
      const unscoped = await http().get('/api/oauth-meta/secret').set(bearer(await makeToken(holder, { scopes: ['osmeta_items:read', 'osmeta_items:write'] }))).expect(403);
      expect(unscoped.headers['www-authenticate']).toBeUndefined();
    });

    it('a session caller denied a permission gets the ordinary 403 (unchanged)', async () => {
      const user = await makeUser('session', { perms: ['users:read'] });
      const graph = await client.user.findUniqueOrThrow({ where: { id: user }, include: PRINCIPAL_USER_INCLUDE });
      const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId });
      const res = await http().post('/api/oauth-meta/items').set(bearer(tokens.accessToken)).expect(403);
      expect(res.headers['www-authenticate']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    const preflight = (url: string, origin = THIRD_ORIGIN) =>
      http().options(url).set({ origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' });

    it('both metadata documents are fetchable cross-origin: any origin, no credentials', async () => {
      for (const url of ['/api/oauth/.well-known/authorization-server', '/api/oauth/.well-known/protected-resource/api/oauth-meta']) {
        const res = await http().get(url).set('origin', THIRD_ORIGIN).expect(200);
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      }
    });

    it.each(['/api/oauth/token', '/api/oauth/register', '/api/oauth/revoke'])('a preflighted POST to %s succeeds for a third-party origin', async (url) => {
      const res = await preflight(url).expect(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      expect(res.headers['access-control-allow-headers']).toBe('content-type, authorization');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('the real POST /api/oauth/token answers cross-origin too, error responses included', async () => {
      const res = await http().post('/api/oauth/token').set('origin', THIRD_ORIGIN).type('form').send({ grant_type: 'nope' });
      expect(res.status).toBe(400);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body.error).toBe('invalid_request'); // RFC 6749 body, not the platform envelope
    });

    it('the rest of the API is NOT loosened: a stranger origin gets no CORS header, the allowlisted one keeps credentials', async () => {
      for (const url of ['/api/users', '/api/oauth/authorize', '/api/oauth/grants', '/api/oauth/requests/x']) {
        const res = await preflight(url);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
      const stranger = await http().get('/api/users').set('origin', THIRD_ORIGIN).expect(401);
      expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
      const listed = await preflight('/api/users', ALLOWED_ORIGIN);
      expect(listed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(listed.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('discovery from the 401 alone (a scripted client)', () => {
    it('knows only the resource URL, learns the authorization server and finds its endpoints', async () => {
      // 1. call the resource with no token
      const resourceUrl = new URL(`${appUrl}/api/oauth-meta/items`);
      const refused = await http().get(resourceUrl.pathname).expect(401);
      // 2. parse the challenge
      const challenge = parseChallenge(refused.headers['www-authenticate']);
      // 3. fetch the protected resource metadata it names
      const resourceMetadata = (await http().get(viaNginx(challenge['resource_metadata']!)).expect(200)).body;
      expect(resourceMetadata.resource).toBe(`${appUrl}/api/oauth-meta`);
      expect(resourceUrl.href.startsWith(resourceMetadata.resource)).toBe(true);
      // 4. read authorization_servers[0] and fetch the authorization server metadata from that issuer's well-known path
      const issuer: string = resourceMetadata.authorization_servers[0];
      const metadata = (await http().get(viaNginx(`${issuer}/.well-known/oauth-authorization-server`)).expect(200)).body;
      // 5. the endpoints
      expect(metadata.issuer).toBe(issuer);
      expect(metadata.authorization_endpoint).toBe(`${appUrl}/api/oauth/authorize`);
      expect(metadata.token_endpoint).toBe(`${appUrl}/api/oauth/token`);
      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
      expect(metadata.scopes_supported).toEqual(expect.arrayContaining(resourceMetadata.scopes_supported));
    });
  });
});

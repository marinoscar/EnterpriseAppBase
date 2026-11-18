// =============================================================================
// The OAuth resource-server half on real Postgres, through the whole app
// (PP-15.3, #1181)
// =============================================================================
//
// Boots the reference app (`AppModule`: the real `JwtAuthGuard`, `RolesGuard`,
// `PermissionsGuard`, principal cache, Fastify) over the migrated database,
// plus ONE test-only module: a protected resource `oauth-test` at
// `/api/oauth-test` over a "notes" pair of routes, a second resource
// `oauth-other` and one ordinary route outside both (`/api/oauth-open/perms`).
// Tokens, grants and clients are inserted by hand (issuing them is PP-15.4),
// then every access rule of the issue is exercised over HTTP:
//
//   - scopes narrow what the user may do; a scope never grants a permission;
//   - route confinement: any other route is a 403, and the resolver is never
//     reached (no database query);
//   - audience binding; the identical 401 for every refusal reason;
//   - roles alone never admit an oauth credential;
//   - session-only actions refuse one; the principal cache is untouched;
//   - in-process delegation: narrowed, never usable from the network, gone
//     after the request ended and after 60 s;
//   - switched off, the server answers 401 and sessions are unaffected;
//   - no token, hash or key reaches a log line.
//
// The scopes map to the app's real `users:read` / `users:write` permissions;
// the test creates its own org role holding them (and removes everything it
// created). THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ConsoleLogger, Controller, Get, Logger, Module, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import request from 'supertest';

import { type OAuthPrincipalInfo, type Principal } from '@marinoscar/platform-api/core';
import {
  Auth,
  AuthService,
  CurrentPrincipal,
  InProcessDelegation,
  IPD_TTL_MS,
  OAuthGrant,
  OAuthServerSettingsReader,
  OAuthTokenResolver,
  PRINCIPAL_USER_INCLUDE,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-resource-server.db.spec');

// ---- the test-only resources, registered at import time (before the app boots) -------------

registerOAuthScope({ id: 'ostest_items:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthScope({ id: 'ostest_items:write', title: 'Change items', description: 'Edit items.', permissions: ['users:write'], risk: 'elevated' });
registerOAuthProtectedResource({
  id: 'oauth-test',
  path: '/api/oauth-test',
  routePrefixes: ['/api/oauth-test'],
  scopes: ['ostest_items:read', 'ostest_items:write'],
  name: 'OAuth test notes',
});
registerOAuthProtectedResource({
  id: 'oauth-other',
  path: '/api/oauth-other',
  routePrefixes: ['/api/oauth-other'],
  scopes: ['ostest_items:read'],
  name: 'OAuth test other',
});

/** Set by the spec: run right after a delegation is issued (moves the clock for the 60 s test). */
const hooks: { afterIssue?: () => void } = {};

@Controller('oauth-test')
class OAuthTestController {
  constructor(private readonly delegation: InProcessDelegation) {}

  @Get('items')
  @Auth({ permissions: ['users:read'] })
  list(@CurrentPrincipal() principal: Principal) {
    return { permissions: principal.permissions, credential: principal.credential };
  }

  @Post('items')
  @Auth({ permissions: ['users:write'] })
  create() {
    return { created: true };
  }

  @Get('admin-only')
  @Auth({ roles: ['admin'] })
  adminOnly() {
    return { admin: true };
  }

  @Get('whoami')
  @Auth()
  whoami(@CurrentPrincipal() principal: Principal, @OAuthGrant() grant: OAuthPrincipalInfo | null) {
    return { credential: principal.credential, permissions: principal.permissions, roles: principal.roles, grant, enumerable: Object.keys(principal) };
  }

  /** The resource calling an app route outside its prefix, in-process, as the caller. */
  @Get('delegate')
  @Auth()
  async delegate(@Req() req: FastifyRequest) {
    const res = await this.delegation.inject(req, { method: 'GET', url: '/api/oauth-open/perms?x=1' });
    return { status: res.statusCode, body: res.json() };
  }

  /** Delegating to an app route that needs a permission the token's scopes may not carry. */
  @Get('delegate-write')
  @Auth()
  async delegateWrite(@Req() req: FastifyRequest) {
    const res = await this.delegation.inject(req, { method: 'POST', url: '/api/oauth-open/write' });
    return { status: res.statusCode };
  }

  /** Delegating to routes that must stay session-only. */
  @Get('delegate-session-only')
  @Auth()
  async delegateSessionOnly(@Req() req: FastifyRequest) {
    const pat = await this.delegation.inject(req, { method: 'POST', url: '/api/pat', payload: { name: 'x', durationValue: 1, durationUnit: 'days' } });
    const logoutAll = await this.delegation.inject(req, { method: 'POST', url: '/api/auth/logout-all' });
    const switchOrg = await this.delegation.inject(req, { method: 'POST', url: '/api/auth/switch-org', payload: { orgId: randomUUID() } });
    return { pat: pat.statusCode, logoutAll: logoutAll.statusCode, switchOrg: switchOrg.statusCode };
  }

  /** Hands the header out (the test replays it elsewhere). */
  @Get('leak')
  @Auth()
  leak(@Req() req: FastifyRequest) {
    return { header: this.delegation.headerFor(req) };
  }

  /** Issues a delegation, lets the clock move, then redeems it in-process. */
  @Get('late')
  @Auth()
  async late(@Req() req: FastifyRequest) {
    const header = this.delegation.headerFor(req);
    hooks.afterIssue?.();
    const res = await req.server.inject({
      method: 'GET',
      url: '/api/oauth-open/perms',
      headers: { authorization: header },
      remoteAddress: this.delegation.remoteAddressForInject(),
    });
    return { status: res.statusCode };
  }
}

@Controller('oauth-other')
class OAuthOtherController {
  @Get('ping')
  @Auth()
  ping() {
    return { pong: true };
  }
}

@Controller('oauth-open')
class OAuthOpenController {
  @Post('write')
  @Auth({ permissions: ['users:write'] })
  write() {
    return { written: true };
  }

  @Get('perms')
  @Auth({ permissions: ['users:read'] })
  perms(@CurrentPrincipal() principal: Principal, @OAuthGrant() grant: OAuthPrincipalInfo | null) {
    return { permissions: principal.permissions, credential: principal.credential, grant };
  }
}

@Module({ controllers: [OAuthTestController, OAuthOtherController, OAuthOpenController] })
class OAuthTestModule {}

// ---------------------------------------------------------------------------------------------

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describeWithDb('the OAuth resource server through the whole app (real Postgres, #1181)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  let resolveSpy: jest.SpyInstance;
  const run = randomUUID().slice(0, 8);
  const created = { users: [] as string[], roles: [] as string[], permissions: [] as string[], clients: [] as string[], orgs: [] as string[] };
  let defaultOrgId: string;
  let roleId: string;
  let adminRoleId: string;
  let createdAdminRole = false;
  let resourceUrl: string;
  let otherResourceUrl: string;
  const logLines: string[] = [];
  const secrets: string[] = [];
  let restoreStreams: () => void = () => undefined;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function makeUser(label: string, options: { perms?: boolean; admin?: boolean; active?: boolean; member?: boolean } = {}) {
    const user = await client.user.create({ data: { email: `ostest-${label}-${run}@example.test`, isActive: options.active ?? true }, select: { id: true } });
    created.users.push(user.id);
    if (options.member !== false) {
      await client.membership.create({ data: { orgId: defaultOrgId, userId: user.id, roleId: options.perms === false ? await emptyRole() : roleId } });
    }
    if (options.admin) await client.userRole.create({ data: { userId: user.id, roleId: adminRoleId } });
    return user.id;
  }

  let emptyRoleId: string | undefined;
  async function emptyRole() {
    if (!emptyRoleId) {
      emptyRoleId = (await client.role.create({ data: { name: `ostest_empty_${run}`, scope: 'org' }, select: { id: true } })).id;
      created.roles.push(emptyRoleId);
    }
    return emptyRoleId;
  }

  /** Inserts a grant and an access token; returns the raw token. */
  async function makeToken(
    userId: string,
    options: { scopes?: string[]; grantScopes?: string[]; resource?: string; expiresInMs?: number; revoked?: boolean; grantRevoked?: boolean; clientDisabled?: boolean } = {},
  ): Promise<{ raw: string; tokenId: string; grantId: string; clientId: string }> {
    // One ACTIVE grant per (user, client, resource): a fresh client per grant keeps the helper simple.
    const own = await client.oAuthClient.create({
      data: {
        clientId: `oc_${run}_${randomBytes(3).toString('hex')}`,
        kind: 'registered',
        name: 'Client Beta',
        redirectUris: ['https://client.example.test/cb'],
        tokenEndpointAuthMethod: 'none',
        host: 'client.example.test',
        ...(options.clientDisabled ? { disabledAt: new Date() } : {}),
      },
    });
    created.clients.push(own.id);
    const clientId = own.id;
    const scopes = options.scopes ?? ['ostest_items:read'];
    const grant = await client.oAuthGrant.create({
      data: {
        userId,
        orgId: defaultOrgId,
        clientId,
        resource: options.resource ?? resourceUrl,
        scopes: options.grantScopes ?? scopes,
        ...(options.grantRevoked ? { revokedAt: new Date(), revokedReason: 'user' } : {}),
      },
    });
    const raw = `oat_${randomBytes(24).toString('base64url')}`;
    secrets.push(raw, sha256(raw));
    const token = await client.oAuthToken.create({
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
    return { raw, tokenId: token.id, grantId: grant.id, clientId };
  }

  async function sessionToken(userId: string): Promise<string> {
    const graph = await client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    const tokens = await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId });
    secrets.push(tokens.accessToken);
    return tokens.accessToken;
  }

  async function setEnabled(enabled: boolean) {
    const actor = created.users[0]!;
    await app.get(SystemSettingsService).patchSettings({ oauthServer: { enabled } } as never, actor);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    for (const name of ['users:read', 'users:write']) {
      const existing = await client.permission.findUnique({ where: { name } });
      const id = existing?.id ?? (await client.permission.create({ data: { name, scope: 'system' } })).id;
      if (!existing) created.permissions.push(id);
    }
    roleId = (await client.role.create({ data: { name: `ostest_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId);
    for (const name of ['users:read', 'users:write']) {
      const permission = await client.permission.findUniqueOrThrow({ where: { name } });
      await client.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    const admin = await client.role.findUnique({ where: { name: 'admin' } });
    adminRoleId = admin?.id ?? (await client.role.create({ data: { name: 'admin', scope: 'system' }, select: { id: true } })).id;
    createdAdminRole = !admin;

    const module = await Test.createTestingModule({ imports: [AppModule, OAuthTestModule] })
      .overrideProvider(JobWorker)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.register(multipart);
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Capture every Nest logger call from here on (`compile()` installs its own quiet logger, so this
    // goes after it): the log assertion at the end reads them.
    const record = (level: string) => (...args: unknown[]) => void logLines.push(`${level} ${args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`);
    Logger.overrideLogger({
      log: record('log'),
      error: record('error'),
      warn: record('warn'),
      debug: record('debug'),
      verbose: record('verbose'),
      fatal: record('fatal'),
    });
    restoreStreams = () => Logger.overrideLogger(new ConsoleLogger());

    const appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    resourceUrl = `${appUrl}/api/oauth-test`;
    otherResourceUrl = `${appUrl}/api/oauth-other`;

    // The first user is the settings actor for audit rows.
    await makeUser('actor');
    await setEnabled(true);
    resolveSpy = jest.spyOn(app.get(OAuthTokenResolver), 'resolve');
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setEnabled(false);
    } finally {
      restoreStreams?.();
      await app?.close();
      await client.auditEvent.deleteMany({ where: { actorUserId: { in: created.users } } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      await client.oAuthClient.deleteMany({ where: { id: { in: created.clients } } });
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      if (createdAdminRole) await client.role.deleteMany({ where: { id: adminRoleId } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  beforeEach(() => resolveSpy.mockClear());

  // -------------------------------------------------------------------------------------------

  describe('scopes narrow what the user may do', () => {
    it('a valid token calls a route under its resource and succeeds with only the permissions its scopes grant', async () => {
      const user = await makeUser('reader');
      const { raw } = await makeToken(user);
      const res = await http().get('/api/oauth-test/items').set(bearer(raw)).expect(200);
      expect(res.body.data).toEqual({ permissions: ['users:read'], credential: 'oauth' });
    });

    it('a user with users:write and a token with scope read only cannot write', async () => {
      const user = await makeUser('writer');
      const { raw } = await makeToken(user);
      await http().post('/api/oauth-test/items').set(bearer(raw)).expect(403);
      // the same user's token WITH the write scope can
      const writer = await makeToken(user, { scopes: ['ostest_items:read', 'ostest_items:write'], resource: resourceUrl });
      await http().post('/api/oauth-test/items').set(bearer(writer.raw)).expect(201);
    });

    it('a user WITHOUT users:read and a token with scope read cannot read: a scope never grants a permission', async () => {
      const user = await makeUser('noperm', { perms: false });
      const { raw } = await makeToken(user);
      await http().get('/api/oauth-test/items').set(bearer(raw)).expect(403);
    });

    it('exposes principal.oauth (non-enumerable) and @OAuthGrant()', async () => {
      const user = await makeUser('who');
      const { raw, grantId, clientId } = await makeToken(user);
      const res = await http().get('/api/oauth-test/whoami').set(bearer(raw)).expect(200);
      expect(res.body.data.credential).toBe('oauth');
      expect(res.body.data.grant).toEqual({ clientId, grantId, resourceId: 'oauth-test', scopes: ['ostest_items:read'] });
      expect(res.body.data.enumerable).not.toContain('oauth');
      expect(res.body.data.permissions).toEqual(['users:read']);
    });
  });

  describe('route confinement and audience', () => {
    it('the same token on any other route is a 403 WITHOUT a database query (the resolver is never reached)', async () => {
      const user = await makeUser('confined');
      const { raw } = await makeToken(user);
      for (const [method, url] of [
        ['get', '/api/users'],
        ['get', '/api/auth/me'],
        ['get', '/api/oauth-open/perms'],
        ['post', '/api/pat'],
        ['post', '/api/auth/switch-org'],
        ['get', '/api/nodes'],
        ['get', '/api/system-settings'],
      ] as const) {
        const res = await http()[method](url).set(bearer(raw));
        expect({ url, status: res.status }).toEqual({ url, status: 403 });
      }
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it('a token whose grant names resource A is a 403 on resource B\'s routes', async () => {
      const user = await makeUser('audience');
      const { raw } = await makeToken(user, { resource: otherResourceUrl });
      await http().get('/api/oauth-other/ping').set(bearer(raw)).expect(200);
      await http().get('/api/oauth-test/items').set(bearer(raw)).expect(403);
      const { raw: forTest } = await makeToken(user);
      await http().get('/api/oauth-other/ping').set(bearer(forTest)).expect(403);
    });
  });

  describe('every refusal reason is the same 401', () => {
    it('expired, revoked, grant revoked, client disabled, inactive user and lost membership', async () => {
      const expired = (await makeToken(await makeUser('r-expired'), { expiresInMs: -1000 })).raw;
      const revoked = (await makeToken(await makeUser('r-revoked'), { revoked: true })).raw;
      const grantRevoked = (await makeToken(await makeUser('r-grant'), { grantRevoked: true })).raw;
      const clientDisabled = (await makeToken(await makeUser('r-client'), { clientDisabled: true })).raw;
      const inactive = (await makeToken(await makeUser('r-inactive', { active: false }))).raw;
      const lostMembership = (await makeToken(await makeUser('r-member', { member: false }))).raw;
      const unknown = `oat_${randomBytes(24).toString('base64url')}`;
      const resourceUnregistered = (await makeToken(await makeUser('r-resource'), { resource: `${resourceUrl}-gone` })).raw;

      const bodies = new Set<string>();
      for (const raw of [expired, revoked, grantRevoked, clientDisabled, inactive, lostMembership, unknown, resourceUnregistered]) {
        const res = await http().get('/api/oauth-test/items').set(bearer(raw)).expect(401);
        bodies.add(JSON.stringify({ code: res.body.code, message: res.body.message, statusCode: res.body.statusCode }));
      }
      expect(bodies.size).toBe(1);
    });

    it('a membership removed after the token was issued kills it at once', async () => {
      const user = await makeUser('r-removed');
      const { raw } = await makeToken(user);
      await http().get('/api/oauth-test/items').set(bearer(raw)).expect(200);
      await client.membership.deleteMany({ where: { userId: user } });
      await http().get('/api/oauth-test/items').set(bearer(raw)).expect(401);
    });
  });

  describe('roles never admit an oauth credential by themselves', () => {
    it('a route guarded only by @Roles(admin) is refused to an oauth credential of an admin; the admin session is admitted', async () => {
      const admin = await makeUser('admin', { admin: true });
      const { raw } = await makeToken(admin);
      await http().get('/api/oauth-test/admin-only').set(bearer(raw)).expect(403);
      await http().get('/api/oauth-test/admin-only').set(bearer(await sessionToken(admin))).expect(200);
    });
  });

  describe('session-only actions refuse an oauth credential', () => {
    it('PAT creation, device approval, switch-org and logout-all refuse it, directly and through delegation', async () => {
      const user = await makeUser('sessiononly');
      const { raw } = await makeToken(user, { scopes: ['ostest_items:read', 'ostest_items:write'] });
      // directly: outside the resource prefix
      await http().post('/api/pat').set(bearer(raw)).send({ name: 'x', durationValue: 1, durationUnit: 'days' }).expect(403);
      await http().post('/api/auth/device/authorize').set(bearer(raw)).send({ userCode: 'ABCD-EFGH', approve: true }).expect(403);
      await http().post('/api/auth/switch-org').set(bearer(raw)).send({ orgId: randomUUID() }).expect(403);
      // through the resource's in-process delegation (the route is reachable, the action is not)
      const res = await http().get('/api/oauth-test/delegate-session-only').set(bearer(raw)).expect(200);
      expect(res.body.data).toEqual({ pat: 403, logoutAll: 403, switchOrg: 403 });
      expect(await client.personalAccessToken.count({ where: { userId: user } })).toBe(0);
    });
  });

  describe('the principal cache is never narrowed', () => {
    it('a session request for the same user keeps its full permissions after oauth requests', async () => {
      const user = await makeUser('cache');
      const session = await sessionToken(user);
      const fullBefore = await http().get('/api/oauth-test/whoami').set(bearer(session)).expect(200);
      expect(fullBefore.body.data.permissions.sort()).toEqual(['users:read', 'users:write']);

      const { raw } = await makeToken(user);
      for (let i = 0; i < 3; i++) {
        const narrowed = await http().get('/api/oauth-test/whoami').set(bearer(raw)).expect(200);
        expect(narrowed.body.data.permissions).toEqual(['users:read']);
        const again = await http().get('/api/oauth-test/whoami').set(bearer(session)).expect(200);
        expect(again.body.data.permissions.sort()).toEqual(['users:read', 'users:write']);
        expect(again.body.data.credential).toBe('session');
        expect(again.body.data.grant).toBeNull();
      }
    });
  });

  describe('in-process delegation', () => {
    it('an injected sub-request carries the narrowed permissions and the oauth credential', async () => {
      const user = await makeUser('delegating');
      const { raw, grantId, clientId } = await makeToken(user);
      const res = await http().get('/api/oauth-test/delegate').set(bearer(raw)).expect(200);
      expect(res.body.data.status).toBe(200);
      expect(res.body.data.body.data).toEqual({
        permissions: ['users:read'],
        credential: 'oauth',
        grant: { clientId, grantId, resourceId: 'oauth-test', scopes: ['ostest_items:read'] },
      });
    });

    it('a delegated sub-request cannot exceed the scopes: users:write is refused unless the token carries the write scope', async () => {
      const user = await makeUser('delegating-write');
      const readOnly = await makeToken(user);
      const refused = await http().get('/api/oauth-test/delegate-write').set(bearer(readOnly.raw)).expect(200);
      expect(refused.body.data).toEqual({ status: 403 });
      const writer = await makeToken(user, { scopes: ['ostest_items:read', 'ostest_items:write'], resource: otherResourceUrl });
      // a token for ANOTHER resource still cannot reach this one, delegation or not
      await http().get('/api/oauth-test/delegate-write').set(bearer(writer.raw)).expect(403);
      const sameResource = await makeToken(await makeUser('delegating-write-2'), { scopes: ['ostest_items:read', 'ostest_items:write'] });
      const allowed = await http().get('/api/oauth-test/delegate-write').set(bearer(sameResource.raw)).expect(200);
      expect(allowed.body.data).toEqual({ status: 201 });
    });

    it('works for a session principal and a PAT principal as well (one code path for a resource)', async () => {
      const user = await makeUser('delegating-session');
      const session = await sessionToken(user);
      const viaSession = await http().get('/api/oauth-test/delegate').set(bearer(session)).expect(200);
      expect(viaSession.body.data.body.data).toMatchObject({ credential: 'session', grant: null });
      expect(viaSession.body.data.body.data.permissions.sort()).toEqual(['users:read', 'users:write']);

      const pat = `pat_${randomBytes(32).toString('hex')}`;
      secrets.push(pat, sha256(pat));
      await client.personalAccessToken.create({
        data: { userId: user, name: 'ostest', tokenHash: sha256(pat), tokenPrefix: pat.slice(0, 8), durationValue: 1, durationUnit: 'days', expiresAt: new Date(Date.now() + 86_400_000), orgId: defaultOrgId },
      });
      const viaPat = await http().get('/api/oauth-test/delegate').set(bearer(pat)).expect(200);
      expect(viaPat.body.data.body.data).toMatchObject({ credential: 'pat', grant: null });
    });

    it('the same ipd_ header sent over the network is a 401, whether or not its request is still live', async () => {
      const user = await makeUser('network');
      const session = await sessionToken(user);
      const leaked = (await http().get('/api/oauth-test/leak').set(bearer(session)).expect(200)).body.data.header as string;
      secrets.push(leaked);
      expect(leaked).toMatch(/^Bearer ipd_/);
      await http().get('/api/oauth-open/perms').set({ authorization: leaked }).expect(401);
      await http().get('/api/oauth-open/perms').set({ authorization: leaked, 'x-forwarded-for': '127.0.0.1' }).expect(401);
    });

    it('is a 401 after the originating request ended, even for an in-process call', async () => {
      const user = await makeUser('ended');
      const session = await sessionToken(user);
      const leaked = (await http().get('/api/oauth-test/leak').set(bearer(session)).expect(200)).body.data.header as string;
      const delegation = app.get(InProcessDelegation);
      const replay = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/api/oauth-open/perms', headers: { authorization: leaked }, remoteAddress: delegation.remoteAddressForInject() });
      expect(replay.statusCode).toBe(401);
      expect(delegation.size()).toBe(0);
    });

    it('is a 401 after 60 s', async () => {
      const user = await makeUser('late');
      const session = await sessionToken(user);
      const realNow = Date.now.bind(Date);
      let skew = 0;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
      hooks.afterIssue = () => {
        skew = IPD_TTL_MS + 1;
      };
      try {
        const res = await http().get('/api/oauth-test/late').set(bearer(session)).expect(200);
        expect(res.body.data).toEqual({ status: 401 });
      } finally {
        hooks.afterIssue = undefined;
        nowSpy.mockRestore();
      }
    });
  });

  describe('last_used_at', () => {
    it('is stamped on the token and its grant, once, fire-and-forget', async () => {
      const user = await makeUser('lastused');
      const { raw, tokenId, grantId } = await makeToken(user);
      for (let i = 0; i < 3; i++) await http().get('/api/oauth-test/items').set(bearer(raw)).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const token = await client.oAuthToken.findUniqueOrThrow({ where: { id: tokenId } });
      const grant = await client.oAuthGrant.findUniqueOrThrow({ where: { id: grantId } });
      expect(token.lastUsedAt).not.toBeNull();
      expect(grant.lastUsedAt).not.toBeNull();
    });

    it('a refused request leaves last_used_at null (route confinement precedes the lookup)', async () => {
      const user = await makeUser('probe');
      const { raw, tokenId } = await makeToken(user);
      await http().get('/api/users').set(bearer(raw)).expect(403);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await client.oAuthToken.findUniqueOrThrow({ where: { id: tokenId } })).lastUsedAt).toBeNull();
    });
  });

  describe('switched off', () => {
    it('with oauthServer.enabled false an oat_ token is a 401 on a resource route and on any other; sessions are unaffected', async () => {
      const user = await makeUser('disabled');
      const { raw } = await makeToken(user);
      const session = await sessionToken(user);
      await setEnabled(false);
      try {
        const onResource = await http().get('/api/oauth-test/items').set(bearer(raw)).expect(401);
        const elsewhere = await http().get('/api/users').set(bearer(raw)).expect(401);
        expect(onResource.body.error?.message ?? onResource.body.message).toBe(elsewhere.body.error?.message ?? elsewhere.body.message);
        expect(resolveSpy).not.toHaveBeenCalled();
        await http().get('/api/oauth-test/items').set(bearer(session)).expect(200);
      } finally {
        await setEnabled(true);
      }
      await http().get('/api/oauth-test/items').set(bearer(raw)).expect(200);
    });
  });

  describe('logs', () => {
    it('no token, hash, session JWT, PAT, ipd_ header or HMAC key appears in anything the app logged', () => {
      const key = (app.get(InProcessDelegation) as unknown as { key: Buffer }).key;
      const haystack = logLines.join('\n');
      // The capture works: the network replay above made the delegation service warn.
      expect(haystack).toContain('Refused an in-process delegation credential presented over the network');
      for (const secret of [...secrets, key.toString('hex'), key.toString('base64'), key.toString('base64url')]) {
        expect(haystack).not.toContain(secret);
      }
      expect(haystack).not.toMatch(/ipd_[0-9a-f]{32}\./);
      expect(haystack).not.toMatch(/oat_[A-Za-z0-9_-]{20}/);
    });
  });
});

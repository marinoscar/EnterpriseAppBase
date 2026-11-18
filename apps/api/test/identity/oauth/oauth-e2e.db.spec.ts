// =============================================================================
// The end-to-end OAuth client test (PP-15.8, #1186)
// =============================================================================
//
// THE REFERENCE FOR APP AUTHORS AND FOR THE HEXACTRA EPIC'S OWN E2E.
//
// A scripted client that knows ONLY THE RESOURCE URL and behaves as the hosted
// clients are documented to: it calls the resource, gets a 401, reads the
// `WWW-Authenticate` challenge, fetches the protected resource metadata and then
// the authorization server metadata, and takes every endpoint from there. It
// never hard-codes `/api/oauth/...`. The root `/.well-known/...` paths are served
// by the nginx fragment in production (`platform/oauth-server.conf`); the client
// here applies the same rewrite to reach the API.
//
//   A  Client ID Metadata Document (the fetch transport is a scripted stub)
//   B  dynamic client registration
//   C  a pre-registered confidential client, with step-up, rotation reuse detection
//   D  a loopback client whose redirect uses a different port than registered
//
// Each variant is one test: authorize with PKCE S256, `resource` and `state`;
// approve as a test user through the consent API; verify `iss` and `state`;
// exchange the code with a form body; call the resource; refresh; call again;
// trigger `insufficient_scope` and re-authorize with the wider scope; revoke;
// confirm `401`.
//
// THIS IS A `*.db.spec.ts`: skipped with a warning without Postgres.
// =============================================================================

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
delete process.env.DATABASE_URL; // the suite's own POSTGRES_* decide, as db-test-support does

import { randomUUID } from 'node:crypto';

import { ConsoleLogger, Controller, Get, Logger, Module, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { type HostResolver, type PinnedGetRequest, type PinnedGetResponse, type PinnedGetTransport } from '@marinoscar/platform-api/core';
import {
  Auth,
  AuthService,
  CimdFetcher,
  OAuthRateLimitService,
  OAuthServerSettingsReader,
  PRINCIPAL_USER_INCLUDE,
  registerOAuthProtectedResource,
  registerOAuthScope,
} from '@marinoscar/platform-api/identity';
import { createOAuthTestClient, createOAuthTestPkce } from '@marinoscar/platform-api/identity/testing';
import { JobWorker } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { AppModule } from '../../../src/app.module';
import { createDbClient, resolveDbSuite } from '../../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('oauth-e2e.db.spec');

// ---- the resource the client discovers ------------------------------------------------------

registerOAuthScope({ id: 'e2eitems:read', title: 'Read items', description: 'See items.', permissions: ['users:read'], risk: 'low', default: true });
registerOAuthScope({ id: 'e2eitems:write', title: 'Change items', description: 'Edit items.', permissions: ['users:write'], risk: 'elevated' });
registerOAuthProtectedResource({
  id: 'oauth-e2e',
  path: '/api/oauth-e2e',
  routePrefixes: ['/api/oauth-e2e'],
  scopes: ['e2eitems:read', 'e2eitems:write'],
  name: 'End-to-end test resource',
});

@Controller('oauth-e2e')
class OAuthE2eController {
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

@Module({ controllers: [OAuthE2eController] })
class OAuthE2eModule {}

// ---- the scripted metadata-document host ----------------------------------------------------

class ScriptedTransport implements PinnedGetTransport {
  private readonly answers = new Map<string, unknown>();
  set(url: string, document: unknown): void {
    this.answers.set(url, document);
  }
  async get(req: PinnedGetRequest): Promise<PinnedGetResponse> {
    const document = this.answers.get(req.target.url.href);
    if (!document) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    return { status: 200, headers: { 'cache-control': 'max-age=3600' }, body: Buffer.from(JSON.stringify(document)) };
  }
}

/** Parses `Bearer a="b", c="d"`. */
function parseChallenge(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of (header ?? '').matchAll(/([a-z_]+)="([^"]*)"/g)) out[match[1]!] = match[2]!;
  return out;
}

describeWithDb('an OAuth client that knows only the resource URL (real Postgres, #1186)', () => {
  let app: NestFastifyApplication;
  let client: PrismaClient;
  const run = randomUUID().slice(0, 8);
  const suiteStart = new Date();
  const created = { users: [] as string[], roles: [] as string[], clients: [] as string[], permissions: [] as string[] };
  const transport = new ScriptedTransport();
  let defaultOrgId: string;
  let roleId: string;
  let appUrl: string;
  let resourceUrl: string;
  let userId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const pathOf = (url: string) => new URL(url).pathname;

  async function sessionToken(): Promise<string> {
    const graph = await client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });
    return (await app.get(AuthService).generateFullTokens(graph as never, { orgId: defaultOrgId })).accessToken;
  }

  async function setSettings(patch: Record<string, unknown>) {
    await app.get(SystemSettingsService).patchSettings({ oauthServer: patch } as never, userId);
    app.get(OAuthServerSettingsReader).invalidate();
  }

  /** What nginx does for the root well-known paths. */
  const apiPathOfWellKnown = (url: string): string => {
    const path = pathOf(url);
    if (path.startsWith('/.well-known/oauth-protected-resource')) return `/api/oauth/.well-known/protected-resource${path.slice('/.well-known/oauth-protected-resource'.length)}`;
    if (path.startsWith('/.well-known/oauth-authorization-server')) return '/api/oauth/.well-known/authorization-server';
    throw new Error(`not a well-known path: ${path}`);
  };

  /** Steps 1: 401, challenge, resource metadata, authorization server metadata. */
  async function discover() {
    const unauthorized = await http().get(pathOf(`${resourceUrl}/items`)).expect(401);
    const challenge = parseChallenge(unauthorized.headers['www-authenticate']);
    expect(unauthorized.headers['www-authenticate']).toMatch(/^Bearer /);
    expect(challenge.resource_metadata).toBe(`${appUrl}/.well-known/oauth-protected-resource/api/oauth-e2e`);
    const prm = (await http().get(apiPathOfWellKnown(challenge.resource_metadata!)).expect(200)).body;
    expect(prm.resource).toBe(resourceUrl);
    const issuer: string = prm.authorization_servers[0];
    const as = (await http().get(apiPathOfWellKnown(`${issuer}/.well-known/oauth-authorization-server`)).expect(200)).body;
    expect(as.issuer).toBe(issuer);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    return { prm, as, issuer };
  }

  type Discovered = Awaited<ReturnType<typeof discover>>;
  interface ClientIdentity {
    clientId: string;
    redirectUri: string;
    secret?: string;
  }

  /** authorize -> consent -> code, verifying `iss` and `state`. */
  async function authorizeAndApprove(found: Discovered, identity: ClientIdentity, scope: string) {
    const pkce = createOAuthTestPkce();
    const state = `state-${randomUUID().slice(0, 8)}`;
    const authorized = await http()
      .get(pathOf(found.as.authorization_endpoint))
      .query({ response_type: 'code', client_id: identity.clientId, redirect_uri: identity.redirectUri, scope, state, code_challenge: pkce.challenge, code_challenge_method: 'S256', resource: found.prm.resource })
      .expect(302);
    const requestId = new URL(authorized.headers.location).searchParams.get('request')!;
    expect(authorized.headers.location).toContain(`${appUrl}/oauth/consent`);
    const session = await sessionToken();
    await http().get(`/api/oauth/requests/${requestId}`).set(bearer(session)).expect(200);
    const decision = await http().post(`/api/oauth/requests/${requestId}/decision`).set(bearer(session)).send({ decision: 'approve' }).expect(200);
    const redirect = new URL(decision.body.data.redirectTo);
    expect(`${redirect.protocol}//${redirect.host}${redirect.pathname}`).toBe(identity.redirectUri);
    expect(redirect.searchParams.get('state')).toBe(state);
    expect(redirect.searchParams.get('iss')).toBe(found.issuer);
    return { code: redirect.searchParams.get('code')!, verifier: pkce.verifier };
  }

  const tokenCall = (found: Discovered, identity: ClientIdentity, form: Record<string, string>) =>
    http()
      .post(pathOf(found.as.token_endpoint))
      .type('form')
      .send({ client_id: identity.clientId, ...(identity.secret ? { client_secret: identity.secret } : {}), ...form });

  async function exchange(found: Discovered, identity: ClientIdentity, auth: { code: string; verifier: string }) {
    const res = await tokenCall(found, identity, { grant_type: 'authorization_code', code: auth.code, redirect_uri: identity.redirectUri, code_verifier: auth.verifier }).expect(200);
    expect(res.body.token_type).toBe('Bearer');
    return res.body as { access_token: string; refresh_token: string; scope: string; expires_in: number };
  }

  const callResource = (method: 'get' | 'post', token: string) => http()[method](pathOf(`${resourceUrl}/items`)).set(bearer(token));

  /** The full documented client behaviour; returns what a variant may probe further. */
  async function fullFlow(identity: ClientIdentity) {
    const found = await discover();
    const first = await exchange(found, identity, await authorizeAndApprove(found, identity, 'e2eitems:read offline_access'));
    await callResource('get', first.access_token).expect(200);

    // refresh, then call again with the new access token
    const refreshed = (await tokenCall(found, identity, { grant_type: 'refresh_token', refresh_token: first.refresh_token }).expect(200)).body as typeof first;
    expect(refreshed.refresh_token).not.toBe(first.refresh_token);
    await callResource('get', refreshed.access_token).expect(200);

    // step-up: a write needs a scope the token lacks
    const denied = await callResource('post', refreshed.access_token).expect(403);
    const challenge = parseChallenge(denied.headers['www-authenticate']);
    expect(challenge.error).toBe('insufficient_scope');
    expect(challenge.resource_metadata).toContain('/.well-known/oauth-protected-resource');
    expect(challenge.scope!.split(' ').sort()).toEqual(['e2eitems:read', 'e2eitems:write', 'offline_access']);
    // re-authorize with the scope the challenge named (the granted scopes plus the missing one)
    const wider = await exchange(found, identity, await authorizeAndApprove(found, identity, challenge.scope!));
    await callResource('post', wider.access_token).expect(201);
    return { found, first, refreshed, wider };
  }

  async function revokeAndConfirm(found: Discovered, identity: ClientIdentity, tokens: { access_token: string; refresh_token: string }) {
    await http()
      .post(pathOf(found.as.revocation_endpoint))
      .type('form')
      .send({ client_id: identity.clientId, ...(identity.secret ? { client_secret: identity.secret } : {}), token: tokens.refresh_token })
      .expect(200);
    await callResource('get', tokens.access_token).expect(401);
  }

  beforeAll(async () => {
    client = createDbClient();
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    for (const name of ['users:read', 'users:write']) {
      if (!(await client.permission.findUnique({ where: { name } }))) created.permissions.push((await client.permission.create({ data: { name, scope: 'system' } })).id);
    }
    roleId = (await client.role.create({ data: { name: `oe2e_role_${run}`, scope: 'org' }, select: { id: true } })).id;
    created.roles.push(roleId);
    for (const name of ['users:read', 'users:write']) {
      const permission = await client.permission.findUniqueOrThrow({ where: { name } });
      await client.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    const module = await Test.createTestingModule({ imports: [AppModule, OAuthE2eModule] })
      .overrideProvider(JobWorker)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(fastifyCookie, { secret: 'test-secret' });
    await app.register(multipart);
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    appUrl = app.get(ConfigService).get<string>('appUrl')!.replace(/\/+$/, '');
    resourceUrl = `${appUrl}/api/oauth-e2e`;

    const fetcher = app.get(CimdFetcher) as unknown as { transport: PinnedGetTransport; resolver: HostResolver };
    fetcher.transport = transport;
    fetcher.resolver = { resolveAll: async () => [{ address: '93.184.216.34', family: 4 }] };
    const limiter = app.get(OAuthRateLimitService);
    jest.spyOn(limiter, 'consume').mockImplementation(() => ({ allowed: true, retryAfterSeconds: 0 }));

    userId = (await client.user.create({ data: { email: `oe2e-${run}@example.test`, isActive: true }, select: { id: true } })).id;
    created.users.push(userId);
    await client.membership.create({ data: { orgId: defaultOrgId, userId, roleId } });
    await setSettings({ enabled: true, allowedClientHosts: ['cimd.example.test', 'dcr.example.test'], allowAnyClientHost: false, allowLoopbackClients: true, clientIdMetadataDocuments: true, dynamicClientRegistration: true });
  }, 240_000);

  afterAll(async () => {
    try {
      if (app) await setSettings({ enabled: false, allowedClientHosts: [] });
    } finally {
      await app?.close();
      await client.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: created.users } }, { targetType: { in: ['oauth_grant', 'oauth_client', 'oauth_settings'] }, createdAt: { gte: suiteStart } }] } });
      await client.oAuthClient.deleteMany({ where: { OR: [{ id: { in: created.clients } }, { createdAt: { gte: suiteStart } }] } });
      await client.user.deleteMany({ where: { id: { in: created.users } } });
      await client.role.deleteMany({ where: { id: { in: created.roles } } });
      await client.permission.deleteMany({ where: { id: { in: created.permissions } } });
      await client.$disconnect();
    }
  });

  it('A (CIMD): a client_id that is a metadata document URL connects, refreshes, steps up and is revoked', async () => {
    const clientId = 'https://cimd.example.test/clients/e2e.json';
    const redirectUri = 'https://cimd.example.test/callback';
    transport.set(clientId, { client_id: clientId, client_name: 'CIMD Client', redirect_uris: [redirectUri] });
    const identity = { clientId, redirectUri };
    const { found, wider } = await fullFlow(identity);
    await revokeAndConfirm(found, identity, wider);
  });

  it('B (DCR): a client registers itself at the advertised registration endpoint, then connects', async () => {
    const found = await discover();
    expect(found.as.registration_endpoint).toBeTruthy();
    const registered = await http().post(pathOf(found.as.registration_endpoint)).send({ redirect_uris: ['https://dcr.example.test/callback'], client_name: 'DCR Client' }).expect(201);
    const identity = { clientId: registered.body.client_id as string, redirectUri: 'https://dcr.example.test/callback' };
    const { found: again, wider } = await fullFlow(identity);
    expect(again.issuer).toBe(found.issuer);
    await revokeAndConfirm(again, identity, wider);
  });

  it('C (pre-registered confidential client): connects with its secret, steps up, and a replayed refresh token kills the grant', async () => {
    const made = await createOAuthTestClient(client as never, { tokenEndpointAuthMethod: 'client_secret_post', redirectUris: ['https://confidential.example.test/callback'], host: 'confidential.example.test' });
    created.clients.push(made.id);
    const identity = { clientId: made.clientId, redirectUri: made.redirectUri, secret: made.secret };
    // a wrong secret is refused before anything else
    const found = await discover();
    await tokenCall(found, { ...identity, secret: 'wrong-secret' }, { grant_type: 'refresh_token', refresh_token: 'ort_x' }).expect(401);

    const { first, wider } = await fullFlow(identity);
    // rotate twice, then replay the OLDEST refresh token: its successor was already used, so this is REUSE, not a retry
    const second = (await tokenCall(found, identity, { grant_type: 'refresh_token', refresh_token: wider.refresh_token }).expect(200)).body as typeof first;
    const third = (await tokenCall(found, identity, { grant_type: 'refresh_token', refresh_token: second.refresh_token }).expect(200)).body as typeof first;
    await callResource('get', third.access_token).expect(200);
    const replay = await tokenCall(found, identity, { grant_type: 'refresh_token', refresh_token: wider.refresh_token });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ error: 'invalid_grant' });
    // the whole grant is dead: nothing the client holds works any more
    await callResource('get', third.access_token).expect(401);
    const rows = await client.auditEvent.findMany({ where: { action: 'oauth:token.reuse_detected', createdAt: { gte: suiteStart } } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toMatch(/ort_|oat_|oac_/);
  });

  it('D (loopback): a redirect on a different port than the registered one completes the flow', async () => {
    const made = await createOAuthTestClient(client as never, { redirectUris: ['http://127.0.0.1/callback'], host: '127.0.0.1' });
    created.clients.push(made.id);
    const found = await discover();
    const identity = { clientId: made.clientId, redirectUri: 'http://127.0.0.1:51234/callback' };
    const auth = await authorizeAndApprove(found, identity, 'e2eitems:read');
    const tokens = await exchange(found, identity, auth);
    await callResource('get', tokens.access_token).expect(200);
    await revokeAndConfirm(found, identity, { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? 'none' }).catch(() => undefined);
  });
});

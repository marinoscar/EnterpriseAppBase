// The authorize endpoint's validation ORDER and its error shapes (PP-15.4, #1182),
// against a stubbed store: a bad client or redirect URI never redirects to the
// redirect URI; from response_type on, errors do, with state and iss.
import { withTemporaryEntries } from '../../../src/core/index';
import { OAuthAuthorizationService } from '../../../src/identity/oauth-server/oauth-authorization.service';
import { OAuthServerContext } from '../../../src/identity/oauth-server/oauth-server-context';
import type { ClientResolution, ClientResolver, OAuthClientRecord } from '../../../src/identity/oauth-server/client-resolver';
import {
  oauthResourceRegistry,
  oauthScopeRegistry,
  registerOAuthProtectedResource,
  registerOAuthScope,
  type OAuthScopeDefinition,
} from '../../../src/identity/index';
import { createOAuthTestPkce } from '../../../src/identity/testing/oauth';
import { APP_URL, NOTES_RESOURCE, NOTES_SCOPES, OTHER_RESOURCE } from './support';

for (const scope of NOTES_SCOPES) if (!oauthScopeRegistry.has(scope.id)) registerOAuthScope(scope);
for (const resource of [NOTES_RESOURCE, OTHER_RESOURCE]) if (!oauthResourceRegistry.has(resource.id)) registerOAuthProtectedResource(resource);

const REDIRECT = 'https://client.example.test/cb';
const client: OAuthClientRecord = {
  id: 'client-row-1',
  clientId: 'oc_test',
  kind: 'registered',
  name: 'Client Alpha',
  logoUri: null,
  redirectUris: [REDIRECT, 'http://127.0.0.1/cb'],
  tokenEndpointAuthMethod: 'none',
  secretHash: null,
  host: 'client.example.test',
  disabledAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function build(options: { enabled?: boolean; resolution?: ClientResolution } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    oAuthAuthorizationRequest: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: '11111111-1111-4111-8111-111111111111' };
      }),
    },
  };
  const resolver: ClientResolver = {
    resolveForAuthorization: jest.fn(async (id: string) => options.resolution ?? (id === client.clientId ? { ok: true as const, client } : { ok: false as const, code: 'unknown_client' as const })),
    resolveStored: jest.fn(),
  };
  const context = new OAuthServerContext({ get: (key: string) => (key === 'appUrl' ? `${APP_URL}/` : undefined) } as never);
  const service = new OAuthAuthorizationService(
    prisma as never,
    resolver,
    { isEnabled: async () => options.enabled !== false, read: async () => ({}) } as never,
    context,
    {} as never,
  );
  return { service, prisma, created, resolver };
}

const pkce = createOAuthTestPkce();
const valid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  response_type: 'code',
  client_id: client.clientId,
  redirect_uri: REDIRECT,
  scope: 'notes:read',
  state: 'st-1',
  code_challenge: pkce.challenge,
  code_challenge_method: 'S256',
  resource: `${APP_URL}/api/notes-agent`,
  ...over,
});

const parse = (location: string) => {
  const url = new URL(location);
  return { origin: url.origin + url.pathname, params: Object.fromEntries(url.searchParams) };
};

describe('authorize validation order', () => {
  it('1: a disabled server is the error page and never touches the store', async () => {
    const { service, resolver, created } = build({ enabled: false });
    expect(await service.authorize(valid())).toBe(`${APP_URL}/oauth/error?code=server_disabled`);
    expect(resolver.resolveForAuthorization).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it.each([
    ['an unknown client', { client_id: 'oc_unknown' }],
    ['no client', { client_id: undefined }],
    ['a repeated client_id', { client_id: ['a', 'b'] }],
  ])('2: %s is the error page unknown_client, never a redirect', async (_label, over) => {
    const { service } = build();
    expect(await service.authorize(valid(over))).toBe(`${APP_URL}/oauth/error?code=unknown_client`);
  });

  it('2: the resolver decides the page code (a disallowed host, an unreachable document)', async () => {
    for (const code of ['client_not_allowed', 'client_metadata_unavailable'] as const) {
      const { service } = build({ resolution: { ok: false, code } });
      expect(await service.authorize(valid())).toBe(`${APP_URL}/oauth/error?code=${code}`);
    }
  });

  it.each([
    ['a different URI', { redirect_uri: 'https://evil.example.test/cb' }],
    ['a path prefix', { redirect_uri: `${REDIRECT}/x` }],
    ['no redirect_uri', { redirect_uri: undefined }],
    ['a fragment', { redirect_uri: `${REDIRECT}#x` }],
  ])('3: %s is the error page invalid_redirect_uri, NEVER a redirect to it', async (_label, over) => {
    const { service } = build();
    const location = await service.authorize(valid({ ...over, response_type: 'token', code_challenge: undefined }));
    expect(location).toBe(`${APP_URL}/oauth/error?code=invalid_redirect_uri`);
  });

  it('3: a loopback redirect URI matches whatever port the client picked', async () => {
    const { service } = build();
    const location = await service.authorize(valid({ redirect_uri: 'http://127.0.0.1:49152/cb' }));
    expect(parse(location).origin).toBe(`${APP_URL}/oauth/consent`);
  });

  it('4: a response_type other than code redirects unsupported_response_type with state and iss', async () => {
    const { service } = build();
    const { origin, params } = parse(await service.authorize(valid({ response_type: 'token' })));
    expect(origin).toBe('https://client.example.test/cb');
    expect(params).toMatchObject({ error: 'unsupported_response_type', state: 'st-1', iss: APP_URL });
  });

  it.each([
    ['no challenge', { code_challenge: undefined }],
    ['no method', { code_challenge_method: undefined }],
    ['the plain method', { code_challenge_method: 'plain' }],
    ['a lower-case s256', { code_challenge_method: 's256' }],
    ['a malformed challenge', { code_challenge: 'short' }],
  ])('5: %s redirects invalid_request', async (_label, over) => {
    const { service } = build();
    const { params } = parse(await service.authorize(valid(over)));
    expect(params).toMatchObject({ error: 'invalid_request', state: 'st-1', iss: APP_URL });
  });

  it.each([
    ['no resource', { resource: undefined }],
    ['another origin', { resource: 'https://other.example.test/api/notes-agent' }],
    ['an unregistered path', { resource: `${APP_URL}/api/unknown` }],
    ['a path under the resource', { resource: `${APP_URL}/api/notes-agent/x` }],
  ])('6: %s redirects invalid_target', async (_label, over) => {
    const { service } = build();
    const { params } = parse(await service.authorize(valid(over)));
    expect(params).toMatchObject({ error: 'invalid_target', iss: APP_URL });
  });

  it('6: the resource is compared after normalisation (case, trailing slash, fragment)', async () => {
    const { service } = build();
    for (const resource of ['HTTPS://APP.EXAMPLE.TEST/api/notes-agent/', `${APP_URL}/api/notes-agent#x`]) {
      expect(parse(await service.authorize(valid({ resource }))).origin).toBe(`${APP_URL}/oauth/consent`);
    }
  });

  it.each([
    ['an unregistered scope', { scope: 'nope:read' }],
    ['a scope the resource does not accept', { scope: 'notes:write', resource: `${APP_URL}/api/other-agent` }],
    ['one bad scope among good ones', { scope: 'notes:read nope' }],
  ])('7: %s redirects invalid_scope', async (_label, over) => {
    const { service } = build();
    const { params } = parse(await service.authorize(valid(over)));
    expect(params).toMatchObject({ error: 'invalid_scope', state: 'st-1', iss: APP_URL });
  });

  it('7: offline_access is accepted by every resource', async () => {
    const { service, created } = build();
    await service.authorize(valid({ scope: 'notes:read offline_access', resource: `${APP_URL}/api/other-agent` }));
    expect(created[0]!.scope).toBe('notes:read offline_access');
  });

  it('7: no scope requested means the resource\'s default scopes', async () => {
    const { service, created } = build();
    await service.authorize(valid({ scope: undefined }));
    expect(created[0]!.scope).toBe('notes:read');
  });

  it('success: stores a 10-minute S256 request and redirects to the consent page with nothing but the id', async () => {
    const { service, created } = build();
    const before = Date.now();
    const location = await service.authorize(valid());
    expect(location).toBe(`${APP_URL}/oauth/consent?request=11111111-1111-4111-8111-111111111111`);
    expect(created[0]).toMatchObject({
      clientId: client.id,
      redirectUri: REDIRECT,
      scope: 'notes:read',
      state: 'st-1',
      resource: `${APP_URL}/api/notes-agent`,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
      status: 'pending',
    });
    const expiresAt = (created[0]!.expiresAt as Date).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  it('keeps the query of a registered redirect URI when it redirects an error', async () => {
    const withQuery = { ...client, redirectUris: ['https://client.example.test/cb?tenant=a'] };
    const { service } = build({ resolution: { ok: true, client: withQuery } });
    const { params } = parse(await service.authorize(valid({ redirect_uri: 'https://client.example.test/cb?tenant=a', response_type: 'x' })));
    expect(params).toMatchObject({ tenant: 'a', error: 'unsupported_response_type' });
  });

  it('an over-long state is invalid_request without it', async () => {
    const { service } = build();
    const { params } = parse(await service.authorize(valid({ state: 's'.repeat(3000) })));
    expect(params.error).toBe('invalid_request');
    expect(params.state).toBeUndefined();
  });
});

describe('authorize: scope availability (#1215)', () => {
  const BETA_RESOURCE = { id: 'beta', path: '/api/beta-agent', routePrefixes: ['/api/beta-agent'], scopes: ['beta:read', 'beta:write'], name: 'Beta agent' };
  const betaScope = (id: string, over: Partial<OAuthScopeDefinition> = {}): OAuthScopeDefinition => ({
    id,
    title: id,
    description: id,
    permissions: ['beta:read'],
    risk: 'low',
    ...over,
  });
  const betaAt = (over: Record<string, unknown> = {}) => valid({ resource: `${APP_URL}/api/beta-agent`, ...over });

  /** Registers beta:read (default) and beta:write with the given predicates for the duration of `fn`. */
  const withBeta = <T>(read: OAuthScopeDefinition['available'], write: OAuthScopeDefinition['available'], fn: () => Promise<T>) =>
    withTemporaryEntries(oauthScopeRegistry, [betaScope('beta:read', { default: true, available: read }), betaScope('beta:write', { available: write })], () =>
      withTemporaryEntries(oauthResourceRegistry, [BETA_RESOURCE], fn),
    ) as Promise<T>;

  it('drops an unavailable requested scope from the stored request', async () => {
    await withBeta(() => true, () => false, async () => {
      const { service, created } = build();
      const location = await service.authorize(betaAt({ scope: 'beta:read beta:write' }));
      expect(location).toContain('/oauth/consent');
      expect(created[0]!.scope).toBe('beta:read');
    });
  });

  it('keeps every scope, in order, when all are available', async () => {
    await withBeta(() => true, async () => true, async () => {
      const { service, created } = build();
      await service.authorize(betaAt({ scope: 'beta:write beta:read' }));
      expect(created[0]!.scope).toBe('beta:write beta:read');
    });
  });

  it('keeps offline_access when something tickable is left', async () => {
    await withBeta(() => true, () => false, async () => {
      const { service, created } = build();
      await service.authorize(betaAt({ scope: 'beta:write offline_access beta:read' }));
      expect(created[0]!.scope).toBe('offline_access beta:read');
    });
  });

  it.each([
    ['only unavailable scopes requested', 'beta:write'],
    ['an unavailable scope with offline_access', 'beta:write offline_access'],
  ])('redirects invalid_scope when %s', async (_label, scope) => {
    await withBeta(() => true, () => false, async () => {
      const { service, created } = build();
      const { params } = parse(await service.authorize(betaAt({ scope })));
      expect(params).toMatchObject({ error: 'invalid_scope', state: 'st-1', iss: APP_URL });
      expect(created).toHaveLength(0);
    });
  });

  it('filters the default scopes the same way, and invalid_scope when none is left', async () => {
    await withBeta(() => false, () => true, async () => {
      const { service, created } = build();
      const { params } = parse(await service.authorize(betaAt({ scope: undefined })));
      expect(params).toMatchObject({ error: 'invalid_scope' });
      expect(created).toHaveLength(0);
    });
    await withBeta(() => true, () => false, async () => {
      const { service, created } = build();
      await service.authorize(betaAt({ scope: undefined }));
      expect(created[0]!.scope).toBe('beta:read');
    });
  });

  it('leaves offline_access alone as the only requested scope unchanged', async () => {
    // offline_access has no predicate: the pre-existing behaviour holds (it is accepted by any resource).
    const { service, created } = build();
    await service.authorize(valid({ scope: 'offline_access' }));
    expect(created[0]!.scope).toBe('offline_access');
  });

  it('judges availability with an empty context', async () => {
    const read = jest.fn(() => true);
    const write = jest.fn(() => true);
    await withBeta(read, write, async () => {
      const { service } = build();
      await service.authorize(betaAt({ scope: 'beta:read beta:write' }));
      expect(read).toHaveBeenCalledWith({});
      expect(write).toHaveBeenCalledWith({});
      await service.authorize(betaAt({ scope: undefined }));
      for (const call of [...read.mock.calls, ...write.mock.calls] as unknown[][]) expect(call).toEqual([{}]);
    });
  });

  it('treats a throwing predicate as unavailable', async () => {
    await withBeta(() => true, () => { throw new Error('boom'); }, async () => {
      const { service, created } = build();
      await service.authorize(betaAt({ scope: 'beta:read beta:write' }));
      expect(created[0]!.scope).toBe('beta:read');
    });
  });

  it('still rejects an unregistered scope before availability is consulted', async () => {
    const read = jest.fn(() => true);
    await withBeta(read, () => true, async () => {
      const { service } = build();
      const { params } = parse(await service.authorize(betaAt({ scope: 'beta:read nope' })));
      expect(params.error).toBe('invalid_scope');
      expect(read).not.toHaveBeenCalled();
    });
  });
});

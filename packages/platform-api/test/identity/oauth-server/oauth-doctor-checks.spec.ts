// The OAuth server's Doctor checks (PP-15.8, #1186): every verdict of every check.
import {
  OAuthClientPolicyDoctorCheck,
  OAuthResourcesDoctorCheck,
  OAuthTokenCleanupDoctorCheck,
  OAuthWellKnownDoctorCheck,
  decideOAuthClientPolicy,
  decideOAuthPublicUrl,
  decideOAuthResources,
  decideOAuthTokenCleanup,
  decideOAuthWellKnown,
  isNonPublicHostName,
} from '../../../src/identity/index';
import { withTemporaryEntries } from '../../../src/core/index';
import { oauthResourceRegistry, oauthScopeRegistry } from '../../../src/identity/index';
import { PinnedGetError } from '../../../src/core/index';

const ON = { enabled: true, allowAnyClientHost: false, allowedClientHosts: [] as string[], allowLoopbackClients: true, clientIdMetadataDocuments: true, dynamicClientRegistration: true };
const registry = { register: jest.fn() } as never;

describe('oauth.public_url', () => {
  it('skip while off', () => expect(decideOAuthPublicUrl({ enabled: false, appUrl: 'http://localhost' }).status).toBe('skip'));
  it.each([undefined, 'not a url', 'http://app.example.test', 'https://localhost:3000', 'https://10.0.0.4', 'https://myhost'])('warn for %s', (appUrl) => {
    const out = decideOAuthPublicUrl({ enabled: true, appUrl });
    expect(out.status).toBe('warn');
    expect(out.remedy).toBeTruthy();
  });
  it('pass for a public https URL', () => expect(decideOAuthPublicUrl({ enabled: true, appUrl: 'https://app.example.test' }).status).toBe('pass'));
  it('classifies hosts', () => {
    expect(isNonPublicHostName('[::1]')).toBe(true);
    expect(isNonPublicHostName('app.example.test')).toBe(false);
  });
});

describe('oauth.well_known', () => {
  const probe = (outcome: 'ok' | 'wrong' | 'unreachable') => ({ what: 'authorization server', url: 'https://a.example.test/x', outcome, why: 'why' });
  it('decides', () => {
    expect(decideOAuthWellKnown([probe('ok')]).status).toBe('pass');
    expect(decideOAuthWellKnown([probe('ok'), probe('wrong')]).status).toBe('fail');
    expect(decideOAuthWellKnown([probe('unreachable')]).status).toBe('warn');
  });

  const build = (body: (url: string) => { status: number; text: string } | Error, appUrl = 'https://app.example.test', enabled = true) => {
    const transport = {
      get: async (req: { target: { url: URL } }) => {
        const out = body(req.target.url.href);
        if (out instanceof Error) throw out;
        return { status: out.status, headers: {}, body: Buffer.from(out.text) };
      },
    };
    const resolver = { resolveAll: async () => [{ address: '93.184.216.34', family: 4 as const }] };
    return new OAuthWellKnownDoctorCheck(registry, { isEnabled: async () => enabled } as never, { get: () => appUrl } as never, transport as never, resolver as never);
  };
  const sound = (url: string) =>
    url.endsWith('/oauth-authorization-server') ? { status: 200, text: JSON.stringify({ issuer: 'https://app.example.test' }) } : { status: 200, text: JSON.stringify({ resource: 'https://app.example.test/api/cn' }) };
  const withResource = <T>(fn: () => Promise<T>) =>
    withTemporaryEntries(oauthScopeRegistry, [{ id: 'cn:read', title: 'r', description: 'r', permissions: [], risk: 'low', default: true }], () =>
      withTemporaryEntries(oauthResourceRegistry, [{ id: 'cn', path: '/api/cn', routePrefixes: ['/api/cn'], scopes: ['cn:read'], name: 'CN' }], fn));

  it('pass when both documents answer as expected', async () => expect((await withResource(() => build(sound).run())).status).toBe('pass'));
  it('fail when the SPA answers HTML', async () => {
    const out = await withResource(() => build(() => ({ status: 200, text: '<html>' })).run());
    expect(out.status).toBe('fail');
    expect(out.remedy).toContain('well-known');
  });
  it('fail on a wrong issuer', async () => expect((await withResource(() => build((u) => (u.includes('authorization') ? { status: 200, text: '{"issuer":"x"}' } : sound(u))).run())).status).toBe('fail'));
  it('warn when the server cannot reach its own public URL', async () => expect((await withResource(() => build(() => new PinnedGetError('network', 'down')).run())).status).toBe('warn'));
  it('skip on a private address and while off', async () => {
    expect((await build(sound, 'https://10.0.0.4').run()).status).toBe('skip');
    expect((await build(sound, 'https://app.example.test', false).run()).status).toBe('skip');
  });
});

describe('oauth.client_policy', () => {
  it('decides', () => {
    expect(decideOAuthClientPolicy({ ...ON, enabled: false }).status).toBe('skip');
    expect(decideOAuthClientPolicy({ ...ON, allowAnyClientHost: true }).status).toBe('warn');
    const pass = decideOAuthClientPolicy({ ...ON, allowedClientHosts: ['a.example.test'] });
    expect(pass).toMatchObject({ status: 'pass' });
    expect(pass.detail).toContain('a.example.test');
  });
  it('runs over the settings reader', async () => {
    const check = new OAuthClientPolicyDoctorCheck(registry, { read: async () => ({ ...ON, allowAnyClientHost: true }) } as never);
    expect((await check.run()).status).toBe('warn');
  });
});

describe('oauth.resources', () => {
  it('decides', () => {
    expect(decideOAuthResources(false, []).status).toBe('skip');
    expect(decideOAuthResources(true, []).status).toBe('warn');
    expect(decideOAuthResources(true, [{ id: 'cn', scopes: 2 }]).detail).toContain('cn (2 scopes)');
  });
  it('runs over the registry', async () => {
    const check = new OAuthResourcesDoctorCheck(registry, { isEnabled: async () => true } as never);
    expect(['warn', 'pass']).toContain((await check.run()).status);
  });
});

describe('oauth.token_cleanup', () => {
  it('decides', () => {
    expect(decideOAuthTokenCleanup(3).status).toBe('warn');
    expect(decideOAuthTokenCleanup(0).status).toBe('pass');
  });
  it('counts only (read-only)', async () => {
    const count = jest.fn(async () => 2);
    const check = new OAuthTokenCleanupDoctorCheck(registry, { oAuthToken: { count } } as never);
    const out = await check.run();
    expect(out.status).toBe('warn');
    expect(JSON.stringify(out)).not.toMatch(/oat_|ort_/);
    expect(count).toHaveBeenCalledTimes(1);
  });
});

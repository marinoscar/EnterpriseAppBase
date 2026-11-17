// The smaller pieces of the OAuth resource-server half (PP-15.3, #1181): the
// cached settings reader, the shared route-prefix helper, the credential kind,
// the options, the session-only refusals and the settings namespace.
import { ForbiddenException } from '@nestjs/common';

import { credentialKindRegistry, requireCredentialKind } from '../../../src/core/index';
import {
  IdentityModule,
  OAUTH_SERVER_SETTINGS_DEFAULTS,
  OAUTH_SETTINGS_CACHE_MS,
  OAuthServerSettingsReader,
  isUnderRoutePrefix,
  refuseOAuthCredential,
  requestPathOf,
  oauthServerSettingsSchema,
} from '../../../src/identity/index';
import { resolveIdentityModuleOptions } from '../../../src/identity/identity.options';
import { PatController } from '../../../src/identity/pat/pat.controller';
import { DeviceAuthController } from '../../../src/identity/device-auth/device-auth.controller';
import { toPrincipal } from '../../../src/identity/auth/principal.factory';
import { AuthService } from '../../../src/identity/auth/auth.service';
import { NodeRouteGuard } from '../../../src/nodes/node-route.guard';
import { OAUTH_SERVER_SYSTEM_SETTINGS, mergeOAuthServerSettings } from '../../../src/settings/index';
import type { AuthCredentialInfo } from '../../../src/identity/index';
import { userGraph } from './support';

describe('credential kind oauth', () => {
  it('is registered by the identity slice against the user principal kind', () => {
    expect(requireCredentialKind('oauth')).toMatchObject({ id: 'oauth', principalKind: 'user' });
    expect(credentialKindRegistry.ids().slice(0, 4)).toEqual(['session', 'device', 'pat', 'node']);
  });

  it('toPrincipal never builds an oauth principal without its narrowing (it would carry the full permissions)', () => {
    expect(() => toPrincipal(userGraph(['notes:read']) as never, 'oauth')).toThrow(/Unrecognised credential/);
  });
});

describe('route prefix helper (shared with the nod_ confinement)', () => {
  it.each([
    ['/api/nodes', '/api/nodes', true],
    ['/api/nodes/a/b', '/api/nodes', true],
    ['/api/nodesX', '/api/nodes', false],
    ['/api/node', '/api/nodes', false],
    ['/api/nodes-other', '/api/nodes', false],
    ['/', '/api/nodes', false],
  ])('isUnderRoutePrefix(%s, %s) = %s', (path, prefix, expected) => {
    expect(isUnderRoutePrefix(path, prefix)).toBe(expected);
  });

  it('requestPathOf strips the query and prefers originalUrl', () => {
    expect(requestPathOf({ url: '/a/b?x=/api/nodes' })).toBe('/a/b');
    expect(requestPathOf({ originalUrl: '/real?x', url: '/rewritten' })).toBe('/real');
    expect(requestPathOf({})).toBeNull();
  });
});

describe('OAuthServerSettingsReader', () => {
  const value = (enabled: boolean) => ({ ...OAUTH_SERVER_SETTINGS_DEFAULTS, enabled });
  afterEach(() => jest.useRealTimers());

  it('reads as disabled without the settings slice', async () => {
    const reader = new OAuthServerSettingsReader();
    expect(await reader.isEnabled()).toBe(false);
    expect(await reader.read()).toEqual(OAUTH_SERVER_SETTINGS_DEFAULTS);
  });

  it('caches for 5 s: no query per request, and a burst after expiry shares one read', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const read = jest.fn(async () => value(true));
    const reader = new OAuthServerSettingsReader({ read });
    expect(OAUTH_SETTINGS_CACHE_MS).toBe(5000);
    await Promise.all([reader.isEnabled(), reader.isEnabled(), reader.isEnabled()]);
    await reader.isEnabled();
    expect(read).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(OAUTH_SETTINGS_CACHE_MS + 1);
    await Promise.all([reader.isEnabled(), reader.isEnabled()]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a switch reaches the guard within 5 s', async () => {
    jest.useFakeTimers({ now: Date.now() });
    let enabled = false;
    const reader = new OAuthServerSettingsReader({ read: async () => value(enabled) });
    expect(await reader.isEnabled()).toBe(false);
    enabled = true;
    expect(await reader.isEnabled()).toBe(false); // still cached
    jest.advanceTimersByTime(OAUTH_SETTINGS_CACHE_MS + 1);
    expect(await reader.isEnabled()).toBe(true);
  });

  it('fails closed: a failing read with nothing cached is disabled; with a value cached it keeps it', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const failing = new OAuthServerSettingsReader({ read: async () => Promise.reject(new Error('db down')) });
    expect(await failing.isEnabled()).toBe(false);

    let fail = false;
    const flaky = new OAuthServerSettingsReader({ read: async () => (fail ? Promise.reject(new Error('db down')) : value(true)) });
    expect(await flaky.isEnabled()).toBe(true);
    fail = true;
    jest.advanceTimersByTime(OAUTH_SETTINGS_CACHE_MS + 1);
    expect(await flaky.isEnabled()).toBe(true);
  });
});

describe('IdentityModule options: oauthServer', () => {
  it('is not mounted by default', () => {
    expect(resolveIdentityModuleOptions().oauthServer).toBeUndefined();
  });
  it('mounts with defaults and validates suggested hosts', () => {
    expect(resolveIdentityModuleOptions({ oauthServer: {} }).oauthServer).toEqual({ defaultAllowedClientHosts: [] });
    expect(resolveIdentityModuleOptions({ oauthServer: { defaultAllowedClientHosts: ['Client.Example.test', 'client.example.test'] } }).oauthServer).toEqual({
      defaultAllowedClientHosts: ['client.example.test'],
    });
    for (const bad of ['https://x.test', '*.x.test', 'x.test:8080', 'x.test/p', '']) {
      expect(() => resolveIdentityModuleOptions({ oauthServer: { defaultAllowedClientHosts: [bad] } })).toThrow(/defaultAllowedClientHosts/);
    }
  });
  it('mounts the sub-slice only when asked', () => {
    const names = (mod: { imports?: unknown[] }): string[] => {
      const composition = (mod.imports ?? [])[0] as { name: string };
      const imports = (Reflect.getMetadata('imports', composition) ?? []) as Array<{ name?: string }>;
      return imports.map((i) => i.name ?? '');
    };
    expect(names(IdentityModule.forRoot())).not.toContain('OAuthServerModule');
    expect(names(IdentityModule.forRoot({ oauthServer: {} }))).toContain('OAuthServerModule');
  });
});

describe('session-only actions refuse an oauth credential', () => {
  const oauth: AuthCredentialInfo = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'r', scopes: [] };

  it('refuseOAuthCredential refuses oauth only', () => {
    expect(() => refuseOAuthCredential(oauth)).toThrow(ForbiddenException);
    for (const ok of [{ kind: 'jwt' }, { kind: 'pat', tokenId: 'p' }, { kind: 'node' }, null, undefined] as const) {
      expect(() => refuseOAuthCredential(ok as never)).not.toThrow();
    }
  });

  it('PAT creation and revocation refuse it before touching the service', async () => {
    const pats = { createToken: jest.fn(), revokeToken: jest.fn() };
    const controller = new PatController(pats as never);
    await expect(controller.createToken({} as never, { userId: 'u' } as never, {} as never, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.revokeToken('00000000-0000-4000-8000-000000000001', 'u', oauth)).rejects.toBeInstanceOf(ForbiddenException);
    expect(pats.createToken).not.toHaveBeenCalled();
    expect(pats.revokeToken).not.toHaveBeenCalled();
  });

  it('device approval and device session revocation refuse it', async () => {
    const device = { authorizeDevice: jest.fn(), revokeDeviceSession: jest.fn() };
    const controller = new DeviceAuthController(device as never);
    await expect(controller.authorizeDevice({ id: 'u' } as never, { userCode: 'x', approve: true } as never, oauth)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.revokeSession({ id: 'u' } as never, 'sid', oauth)).rejects.toBeInstanceOf(ForbiddenException);
    expect(device.authorizeDevice).not.toHaveBeenCalled();
    expect(device.revokeDeviceSession).not.toHaveBeenCalled();
  });

  it('switchOrg accepts the session kind only (oauth refused before any lookup)', async () => {
    const auth = Object.create(AuthService.prototype) as AuthService;
    await expect(auth.switchOrg({ id: 'u', tokenKind: 'oauth' }, 'org', 'rt')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a node route lists no oauth credential: refused with a 403', async () => {
    const guard = new NodeRouteGuard(
      { getAllAndOverride: () => ({ credentials: ['nod', 'pat', 'jwt'], nodeParam: false }) } as never,
      {} as never,
    );
    const ctx = { getHandler: () => 1, getClass: () => 2, switchToHttp: () => ({ getRequest: () => ({ authCredential: oauth }) }) };
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('the oauthServer system settings namespace', () => {
  it('has the full field list of the spec, shipping off, and the defaults satisfy the schema', () => {
    expect(OAUTH_SERVER_SYSTEM_SETTINGS.key).toBe('oauthServer');
    expect(Object.keys(oauthServerSettingsSchema.shape)).toEqual([
      'enabled',
      'accessTokenTtlMinutes',
      'refreshTokenTtlDays',
      'refreshTokenMaxAgeDays',
      'alwaysIssueRefreshToken',
      'clientIdMetadataDocuments',
      'dynamicClientRegistration',
      'allowedClientHosts',
      'allowAnyClientHost',
      'allowLoopbackClients',
      'dynamicClientUnusedDays',
    ]);
    expect(OAUTH_SERVER_SETTINGS_DEFAULTS).toMatchObject({
      enabled: false,
      accessTokenTtlMinutes: 60,
      refreshTokenTtlDays: 30,
      refreshTokenMaxAgeDays: 180,
      alwaysIssueRefreshToken: true,
      clientIdMetadataDocuments: true,
      dynamicClientRegistration: true,
      allowedClientHosts: [],
      allowAnyClientHost: false,
      allowLoopbackClients: true,
      dynamicClientUnusedDays: 7,
    });
    expect(oauthServerSettingsSchema.safeParse(OAUTH_SERVER_SETTINGS_DEFAULTS).success).toBe(true);
  });

  it.each([
    [{ accessTokenTtlMinutes: 4 }, false],
    [{ accessTokenTtlMinutes: 1441 }, false],
    [{ refreshTokenTtlDays: 0 }, false],
    [{ refreshTokenMaxAgeDays: 0 }, true],
    [{ refreshTokenMaxAgeDays: -1 }, false],
    [{ dynamicClientUnusedDays: 91 }, false],
    [{ allowedClientHosts: ['client.example.test'] }, true],
    [{ allowedClientHosts: ['Client.Example.test'] }, false],
    [{ allowedClientHosts: ['*.example.test'] }, false],
    [{ allowedClientHosts: ['https://x.test'] }, false],
  ])('validates %j -> %s', (patch, ok) => {
    expect(oauthServerSettingsSchema.safeParse({ ...OAUTH_SERVER_SETTINGS_DEFAULTS, ...patch }).success).toBe(ok);
  });

  it('merges a patch field by field; an array replaces', () => {
    const merged = mergeOAuthServerSettings({ ...OAUTH_SERVER_SETTINGS_DEFAULTS, allowedClientHosts: ['a.test'] }, { enabled: true, allowedClientHosts: ['b.test'] });
    expect(merged).toMatchObject({ enabled: true, accessTokenTtlMinutes: 60, allowedClientHosts: ['b.test'] });
    expect(mergeOAuthServerSettings(OAUTH_SERVER_SETTINGS_DEFAULTS, undefined)).toEqual(OAUTH_SERVER_SETTINGS_DEFAULTS);
  });
});

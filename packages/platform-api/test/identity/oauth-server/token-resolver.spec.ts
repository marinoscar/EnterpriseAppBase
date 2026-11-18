// OAuthTokenResolver (PP-15.3, #1181): every refusal reason is the same null,
// the narrowing is stamped on the request's copy, `last_used_at` is throttled.
import { ConfigService } from '@nestjs/config';

import { withTemporaryEntries } from '../../../src/core/index';
import {
  OAuthTokenResolver,
  OAUTH_LAST_USED_INTERVAL_MS,
  oauthResourceRegistry,
  oauthScopeRegistry,
} from '../../../src/identity/index';
import { recordTenancyMode } from '../../../src/identity/index';
import { toRequestUser, type AuthenticatedUser } from '../../../src/identity/auth/interfaces/authenticated-user.interface';
import { principalFactory } from '../../../src/identity/auth/principal.factory';
import { APP_URL, NOTES_RESOURCE, NOTES_SCOPES, ORG_ID, sha256, tokenRow, userGraph } from './support';

describe('OAuthTokenResolver', () => {
  let found: ReturnType<typeof tokenRow> | null;
  const prisma = {
    oAuthToken: { findUnique: jest.fn(async () => found), update: jest.fn(async () => ({})) },
    oAuthGrant: { update: jest.fn(async () => ({})) },
  };
  const config = new ConfigService({ appUrl: APP_URL });
  let resolver: OAuthTokenResolver;

  /** Runs `fn` with the notes scopes and resource registered. */
  const withNotes = <T>(fn: () => Promise<T>) =>
    withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [NOTES_RESOURCE], fn));

  beforeEach(() => {
    jest.clearAllMocks();
    recordTenancyMode('multi');
    found = tokenRow();
    resolver = new OAuthTokenResolver(prisma as never, config);
  });
  afterAll(() => recordTenancyMode('single'));

  it('looks the token up by the SHA-256 of the raw string, never the string', async () => {
    await withNotes(() => resolver.resolve('oat_secret-value'));
    expect(prisma.oAuthToken.findUnique).toHaveBeenCalledTimes(1);
    const args = JSON.stringify(prisma.oAuthToken.findUnique.mock.calls[0]);
    expect(args).toContain(sha256('oat_secret-value'));
    expect(args).not.toContain('secret-value');
  });

  it('resolves a live token: user, ids, resource and the scopes the grant still holds', async () => {
    const resolved = await withNotes(() => resolver.resolve('oat_x'));
    expect(resolved).toMatchObject({ tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', scopes: ['notes:read'], resource: { id: 'notes' } });
    expect(resolved!.user).toMatchObject({ id: 'user-1', tokenKind: 'oauth', activeOrgId: ORG_ID });
  });

  it('drops a token scope the grant no longer holds', async () => {
    found = tokenRow({ scopes: ['notes:read', 'notes:write'] }, { scopes: ['notes:read'] });
    expect((await withNotes(() => resolver.resolve('oat_x')))!.scopes).toEqual(['notes:read']);
  });

  const refusals: Array<[string, () => void]> = [
    ['not found', () => (found = null)],
    ['a refresh token', () => (found = tokenRow({ kind: 'refresh' }))],
    ['revoked', () => (found = tokenRow({ revokedAt: new Date() }))],
    ['expired', () => (found = tokenRow({ expiresAt: new Date(Date.now() - 1) }))],
    ['expiring this instant', () => (found = tokenRow({ expiresAt: new Date() }))],
    ['grant revoked', () => (found = tokenRow({}, { revokedAt: new Date() }))],
    ['client disabled', () => (found = tokenRow({}, { client: { id: 'client-1', disabledAt: new Date() } }))],
    ['user inactive', () => (found = tokenRow({}, {}, userGraph(['notes:read'], { isActive: false })))],
    ['membership lost (no membership in the grant org)', () => (found = tokenRow({}, {}, userGraph(['notes:read'], { orgId: '00000000-0000-4000-8000-0000000000bb' })))],
    ['membership suspended', () => {
      const user = userGraph(['notes:read']);
      user.memberships[0]!.status = 'suspended';
      found = tokenRow({}, {}, user);
    }],
    ['grant resource no longer registered', () => (found = tokenRow({}, { resource: `${APP_URL}/api/gone-agent` }))],
    ['grant for another deployment URL', () => (found = tokenRow({}, { resource: 'https://evil.example.test/api/notes-agent' }))],
    ['a grant without an org in multi mode', () => (found = tokenRow({}, { orgId: null }))],
  ];
  it.each(refusals)('refuses with null: %s', async (_name, arrange) => {
    arrange();
    expect(await withNotes(() => resolver.resolve('oat_x'))).toBeNull();
    // A refused token stamps nothing.
    expect(prisma.oAuthToken.update).not.toHaveBeenCalled();
    expect(prisma.oAuthGrant.update).not.toHaveBeenCalled();
  });

  it('honours a grant without an org in single mode, as a PAT does', async () => {
    recordTenancyMode('single');
    found = tokenRow({}, { orgId: null }, userGraph(['notes:read'], { orgId: null }));
    expect(await withNotes(() => resolver.resolve('oat_x'))).not.toBeNull();
  });

  it('refuses when APP_URL is not configured (no audience to compare)', async () => {
    const bare = new OAuthTokenResolver(prisma as never, new ConfigService({}));
    expect(await withNotes(() => bare.resolve('oat_x'))).toBeNull();
  });

  describe('permission narrowing on the request copy', () => {
    it('effective permissions = the user\'s ∩ the scopes\' permissions', async () => {
      // user holds notes:read and notes:write; the token only carries notes:read
      const resolved = await withNotes(() => resolver.resolve('oat_x'));
      const user = resolved!.user as AuthenticatedUser;
      expect(toRequestUser(user).permissions).toEqual(['notes:read']);
      expect(principalFactory.forUser(user, 'oauth').permissions).toEqual(['notes:read']);
    });

    it('a scope never grants a permission the user lacks', async () => {
      found = tokenRow({ scopes: ['notes:read'] }, {}, userGraph(['notes:write']));
      const resolved = await withNotes(() => resolver.resolve('oat_x'));
      expect(toRequestUser(resolved!.user as AuthenticatedUser).permissions).toEqual([]);
    });

    it('keeps roles for display and exposes non-enumerable principal.oauth', async () => {
      const resolved = await withNotes(() => resolver.resolve('oat_x'));
      const principal = principalFactory.forUser(resolved!.user as AuthenticatedUser, 'oauth');
      expect(principal.roles).toEqual(['contributor']);
      expect(principal.oauth).toEqual({ clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes', scopes: ['notes:read'] });
      expect(Object.keys(principal)).not.toContain('oauth');
      expect(JSON.stringify(principal)).not.toContain('grant-1');
      expect(Object.keys(resolved!.user)).not.toContain('oauthNarrowing');
    });

    it('does not touch the graph an unrelated session would use: the graph of another resolve is full', async () => {
      const resolved = await withNotes(() => resolver.resolve('oat_x'));
      // The same underlying row graph viewed WITHOUT the narrowing (a copy as the cache makes it) has everything.
      const copy = { ...resolved!.user } as AuthenticatedUser;
      expect(toRequestUser(copy).permissions.sort()).toEqual(['notes:read', 'notes:write']);
    });
  });

  describe('last_used_at', () => {
    it('stamps the token and its grant, not awaited, at most once a minute per token', async () => {
      jest.useFakeTimers({ now: Date.now() });
      try {
        await withNotes(() => resolver.resolve('oat_x'));
        await withNotes(() => resolver.resolve('oat_x'));
        expect(prisma.oAuthToken.update).toHaveBeenCalledTimes(1);
        expect(prisma.oAuthGrant.update).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(OAUTH_LAST_USED_INTERVAL_MS + 1);
        await withNotes(() => resolver.resolve('oat_x'));
        expect(prisma.oAuthToken.update).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('is fire-and-forget: a failing write never fails the request', async () => {
      prisma.oAuthToken.update.mockRejectedValueOnce(new Error('db down'));
      prisma.oAuthGrant.update.mockRejectedValueOnce(new Error('db down'));
      await expect(withNotes(() => resolver.resolve('oat_x'))).resolves.not.toBeNull();
    });

    it('stamps independently per token', async () => {
      await withNotes(() => resolver.resolve('oat_x'));
      found = tokenRow({ id: 'tok-2' });
      await withNotes(() => resolver.resolve('oat_y'));
      expect(prisma.oAuthToken.update).toHaveBeenCalledTimes(2);
    });
  });
});

import { withTemporaryEntries } from '../../../src/core/index';
import { AuthLoginDeniedException } from '../../../src/identity/auth/auth-error-codes';
import { authProviderRegistry, type AuthProviderDefinition } from '../../../src/identity/auth/providers/auth-provider.registry';
import type { ExternalProfile } from '../../../src/identity/auth/external-profile';
import type { SignInPolicy } from '../../../src/identity/auth/sign-in-policy';
import { IDENTITY_EVENTS } from '../../../src/identity/identity.events';
import { setupExternalLoginHarness } from './external-login.helper';

// =============================================================================
// AuthService.completeExternalLogin (PP-14.9): the provider-neutral sign-in
// and the proof that Google's path through it is unchanged.
// =============================================================================

const github: AuthProviderDefinition = {
  id: 'github',
  label: 'GitHub',
  createStrategy: () => ({ authenticate: () => undefined }) as never,
  isEnabled: () => true,
  mapProfile: (raw) => raw as ExternalProfile,
};

const profile = (over: Partial<ExternalProfile> = {}): ExternalProfile => ({
  provider: 'github',
  subject: 'gh-42',
  email: 'octo@example.com',
  emailVerified: true,
  displayName: 'Octo Cat',
  pictureUrl: 'https://example.com/octo.png',
  ...over,
});

describe('AuthService.completeExternalLogin', () => {
  let h: Awaited<ReturnType<typeof setupExternalLoginHarness>>;

  beforeEach(async () => {
    h = await setupExternalLoginHarness();
  });

  afterEach(() => jest.clearAllMocks());

  const withGithub = <R>(fn: () => Promise<R>) => withTemporaryEntries(authProviderRegistry, [github], fn);

  describe('a new user', () => {
    it('is stored under the provider id and subject, and announced with source = provider id', async () => {
      await withGithub(async () => {
        const tokens = await h.service.completeExternalLogin(profile());

        expect(tokens.accessToken).toBeDefined();
        expect(tokens.refreshToken).toBeDefined();
        const created = h.prisma.user.create.mock.calls[0]![0] as any;
        expect(created.data.identities.create).toEqual({
          provider: 'github',
          providerSubject: 'gh-42',
          providerEmail: 'octo@example.com',
        });
        expect(created.data.providerProfileImageUrl).toBe('https://example.com/octo.png');
        expect(h.events).toContainEqual([
          IDENTITY_EVENTS.USER_CREATED,
          { userId: 'user-1', email: 'octo@example.com', source: 'github', orgId: 'org-default' },
        ]);
        expect(h.events).toContainEqual([
          IDENTITY_EVENTS.LOGIN_SUCCEEDED,
          { userId: 'user-1', provider: 'github', isNewUser: true },
        ]);
        expect(h.metrics.authLogin).toHaveBeenCalledWith('success', 'github');
      });
    });

    it('never puts the provider payload (raw) anywhere it is stored or announced', async () => {
      await withGithub(async () => {
        await h.service.completeExternalLogin(profile({ raw: { secretClaim: 'do-not-leak' } }));
        expect(JSON.stringify(h.prisma.user.create.mock.calls)).not.toContain('do-not-leak');
        expect(JSON.stringify(h.events)).not.toContain('do-not-leak');
      });
    });
  });

  describe('optional profile fields are bounded, and a bad one is dropped, not fatal', () => {
    const stored = () => (h.prisma.user.create.mock.calls[0]![0] as any).data;

    it.each([
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a data: URL', 'data:image/png;base64,AAAA'],
      ['an http: URL', 'http://example.com/p.png'],
      ['not a URL', 'octo.png'],
      ['a URL over 2048 characters', `https://example.com/${'a'.repeat(2100)}`],
    ])('drops pictureUrl that is %s and still signs in', async (_name, pictureUrl) => {
      await withGithub(async () => {
        await expect(h.service.completeExternalLogin(profile({ pictureUrl }))).resolves.toBeDefined();
        expect(stored().providerProfileImageUrl).toBeNull();
      });
    });

    it('drops a display name over 255 characters and keeps one at the limit', async () => {
      await withGithub(async () => {
        await h.service.completeExternalLogin(profile({ displayName: 'x'.repeat(256) }));
        expect(stored().providerDisplayName).toBeUndefined();
      });
      h.prisma.user.create.mockClear();
      await withGithub(async () => {
        await h.service.completeExternalLogin(profile({ subject: 'gh-43', displayName: 'x'.repeat(255) }));
        expect(stored().providerDisplayName).toHaveLength(255);
      });
    });

    it('keeps an https picture', async () => {
      await withGithub(async () => {
        await h.service.completeExternalLogin(profile());
        expect(stored().providerProfileImageUrl).toBe('https://example.com/octo.png');
      });
    });
  });

  describe('a returning user', () => {
    it('resolves by (provider, subject), creates nothing and says isNewUser: false', async () => {
      await withGithub(async () => {
        const user = { id: 'u-9', email: 'octo@example.com', isActive: true, userRoles: [], memberships: [] };
        h.prisma.userIdentity.findUnique.mockResolvedValue({ user } as any);
        h.prisma.user.update.mockResolvedValue(user as any);

        await h.service.completeExternalLogin(profile());

        expect(h.prisma.userIdentity.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { provider_providerSubject: { provider: 'github', providerSubject: 'gh-42' } } }),
        );
        expect(h.prisma.user.create).not.toHaveBeenCalled();
        expect(h.events).toContainEqual([
          IDENTITY_EVENTS.LOGIN_SUCCEEDED,
          { userId: 'u-9', provider: 'github', isNewUser: false },
        ]);
      });
    });
  });

  describe('refusals', () => {
    const refusal = async (p: ExternalProfile) => {
      try {
        await h.service.completeExternalLogin(p);
      } catch (error) {
        return error;
      }
      return null;
    };

    it('refuses an address the provider did not verify, before any lookup', async () => {
      await withGithub(async () => {
        const error = await refusal(profile({ emailVerified: false }));
        expect(error).toBeInstanceOf(AuthLoginDeniedException);
        expect((error as AuthLoginDeniedException).reason).toBe('access_denied');
        expect(h.allowlist.isEmailAllowed).not.toHaveBeenCalled();
        expect(h.prisma.userIdentity.findUnique).not.toHaveBeenCalled();
        expect(h.metrics.authLogin).toHaveBeenCalledWith('allowlist_rejected', 'github');
      });
    });

    it('refuses a profile with no address', async () => {
      await withGithub(async () => {
        const error = await refusal(profile({ email: null }));
        expect((error as AuthLoginDeniedException).reason).toBe('access_denied');
      });
    });

    it('still applies the allowlist to a provider that does not vouch for addresses', async () => {
      await withGithub(async () => {
        h.allowlist.isEmailAllowed.mockResolvedValue(false);
        const error = await refusal(profile());
        expect((error as AuthLoginDeniedException).reason).toBe('not_allowlisted');
        expect(h.prisma.user.create).not.toHaveBeenCalled();
      });
    });

    describe('INITIAL_ADMIN_EMAIL (a bootstrap only a trusted provider may trigger)', () => {
      beforeEach(() => {
        h.config.values.INITIAL_ADMIN_EMAIL = 'octo@example.com';
        h.adminBootstrap.shouldGrantAdminRole.mockResolvedValue(true);
      });

      it('does NOT bypass the allowlist for a provider that is not trusted to vouch for the address', async () => {
        await withGithub(async () => {
          h.allowlist.isEmailAllowed.mockResolvedValue(false);
          const error = await refusal(profile());
          expect((error as AuthLoginDeniedException).reason).toBe('not_allowlisted');
          expect(h.prisma.user.create).not.toHaveBeenCalled();
        });
      });

      it('does NOT grant admin to an allowlisted address from such a provider', async () => {
        await withGithub(async () => {
          await h.service.completeExternalLogin(profile());
          // The bootstrap is never even asked, and no system role is written.
          expect(h.adminBootstrap.shouldGrantAdminRole).not.toHaveBeenCalled();
          expect(h.prisma.userRole.upsert).not.toHaveBeenCalled();
          expect(JSON.stringify(h.prisma.membership.upsert.mock.calls)).not.toContain('role-org_admin');
        });
      });

      it('does not treat the sign-in as the initial administrator for tenancy or the policy either', async () => {
        const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true }) };
        const harness = await setupExternalLoginHarness({ policy });
        harness.config.values.INITIAL_ADMIN_EMAIL = 'octo@example.com';
        await withGithub(async () => {
          await harness.service.completeExternalLogin(profile());
          expect(policy.beforeLogin).toHaveBeenCalledWith(expect.anything(), { existingUserId: null, isInitialAdmin: false });
        });
      });

      it('still bypasses the allowlist and bootstraps the administrator for a trusted provider', async () => {
        await withTemporaryEntries(authProviderRegistry, [{ ...github, linkExistingByEmail: true }], async () => {
          h.allowlist.isEmailAllowed.mockResolvedValue(false);
          await expect(h.service.completeExternalLogin(profile())).resolves.toBeDefined();
          expect(h.adminBootstrap.shouldGrantAdminRole).toHaveBeenCalledWith('octo@example.com');
          expect(h.prisma.userRole.upsert).toHaveBeenCalled();
        });
      });

      it('is unchanged for Google', async () => {
        h.allowlist.isEmailAllowed.mockResolvedValue(false);
        await expect(
          h.service.handleGoogleLogin({ id: 'g-1', email: 'octo@example.com', displayName: 'O' }),
        ).resolves.toBeDefined();
        expect(h.adminBootstrap.shouldGrantAdminRole).toHaveBeenCalledWith('octo@example.com');
      });
    });

    it('finds an existing account case-insensitively for a provider that does not link, and refuses', async () => {
      await withGithub(async () => {
        h.prisma.user.findUnique.mockResolvedValue(null);
        h.prisma.user.findFirst.mockResolvedValue({ id: 'owner', email: 'octo@example.com', isActive: true, userRoles: [] } as any);

        const error = await refusal(profile({ email: 'Octo@Example.com' }));

        expect((error as AuthLoginDeniedException).reason).toBe('access_denied');
        expect(h.prisma.user.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { email: { equals: 'Octo@Example.com', mode: 'insensitive' } } }),
        );
        expect(h.prisma.user.create).not.toHaveBeenCalled();
      });
    });

    it('leaves Google\'s lookup exactly as it was: no case-insensitive query', async () => {
      await h.service.handleGoogleLogin({ id: 'g-9', email: 'Person@Example.com', displayName: 'P' });
      expect(h.prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('creates the account when no address matches, however it is cased', async () => {
      await withGithub(async () => {
        h.prisma.user.findFirst.mockResolvedValue(null);
        await h.service.completeExternalLogin(profile({ email: 'New@Example.com' }));
        expect(h.prisma.user.create).toHaveBeenCalled();
      });
    });

    it('does NOT link to an existing user by address unless the provider declares linkExistingByEmail', async () => {
      await withGithub(async () => {
        h.prisma.userIdentity.findUnique.mockResolvedValue(null);
        h.prisma.user.findUnique.mockResolvedValue({ id: 'owner', email: 'octo@example.com', isActive: true, userRoles: [] } as any);

        const error = await refusal(profile());

        expect((error as AuthLoginDeniedException).reason).toBe('access_denied');
        expect(h.prisma.userIdentity.create).not.toHaveBeenCalled();
        expect(h.prisma.user.create).not.toHaveBeenCalled();
      });
    });

    it('links to the existing user when the provider declares linkExistingByEmail and the address is verified', async () => {
      await withTemporaryEntries(authProviderRegistry, [{ ...github, linkExistingByEmail: true }], async () => {
        const owner = { id: 'owner', email: 'octo@example.com', isActive: true, userRoles: [], memberships: [] };
        h.prisma.userIdentity.findUnique.mockResolvedValue(null);
        h.prisma.user.findUnique.mockResolvedValue(owner as any);
        h.prisma.userIdentity.create.mockResolvedValue({} as any);
        h.prisma.user.update.mockResolvedValue(owner as any);

        await h.service.completeExternalLogin(profile());

        expect(h.prisma.userIdentity.create).toHaveBeenCalledWith({
          data: { userId: 'owner', provider: 'github', providerSubject: 'gh-42', providerEmail: 'octo@example.com' },
        });
        // Linking is not creation: no welcome, no user.created.
        expect(h.events.map(([name]) => name)).not.toContain(IDENTITY_EVENTS.USER_CREATED);
      });
    });

    it('refuses a provider id that is not registered (a programming error, not a login)', async () => {
      await expect(h.service.completeExternalLogin(profile({ provider: 'nope' }))).rejects.toThrow(/not a registered sign-in provider/);
    });

    it('refuses a malformed profile', async () => {
      await withGithub(async () => {
        await expect(h.service.completeExternalLogin(profile({ subject: '' }))).rejects.toThrow(/Invalid ExternalProfile/);
      });
    });

    it('refuses a disabled account with account_disabled', async () => {
      await withGithub(async () => {
        const user = { id: 'u-9', email: 'octo@example.com', isActive: false, userRoles: [], memberships: [] };
        h.prisma.userIdentity.findUnique.mockResolvedValue({ user } as any);
        h.prisma.user.update.mockResolvedValue(user as any);
        const error = await refusal(profile());
        expect((error as AuthLoginDeniedException).reason).toBe('account_disabled');
        expect(h.metrics.authLogin).toHaveBeenCalledWith('disabled', 'github');
      });
    });
  });

  describe('the sign-in policy', () => {
    const bound = async (policy: SignInPolicy) => setupExternalLoginHarness({ policy });

    it('is not consulted when none is bound: the allowlist alone admits', async () => {
      await withGithub(async () => {
        await expect(h.service.completeExternalLogin(profile())).resolves.toBeDefined();
      });
    });

    it('denies with its reason and writes nothing', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: false, reason: 'access_denied' }) };
      const harness = await bound(policy);
      await withGithub(async () => {
        await expect(harness.service.completeExternalLogin(profile())).rejects.toMatchObject({ reason: 'access_denied' });
        expect(harness.prisma.user.create).not.toHaveBeenCalled();
        expect(harness.prisma.userIdentity.create).not.toHaveBeenCalled();
        expect(harness.prisma.user.update).not.toHaveBeenCalled();
        expect(harness.metrics.authLogin).toHaveBeenCalledWith('allowlist_rejected', 'github');
      });
    });

    it('runs after the allowlist: an allowlist refusal wins and the policy is not asked', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true }) };
      const harness = await bound(policy);
      harness.allowlist.isEmailAllowed.mockResolvedValue(false);
      await withGithub(async () => {
        await expect(harness.service.completeExternalLogin(profile())).rejects.toMatchObject({ reason: 'not_allowlisted' });
        expect(policy.beforeLogin).not.toHaveBeenCalled();
      });
    });

    it('applies to Google too, so a rule cannot be bypassed by picking another provider', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: false, reason: 'access_denied' }) };
      const harness = await bound(policy);
      await expect(
        harness.service.handleGoogleLogin({ id: 'g-1', email: 'a@example.com', displayName: 'A' }),
      ).rejects.toMatchObject({ reason: 'access_denied' });
    });

    it('is told who it is deciding about (never the raw payload is logged) and whether a user exists', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true }) };
      const harness = await bound(policy);
      await withGithub(async () => {
        await harness.service.completeExternalLogin(profile());
        expect(policy.beforeLogin).toHaveBeenCalledWith(
          expect.objectContaining({ provider: 'github', subject: 'gh-42', email: 'octo@example.com' }),
          { existingUserId: null, isInitialAdmin: false },
        );
      });
    });

    it('fails closed when the policy throws, without leaking its message into the error', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockRejectedValue(new Error('claim tenant=acme missing')) };
      const harness = await bound(policy);
      await withGithub(async () => {
        const error = await harness.service.completeExternalLogin(profile()).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(AuthLoginDeniedException);
        expect(String(error.message)).not.toContain('acme');
        expect(harness.prisma.user.create).not.toHaveBeenCalled();
      });
    });

    it('treats a malformed denial as access_denied (fail closed)', async () => {
      const policy = { beforeLogin: jest.fn().mockResolvedValue({ allow: false, reason: 'because' }) } as unknown as SignInPolicy;
      const harness = await bound(policy);
      await withGithub(async () => {
        await expect(harness.service.completeExternalLogin(profile())).rejects.toMatchObject({ reason: 'access_denied' });
      });
    });

    it('maps an org role onto the NEW user\'s membership', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true, roles: ['org_admin'] }) };
      const harness = await bound(policy);
      harness.roles.set('org_admin', { id: 'role-org_admin', name: 'org_admin', scope: 'org', rolePermissions: [] });
      await withGithub(async () => {
        await harness.service.completeExternalLogin(profile());
        const membership = harness.prisma.membership.upsert.mock.calls[0]![0] as any;
        expect(JSON.stringify(membership)).toContain('role-org_admin');
      });
    });

    it('maps a system role onto the NEW user', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true, roles: ['auditor'] }) };
      const harness = await bound(policy);
      harness.roles.set('auditor', { id: 'role-auditor', name: 'auditor', scope: 'system', rolePermissions: [] });
      await withGithub(async () => {
        await harness.service.completeExternalLogin(profile());
        expect(harness.prisma.userRole.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ create: { userId: 'user-1', roleId: 'role-auditor' } }),
        );
      });
    });

    it('fails closed on an unknown role name, before anything is written', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true, roles: ['ghost'] }) };
      const harness = await bound(policy);
      harness.roles.delete('ghost');
      await withGithub(async () => {
        await expect(harness.service.completeExternalLogin(profile())).rejects.toThrow(/does not exist/);
        expect(harness.prisma.user.create).not.toHaveBeenCalled();
      });
    });

    it('does not re-apply roles to a returning user (an administrator\'s edits stick)', async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: true, roles: ['auditor'] }) };
      const harness = await bound(policy);
      harness.roles.set('auditor', { id: 'role-auditor', name: 'auditor', scope: 'system', rolePermissions: [] });
      const user = { id: 'u-9', email: 'octo@example.com', isActive: true, userRoles: [], memberships: [] };
      harness.prisma.userIdentity.findUnique.mockResolvedValue({ user } as any);
      harness.prisma.user.update.mockResolvedValue(user as any);
      await withGithub(async () => {
        await harness.service.completeExternalLogin(profile());
        expect(harness.prisma.userRole.upsert).not.toHaveBeenCalled();
      });
    });
  });

  describe('Google through the same path (byte-identical behaviour)', () => {
    const google = { id: 'g-1', email: 'Person@Example.com', displayName: 'Person', picture: 'https://example.com/p.png' };

    it('stores the identity as google, emits user.created with source google, and records one-argument metrics', async () => {
      await h.service.handleGoogleLogin(google);

      const created = h.prisma.user.create.mock.calls[0]![0] as any;
      expect(created.data.identities.create).toEqual({
        provider: 'google',
        providerSubject: 'g-1',
        providerEmail: 'Person@Example.com',
      });
      expect(created.data.email).toBe('Person@Example.com');
      expect(created.data.providerDisplayName).toBe('Person');
      expect(created.data.providerProfileImageUrl).toBe('https://example.com/p.png');
      expect(h.allowlist.isEmailAllowed).toHaveBeenCalledWith('person@example.com');
      expect(h.events).toContainEqual([
        IDENTITY_EVENTS.USER_CREATED,
        { userId: 'user-1', email: 'Person@Example.com', source: 'google', orgId: 'org-default' },
      ]);
      // The pre-seam call shape: the instrument defaults the provider to google.
      expect(h.metrics.authLogin).toHaveBeenCalledWith('success');
      expect(h.metrics.authLogin).not.toHaveBeenCalledWith('success', 'google');
    });

    it('still links a Google sign-in to the user holding the same address', async () => {
      const owner = { id: 'owner', email: google.email, isActive: true, userRoles: [], memberships: [] };
      h.prisma.userIdentity.findUnique.mockResolvedValue(null);
      h.prisma.user.findUnique.mockResolvedValue(owner as any);
      h.prisma.userIdentity.create.mockResolvedValue({} as any);
      h.prisma.user.update.mockResolvedValue(owner as any);

      await h.service.handleGoogleLogin(google);

      expect(h.prisma.userIdentity.create).toHaveBeenCalledWith({
        data: { userId: 'owner', provider: 'google', providerSubject: 'g-1', providerEmail: 'Person@Example.com' },
      });
    });

    it('also announces the login (the new event), for Google as for any provider', async () => {
      await h.service.handleGoogleLogin(google);
      expect(h.events).toContainEqual([
        IDENTITY_EVENTS.LOGIN_SUCCEEDED,
        { userId: 'user-1', provider: 'google', isNewUser: true },
      ]);
    });

    it('records an allowlist refusal with the one-argument call', async () => {
      h.allowlist.isEmailAllowed.mockResolvedValue(false);
      await expect(h.service.handleGoogleLogin(google)).rejects.toMatchObject({ reason: 'not_allowlisted' });
      expect(h.metrics.authLogin).toHaveBeenCalledWith('allowlist_rejected');
    });
  });

  describe('getEnabledProviders (async isEnabled)', () => {
    it('awaits an asynchronous isEnabled that reads the credential store', async () => {
      const secrets = { getSecret: jest.fn(async (purpose: string, name: string) => (purpose === 'auth_github' && name === 'client_secret' ? 's' : null)) };
      const harness = await setupExternalLoginHarness({ credentials: secrets });
      const enabledByCredential: AuthProviderDefinition = {
        ...github,
        isEnabled: async (_config, ctx) => (await ctx.credentials.getSecret('auth_github', 'client_secret')) !== null,
      };
      await withTemporaryEntries(authProviderRegistry, [enabledByCredential], async () => {
        expect(await harness.service.getEnabledProviders()).toContainEqual({ name: 'github', enabled: true });
        secrets.getSecret.mockResolvedValue(null);
        expect(await harness.service.getEnabledProviders()).not.toContainEqual({ name: 'github', enabled: true });
      });
    });

    it('treats a provider whose isEnabled throws as not enabled', async () => {
      const broken: AuthProviderDefinition = { ...github, isEnabled: () => { throw new Error('store down'); } };
      await withTemporaryEntries(authProviderRegistry, [broken], async () => {
        expect((await h.service.getEnabledProviders()).map((p) => p.name)).not.toContain('github');
      });
    });

    it('without a credential binding every secret reads as absent', async () => {
      const probe = jest.fn();
      const def: AuthProviderDefinition = { ...github, isEnabled: async (_c, ctx) => { probe(await ctx.credentials.getSecret('auth_github', 'x')); return false; } };
      await withTemporaryEntries(authProviderRegistry, [def], async () => {
        await h.service.getEnabledProviders();
        expect(probe).toHaveBeenCalledWith(null);
      });
    });

    it('lists a custom provider with mode: custom and a redirect provider exactly as before', async () => {
      const custom: AuthProviderDefinition = { id: 'sso-popup', mode: 'custom', isEnabled: () => true };
      await withTemporaryEntries(authProviderRegistry, [github, custom], async () => {
        const providers = await h.service.getEnabledProviders();
        expect(providers).toContainEqual({ name: 'github', enabled: true });
        expect(providers).toContainEqual({ name: 'sso-popup', enabled: true, mode: 'custom' });
      });
    });
  });
});

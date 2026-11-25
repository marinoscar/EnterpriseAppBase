// =============================================================================
// The `example-oidc` example: an app adds a sign-in provider WITHOUT touching a package (PP-14.9)
// =============================================================================
//
// `src/platform-extensions/identity/example-oidc.provider.ts` is registered from
// `src/app-registrations/identity.ts` with `registerAuthProvider`, the same
// function Google's registration uses. This spec drives it against the REAL
// application wiring (the real AppModule: identity slice, allowlist, credential
// store, tenancy, Doctor and egress contributors; only Prisma is mocked and the
// credential read is controlled), because the Google callback itself cannot be
// driven here (its integration cases are skipped for lack of a provider):
//
//   1. a fresh install is unchanged: the provider is off, unlisted, unmounted;
//   2. with its signing key stored it is listed, its route starts the flow and
//      its callback signs a NEW user in: the identity is stored as
//      `example-oidc`, the refresh cookie has Google's attributes, and
//      `identity.user.created` (source) and `identity.login.succeeded` fire;
//   3. a RETURNING user is found by (provider, subject), nothing is created;
//   4. the allowlist applies; an unverified or unsigned or expired token is a
//      refusal; an address that already belongs to another account is not merged;
//   5. the Doctor and the egress view name the provider;
//   6. it passes the provider conformance kit, and so does Google.
// =============================================================================

import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';

import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { DoctorCheckRegistry, EgressRegistry } from '@marinoscar/platform-api/doctor';
import {
  AuthService,
  REFRESH_TOKEN_COOKIE_OPTIONS,
  authProviderRegistry,
  type ExternalProfile,
} from '@marinoscar/platform-api/identity';
import { describeAuthProviderConformance } from '@marinoscar/platform-api/identity/testing';

import {
  EXAMPLE_OIDC_ID,
  EXAMPLE_OIDC_KEY_NAME,
  EXAMPLE_OIDC_PURPOSE,
  exampleOidcProvider,
  signExampleIdToken,
  type ExampleOidcClaims,
} from '../../../src/platform-extensions/identity/example-oidc.provider';
// The registration under test: what `platform/identity/identity.config.ts` imports.
import '../../../src/app-registrations/identity';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma.mock';

const KEY = 'example-oidc-signing-key-for-tests-only';
const nowSeconds = () => Math.floor(Date.now() / 1000);

const claims = (over: Partial<ExampleOidcClaims> = {}): ExampleOidcClaims => ({
  sub: 'oidc-user-1',
  email: 'person@example.test',
  email_verified: true,
  name: 'Person Example',
  exp: nowSeconds() + 300,
  ...over,
});

describe('example-oidc: an app-side sign-in provider (PP-14.9)', () => {
  let context: TestContext;
  let storedKey: string | null;
  let events: Array<[string, unknown]>;

  const server = () => context.app.getHttpServer();
  const callback = (token: string) => request(server()).get('/api/auth/example-oidc/callback').query({ id_token: token });
  const errorOf = (res: request.Response) => new URL(res.headers.location!).searchParams.get('error');

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    // The credential store is the real service; only its read is controlled, so the
    // spec decides whether the signing key "is stored".
    jest.spyOn(context.module.get(CredentialsService, { strict: false }), 'getSecret').mockImplementation(async (purpose, name) =>
      purpose === EXAMPLE_OIDC_PURPOSE && name === EXAMPLE_OIDC_KEY_NAME ? storedKey : null,
    );
    events = [];
    context.module.get(EventEmitter2).onAny((name, payload) => events.push([String(name), payload]));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await closeTestApp(context);
  });

  beforeEach(() => {
    storedKey = KEY;
    events.length = 0;
    resetPrismaMock();
    setupBaseMocks();
    // The admin bootstrap reads the admin role with its holders: nobody holds it here.
    const roleByName = (prismaMock.role.findUnique as jest.Mock).getMockImplementation()!;
    (prismaMock.role.findUnique as jest.Mock).mockImplementation(async (args: { where: { name?: string } }) => {
      const role = await roleByName(args);
      return role && args.where.name === 'admin' ? { ...role, userRoles: [] } : role;
    });
    prismaMock.organization.findFirst.mockResolvedValue({ id: 'org-default', name: 'Default', slug: 'default', isDefault: true } as never);
    prismaMock.membership.upsert.mockResolvedValue({ id: 'm-1' } as never);
    prismaMock.userIdentity.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => cb(prismaMock)) as never);
    prismaMock.user.create.mockImplementation((async (args: { data: { email: string } }) => ({
      id: 'user-new',
      email: args.data.email,
      isActive: true,
      userRoles: [],
      memberships: [],
    })) as never);
    prismaMock.user.update.mockResolvedValue({} as never);
    prismaMock.refreshToken.create.mockResolvedValue({} as never);
    // The allowlist admits the example address.
    prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'a-1', email: 'person@example.test', claimedById: 'x' } as never);
  });

  describe('a fresh install', () => {
    it('is unchanged: no key stored means unlisted and unmounted, and Google is still offered', async () => {
      storedKey = null;

      const providers = await request(server()).get('/api/auth/providers').expect(200);
      expect(providers.body.data.providers.map((p: { name: string }) => p.name)).not.toContain(EXAMPLE_OIDC_ID);

      await request(server()).get('/api/auth/example-oidc').expect(404);
      const res = await callback(signExampleIdToken(claims(), KEY)).expect(302);
      expect(errorOf(res)).toBe('authentication_failed');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(prismaMock.user.create).not.toHaveBeenCalled();

      // Google's own route is untouched by the generic ones.
      await request(server()).get('/api/auth/google').expect(302);
    });
  });

  describe('once its signing key is stored', () => {
    it('is listed, and its route starts the flow at the issuer', async () => {
      const providers = await request(server()).get('/api/auth/providers').expect(200);
      expect(providers.body.data.providers).toContainEqual({ name: EXAMPLE_OIDC_ID, enabled: true });

      const start = await request(server()).get('/api/auth/example-oidc').expect(302);
      expect(new URL(start.headers.location!).host).toBe('idp.example.test');
    });

    it('signs a NEW user in: identity stored as example-oidc, Google\'s cookie, the events', async () => {
      const res = await callback(signExampleIdToken(claims({ picture: 'https://idp.example.test/p.png' }), KEY)).expect(302);

      const url = new URL(res.headers.location!);
      expect(url.pathname).toBe('/auth/callback');
      expect(url.searchParams.get('token')).toEqual(expect.any(String));
      expect(url.searchParams.get('expiresIn')).toEqual(expect.any(String));
      expect(url.searchParams.has('error')).toBe(false);

      // The one cookie, with exactly the attributes Google's callback sets.
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(1);
      const attributes = cookies[0]!.split('; ').slice(1).map((a) => a.toLowerCase());
      expect(cookies[0]).toMatch(/^refresh_token=[^;]+/);
      expect(attributes).toEqual(
        expect.arrayContaining([
          'httponly',
          'path=/api/auth',
          'samesite=lax',
          `max-age=${REFRESH_TOKEN_COOKIE_OPTIONS.maxAge}`,
          ...(REFRESH_TOKEN_COOKIE_OPTIONS.secure ? ['secure'] : []),
        ]),
      );
      // The access token travels in the redirect only, never in a cookie.
      expect(cookies[0]).not.toContain(url.searchParams.get('token'));

      const created = prismaMock.user.create.mock.calls[0]![0] as { data: { identities: { create: unknown }; providerProfileImageUrl: string } };
      expect(created.data.identities.create).toEqual({
        provider: 'example-oidc',
        providerSubject: 'oidc-user-1',
        providerEmail: 'person@example.test',
      });
      expect(created.data.providerProfileImageUrl).toBe('https://idp.example.test/p.png');
      expect(events).toContainEqual(['identity.user.created', { userId: 'user-new', email: 'person@example.test', source: 'example-oidc', orgId: 'org-default' }]);
      expect(events).toContainEqual(['identity.login.succeeded', { userId: 'user-new', provider: 'example-oidc', isNewUser: true }]);
    });

    it('signs a RETURNING user in by (provider, subject) and creates nothing', async () => {
      const user = { id: 'user-old', email: 'person@example.test', isActive: true, userRoles: [], memberships: [] };
      prismaMock.userIdentity.findUnique.mockResolvedValue({ user } as never);
      prismaMock.user.update.mockResolvedValue(user as never);

      const res = await callback(signExampleIdToken(claims(), KEY)).expect(302);

      expect(new URL(res.headers.location!).searchParams.has('token')).toBe(true);
      expect(prismaMock.userIdentity.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider_providerSubject: { provider: 'example-oidc', providerSubject: 'oidc-user-1' } } }),
      );
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(events).toContainEqual(['identity.login.succeeded', { userId: 'user-old', provider: 'example-oidc', isNewUser: false }]);
    });
  });

  describe('refusals', () => {
    it('applies the allowlist: an address that is not on it is not_allowlisted and nothing is written', async () => {
      prismaMock.allowedEmail.findUnique.mockResolvedValue(null);

      const res = await callback(signExampleIdToken(claims(), KEY)).expect(302);

      expect(errorOf(res)).toBe('not_allowlisted');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.userIdentity.create).not.toHaveBeenCalled();
    });

    it('refuses an address the issuer did not verify, before the allowlist is consulted', async () => {
      const res = await callback(signExampleIdToken(claims({ email_verified: false }), KEY)).expect(302);

      expect(errorOf(res)).toBe('access_denied');
      expect(prismaMock.allowedEmail.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('does NOT merge into an existing account that holds the same address', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'owner', email: 'person@example.test', isActive: true, userRoles: [] } as never);

      const res = await callback(signExampleIdToken(claims(), KEY)).expect(302);

      expect(errorOf(res)).toBe('access_denied');
      expect(prismaMock.userIdentity.create).not.toHaveBeenCalled();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it.each([
      ['a token signed with another key', () => signExampleIdToken(claims(), 'some-other-key')],
      ['an expired token', () => signExampleIdToken(claims({ exp: nowSeconds() - 5 }), KEY)],
      ['garbage', () => 'not.a.token'],
    ])('redirects %s with authentication_failed and no session', async (_name, make) => {
      const res = await callback(make()).expect(302);

      expect(errorOf(res)).toBe('authentication_failed');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });

  describe('Doctor and egress', () => {
    it('names the provider in auth.providers, with its remedy while it is off', async () => {
      const check = context.module.get(DoctorCheckRegistry).list().find((c) => c.id === 'auth.providers')!;

      const on = await check.run();
      expect(on.data).toMatchObject({ 'provider.google': 'enabled', 'provider.example-oidc': 'enabled' });

      storedKey = null;
      const off = await check.run();
      expect(off.data).toMatchObject({ 'provider.example-oidc': 'not enabled' });
      expect(off.data!['remedy.example-oidc']).toMatch(/auth_example-oidc/);
    });

    it('lists its egress host beside Google\'s', async () => {
      const contributor = context.module.get(EgressRegistry).list().find((c) => c.id === 'auth')!;
      const dependencies = await contributor.describe();
      expect(dependencies.find((d) => d.id === 'auth.example-oidc')).toMatchObject({
        capability: 'Example OIDC sign-in',
        enabled: true,
        hosts: ['idp.example.test'],
      });
    });
  });

  describe('the provider conformance kit', () => {
    // Both definitions run the same kit against the real AuthService and the
    // app's Prisma mock; `login` and the refusals go through completeExternalLogin.
    const host = () => ({
      completeLogin: (profile: ExternalProfile) => context.module.get(AuthService).completeExternalLogin(profile),
      hasIdentity: async (provider: string, subject: string) =>
        prismaMock.user.create.mock.calls.some((call: unknown[]) => {
          const create = (call[0] as { data: { identities: { create: { provider: string; providerSubject: string } } } }).data.identities.create;
          return create.provider === provider && create.providerSubject === subject;
        }),
      withAllowlist: async (allowed: boolean, fn: () => Promise<void>) => {
        prismaMock.allowedEmail.findUnique.mockResolvedValue(allowed ? ({ id: 'a-1', claimedById: 'x' } as never) : null);
        await fn();
      },
      routeIsMounted: async (id: string) => (await request(server()).get(`/api/auth/${id}`)).status !== 404,
    });

    // The hosts are built lazily (the app boots in beforeAll, after these are declared).
    const lazyHost = {
      completeLogin: (p: ExternalProfile) => host().completeLogin(p),
      hasIdentity: (provider: string, subject: string) => host().hasIdentity(provider, subject),
      withAllowlist: (allowed: boolean, fn: () => Promise<void>) => host().withAllowlist(allowed, fn),
      routeIsMounted: (id: string) => host().routeIsMounted(id),
    };

    describeAuthProviderConformance(exampleOidcProvider, {
      describe,
      it,
      expect,
      rawProfile: claims(),
      sparseRawProfile: { sub: 'oidc-user-1', exp: nowSeconds() + 300 },
      expectedSubject: 'oidc-user-1',
      expectedEmail: 'person@example.test',
      enabledWith: { credentials: { [EXAMPLE_OIDC_KEY_NAME]: KEY } },
      host: lazyHost,
    });

    describeAuthProviderConformance(authProviderRegistry.require('google'), {
      describe,
      it,
      expect,
      rawProfile: { id: 'g-kit-1', email: 'person@example.test', displayName: 'Google Person', picture: 'https://example.test/p.png' },
      sparseRawProfile: { id: 'g-kit-1', email: 'person@example.test' },
      expectedSubject: 'g-kit-1',
      enabledWith: { config: { 'google.clientId': 'id', 'google.clientSecret': 'secret' } },
      // Google's route is its own controller route, mounted by AuthController.
      host: { ...lazyHost, routeIsMounted: async () => (await request(server()).get('/api/auth/google')).status === 302 },
    });
  });
});

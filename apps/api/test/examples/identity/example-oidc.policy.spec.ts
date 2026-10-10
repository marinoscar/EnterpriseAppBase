// =============================================================================
// The sign-in policy seam, proven with the example's policy (PP-14.9)
// =============================================================================
//
// `ExampleOidcSignInPolicy` (a company-domain rule and a role mapped from a
// claim) is bound through `IdentityModule.forRoot({ signInPolicy })`, the only
// way the policy reaches the slice's own `AuthService`. The reference app does
// NOT bind it (a bound policy is consulted for every provider), so this spec
// boots the real identity module on the stub host instead, with the example
// provider registered:
//
//   - a denial carries its reason to the redirect and writes nothing;
//   - a member of `org-admins` is created with the `org_admin` organization role;
//   - the policy waves other providers through, so binding it cannot change Google;
//   - the provider kit's policy scenario passes with it.
// =============================================================================

import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DoctorModule } from '@marinoscar/platform-api/doctor';
import {
  AuthService,
  IdentityModule,
  authProviderRegistry,
  identityConfiguration,
  type ExternalProfile,
  type SignInPolicy,
} from '@marinoscar/platform-api/identity';
import { createStubIdentityHost, describeAuthProviderConformance } from '@marinoscar/platform-api/identity/testing';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { createTestPlatformHost } from '@marinoscar/platform-api/testing';

import {
  EXAMPLE_OIDC_KEY_NAME,
  ExampleOidcSignInPolicy,
  exampleOidcProvider,
  signExampleIdToken,
  type ExampleOidcClaims,
} from '../../../src/platform-extensions/identity/example-oidc.provider';
import { prismaMock, resetPrismaMock } from '../../mocks/prisma.mock';

const KEY = 'policy-spec-signing-key';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const claims = (over: Partial<ExampleOidcClaims> = {}): ExampleOidcClaims => ({
  sub: 'oidc-policy-1',
  email: 'staff@example.test',
  email_verified: true,
  exp: nowSeconds() + 300,
  ...over,
});

/** The policy under test, switchable so the kit can swap in its own denial. */
const policy: { current: SignInPolicy } = { current: new ExampleOidcSignInPolicy() };
const delegating: SignInPolicy = { beforeLogin: (profile, ctx) => policy.current.beforeLogin(profile, ctx) };

async function bootApp() {
  const host = createStubIdentityHost({
    prisma: prismaMock,
    userSettings: { theme: 'system' },
    authCredentials: { getSecret: async (_purpose, name) => (name === EXAMPLE_OIDC_KEY_NAME ? KEY : null) },
  });
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [
          () => ({
            ...identityConfiguration({
              JWT_SECRET: 'policy-spec-jwt-secret-0123456789abcdef',
              GOOGLE_CLIENT_ID: 'id',
              GOOGLE_CLIENT_SECRET: 'secret',
              GOOGLE_CALLBACK_URL: 'http://localhost/api/auth/google/callback',
            }),
            appUrl: 'http://localhost:3535',
          }),
        ],
      }),
      EventEmitterModule.forRoot(),
      DoctorModule.forRoot({ host: createTestPlatformHost() }),
      IdentityModule.forRoot({ imports: [host.module], signInPolicy: { useFactory: () => delegating } }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, moduleRef };
}

function arrange(): void {
  resetPrismaMock();
  prismaMock.organization.findFirst.mockResolvedValue({ id: 'org-default', name: 'Default', slug: 'default', isDefault: true } as never);
  prismaMock.membership.upsert.mockResolvedValue({ id: 'm-1' } as never);
  prismaMock.role.findUnique.mockImplementation((async (args: { where: { name: string } }) => ({
    id: `role-${args.where.name}`,
    name: args.where.name,
    scope: 'org',
    rolePermissions: [],
    // The admin bootstrap reads the admin role with its holders: nobody holds it here.
    userRoles: [],
  })) as never);
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
  prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'a-1', claimedById: 'x' } as never);
}

describe('ExampleOidcSignInPolicy bound through IdentityModule.forRoot (PP-14.9)', () => {
  let app: NestFastifyApplication;
  let auth: AuthService;
  let restore: () => void;

  beforeAll(async () => {
    // Registered for this spec's graph (the registry is frozen once an app has booted).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve, reject) => {
      void withTemporaryEntries(authProviderRegistry, authProviderRegistry.has('example-oidc') ? [] : [exampleOidcProvider], async () => {
        try {
          const booted = await bootApp();
          app = booted.app;
          auth = booted.moduleRef.get(AuthService);
          resolve();
        } catch (error) {
          reject(error);
        }
        await held;
      });
    });
    restore = release;
    await ready;
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  beforeEach(() => {
    arrange();
    policy.current = new ExampleOidcSignInPolicy();
  });

  const callback = (token: string) => request(app.getHttpServer()).get('/api/auth/example-oidc/callback').query({ id_token: token });

  it('denies an address outside the company domain with its reason, and writes nothing', async () => {
    const res = await callback(signExampleIdToken(claims({ email: 'outsider@gmail.test' }), KEY)).expect(302);

    expect(new URL(res.headers.location!).searchParams.get('error')).toBe('access_denied');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled();
  });

  it('admits a company address as an ordinary member (the default organization role)', async () => {
    await callback(signExampleIdToken(claims(), KEY)).expect(302);

    const membership = JSON.stringify(prismaMock.membership.upsert.mock.calls[0]![0]);
    expect(membership).toContain('role-viewer');
  });

  it('maps the org-admins group to the org_admin role on the NEW account', async () => {
    const res = await callback(signExampleIdToken(claims({ groups: ['org-admins'] }), KEY)).expect(302);

    expect(new URL(res.headers.location!).searchParams.has('token')).toBe(true);
    expect(JSON.stringify(prismaMock.membership.upsert.mock.calls[0]![0])).toContain('role-org_admin');
  });

  it('does not grant the mapped role to an existing account (an administrator\'s edits stick)', async () => {
    const user = { id: 'user-old', email: 'staff@example.test', isActive: true, userRoles: [], memberships: [] };
    prismaMock.userIdentity.findUnique.mockResolvedValue({ user } as never);
    prismaMock.user.update.mockResolvedValue(user as never);

    await callback(signExampleIdToken(claims({ groups: ['org-admins'] }), KEY)).expect(302);

    expect(prismaMock.membership.upsert).not.toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ roleId: 'role-org_admin' }) }));
  });

  it.each([['a string', 'org-admins'], ['an object', { 0: 'org-admins' }], ['a number', 1]])(
    'maps no role from a groups claim that is %s, not an array',
    (_name, groups) => {
      const decision = new ExampleOidcSignInPolicy().beforeLogin({
        provider: 'example-oidc',
        subject: 's',
        email: 'staff@example.test',
        emailVerified: true,
        raw: { groups },
      });
      expect(decision).toEqual({ allow: true });
    },
  );

  it('waves another provider through, so binding it cannot change Google', () => {
    const decision = new ExampleOidcSignInPolicy().beforeLogin({
      provider: 'google',
      subject: 'g-1',
      email: 'anyone@gmail.test',
      emailVerified: true,
    });
    expect(decision).toEqual({ allow: true });
  });

  describe('the provider kit, including its policy scenario', () => {
    describeAuthProviderConformance(exampleOidcProvider, {
      describe,
      it,
      expect,
      rawProfile: claims(),
      expectedSubject: 'oidc-policy-1',
      enabledWith: { credentials: { [EXAMPLE_OIDC_KEY_NAME]: KEY } },
      host: {
        completeLogin: (profile: ExternalProfile) => auth.completeExternalLogin(profile),
        hasIdentity: async (provider, subject) =>
          prismaMock.user.create.mock.calls.some((call: unknown[]) => {
            const create = (call[0] as { data: { identities: { create: { provider: string; providerSubject: string } } } }).data.identities.create;
            return create.provider === provider && create.providerSubject === subject;
          }),
        withAllowlist: async (allowed, fn) => {
          prismaMock.allowedEmail.findUnique.mockResolvedValue(allowed ? ({ id: 'a-1', claimedById: 'x' } as never) : null);
          await fn();
        },
        withPolicy: async (denying, fn) => {
          policy.current = denying;
          try {
            await fn();
          } finally {
            policy.current = new ExampleOidcSignInPolicy();
          }
        },
        routeIsMounted: async (id) => (await request(app.getHttpServer()).get(`/api/auth/${id}`)).status !== 404,
      },
    });
  });
});

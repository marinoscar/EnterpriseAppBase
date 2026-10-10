import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DoctorModule } from '../../src/doctor/index';
import { withTemporaryEntries } from '../../src/core/index';
import {
  IdentityModule,
  authCredentialPurpose,
  authProviderRegistry,
  identityConfiguration,
  type AuthProviderDefinition,
  type ExternalProfile,
  type SignInPolicy,
} from '../../src/identity/index';
import { createStubIdentityHost } from '../../src/identity/testing/index';
import { createTestPlatformHost } from '../../src/testing/index';
import { prismaMock, resetPrismaMock } from './support/prisma.mock';

// =============================================================================
// The generic sign-in routes, through the REAL IdentityModule (PP-14.9)
// =============================================================================
//
// A provider registered with `registerAuthProvider` (a fake whose strategy
// accepts `?code=ok` and builds from a stored secret) completes a sign-in over
// `GET /api/auth/:id` and `/callback`, and ends it exactly as Google's callback
// does. The module is booted with `IdentityModule.forRoot` and the stub host; the
// policy is bound through `forRoot({ signInPolicy })`, the only way it reaches
// `AuthService`.
// =============================================================================

const ENV = {
  JWT_SECRET: 'auth-provider-routes-secret-0123456789abcdef',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost/api/auth/google/callback',
};

/** A Passport strategy with no network: `?code=ok` signs in, no code asks the IdP, anything else fails. */
function fakeStrategy(secret: string) {
  return {
    name: 'fake',
    authenticate(this: any, req: { url: string }) {
      const code = new URL(req.url, 'http://localhost').searchParams.get('code');
      if (!code) return this.redirect(`https://idp.example/authorize?client=${secret.length}`);
      if (code === 'ok') return this.success({ sub: 'f-1', mail: 'fake@example.com', verified: true, name: 'Fay Ke' });
      return this.fail();
    },
  };
}

function fakeDefinition(over: Partial<AuthProviderDefinition> = {}): AuthProviderDefinition {
  const purpose = authCredentialPurpose('fake');
  return {
    id: 'fake',
    label: 'Fake',
    isEnabled: async (_config, { credentials }) => (await credentials.getSecret(purpose, 'client_secret')) !== null,
    createStrategy: async ({ credentials }) => fakeStrategy((await credentials.getSecret(purpose, 'client_secret')) ?? '') as never,
    mapProfile: (raw): ExternalProfile => {
      const r = raw as { sub: string; mail: string; verified: boolean; name: string };
      // A hostile or buggy mapper claiming to be Google: the route must ignore it.
      return { provider: 'google', subject: r.sub, email: r.mail, emailVerified: r.verified, displayName: r.name };
    },
    ...over,
  };
}

async function boot(opts: { secrets?: Record<string, string>; signInPolicy?: SignInPolicy } = {}) {
  const secrets = opts.secrets ?? {};
  const host = createStubIdentityHost({
    prisma: prismaMock,
    userSettings: { theme: 'system' },
    authCredentials: { getSecret: async (_purpose, name) => secrets[name] ?? null },
  });
  const platformHost = createTestPlatformHost();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => ({ ...identityConfiguration(ENV), appUrl: 'http://localhost:3535' })],
      }),
      EventEmitterModule.forRoot(),
      DoctorModule.forRoot({ host: platformHost }),
      IdentityModule.forRoot({
        imports: [host.module],
        ...(opts.signInPolicy ? { signInPolicy: { useFactory: () => opts.signInPolicy! } } : {}),
      }),
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const events: Array<[string, unknown]> = [];
  const emitter = moduleRef.get(EventEmitter2);
  emitter.onAny((name, payload) => events.push([String(name), payload]));
  return { app, moduleRef, secrets, events };
}

function arrangeNewUser(): void {
  resetPrismaMock();
  prismaMock.organization.findFirst.mockResolvedValue({ id: 'org-default', name: 'Default', slug: 'default', isDefault: true } as never);
  prismaMock.membership.upsert.mockResolvedValue({ id: 'm-1' } as never);
  prismaMock.role.findUnique.mockImplementation((async (args: { where: { name: string } }) => ({
    id: `role-${args.where.name}`,
    name: args.where.name,
    scope: 'org',
    rolePermissions: [],
  })) as never);
  prismaMock.userIdentity.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation((async (cb: (tx: unknown) => unknown) => cb(prismaMock)) as never);
  prismaMock.user.create.mockImplementation((async (args: { data: { email: string } }) => ({
    id: 'user-1',
    email: args.data.email,
    isActive: true,
    userRoles: [],
    memberships: [],
  })) as never);
  prismaMock.user.update.mockResolvedValue({} as never);
  prismaMock.refreshToken.create.mockResolvedValue({} as never);
  prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'a-1', email: 'fake@example.com', claimedById: null } as never);
}

describe('generic sign-in routes (PP-14.9)', () => {
  beforeEach(() => arrangeNewUser());

  it('is a 404 for an unknown provider, a custom provider and a provider that is not configured', async () => {
    const custom: AuthProviderDefinition = { id: 'popup', mode: 'custom', isEnabled: () => true };
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition(), custom], async () => {
      const { app } = await boot(); // no secret stored: `fake` is not configured
      try {
        for (const id of ['nope', 'popup', 'fake']) {
          await request(app.getHttpServer()).get(`/api/auth/${id}`).expect(404);
        }
        // The callback ends in the closed-set redirect, never a JSON body or a login.
        const callback = await request(app.getHttpServer()).get('/api/auth/fake/callback?code=ok').expect(302);
        expect(new URL(callback.headers.location!).searchParams.get('error')).toBe('authentication_failed');
        expect(callback.headers['set-cookie']).toBeUndefined();
        expect(prismaMock.user.create).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it('starts the flow at the provider and completes it with the same cookie and redirect as Google', async () => {
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition()], async () => {
      const { app, events } = await boot({ secrets: { client_secret: 'topsecret' } });
      try {
        const start = await request(app.getHttpServer()).get('/api/auth/fake').expect(302);
        expect(start.headers.location).toBe('https://idp.example/authorize?client=9');

        const done = await request(app.getHttpServer()).get('/api/auth/fake/callback?code=ok').expect(302);
        const url = new URL(done.headers.location!);
        expect(url.origin + url.pathname).toBe('http://localhost:3535/auth/callback');
        expect(url.searchParams.get('token')).toEqual(expect.any(String));
        expect(url.searchParams.get('expiresIn')).toBe('900');
        expect(url.searchParams.has('error')).toBe(false);

        // The ONLY cookie: HttpOnly refresh_token, Lax, /api/auth, 14 days (not Secure outside production).
        const cookies = done.headers['set-cookie'] as unknown as string[];
        expect(cookies).toHaveLength(1);
        expect(cookies[0]).toMatch(/^refresh_token=[^;]+;/);
        expect(cookies[0]).toContain('HttpOnly');
        expect(cookies[0]).toContain('SameSite=Lax');
        expect(cookies[0]).toContain('Path=/api/auth');
        expect(cookies[0]).toContain('Max-Age=1209600');

        // The identity is stored under the SERVING provider's id, not the one the mapper claimed.
        const created = prismaMock.user.create.mock.calls[0]![0] as { data: { identities: { create: unknown } } };
        expect(created.data.identities.create).toEqual({
          provider: 'fake',
          providerSubject: 'f-1',
          providerEmail: 'fake@example.com',
        });
        expect(events).toContainEqual(['identity.user.created', { userId: 'user-1', email: 'fake@example.com', source: 'fake', orgId: 'org-default' }]);
        expect(events).toContainEqual(['identity.login.succeeded', { userId: 'user-1', provider: 'fake', isNewUser: true }]);
      } finally {
        await app.close();
      }
    });
  });

  it('redirects a failed provider authentication with error=authentication_failed and sets no cookie', async () => {
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition()], async () => {
      const { app } = await boot({ secrets: { client_secret: 'topsecret' } });
      try {
        const res = await request(app.getHttpServer()).get('/api/auth/fake/callback?code=bad').expect(302);
        expect(new URL(res.headers.location!).searchParams.get('error')).toBe('authentication_failed');
        expect(res.headers['set-cookie']).toBeUndefined();
      } finally {
        await app.close();
      }
    });
  });

  it('builds the strategy from the credential store on every request (a rotated secret applies at once)', async () => {
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition()], async () => {
      const { app, secrets } = await boot({ secrets: { client_secret: 'aaaa' } });
      try {
        expect((await request(app.getHttpServer()).get('/api/auth/fake')).headers.location).toContain('client=4');
        secrets.client_secret = 'bbbbbbbb';
        expect((await request(app.getHttpServer()).get('/api/auth/fake')).headers.location).toContain('client=8');
        delete secrets.client_secret;
        await request(app.getHttpServer()).get('/api/auth/fake').expect(404);
      } finally {
        await app.close();
      }
    });
  });

  it('applies a SignInPolicy bound through forRoot: a denial redirects with its reason and writes nothing', async () => {
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition()], async () => {
      const policy: SignInPolicy = { beforeLogin: jest.fn().mockResolvedValue({ allow: false, reason: 'access_denied' }) };
      const { app } = await boot({ secrets: { client_secret: 'topsecret' }, signInPolicy: policy });
      try {
        const res = await request(app.getHttpServer()).get('/api/auth/fake/callback?code=ok').expect(302);
        expect(new URL(res.headers.location!).searchParams.get('error')).toBe('access_denied');
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(policy.beforeLogin).toHaveBeenCalledTimes(1);
        expect(prismaMock.user.create).not.toHaveBeenCalled();
        expect(prismaMock.userIdentity.create).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  it('lists a configured provider on GET /api/auth/providers', async () => {
    await withTemporaryEntries(authProviderRegistry, [fakeDefinition()], async () => {
      const { app, secrets } = await boot();
      try {
        let res = await request(app.getHttpServer()).get('/api/auth/providers').expect(200);
        expect(res.body.data.providers).toEqual([{ name: 'google', enabled: true }]);
        secrets.client_secret = 'x';
        res = await request(app.getHttpServer()).get('/api/auth/providers').expect(200);
        expect(res.body.data.providers).toEqual([
          { name: 'google', enabled: true },
          { name: 'fake', enabled: true },
        ]);
      } finally {
        await app.close();
      }
    });
  });
});

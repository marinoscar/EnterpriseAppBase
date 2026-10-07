// =============================================================================
// Sign-in by TENANCY_MODE, through the real AppModule (PP-6.2, #722)
// =============================================================================
//
// `src/auth/auth.service.tenancy.spec.ts` proves what AuthService decides. This
// suite boots the whole application once per mode, with `TENANCY_MODE` set in
// the environment before the config factory runs (as a deployment would), and
// drives:
//
//   - the Google OAuth callback, with the `google` passport strategy replaced
//     by `MockGoogleStrategy` (no network), so a refusal is observed as the
//     real redirect `/auth/callback?error=<code>`;
//   - the test login route, which applies the same rules;
//   - `GET /api/auth/me`, which reports the mode.
//
// Prisma is mocked; the organization rows come from `setupBaseMocks`.
// =============================================================================

import request from 'supertest';

import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { authHeader, createMockTestUser } from '../helpers/auth-mock.helper';
import { MockGoogleStrategy } from '../mocks/google-oauth.mock';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { mockRoles } from '../fixtures/test-data.factory';

// The bootstrap admin `.env.test` configures. Read at call time by
// `ConfigService.get('INITIAL_ADMIN_EMAIL')`, so it is not overridden here.
const ADMIN_EMAIL = (process.env.INITIAL_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
const PERSON = { id: 'google-person', email: 'person@example.test', displayName: 'Person' };

/** Boots the app with TENANCY_MODE (undefined = unset) and the mock Google strategy. */
async function bootWith(mode: string | undefined): Promise<TestContext> {
  const savedMode = process.env.TENANCY_MODE;
  if (mode === undefined) delete process.env.TENANCY_MODE;
  else process.env.TENANCY_MODE = mode;
  try {
    const context = await createTestApp({ useMockDatabase: true });
    // Re-registers the passport strategy named `google` (passport is a
    // process-wide singleton, isolated per test file by Jest), so the callback
    // guard yields `MockGoogleStrategy.mockProfile` without calling Google.
    new MockGoogleStrategy();
    return context;
  } finally {
    if (savedMode === undefined) delete process.env.TENANCY_MODE;
    else process.env.TENANCY_MODE = savedMode;
  }
}

function userRow(id: string, email: string, roleName: keyof typeof mockRoles = 'viewer') {
  return {
    id,
    email,
    isActive: true,
    displayName: null,
    providerDisplayName: null,
    providerProfileImageUrl: null,
    userRoles: [{ role: { ...mockRoles[roleName], rolePermissions: [] } }],
  };
}

/** The callback's sign-in for a brand-new, allowlisted user. */
function mockNewUser(context: TestContext, id: string, email: string): void {
  const row = userRow(id, email);
  context.prismaMock.userIdentity.findUnique.mockResolvedValue(null);
  context.prismaMock.user.findUnique.mockResolvedValue(null);
  context.prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'allow-1', email, claimedById: null });
  context.prismaMock.allowedEmail.update.mockResolvedValue({});
  context.prismaMock.user.create.mockResolvedValue(row);
  context.prismaMock.user.update.mockResolvedValue(row);
  context.prismaMock.refreshToken.create.mockResolvedValue({});
  // An active admin already exists, so admin bootstrap grants nothing: the
  // default-org join under test keys on INITIAL_ADMIN_EMAIL alone.
  context.prismaMock.role.findUnique.mockImplementation(async ({ where }: { where: { name?: string } }) =>
    where.name === 'admin'
      ? { ...mockRoles.admin, userRoles: [{ user: { isActive: true } }] }
      : { ...mockRoles.viewer, rolePermissions: [] },
  );
}

/** The callback's sign-in for a user whose Google identity is already linked. */
function mockReturningUser(context: TestContext, id: string, email: string): void {
  const row = userRow(id, email);
  context.prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'allow-1', email, claimedById: id });
  context.prismaMock.userIdentity.findUnique.mockResolvedValue({ id: 'identity-1', userId: id, user: row });
  context.prismaMock.user.update.mockResolvedValue(row);
  context.prismaMock.refreshToken.create.mockResolvedValue({});
}

async function callback(context: TestContext): Promise<URL> {
  const response = await request(context.app.getHttpServer()).get('/api/auth/google/callback').expect(302);
  return new URL(response.headers.location);
}

describe('Sign-in with TENANCY_MODE unset (single, the default)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await bootWith(undefined);
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    MockGoogleStrategy.resetMockProfile();
  });

  it('joins a new user to the default org in the creation transaction and signs them in', async () => {
    MockGoogleStrategy.setMockProfile(PERSON);
    mockNewUser(context, 'user-new', PERSON.email);

    const location = await callback(context);

    expect(location.searchParams.get('token')).toBeTruthy();
    expect(context.prismaMock.membership.upsert).toHaveBeenCalledTimes(1);
    expect(context.prismaMock.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: 'org-default', userId: 'user-new' } } }),
    );
  });

  it('self-heals a returning user who has no membership', async () => {
    MockGoogleStrategy.setMockProfile(PERSON);
    mockReturningUser(context, 'user-lost', PERSON.email);
    context.prismaMock.membership.findUnique.mockResolvedValue(null);

    const location = await callback(context);

    expect(location.searchParams.get('token')).toBeTruthy();
    expect(context.prismaMock.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: 'org-default', userId: 'user-lost' } } }),
    );
  });

  it('reports tenancyMode single on GET /api/auth/me', async () => {
    const user = await createMockTestUser(context);

    const response = await request(context.app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(response.body.data.tenancyMode).toBe('single');
  });
});

describe('Sign-in with TENANCY_MODE=multi', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await bootWith('multi');
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    MockGoogleStrategy.resetMockProfile();
  });

  it('refuses a new non-admin user with error=no_organization, and joins them to nothing', async () => {
    MockGoogleStrategy.setMockProfile(PERSON);
    mockNewUser(context, 'user-orphan', PERSON.email);
    context.prismaMock.membership.count.mockResolvedValue(0);

    const location = await callback(context);

    expect(location.pathname).toBe('/auth/callback');
    expect(location.searchParams.get('error')).toBe('no_organization');
    expect(location.searchParams.has('token')).toBe(false);
    expect(context.prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(context.prismaMock.membership.upsert).not.toHaveBeenCalled();
    expect(context.prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it('joins the INITIAL_ADMIN_EMAIL user to the default org and signs them in', async () => {
    MockGoogleStrategy.setMockProfile({ id: 'google-admin', email: ADMIN_EMAIL, displayName: 'Admin' });
    mockNewUser(context, 'user-admin', ADMIN_EMAIL);
    context.prismaMock.membership.count.mockResolvedValue(1);

    const location = await callback(context);

    expect(location.searchParams.get('token')).toBeTruthy();
    expect(context.prismaMock.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: 'org-default', userId: 'user-admin' } } }),
    );
  });

  it('signs in a returning user with an active membership', async () => {
    MockGoogleStrategy.setMockProfile(PERSON);
    mockReturningUser(context, 'user-member', PERSON.email);
    context.prismaMock.membership.count.mockResolvedValue(1);
    // #724: that membership is the org the session is bound to.
    context.prismaMock.membership.findMany.mockResolvedValue([{ orgId: 'org-a' }]);

    const location = await callback(context);

    expect(location.searchParams.get('token')).toBeTruthy();
    expect(context.prismaMock.membership.upsert).not.toHaveBeenCalled();
  });

  it('refuses a returning user with no active membership', async () => {
    MockGoogleStrategy.setMockProfile(PERSON);
    mockReturningUser(context, 'user-suspended', PERSON.email);
    context.prismaMock.membership.count.mockResolvedValue(0);

    expect((await callback(context)).searchParams.get('error')).toBe('no_organization');
  });

  it('applies the same refusal to the test login route', async () => {
    context.prismaMock.user.findUnique.mockResolvedValue(null);
    context.prismaMock.user.create.mockResolvedValue({ ...userRow('user-e2e', 'e2e@example.test'), userRoles: [] });
    context.prismaMock.membership.count.mockResolvedValue(0);

    const response = await request(context.app.getHttpServer())
      .post('/api/auth/test/login')
      .send({ email: 'e2e@example.test', role: 'viewer' })
      .expect(302);

    const location = new URL(response.headers.location);
    expect(location.pathname).toBe('/auth/callback');
    expect(location.searchParams.get('error')).toBe('no_organization');
    expect(context.prismaMock.membership.upsert).not.toHaveBeenCalled();
  });

  it('reports tenancyMode multi on GET /api/auth/me', async () => {
    // #724: multi mode refuses a token without `org`, so this user holds a
    // membership and its token names it.
    const user = await createMockTestUser(context, { orgRoleName: 'viewer' });

    const response = await request(context.app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(response.body.data.tenancyMode).toBe('multi');
  });
});

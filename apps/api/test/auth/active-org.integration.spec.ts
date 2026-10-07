// =============================================================================
// The active organization, through the real AppModule (PP-6.4, #724)
// =============================================================================
//
// `src/auth/auth.service.active-org.spec.ts` proves what AuthService decides.
// This suite boots the whole application (Prisma mocked) once per tenancy
// mode and drives the HTTP surface:
//
//   - every request is bound to the signed `org` claim, re-checked against the
//     user's ACTIVE memberships through the principal cache;
//   - `POST /api/auth/switch-org` rotates the refresh cookie and re-issues for
//     another org (404 for a non-member org, 403 for a PAT);
//   - `POST /api/auth/refresh` is org-preserving and fails once the
//     membership is gone;
//   - a PAT is bound to the org it was created in, and dies with the
//     membership; a device session approved in org A issues `org = A`;
//   - single mode keeps a token without `org` working, mapped to the default
//     organization; multi mode refuses it.
// =============================================================================

import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { OrganizationsService, PrincipalCache } from '@marinoscar/platform-api/identity';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { mockPermissions, mockRoles } from '../fixtures/test-data.factory';
import { authHeader } from '../helpers/auth-mock.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';

const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const EMAIL = 'member@example.test';
const DEFAULT_ORG = '00000000-0000-4000-8000-0000000000d0';
const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const ORG_X = '00000000-0000-4000-8000-0000000000ff';

/** An org role with a real grant, so a request can be authorized through it. */
const viewer = {
  ...mockRoles.viewer,
  rolePermissions: [{ permission: mockPermissions.userSettingsRead }],
};

const membership = (orgId: string, status: 'active' | 'suspended' = 'active') => ({
  id: `m-${orgId}`,
  orgId,
  userId: USER_ID,
  status,
  lastActiveAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  roleId: viewer.id,
  org: { id: orgId, isDefault: orgId === DEFAULT_ORG, name: `Org ${orgId.slice(-2)}`, slug: `org-${orgId.slice(-2)}` },
  role: viewer,
});

/** Boots the app with TENANCY_MODE set before the config factory runs. */
async function bootWith(mode: 'single' | 'multi'): Promise<TestContext> {
  const saved = process.env.TENANCY_MODE;
  process.env.TENANCY_MODE = mode;
  try {
    return await createTestApp({ useMockDatabase: true });
  } finally {
    if (saved === undefined) delete process.env.TENANCY_MODE;
    else process.env.TENANCY_MODE = saved;
  }
}

/** The world one test runs in: the user's memberships, which the mocks read live. */
function installUser(context: TestContext, orgIds: string[]) {
  const state = { memberships: orgIds.map((orgId) => membership(orgId)) };
  const graph = () => ({
    id: USER_ID,
    email: EMAIL,
    isActive: true,
    displayName: null,
    providerDisplayName: 'Member',
    profileImageUrl: null,
    providerProfileImageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    userRoles: [],
    memberships: state.memberships,
    userSettings: null,
  });

  const findUser = context.prismaMock.user.findUnique.getMockImplementation();
  context.prismaMock.user.findUnique.mockImplementation(async (args: any) =>
    args?.where?.id === USER_ID ? graph() : findUser?.(args),
  );
  context.prismaMock.membership.findUnique.mockImplementation(async ({ where }: any) =>
    where?.orgId_userId?.userId === USER_ID
      ? (state.memberships.find((m) => m.orgId === where.orgId_userId.orgId) ?? null)
      : null,
  );
  context.prismaMock.membership.updateMany.mockResolvedValue({ count: 1 });
  context.prismaMock.membership.deleteMany.mockImplementation(async ({ where }: any) => {
    const before = state.memberships.length;
    state.memberships = state.memberships.filter((m) => m.orgId !== where.orgId);
    return { count: before - state.memberships.length };
  });
  context.prismaMock.refreshToken.create.mockResolvedValue({});
  context.prismaMock.refreshToken.update.mockResolvedValue({});
  context.prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

  return { state, graph };
}

function sign(context: TestContext, org?: string, extra: Record<string, unknown> = {}): string {
  return context.module.get(JwtService).sign({
    sub: USER_ID,
    email: EMAIL,
    roles: [],
    ...(org !== undefined ? { org } : {}),
    ...extra,
  });
}

const claims = (context: TestContext, token: string) => context.module.get(JwtService).verify(token);

const me = (context: TestContext, token: string) =>
  request(context.app.getHttpServer()).get('/api/auth/me').set(authHeader(token));

/** A refresh token row for the user, as `PRINCIPAL_USER_INCLUDE` loads it. */
const refreshRow = (graph: () => unknown, orgId: string | null) => ({
  id: 'rt-1',
  userId: USER_ID,
  tokenHash: 'h',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
  deviceCodeId: null,
  deviceCode: null,
  orgId,
  user: graph(),
});

describe('active organization (multi mode)', () => {
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
    // Every test reuses one user id: start each without a cached principal.
    context.module.get(PrincipalCache).invalidate({ all: true });
  });

  it('binds the request to the signed org: /auth/me reports it and every membership', async () => {
    installUser(context, [ORG_A, ORG_B]);

    const res = await me(context, sign(context, ORG_B)).expect(200);

    expect(res.body.data.activeOrg).toMatchObject({ id: ORG_B });
    expect(res.body.data.memberships.map((m: { orgId: string }) => m.orgId).sort()).toEqual([ORG_A, ORG_B].sort());
    expect(res.body.data.tenancyMode).toBe('multi');
  });

  it('refuses a token for an org the user is not a member of, and a token without org', async () => {
    installUser(context, [ORG_A]);

    await me(context, sign(context, ORG_X)).expect(401);
    await me(context, sign(context)).expect(401);
  });

  it('a removed membership is refused on the very next request, cache or not', async () => {
    installUser(context, [ORG_A, ORG_B]);
    const token = sign(context, ORG_A);
    await me(context, token).expect(200); // primes the principal cache

    await context.module.get(OrganizationsService).removeMembership(ORG_A, USER_ID);

    await me(context, token).expect(401);
    await me(context, sign(context, ORG_B)).expect(200);
  });

  describe('POST /api/auth/switch-org', () => {
    it('switches to another org: new access token, rotated cookie, audit event', async () => {
      const { graph } = installUser(context, [ORG_A, ORG_B]);
      context.prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRow(graph, ORG_A));

      const res = await request(context.app.getHttpServer())
        .post('/api/auth/switch-org')
        .set(authHeader(sign(context, ORG_A)))
        .set('Cookie', 'refresh_token=current-cookie')
        .send({ orgId: ORG_B })
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(claims(context, body.accessToken).org).toBe(ORG_B);
      expect(body.expiresIn).toEqual(expect.any(Number));
      expect(String(res.headers['set-cookie'])).toMatch(/refresh_token=/);
      expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
      expect(context.prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(context.prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: USER_ID, orgId: ORG_B }),
      });
      expect(context.prismaMock.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'auth:org_switched',
          targetType: 'organization',
          targetId: ORG_B,
          actorUserId: USER_ID,
        }),
      });

      // The new token works and is bound to B.
      const after = await me(context, body.accessToken).expect(200);
      expect(after.body.data.activeOrg).toMatchObject({ id: ORG_B });
    });

    it('404s for an org the caller is not a member of', async () => {
      const { graph } = installUser(context, [ORG_A]);
      context.prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRow(graph, ORG_A));

      await request(context.app.getHttpServer())
        .post('/api/auth/switch-org')
        .set(authHeader(sign(context, ORG_A)))
        .set('Cookie', 'refresh_token=current-cookie')
        .send({ orgId: ORG_X })
        .expect(404);
      expect(context.prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('403s for a PAT caller: a bound credential cannot hop orgs', async () => {
      const { graph } = installUser(context, [ORG_A, ORG_B]);
      context.prismaMock.personalAccessToken.findUnique.mockResolvedValue({
        id: 'pat-1',
        userId: USER_ID,
        orgId: ORG_A,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: graph(),
      });
      context.prismaMock.personalAccessToken.update.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/switch-org')
        .set('Authorization', 'Bearer pat_' + 'a'.repeat(64))
        .send({ orgId: ORG_B })
        .expect(403);
    });

    it('400s a body whose orgId is not a UUID', async () => {
      installUser(context, [ORG_A]);

      await request(context.app.getHttpServer())
        .post('/api/auth/switch-org')
        .set(authHeader(sign(context, ORG_A)))
        .send({ orgId: 'not-a-uuid' })
        .expect(400);
    });

    it('401s without a refresh cookie', async () => {
      installUser(context, [ORG_A, ORG_B]);

      await request(context.app.getHttpServer())
        .post('/api/auth/switch-org')
        .set(authHeader(sign(context, ORG_A)))
        .send({ orgId: ORG_B })
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('re-issues for the same org', async () => {
      const { graph } = installUser(context, [ORG_A, ORG_B]);
      context.prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRow(graph, ORG_B));

      const res = await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=current-cookie')
        .expect(200);

      const body = res.body.data ?? res.body;
      expect(claims(context, body.accessToken).org).toBe(ORG_B);
    });

    it('fails (401) after the membership was removed', async () => {
      const { graph, state } = installUser(context, [ORG_A, ORG_B]);
      state.memberships = state.memberships.filter((m) => m.orgId !== ORG_A);
      context.prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRow(graph, ORG_A));

      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=current-cookie')
        .expect(401);
      expect(context.prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('personal access tokens', () => {
    const patRow = (graph: () => unknown, orgId: string) => ({
      id: 'pat-1',
      userId: USER_ID,
      name: 'CI',
      tokenPrefix: 'pat_aaaa',
      orgId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      user: graph(),
    });

    it("binds a new PAT to the caller's active org", async () => {
      installUser(context, [ORG_A, ORG_B]);
      context.prismaMock.personalAccessToken.create.mockImplementation(async ({ data }: any) => ({
        id: 'pat-1',
        createdAt: new Date(),
        ...data,
      }));

      const res = await request(context.app.getHttpServer())
        .post('/api/pat')
        .set(authHeader(sign(context, ORG_B)))
        .send({ name: 'CI', durationValue: 1, durationUnit: 'days' })
        .expect(201);

      expect(res.body.data.orgId).toBe(ORG_B);
      expect(context.prismaMock.personalAccessToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ orgId: ORG_B }),
      });
    });

    it('refuses (400) a PAT for an org the caller is not a member of', async () => {
      installUser(context, [ORG_A]);

      await request(context.app.getHttpServer())
        .post('/api/pat')
        .set(authHeader(sign(context, ORG_A)))
        .send({ name: 'CI', durationValue: 1, durationUnit: 'days', orgId: ORG_X })
        .expect(400);
      expect(context.prismaMock.personalAccessToken.create).not.toHaveBeenCalled();
    });

    it('a PAT created in org A stops working once the membership in A is removed', async () => {
      const { graph, state } = installUser(context, [ORG_A]);
      context.prismaMock.personalAccessToken.findUnique.mockImplementation(async () => patRow(graph, ORG_A));
      context.prismaMock.personalAccessToken.update.mockResolvedValue({});
      const pat = 'Bearer pat_' + 'b'.repeat(64);

      const before = await request(context.app.getHttpServer()).get('/api/auth/me').set('Authorization', pat).expect(200);
      expect(before.body.data.activeOrg).toMatchObject({ id: ORG_A });

      state.memberships = [];
      await request(context.app.getHttpServer()).get('/api/auth/me').set('Authorization', pat).expect(401);
    });
  });

  describe('device authorization', () => {
    it('a session approved in org A yields tokens with org = A', async () => {
      const { graph } = installUser(context, [ORG_A, ORG_B]);
      context.prismaMock.deviceCode.findUnique.mockResolvedValueOnce({
        id: 'dc-1',
        userCode: 'ABCD-EFGH',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      });
      context.prismaMock.deviceCode.update.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/device/authorize')
        .set(authHeader(sign(context, ORG_A)))
        .send({ userCode: 'ABCD-EFGH', approve: true })
        .expect(200);

      expect(context.prismaMock.deviceCode.update).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        data: expect.objectContaining({ status: 'approved', userId: USER_ID, orgId: ORG_A }),
      });

      // The device polls: the approved row now carries ORG_A.
      context.prismaMock.deviceCode.findUnique.mockResolvedValueOnce({
        id: 'dc-1',
        status: 'approved',
        expiresAt: new Date(Date.now() + 60_000),
        userId: USER_ID,
        orgId: ORG_A,
        clientInfo: null,
        user: graph(),
      });
      context.prismaMock.deviceCode.updateMany.mockResolvedValue({ count: 1 });

      const poll = await request(context.app.getHttpServer())
        .post('/api/auth/device/token')
        .send({ deviceCode: 'device-code-raw' })
        .expect(200);

      const body = poll.body.data ?? poll.body;
      expect(claims(context, body.accessToken)).toMatchObject({ org: ORG_A, did: 'dc-1' });
    });
  });
});

describe('active organization (single mode)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await bootWith('single');
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    // Every test reuses one user id: start each without a cached principal.
    context.module.get(PrincipalCache).invalidate({ all: true });
    // A UUID default org, so `switch-org`'s body validation accepts it.
    context.prismaMock.organization.findFirst.mockResolvedValue({
      id: DEFAULT_ORG,
      name: 'Default organization',
      slug: 'default',
      isDefault: true,
    });
  });

  it('a token issued before #724 (no org) is accepted and mapped to the default org', async () => {
    installUser(context, [DEFAULT_ORG]);

    const res = await me(context, sign(context)).expect(200);

    expect(res.body.data.activeOrg).toMatchObject({ id: DEFAULT_ORG });
  });

  it('switch-org to the default org is a no-op re-issue; any other id is 404', async () => {
    const { graph } = installUser(context, [DEFAULT_ORG]);
    context.prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRow(graph, DEFAULT_ORG));

    const res = await request(context.app.getHttpServer())
      .post('/api/auth/switch-org')
      .set(authHeader(sign(context, DEFAULT_ORG)))
      .set('Cookie', 'refresh_token=current-cookie')
      .send({ orgId: DEFAULT_ORG })
      .expect(200);
    expect(claims(context, (res.body.data ?? res.body).accessToken).org).toBe(DEFAULT_ORG);

    await request(context.app.getHttpServer())
      .post('/api/auth/switch-org')
      .set(authHeader(sign(context, DEFAULT_ORG)))
      .set('Cookie', 'refresh_token=current-cookie')
      .send({ orgId: ORG_B })
      .expect(404);
  });
});

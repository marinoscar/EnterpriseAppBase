// =============================================================================
// Org administration API through the real AppModule (#726, PP-6.7)
// =============================================================================
//
// Boots the application in multi-org mode (and once in single mode) with
// mocked Prisma, and drives the three controllers over HTTP:
//
//   - `/api/admin/organizations` (system `organizations:*`): list, create with
//     a first-admin invitation, rename; refused in single mode (409
//     TENANCY_SINGLE_ORG) and to anyone without the system permission;
//   - `/api/org/members` and `/api/org/invites` (org `org_members:*` /
//     `org_invites:*`): every query is scoped to the ACTIVE org of the token
//     (`org-default` here, "org A"), never to an org id from the request, so
//     a member of another org ("org B") is a 404 through every route;
//   - the last-admin (409) and self-protection (403) rules, and the
//     revocation of the removed member's org-bound credentials.
//
// The real-row version of the whole flow (create B, invitee signs in as its
// org_admin, invites, role change, suspend, remove) is
// `org-admin-flow.db.spec.ts`.
// =============================================================================

import request from 'supertest';

import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { authHeader, createMockTestUser, type TestUser } from '../helpers/auth-mock.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID, mockRoles } from '../fixtures/test-data.factory';

const ORG_A = MOCK_DEFAULT_ORG_ID;
const ORG_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const MEMBER_OF_B = '11111111-1111-4111-8111-111111111111';
const MEMBER_OF_A = '22222222-2222-4222-8222-222222222222';
const INVITE_OF_B = '33333333-3333-4333-8333-333333333333';

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

function membership(orgId: string, userId: string, roleName: 'org_admin' | 'contributor' | 'viewer', status = 'active') {
  return {
    id: `m-${orgId}-${userId}`,
    orgId,
    userId,
    status,
    roleId: mockRoles[roleName].id,
    lastActiveAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    user: { id: userId, email: `${userId.slice(0, 4)}@example.com`, displayName: null, providerDisplayName: null },
    role: { id: mockRoles[roleName].id, name: roleName },
  };
}

function orgRow(id: string, name: string, slug: string, isDefault = false) {
  return {
    id,
    name,
    slug,
    isDefault,
    createdById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    _count: { memberships: 1 },
  };
}

/** The audit actions written so far. */
function auditActions(context: TestContext): string[] {
  return context.prismaMock.auditEvent.create.mock.calls.map(([args]: [{ data: { action: string } }]) => args.data.action);
}

describe('Org administration API, TENANCY_MODE=multi (#726)', () => {
  let context: TestContext;
  let orgAdmin: TestUser;
  let systemAdmin: TestUser;

  beforeAll(async () => {
    context = await bootWith('multi');
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([]);
    // An org admin of org A who is NOT a deployment operator, and a system
    // administrator (who also holds org_admin in org A).
    orgAdmin = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'org_admin', email: 'orgadmin@example.com' });
    systemAdmin = await createMockTestUser(context, {
      systemRoles: ['admin'],
      orgRoleName: 'org_admin',
      email: 'sysadmin@example.com',
    });
  });

  const http = () => request(context.app.getHttpServer());

  describe('/api/admin/organizations (system organizations:*)', () => {
    it('is refused (403) to an org admin without the system permission', async () => {
      await http().get('/api/admin/organizations').set(authHeader(orgAdmin.accessToken)).expect(403);
      await http()
        .post('/api/admin/organizations')
        .set(authHeader(orgAdmin.accessToken))
        .send({ name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' })
        .expect(403);
    });

    it('lists organizations with member counts for a system admin', async () => {
      context.prismaMock.organization.findMany.mockResolvedValue([orgRow(ORG_A, 'Default organization', 'default', true)]);
      context.prismaMock.organization.count.mockResolvedValue(1);

      const res = await http().get('/api/admin/organizations').set(authHeader(systemAdmin.accessToken)).expect(200);

      expect(res.body.data).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(res.body.data.items[0]).toMatchObject({ id: ORG_A, isDefault: true, memberCount: 1 });
    });

    it('creates org B with a pending org_admin invitation for the first admin, audited', async () => {
      context.prismaMock.organization.create.mockResolvedValue(orgRow(ORG_B, 'Beta', 'beta'));
      context.prismaMock.organization.findUnique.mockResolvedValue(orgRow(ORG_B, 'Beta', 'beta'));
      context.prismaMock.membership.findFirst.mockResolvedValue(null);
      context.prismaMock.invite.findUnique.mockResolvedValue(null);
      context.prismaMock.invite.upsert.mockImplementation(async ({ create }: any) => ({ id: INVITE_OF_B, ...create }));
      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(null);
      context.prismaMock.allowedEmail.create.mockResolvedValue({ id: 'allowed-1' });

      const res = await http()
        .post('/api/admin/organizations')
        .set(authHeader(systemAdmin.accessToken))
        .send({ name: 'Beta', slug: 'beta', firstAdminEmail: 'First@Example.com' })
        .expect(201);

      expect(res.body.data).toMatchObject({ id: ORG_B, name: 'Beta', slug: 'beta', isDefault: false });
      expect(context.prismaMock.organization.create).toHaveBeenCalledWith({
        data: { name: 'Beta', slug: 'beta', createdById: systemAdmin.id },
      });
      const upsert = context.prismaMock.invite.upsert.mock.calls[0][0];
      expect(upsert.create).toMatchObject({ orgId: ORG_B, email: 'first@example.com', status: 'pending', roleId: mockRoles.org_admin.id });
      expect(context.prismaMock.allowedEmail.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: 'first@example.com' }),
      });
      expect(auditActions(context)).toEqual(['org:created', 'allowlist:add', 'org:invite_created']);
    });

    it('renames an organization and refuses a slug change (400)', async () => {
      context.prismaMock.organization.findUnique
        .mockResolvedValueOnce({ id: ORG_B, name: 'Beta' })
        .mockResolvedValueOnce(orgRow(ORG_B, 'Beta Inc', 'beta'));

      const res = await http()
        .patch(`/api/admin/organizations/${ORG_B}`)
        .set(authHeader(systemAdmin.accessToken))
        .send({ name: 'Beta Inc' })
        .expect(200);
      expect(res.body.data.name).toBe('Beta Inc');
      expect(auditActions(context)).toContain('org:renamed');

      await http()
        .patch(`/api/admin/organizations/${ORG_B}`)
        .set(authHeader(systemAdmin.accessToken))
        .send({ name: 'Beta', slug: 'other' })
        .expect(400);
    });
  });

  describe('/api/org/members (org_members:*) acts on the active org only', () => {
    it.each(['contributor', 'viewer'] as const)('is refused (403) to a %s', async (orgRoleName) => {
      const member = await createMockTestUser(context, { systemRoles: [], orgRoleName });
      await http().get('/api/org/members').set(authHeader(member.accessToken)).expect(403);
      await http().get('/api/org/invites').set(authHeader(member.accessToken)).expect(403);
    });

    it("lists the active org's members, whatever org id the query names", async () => {
      context.prismaMock.membership.findMany.mockResolvedValue([membership(ORG_A, MEMBER_OF_A, 'contributor')]);
      context.prismaMock.membership.count.mockResolvedValue(1);

      const res = await http()
        .get(`/api/org/members?orgId=${ORG_B}`)
        .set(authHeader(orgAdmin.accessToken))
        .expect(200);

      expect(res.body.data.items).toEqual([
        expect.objectContaining({ userId: MEMBER_OF_A, role: 'contributor', status: 'active' }),
      ]);
      const where = context.prismaMock.membership.findMany.mock.calls.at(-1)[0].where;
      expect(where.orgId).toBe(ORG_A);
    });

    it("cannot read or change org B's members through any route (404)", async () => {
      context.prismaMock.membership.findUnique.mockImplementation(async ({ where }: any) =>
        where.orgId_userId.orgId === ORG_B && where.orgId_userId.userId === MEMBER_OF_B
          ? membership(ORG_B, MEMBER_OF_B, 'org_admin')
          : null,
      );

      await http()
        .patch(`/api/org/members/${MEMBER_OF_B}`)
        .set(authHeader(orgAdmin.accessToken))
        .send({ roleName: 'viewer' })
        .expect(404);
      await http().delete(`/api/org/members/${MEMBER_OF_B}`).set(authHeader(orgAdmin.accessToken)).expect(404);

      for (const [args] of context.prismaMock.membership.findUnique.mock.calls) {
        if (args?.where?.orgId_userId?.userId === MEMBER_OF_B) expect(args.where.orgId_userId.orgId).toBe(ORG_A);
      }
      expect(context.prismaMock.membership.update).not.toHaveBeenCalled();
      expect(context.prismaMock.membership.delete).not.toHaveBeenCalled();
    });

    it("cannot list, revoke or create org B's invitations (404, scoped list, no org id in the body)", async () => {
      context.prismaMock.invite.findFirst.mockImplementation(async ({ where }: any) =>
        where.orgId === ORG_B && where.id === INVITE_OF_B ? { id: INVITE_OF_B, status: 'pending', email: 'x@example.com' } : null,
      );
      context.prismaMock.invite.findMany.mockResolvedValue([]);
      context.prismaMock.invite.count.mockResolvedValue(0);

      await http().delete(`/api/org/invites/${INVITE_OF_B}`).set(authHeader(orgAdmin.accessToken)).expect(404);
      await http().get('/api/org/invites').set(authHeader(orgAdmin.accessToken)).expect(200);
      expect(context.prismaMock.invite.findMany.mock.calls.at(-1)[0].where).toEqual({ orgId: ORG_A });
      await http()
        .post('/api/org/invites')
        .set(authHeader(orgAdmin.accessToken))
        .send({ email: 'someone@example.com', roleName: 'viewer', orgId: ORG_B })
        .expect(400);
      expect(context.prismaMock.invite.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'revoked' } }),
      );
    });

    it('invites a contributor into the active org, audited, with an allowlist entry', async () => {
      context.prismaMock.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Default organization' });
      context.prismaMock.membership.findFirst.mockResolvedValue(null);
      context.prismaMock.invite.findUnique.mockResolvedValue(null);
      context.prismaMock.invite.upsert.mockImplementation(async ({ create }: any) => ({ id: INVITE_OF_B, ...create }));
      context.prismaMock.invite.findUniqueOrThrow.mockResolvedValue({
        id: INVITE_OF_B,
        orgId: ORG_A,
        email: 'new@example.com',
        status: 'pending',
        notes: null,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        acceptedAt: null,
        role: { name: 'contributor' },
        invitedBy: { id: orgAdmin.id, email: orgAdmin.email },
        acceptedBy: null,
      });
      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(null);
      context.prismaMock.allowedEmail.create.mockResolvedValue({ id: 'allowed-2' });

      const res = await http()
        .post('/api/org/invites')
        .set(authHeader(orgAdmin.accessToken))
        .send({ email: 'New@Example.com', roleName: 'contributor' })
        .expect(201);

      expect(res.body.data).toMatchObject({ email: 'new@example.com', role: 'contributor', status: 'pending' });
      expect(context.prismaMock.invite.upsert.mock.calls[0][0].where).toEqual({
        orgId_email: { orgId: ORG_A, email: 'new@example.com' },
      });
      expect(auditActions(context)).toEqual(['allowlist:add', 'org:invite_created']);
    });

    it('changes a role and suspends a member, auditing each write', async () => {
      context.prismaMock.membership.findUnique.mockResolvedValue(membership(ORG_A, MEMBER_OF_A, 'viewer'));
      context.prismaMock.membership.update
        .mockResolvedValueOnce(membership(ORG_A, MEMBER_OF_A, 'contributor'))
        .mockResolvedValueOnce(membership(ORG_A, MEMBER_OF_A, 'viewer', 'suspended'));

      const role = await http()
        .patch(`/api/org/members/${MEMBER_OF_A}`)
        .set(authHeader(orgAdmin.accessToken))
        .send({ roleName: 'contributor' })
        .expect(200);
      expect(role.body.data.role).toBe('contributor');

      const suspended = await http()
        .patch(`/api/org/members/${MEMBER_OF_A}`)
        .set(authHeader(orgAdmin.accessToken))
        .send({ status: 'suspended' })
        .expect(200);
      expect(suspended.body.data.status).toBe('suspended');
      expect(auditActions(context)).toEqual(['org:member_updated', 'org:member_updated']);
    });

    it('removes a member and revokes their refresh tokens, PATs and device sessions bound to the org', async () => {
      context.prismaMock.membership.findUnique.mockResolvedValue(membership(ORG_A, MEMBER_OF_A, 'contributor'));
      context.prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      context.prismaMock.personalAccessToken.updateMany.mockResolvedValue({ count: 1 });
      context.prismaMock.deviceCode.updateMany.mockResolvedValue({ count: 0 });

      await http().delete(`/api/org/members/${MEMBER_OF_A}`).set(authHeader(orgAdmin.accessToken)).expect(204);

      for (const delegate of ['refreshToken', 'personalAccessToken', 'deviceCode']) {
        expect(context.prismaMock[delegate].updateMany).toHaveBeenCalledWith({
          where: { userId: MEMBER_OF_A, orgId: ORG_A, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      }
      expect(auditActions(context)).toEqual(['org:member_removed']);
    });

    it('refuses to demote or remove the last active org_admin (409) and to demote yourself (403)', async () => {
      context.prismaMock.membership.findUnique.mockResolvedValue(membership(ORG_A, MEMBER_OF_A, 'org_admin'));
      context.prismaMock.membership.count.mockResolvedValue(0);

      const demote = await http()
        .patch(`/api/org/members/${MEMBER_OF_A}`)
        .set(authHeader(orgAdmin.accessToken))
        .send({ roleName: 'viewer' })
        .expect(409);
      expect(demote.body.details).toEqual({ reason: 'LAST_ORG_ADMIN' });
      await http().delete(`/api/org/members/${MEMBER_OF_A}`).set(authHeader(orgAdmin.accessToken)).expect(409);

      context.prismaMock.membership.findUnique.mockResolvedValue(membership(ORG_A, orgAdmin.id, 'org_admin'));
      await http()
        .patch(`/api/org/members/${orgAdmin.id}`)
        .set(authHeader(orgAdmin.accessToken))
        .send({ roleName: 'viewer' })
        .expect(403);
      await http().delete(`/api/org/members/${orgAdmin.id}`).set(authHeader(orgAdmin.accessToken)).expect(403);

      expect(context.prismaMock.membership.update).not.toHaveBeenCalled();
      expect(context.prismaMock.membership.delete).not.toHaveBeenCalled();
    });
  });

  it('reports tenancyMode multi and the active org on GET /api/auth/me', async () => {
    const res = await http().get('/api/auth/me').set(authHeader(orgAdmin.accessToken)).expect(200);
    expect(res.body.data.tenancyMode).toBe('multi');
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(['org_members:read', 'org_invites:write']));
    expect(res.body.data.permissions).not.toContain('organizations:read');
  });
});

describe('Org administration API, TENANCY_MODE=single (#726)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await bootWith('single');
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  it('refuses POST /api/admin/organizations with 409 TENANCY_SINGLE_ORG', async () => {
    const admin = await createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin' });

    const res = await request(context.app.getHttpServer())
      .post('/api/admin/organizations')
      .set(authHeader(admin.accessToken))
      .send({ name: 'Beta', slug: 'beta', firstAdminEmail: 'first@example.com' })
      .expect(409);

    expect(res.body.details).toEqual({ reason: 'TENANCY_SINGLE_ORG' });
    expect(context.prismaMock.organization.create).not.toHaveBeenCalled();
  });

  it('still serves the member list (the UI hides it; the API enforces the permission)', async () => {
    const admin = await createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin' });
    context.prismaMock.membership.findMany.mockResolvedValue([]);
    context.prismaMock.membership.count.mockResolvedValue(0);

    await request(context.app.getHttpServer()).get('/api/org/members').set(authHeader(admin.accessToken)).expect(200);
  });
});

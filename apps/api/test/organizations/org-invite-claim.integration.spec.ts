// =============================================================================
// Invitation claim at sign-in, through the real AppModule (#726, PP-6.7)
// =============================================================================
//
// Boots the application with TENANCY_MODE=multi and the mock Google strategy,
// and drives the OAuth callback for an invitee who has no account yet:
//
//   - a pending invitation is claimed BEFORE the "no organization" check, so
//     the first sign-in succeeds, the membership gets the invitation's role
//     and the access token is bound to the invited organization;
//   - an expired invitation is marked `expired` and grants nothing, so the
//     sign-in is refused with `no_organization`, as with no invitation.
//
// Prisma is mocked; `org-admin-flow.db.spec.ts` drives the same claim against
// real rows.
// =============================================================================

import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { MockGoogleStrategy } from '../mocks/google-oauth.mock';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { mockRoles } from '../fixtures/test-data.factory';

const ORG_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const INVITEE = { id: 'google-invitee', email: 'invitee@example.test', displayName: 'Invitee' };
const USER_ID = 'user-invitee';

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-b',
    orgId: ORG_B,
    email: INVITEE.email,
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
    roleId: mockRoles.org_admin.id,
    role: { id: mockRoles.org_admin.id, name: 'org_admin' },
    ...overrides,
  };
}

describe('Invitation claim at sign-in, TENANCY_MODE=multi (#726)', () => {
  let context: TestContext;

  beforeAll(async () => {
    const saved = process.env.TENANCY_MODE;
    process.env.TENANCY_MODE = 'multi';
    try {
      context = await createTestApp({ useMockDatabase: true });
      new MockGoogleStrategy();
    } finally {
      if (saved === undefined) delete process.env.TENANCY_MODE;
      else process.env.TENANCY_MODE = saved;
    }
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    MockGoogleStrategy.resetMockProfile();
    MockGoogleStrategy.setMockProfile(INVITEE);

    // A brand-new user whose address the invitation allowlisted.
    const created = {
      id: USER_ID,
      email: INVITEE.email,
      isActive: true,
      displayName: null,
      providerDisplayName: null,
      providerProfileImageUrl: null,
      userRoles: [],
      memberships: [],
    };
    context.prismaMock.userIdentity.findUnique.mockResolvedValue(null);
    context.prismaMock.allowedEmail.findUnique.mockResolvedValue({ id: 'allow-1', email: INVITEE.email, claimedById: null });
    context.prismaMock.allowedEmail.update.mockResolvedValue({});
    context.prismaMock.user.create.mockResolvedValue(created);
    context.prismaMock.user.update.mockResolvedValue(created);
    context.prismaMock.refreshToken.create.mockResolvedValue({});
    context.prismaMock.role.findUnique.mockImplementation(async ({ where }: { where: { name?: string } }) =>
      where.name === 'admin'
        ? { ...mockRoles.admin, userRoles: [{ user: { isActive: true } }] }
        : { ...mockRoles.viewer, rolePermissions: [] },
    );
  });

  async function callback(): Promise<URL> {
    const response = await request(context.app.getHttpServer()).get('/api/auth/google/callback').expect(302);
    return new URL(response.headers.location);
  }

  it('claims the invitation, signs the invitee in as org_admin of the invited org, and marks it accepted', async () => {
    context.prismaMock.invite.findMany.mockResolvedValue([inviteRow()]);
    context.prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    context.prismaMock.membership.count.mockResolvedValue(1);
    context.prismaMock.membership.create.mockResolvedValue({ id: 'm-b' });
    // Before the claim: no user. After it: the reloaded graph with the membership.
    context.prismaMock.user.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === USER_ID
        ? {
            id: USER_ID,
            email: INVITEE.email,
            isActive: true,
            userRoles: [],
            memberships: [
              {
                orgId: ORG_B,
                status: 'active',
                lastActiveAt: new Date(),
                createdAt: new Date(),
                org: { id: ORG_B, isDefault: false },
                role: { ...mockRoles.org_admin, rolePermissions: [] },
              },
            ],
          }
        : null,
    );

    const location = await callback();

    expect(location.searchParams.get('error')).toBeNull();
    const token = location.searchParams.get('token');
    expect(token).toBeTruthy();
    expect(context.module.get(JwtService).decode(token!)).toMatchObject({ sub: USER_ID, org: ORG_B });

    expect(context.prismaMock.invite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: INVITEE.email, status: 'pending' } }),
    );
    expect(context.prismaMock.membership.create).toHaveBeenCalledWith({
      data: { orgId: ORG_B, userId: USER_ID, roleId: mockRoles.org_admin.id, lastActiveAt: expect.any(Date) },
    });
    expect(context.prismaMock.invite.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-b', status: 'pending' },
      data: { status: 'accepted', acceptedById: USER_ID, acceptedAt: expect.any(Date) },
    });
    expect(context.prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'org:invite_accepted', targetId: 'invite-b' }),
    });
    expect(context.prismaMock.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID, orgId: ORG_B }),
    });
  });

  it('marks an expired invitation expired and refuses the sign-in with no_organization', async () => {
    context.prismaMock.user.findUnique.mockResolvedValue(null);
    context.prismaMock.invite.findMany.mockResolvedValue([inviteRow({ expiresAt: new Date(Date.now() - 1000) })]);
    context.prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    context.prismaMock.membership.count.mockResolvedValue(0);

    const location = await callback();

    expect(location.searchParams.get('error')).toBe('no_organization');
    expect(context.prismaMock.invite.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-b', status: 'pending' },
      data: { status: 'expired' },
    });
    expect(context.prismaMock.membership.create).not.toHaveBeenCalled();
  });

  it('refuses an address with no invitation, exactly as before', async () => {
    context.prismaMock.user.findUnique.mockResolvedValue(null);
    context.prismaMock.invite.findMany.mockResolvedValue([]);
    context.prismaMock.membership.count.mockResolvedValue(0);

    const location = await callback();

    expect(location.searchParams.get('error')).toBe('no_organization');
  });
});

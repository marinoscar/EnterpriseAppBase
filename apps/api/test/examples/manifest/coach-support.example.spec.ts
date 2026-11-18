// =============================================================================
// An app adds roles, assigns them end to end and grants them a platform
// permission, without touching a package (PP-14.15)
// =============================================================================
//
// `coach` (an org role) and `support` (a system role granted `users:read`) are
// declared in `src/platform-extensions/identity/coach-support.roles.ts`. This
// suite drives them through the REAL application (the real controllers, guards
// and services over a mocked Prisma):
//
//   1. the seed catalog an app with those roles renders: the grant is in
//      `rolePermissions` (what `seedPlatform` writes into `role_permissions`
//      and the permission resolver reads back), and every platform role's grants
//      are byte-for-byte what the platform declares;
//   2. `GET /api/roles`: the roles with their labels and `assignable` flag,
//      `users:read` for `system`, `org_members:read` for `org`;
//   3. an organization administrator invites someone as `coach` and moves a
//      member to it, and is refused (400 ROLE_NOT_ASSIGNABLE) for `admin`, for a
//      role registered `assignable: false` and for a role nobody registered;
//   4. an administrator gives a user `support`; that user can GET /api/users and
//      nothing else the platform gates.
//
// The roles are registered for the duration of each case with
// `withTemporaryEntries`: the reference app keeps `APP_ROLES` empty, so its
// committed seed catalog stays what it is.
// =============================================================================

import request from 'supertest';

// Fills the role and permission registries, as the application does at start-up.
import '../../../src/common/permissions/permission.manifest';

import {
  buildPermissionCatalog,
  grantPermissions,
  roleGrantRegistry,
  roleRegistry,
  withTemporaryEntries,
} from '@marinoscar/platform-api/core';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';

import {
  COACH_SUPPORT_GRANTS,
  COACH_SUPPORT_ROLES,
} from '../../../src/platform-extensions/identity/coach-support.roles';
import { TestContext, closeTestApp, createTestApp } from '../../helpers/test-app.helper';
import { authHeader, createMockTestUser, type TestUser } from '../../helpers/auth-mock.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';
import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID, mockPermissions, mockRoles } from '../../fixtures/test-data.factory';

const ORG_A = MOCK_DEFAULT_ORG_ID;
const INVITE_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

const ROW = {
  coach: { id: 'role-coach', name: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org' },
  support: { id: 'role-support', name: 'support', description: 'Reads the user list', scope: 'system' },
  'service-bot': { id: 'role-service-bot', name: 'service-bot', description: 'Held by the application', scope: 'org' },
} as const;

/** Runs `fn` with the example roles and grants registered, as an app that copied them into its registrations. */
async function withExampleRoles<T>(fn: () => Promise<T> | T): Promise<T> {
  return withTemporaryEntries(roleRegistry, [...COACH_SUPPORT_ROLES], () =>
    withTemporaryEntries(roleGrantRegistry, [], async () => {
      grantPermissions([...COACH_SUPPORT_GRANTS]);
      return fn();
    }),
  );
}

describe('the seed catalog of an app with the example roles', () => {
  const baseline = platformPermissionCatalog();
  const withExample = platformPermissionCatalog({
    app: { roles: [COACH_SUPPORT_ROLES], grants: COACH_SUPPORT_GRANTS },
  });

  it('adds the roles after the platform ones and holds the grant in rolePermissions', () => {
    expect(withExample.roles.map((role) => role.name)).toEqual([
      ...baseline.roles.map((role) => role.name),
      'coach',
      'support',
      'service-bot',
    ]);
    expect(withExample.roles.find((role) => role.name === 'support')).toEqual({
      name: 'support',
      description: 'Reads the user list to help people; changes nothing',
      scope: 'system',
    });
    expect(withExample.rolePermissions.support).toEqual(['users:read']);
    expect(withExample.rolePermissions.coach).toEqual([]);
    expect(withExample.rolePermissions['service-bot']).toEqual([]);
  });

  it('leaves every platform role, permission and grant exactly as the platform declares them', () => {
    expect(withExample.permissions).toEqual(baseline.permissions);
    for (const role of baseline.roles) {
      expect(withExample.rolePermissions[role.name]).toEqual(baseline.rolePermissions[role.name]);
    }
  });

  it('is the catalog the static registries build once the roles and the grant are registered', async () => {
    await withExampleRoles(() => {
      expect(roleGrantRegistry.ids()).toEqual(['support|users:read']);
      // The grant was validated against the registered roles and permissions,
      // and the catalog built from the registries carries it.
      expect(buildPermissionCatalog().rolePermissions.support).toEqual(['users:read']);
    });
  });
});

describe('the example roles through the real application', () => {
  let context: TestContext;
  let orgAdmin: TestUser;
  let systemAdmin: TestUser;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    context.prismaMock.$queryRaw.mockResolvedValue([]);
    orgAdmin = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'org_admin', email: 'orgadmin@example.com' });
    systemAdmin = await createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin', email: 'sysadmin@example.com' });
    // The database holds a row for every registered role: the seed wrote them.
    const find = context.prismaMock.role.findUnique.getMockImplementation() as (args: any) => Promise<unknown>;
    context.prismaMock.role.findUnique.mockImplementation(async (args: any) => (ROW as Record<string, unknown>)[args.where.name] ?? find(args));
    context.prismaMock.role.findMany.mockImplementation(async ({ where }: any) => {
      const names: string[] = where?.name?.in ?? [];
      return names.map((name) => (ROW as Record<string, unknown>)[name] ?? (mockRoles as Record<string, unknown>)[name]).filter(Boolean);
    });
  });

  const http = () => request(context.app.getHttpServer());

  /** A user who holds the `support` system role, with the permissions the seed would write for it. */
  async function supportUser(): Promise<TestUser> {
    const user = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'viewer', email: 'support@example.com' });
    const grants = platformPermissionCatalog({ app: { roles: [COACH_SUPPORT_ROLES], grants: COACH_SUPPORT_GRANTS } }).rolePermissions.support!;
    const rolePermissions = grants.map((name) => {
      const permission = Object.values(mockPermissions).find((candidate) => candidate.name === name)!;
      return { roleId: ROW.support.id, permissionId: permission.id, permission };
    });
    const previous = context.prismaMock.user.findUnique.getMockImplementation() as (args: any) => Promise<any>;
    context.prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      const found = await previous(args);
      if (!found || found.id !== user.id) return found;
      return { ...found, userRoles: [{ userId: user.id, roleId: ROW.support.id, role: { ...ROW.support, rolePermissions } }] };
    });
    return user;
  }

  describe('GET /api/roles', () => {
    it('lists the org roles with labels and the assignable flag for org_members:read', async () => {
      await withExampleRoles(async () => {
        const res = await http().get('/api/roles?scope=org').set(authHeader(orgAdmin.accessToken)).expect(200);

        expect(res.body.data.map((role: { id: string }) => role.id)).toEqual(['contributor', 'viewer', 'org_admin', 'coach', 'service-bot']);
        expect(res.body.data.find((role: { id: string }) => role.id === 'coach')).toEqual({
          id: 'coach',
          label: 'Coach',
          description: 'Reviews the workouts of assigned athletes',
          scope: 'org',
          assignable: true,
        });
        expect(res.body.data.find((role: { id: string }) => role.id === 'service-bot').assignable).toBe(false);
      });
    });

    it('refuses the system scope to someone without users:read, and lists it for an administrator', async () => {
      await withExampleRoles(async () => {
        await http().get('/api/roles?scope=system').set(authHeader(orgAdmin.accessToken)).expect(403);

        const res = await http().get('/api/roles?scope=system').set(authHeader(systemAdmin.accessToken)).expect(200);
        expect(res.body.data.map((role: { id: string }) => role.id)).toEqual(['admin', 'support']);
      });
    });

    it('needs authentication, and a plain member holds neither permission', async () => {
      await http().get('/api/roles').expect(401);
      const member = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'viewer', email: 'viewer@example.com' });
      await http().get('/api/roles').set(authHeader(member.accessToken)).expect(403);
    });
  });

  describe('inviting and moving members', () => {
    beforeEach(() => {
      context.prismaMock.organization.findUnique.mockResolvedValue({ id: ORG_A, name: 'Default organization' });
      context.prismaMock.membership.findFirst.mockResolvedValue(null);
      context.prismaMock.invite.findUnique.mockResolvedValue(null);
      context.prismaMock.invite.upsert.mockImplementation(async ({ create }: any) => ({ id: INVITE_ID, ...create }));
      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(null);
      context.prismaMock.allowedEmail.create.mockResolvedValue({ id: 'allowed-1' });
      context.prismaMock.invite.findUniqueOrThrow.mockImplementation(async () => ({
        id: INVITE_ID,
        orgId: ORG_A,
        email: 'new@example.com',
        status: 'pending',
        notes: null,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        acceptedAt: null,
        role: { name: 'coach' },
        invitedBy: { id: orgAdmin.id, email: orgAdmin.email },
        acceptedBy: null,
      }));
    });

    it('invites someone as a coach', async () => {
      await withExampleRoles(async () => {
        const res = await http()
          .post('/api/org/invites')
          .set(authHeader(orgAdmin.accessToken))
          .send({ email: 'New@Example.com', roleName: 'coach' })
          .expect(201);

        expect(res.body.data).toMatchObject({ email: 'new@example.com', role: 'coach', status: 'pending' });
        expect(context.prismaMock.invite.upsert.mock.calls[0][0].create).toMatchObject({ orgId: ORG_A, roleId: ROW.coach.id });
      });
    });

    it.each([
      ['the system admin role', 'admin'],
      ['a role registered assignable: false', 'service-bot'],
      ['a system role', 'support'],
      ['a role nobody registered', 'ghost'],
    ])('refuses to invite as %s (400 ROLE_NOT_ASSIGNABLE) and writes nothing', async (_name, roleName) => {
      await withExampleRoles(async () => {
        const res = await http()
          .post('/api/org/invites')
          .set(authHeader(orgAdmin.accessToken))
          .send({ email: 'new@example.com', roleName })
          .expect(400);

        expect(res.body).toMatchObject({ statusCode: 400, code: 'ROLE_NOT_ASSIGNABLE' });
        expect(res.body.details).toMatchObject({ reason: 'ROLE_NOT_ASSIGNABLE', role: roleName });
      });
      expect(context.prismaMock.invite.upsert).not.toHaveBeenCalled();
      expect(context.prismaMock.allowedEmail.create).not.toHaveBeenCalled();
    });

    it('moves a member to coach, and refuses an unassignable role', async () => {
      const member = (role: { id: string; name: string }) => ({
        id: 'm-1',
        orgId: ORG_A,
        userId: MEMBER_ID,
        status: 'active',
        roleId: role.id,
        lastActiveAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        user: { id: MEMBER_ID, email: 'member@example.com', displayName: null, providerDisplayName: null },
        role,
      });
      context.prismaMock.membership.findUnique.mockResolvedValue(member(mockRoles.viewer));
      context.prismaMock.membership.update.mockResolvedValue(member(ROW.coach));

      await withExampleRoles(async () => {
        const moved = await http()
          .patch(`/api/org/members/${MEMBER_ID}`)
          .set(authHeader(orgAdmin.accessToken))
          .send({ roleName: 'coach' })
          .expect(200);
        expect(moved.body.data.role).toBe('coach');

        context.prismaMock.membership.update.mockClear();
        const refused = await http()
          .patch(`/api/org/members/${MEMBER_ID}`)
          .set(authHeader(orgAdmin.accessToken))
          .send({ roleName: 'service-bot' })
          .expect(400);
        expect(refused.body.code).toBe('ROLE_NOT_ASSIGNABLE');
        expect(refused.body.details.reason).toBe('ROLE_NOT_ASSIGNABLE');
        expect(context.prismaMock.membership.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('the support role', () => {
    it('can list users (users:read, granted to the app role) and nothing else the platform gates', async () => {
      const support = await supportUser();
      context.prismaMock.user.findMany.mockResolvedValue([]);
      context.prismaMock.user.count.mockResolvedValue(0);

      await http().get('/api/users').set(authHeader(support.accessToken)).expect(200);

      // users:read only: no write, no settings, no organization surface.
      await http().put(`/api/users/${MEMBER_ID}/roles`).set(authHeader(support.accessToken)).send({ roleNames: ['viewer'] }).expect(403);
      await http().patch(`/api/users/${MEMBER_ID}`).set(authHeader(support.accessToken)).send({ isActive: false }).expect(403);
      await http().get('/api/system-settings').set(authHeader(support.accessToken)).expect(403);
      await http().get('/api/org/members').set(authHeader(support.accessToken)).expect(403);
    });

    it('may read the system roles (users:read) and not the org roles', async () => {
      const support = await supportUser();
      await withExampleRoles(async () => {
        const res = await http().get('/api/roles?scope=system').set(authHeader(support.accessToken)).expect(200);
        expect(res.body.data.map((role: { id: string }) => role.id)).toEqual(['admin', 'support']);
        await http().get('/api/roles?scope=org').set(authHeader(support.accessToken)).expect(403);
      });
    });

    it('is given to a user by an administrator, and a role the app manages itself is refused', async () => {
      const target = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'viewer', email: 'target@example.com' });
      await withExampleRoles(async () => {
        const res = await http()
          .put(`/api/users/${target.id}/roles`)
          .set(authHeader(systemAdmin.accessToken))
          .send({ roleNames: ['support'] })
          .expect(200);
        expect(res.body.data.id).toBe(target.id);
        expect(context.prismaMock.userRole.createMany).toHaveBeenCalledWith({
          data: [{ userId: target.id, roleId: ROW.support.id }],
        });

        context.prismaMock.userRole.createMany.mockClear();
        const refused = await http()
          .put(`/api/users/${target.id}/roles`)
          .set(authHeader(systemAdmin.accessToken))
          .send({ roleNames: ['service-bot'] })
          .expect(400);
        expect(refused.body.code).toBe('ROLE_NOT_ASSIGNABLE');
        expect(refused.body.details.reason).toBe('ROLE_NOT_ASSIGNABLE');
        expect(context.prismaMock.userRole.createMany).not.toHaveBeenCalled();
      });
    });
  });
});

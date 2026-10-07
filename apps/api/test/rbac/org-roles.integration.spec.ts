// =============================================================================
// System roles vs org roles through the real guards (issue #723, PP-6.3)
// =============================================================================
//
// The principals here are in the POST-SPLIT shape (system roles in
// `user_roles`, the org role on the default-org membership; see
// `createSplitMockUser` in test/fixtures/test-data.factory.ts), unlike the
// pre-split fixtures the older RBAC suites keep using. What this proves:
//
//   1. An org-only role, `org_admin` included, reaches no route gated by a
//      SYSTEM permission or by the system `admin` role: every such route the
//      OpenAPI document lists answers 403 for it. A customer's org admin is not
//      a deployment operator.
//   2. A split administrator (system `admin` + `org_admin`) is not refused
//      those routes, and `/api/auth/me` reports, for each pre-split role, the
//      same permissions as before (admins: plus the four `org_*`), with
//      `roles` additive.
//   3. `PUT /api/users/:id/roles` in single-org mode maps the legacy role
//      names onto the system role and the membership role, and in multi-org
//      mode refuses an org role name with a 400 pointing at the org endpoints.
// =============================================================================

import request from 'supertest';

import { createOpenApiDocument } from '../../src/openapi/document';
import { forEachOperation, MutableDocument } from '../../src/openapi/types';
import { RBAC_EXTENSION_KEY, type RbacExtension } from '../../src/auth/decorators/auth.decorator';
import { permissionRegistry } from '../../src/common/permissions';
import * as tenancyMode from '../../src/auth/tenancy-mode';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockTestUser, type TestUser } from '../helpers/auth-mock.helper';
import { mockRoles, rolePermissionsMap } from '../fixtures/test-data.factory';

interface GatedRoute {
  path: string;
  method: string;
  permissions: string[];
  roles: string[];
}

const ORG_PERMISSIONS = ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'];

function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
}

function call(context: TestContext, route: { method: string; path: string }, token: string) {
  return request(context.app.getHttpServer())
    [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](concretePath(route.path))
    .set(authHeader(token))
    .send({});
}

describe('System roles vs org roles (Integration, #723)', () => {
  let context: TestContext;
  let systemRoutes: GatedRoute[];

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });

    const systemScoped = new Set(
      permissionRegistry
        .list()
        .filter((entry) => entry.scope === 'system')
        .map((entry) => entry.id),
    );
    const document = createOpenApiDocument(context.app) as unknown as MutableDocument;
    systemRoutes = [];
    forEachOperation(document, (operation, path, method) => {
      const rbac = operation[RBAC_EXTENSION_KEY] as RbacExtension | undefined;
      if (!rbac) return;
      const needsSystem = rbac.permissions.some((permission) => systemScoped.has(permission));
      if (needsSystem || rbac.roles.includes('admin')) {
        systemRoutes.push({ path, method: method.toUpperCase(), permissions: rbac.permissions, roles: rbac.roles });
      }
    });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  it('discovers the system surface, /api/admin/* included', () => {
    expect(systemRoutes.length).toBeGreaterThan(30);
    expect(systemRoutes.some((route) => route.path.startsWith('/api/admin/'))).toBe(true);
    expect(systemRoutes.some((route) => route.roles.includes('admin'))).toBe(true);
  });

  describe.each(['org_admin', 'contributor', 'viewer'] as const)('an org-only %s', (orgRoleName) => {
    it('is refused every route gated by a system permission or the system admin role', async () => {
      const member = await createMockTestUser(context, { systemRoles: [], orgRoleName });
      const admitted: string[] = [];

      for (const route of systemRoutes) {
        const res = await call(context, route, member.accessToken);
        if (res.status !== 403) admitted.push(`${route.method} ${route.path} (${res.status})`);
      }

      expect(admitted).toEqual([]);
    });
  });

  it('org_admin without the system admin role cannot list users or read the system settings', async () => {
    const orgAdmin = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'org_admin' });

    await call(context, { method: 'GET', path: '/api/users' }, orgAdmin.accessToken).expect(403);
    await call(context, { method: 'GET', path: '/api/system-settings' }, orgAdmin.accessToken).expect(403);
    await call(context, { method: 'GET', path: '/api/admin/doctor' }, orgAdmin.accessToken).expect(403);
  });

  it('a split administrator (system admin + org_admin) is admitted to the system surface', async () => {
    const admin = await createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin' });
    context.prismaMock.user.findMany.mockResolvedValue([]);
    context.prismaMock.user.count.mockResolvedValue(0);

    await call(context, { method: 'GET', path: '/api/users' }, admin.accessToken).expect(200);
    await call(context, { method: 'GET', path: '/api/system-settings' }, admin.accessToken).expect(200);

    const refused: string[] = [];
    for (const route of systemRoutes.filter((r) => r.method === 'GET')) {
      const res = await call(context, route, admin.accessToken);
      if (res.status === 403 && res.body?.details === undefined) refused.push(`${route.method} ${route.path}`);
    }
    expect(refused).toEqual([]);
  });

  it('a suspended membership contributes no org permission', async () => {
    const suspended = await createMockTestUser(context, {
      systemRoles: [],
      orgRoleName: 'contributor',
      membershipStatus: 'suspended',
    });

    const res = await request(context.app.getHttpServer())
      .get('/api/auth/me')
      .set(authHeader(suspended.accessToken))
      .expect(200);

    expect(res.body.data.permissions).toEqual([]);
    expect(res.body.data.roles).toEqual([]);
  });

  describe('GET /api/auth/me keeps each legacy role\'s permissions, with roles additive', () => {
    const SPLIT = {
      admin: { systemRoles: ['admin'] as Array<'admin'>, orgRoleName: 'org_admin' as const, roles: ['admin', 'org_admin'] },
      contributor: { systemRoles: [] as Array<'admin'>, orgRoleName: 'contributor' as const, roles: ['contributor'] },
      viewer: { systemRoles: [] as Array<'admin'>, orgRoleName: 'viewer' as const, roles: ['viewer'] },
    };

    it.each(['admin', 'contributor', 'viewer'] as const)('%s', async (legacyRole) => {
      const { roles, ...shape } = SPLIT[legacyRole];
      const user = await createMockTestUser(context, shape);

      const res = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(user.accessToken))
        .expect(200);

      const before = rolePermissionsMap[legacyRole].map((permission) => permission.name);
      const expected = legacyRole === 'admin' ? [...before, ...ORG_PERMISSIONS] : before;
      expect([...res.body.data.permissions].sort()).toEqual([...expected].sort());
      expect(res.body.data.roles.map((role: { name: string }) => role.name)).toEqual(roles);
      expect(roles).toContain(legacyRole);
    });
  });

  describe('PUT /api/users/:id/roles', () => {
    let admin: TestUser;
    let target: TestUser;

    beforeEach(async () => {
      admin = await createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin', email: 'actor@example.com' });
      target = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'viewer', email: 'target@example.com' });
    });

    describe('in single-org mode', () => {
      it('admin: grants the system admin role and org_admin on the default-org membership', async () => {
        await call(context, { method: 'PUT', path: `/api/users/${target.id}/roles` }, admin.accessToken)
          .send({ roleNames: ['admin'] })
          .expect(200);

        expect(context.prismaMock.userRole.createMany).toHaveBeenCalledWith({
          data: [{ userId: target.id, roleId: mockRoles.admin.id }],
        });
        expect(context.prismaMock.membership.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { orgId_userId: { orgId: 'org-default', userId: target.id } },
            update: { roleId: mockRoles.org_admin.id },
          }),
        );
      });

      it('contributor: sets the membership role and holds no system role', async () => {
        await call(context, { method: 'PUT', path: `/api/users/${target.id}/roles` }, admin.accessToken)
          .send({ roleNames: ['contributor'] })
          .expect(200);

        expect(context.prismaMock.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: target.id } });
        expect(context.prismaMock.userRole.createMany).not.toHaveBeenCalled();
        expect(context.prismaMock.membership.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ update: { roleId: mockRoles.contributor.id } }),
        );
      });

      it('keeps the self-demotion guard', async () => {
        await call(context, { method: 'PUT', path: `/api/users/${admin.id}/roles` }, admin.accessToken)
          .send({ roleNames: ['contributor'] })
          .expect(403);
      });
    });

    describe('in multi-org mode', () => {
      let modeSpy: jest.SpyInstance;
      beforeEach(() => {
        modeSpy = jest.spyOn(tenancyMode, 'currentTenancyMode').mockReturnValue('multi');
      });
      afterEach(() => modeSpy.mockRestore());

      it('rejects an org role name with 400 and points to the organization member endpoints', async () => {
        const res = await call(context, { method: 'PUT', path: `/api/users/${target.id}/roles` }, admin.accessToken)
          .send({ roleNames: ['contributor'] })
          .expect(400);

        expect(res.body.message).toMatch(/organization member endpoints/);
        expect(context.prismaMock.membership.upsert).not.toHaveBeenCalled();
        expect(context.prismaMock.userRole.deleteMany).not.toHaveBeenCalled();
      });

      it('changes the system roles only', async () => {
        await call(context, { method: 'PUT', path: `/api/users/${target.id}/roles` }, admin.accessToken)
          .send({ roleNames: ['admin'] })
          .expect(200);

        expect(context.prismaMock.userRole.createMany).toHaveBeenCalledWith({
          data: [{ userId: target.id, roleId: mockRoles.admin.id }],
        });
        expect(context.prismaMock.membership.upsert).not.toHaveBeenCalled();
      });
    });
  });
});

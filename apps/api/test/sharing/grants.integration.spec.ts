// =============================================================================
// /api/grants through the real AppModule, mocked Prisma (#729, PP-7.2)
// =============================================================================
//
// Drives the grant routes over HTTP with the app's own @Auth() (through the
// platform host) and the mock users of the RBAC suites:
//
//   - the RBAC matrix per route, for an org_admin, a contributor, a viewer and
//     an anonymous caller (sharing:read for every org role, sharing:write for
//     org_admin and contributor, sharing:admin for org_admin);
//   - 404 non-disclosure: a caller who may not share a record gets the same
//     body as for a missing one, while sharing:admin (a bypass for `share`)
//     reads its grants;
//   - the shared member-lookup throttle on grants by e-mail (429 with
//     Retry-After), the contract validation, and the shared_with_you
//     notification dispatched only AFTER the transaction committed.
//
// A test-only resource type (`it_doc`) is registered at import, before the
// app bootstraps and freezes the registry. The real-row versions are the
// `*.db.spec.ts` files next to this one.
// =============================================================================

import request from 'supertest';
import { registerResourceType, type ResourceOwnerInfo } from '@marinoscar/platform-api/sharing';

import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { authHeader, createMockTestUser, type TestUser } from '../helpers/auth-mock.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { resetPrismaMock } from '../mocks/prisma.mock';

const ORG = MOCK_DEFAULT_ORG_ID;
const DOC = '66666666-6666-4666-8666-666666666666';
const GRANT = '77777777-7777-4777-8777-777777777777';

/** The records the test type "has": id -> owner and org. */
const owners = new Map<string, ResourceOwnerInfo>();
registerResourceType({
  type: 'it_doc',
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor', share: 'owner' },
  ownership: 'user',
  loadOwners: async (ids) => new Map([...owners].filter(([id]) => ids.includes(id))),
});

type Role = 'org_admin' | 'contributor' | 'viewer';

interface MatrixRow {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: Record<string, unknown>;
  expect: Record<Role | 'anonymous', number>;
}

const createBody = (grantee: Record<string, unknown>) => ({ resourceType: 'it_doc', resourceId: DOC, role: 'viewer', grantee });

describe('/api/grants (#729)', () => {
  let context: TestContext;
  const users: Partial<Record<Role, TestUser>> = {};

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    owners.clear();
    const prisma = context.prismaMock;
    prisma.grant.findMany.mockResolvedValue([]);
    prisma.grant.findFirst.mockResolvedValue(null);
    prisma.grant.count.mockResolvedValue(0);
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.groupMember.findMany.mockResolvedValue([]);
    for (const role of ['org_admin', 'contributor', 'viewer'] as const) {
      users[role] = await createMockTestUser(context, { systemRoles: [], orgRoleName: role, email: `${role}@example.com` });
    }
  });

  const http = () => request(context.app.getHttpServer());

  function send(row: MatrixRow, token?: string) {
    let req = http()[row.method](row.path);
    if (token) req = req.set(authHeader(token));
    return row.body ? req.send(row.body) : req;
  }

  describe('RBAC matrix (the record and the grant do not exist)', () => {
    const MATRIX: MatrixRow[] = [
      { method: 'get', path: `/api/grants?resourceType=it_doc&resourceId=${DOC}`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
      { method: 'post', path: '/api/grants', body: createBody({ kind: 'user', email: 'x@example.com' }), expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
      { method: 'get', path: '/api/grants/shared-with-me', expect: { org_admin: 200, contributor: 200, viewer: 200, anonymous: 401 } },
      { method: 'patch', path: `/api/grants/${GRANT}`, body: { role: 'editor' }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
      // sharing:read on the route (removing your own access); anyone else's grant is a 404.
      { method: 'delete', path: `/api/grants/${GRANT}`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
    ];
    for (const row of MATRIX) {
      it(`${row.method.toUpperCase()} ${row.path.split('?')[0]!.replace(GRANT, ':id')}`, async () => {
        const got: Record<string, number> = {};
        for (const role of ['org_admin', 'contributor', 'viewer'] as const) {
          got[role] = (await send(row, users[role]!.accessToken)).status;
        }
        got.anonymous = (await send(row)).status;
        expect(got).toEqual(row.expect);
      });
    }
  });

  describe('404 non-disclosure', () => {
    it("answers a caller who may not share someone else's record the SAME 404 as a missing record", async () => {
      const missing = await http().get(`/api/grants?resourceType=it_doc&resourceId=${DOC}`).set(authHeader(users.contributor!.accessToken)).expect(404);
      owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.viewer!.id } });
      const denied = await http().get(`/api/grants?resourceType=it_doc&resourceId=${DOC}`).set(authHeader(users.contributor!.accessToken)).expect(404);
      const { timestamp: _t1, ...deniedBody } = denied.body;
      const { timestamp: _t2, ...missingBody } = missing.body;
      expect(deniedBody).toEqual(missingBody);
      // An unknown resource type is the same 404 too, never a 500.
      const unknown = await http().get(`/api/grants?resourceType=nope&resourceId=${DOC}`).set(authHeader(users.contributor!.accessToken)).expect(404);
      expect(unknown.body.message).toBe(missing.body.message);
    });

    it("lets sharing:admin (the share bypass) list the grants of a record it does not own", async () => {
      owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.viewer!.id } });
      const res = await http().get(`/api/grants?resourceType=it_doc&resourceId=${DOC}`).set(authHeader(users.org_admin!.accessToken)).expect(200);
      expect(res.body.data).toMatchObject({ items: [], total: 0, page: 1 });
      expect(context.prismaMock.grant.findMany.mock.calls.at(-1)![0].where).toMatchObject({ orgId: ORG, resourceType: 'it_doc', resourceId: DOC, revokedAt: null });
    });
  });

  it('shares a record, and dispatches sharing.shared_with_you only after the transaction committed', async () => {
    const prisma = context.prismaMock;
    const notifications = context.app.get(NotificationsService);
    const notify = jest.spyOn(notifications, 'notify').mockResolvedValue(undefined);
    owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.contributor!.id } });
    prisma.membership.findFirst.mockResolvedValue({ userId: users.viewer!.id });
    prisma.$queryRaw.mockImplementation(async () => {
      expect(notify).not.toHaveBeenCalled();
      return [{ id: GRANT, inserted: true, previous_role: null, previous_expires_at: null }];
    });
    prisma.grant.findUnique.mockResolvedValue({
      id: GRANT,
      orgId: ORG,
      resourceType: 'it_doc',
      resourceId: DOC,
      granteeKind: 'user',
      granteeUserId: users.viewer!.id,
      granteeGroupId: null,
      role: 'viewer',
      expiresAt: null,
      revokedAt: null,
      grantedById: users.contributor!.id,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      granteeUser: { email: 'viewer@example.com', displayName: null, providerDisplayName: 'Viewer' },
      granteeGroup: null,
    });

    const res = await http().post('/api/grants').set(authHeader(users.contributor!.accessToken)).send(createBody({ kind: 'user', userId: users.viewer!.id })).expect(201);

    expect(res.body.data).toMatchObject({ id: GRANT, role: 'viewer', grantee: { kind: 'user', userId: users.viewer!.id, email: 'viewer@example.com' } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toBe('sharing.shared_with_you');
    expect(notify.mock.calls[0]![1]).toBe(users.viewer!.id);
    expect(prisma.auditEvent.create.mock.calls.map((c: [{ data: { action: string } }]) => c[0].data.action)).toContain('grant:create');
    notify.mockRestore();
  });

  it('validates the body with the contract schema (400): a link grantee is not accepted here', async () => {
    const res = await http().post('/api/grants').set(authHeader(users.contributor!.accessToken)).send(createBody({ kind: 'link' })).expect(400);
    expect(res.body.details.issues.length).toBeGreaterThan(0);
  });

  it('throttles failed grantee lookups by e-mail per account: 429 with Retry-After', async () => {
    owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.contributor!.id } });
    const sharer = users.contributor!;
    for (let i = 0; i < 10; i += 1) {
      const res = await http().post('/api/grants').set(authHeader(sharer.accessToken)).send(createBody({ kind: 'user', email: `nobody${i}@example.com` })).expect(422);
      expect(res.body.details.reason).toBe('NOT_AN_ORG_MEMBER');
    }
    const throttled = await http().post('/api/grants').set(authHeader(sharer.accessToken)).send(createBody({ kind: 'user', email: 'one-more@example.com' })).expect(429);
    expect(throttled.body.details).toMatchObject({ reason: 'LOOKUP_THROTTLED', retryAfterMs: expect.any(Number) });
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('registers sharing.grants.prune with the queue as a server-only type', () => {
    const registry = context.app.get(JobHandlerRegistry);
    expect(registry.serverOnlyTypes()).toContain('sharing.grants.prune');
  });

  it("lists what is shared with me in my active organization only", async () => {
    await http().get('/api/grants/shared-with-me').set(authHeader(users.viewer!.accessToken)).expect(200);
    const where = context.prismaMock.grant.findMany.mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ orgId: ORG, revokedAt: null, resourceType: { in: expect.arrayContaining(['it_doc']) } });
    expect(where.AND[1].OR).toEqual([{ granteeKind: 'user', granteeUserId: users.viewer!.id }]);
  });
});

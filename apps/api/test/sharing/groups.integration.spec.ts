// =============================================================================
// /api/groups through the real AppModule, mocked Prisma (#728, PP-7.1)
// =============================================================================
//
// Drives the sharing slice's routes over HTTP with the app's own @Auth()
// (through the platform host) and the mock users of the RBAC suites:
//
//   - the RBAC matrix per route, for an org_admin, a contributor, a viewer
//     and an anonymous caller (groups:read for every org role, groups:write
//     for org_admin and contributor, groups:admin for org_admin);
//   - 404 non-disclosure: a non-member never learns a group exists, while a
//     groups:admin holder reads it;
//   - the invitee's static routes are reachable although `:id` routes share
//     the prefix (`/api/groups/invites/mine` is never parsed as an id);
//   - the per-account throttle on failed member lookups by e-mail (429 with
//     Retry-After), and atomic creation.
//
// The real-row versions are the `*.db.spec.ts` files next to this one.
// =============================================================================

import request from 'supertest';

import { authHeader, createMockTestUser, type TestUser } from '../helpers/auth-mock.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { resetPrismaMock } from '../mocks/prisma.mock';

const ORG = MOCK_DEFAULT_ORG_ID;
const GROUP = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const INVITE = '55555555-5555-4555-8555-555555555555';

type Role = 'org_admin' | 'contributor' | 'viewer';

function groupRow(extra: Record<string, unknown> = {}) {
  return {
    id: GROUP,
    orgId: ORG,
    name: 'Family',
    description: null,
    metadata: null,
    createdById: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  };
}

/** One route of the matrix and the status each caller gets when the group does not exist. */
interface MatrixRow {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: Record<string, unknown>;
  expect: Record<Role | 'anonymous', number>;
}

const ID = `/api/groups/${GROUP}`;
const MATRIX: MatrixRow[] = [
  { method: 'get', path: '/api/groups', expect: { org_admin: 200, contributor: 200, viewer: 200, anonymous: 401 } },
  { method: 'get', path: '/api/groups?scope=all', expect: { org_admin: 200, contributor: 403, viewer: 403, anonymous: 401 } },
  { method: 'post', path: '/api/groups', body: { name: 'Family' }, expect: { org_admin: 201, contributor: 201, viewer: 403, anonymous: 401 } },
  { method: 'get', path: '/api/groups/invites/mine', expect: { org_admin: 200, contributor: 200, viewer: 200, anonymous: 401 } },
  { method: 'post', path: `/api/groups/invites/${INVITE}/accept`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
  { method: 'post', path: `/api/groups/invites/${INVITE}/decline`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
  { method: 'get', path: ID, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
  { method: 'patch', path: ID, body: { name: 'x' }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  { method: 'delete', path: ID, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  { method: 'get', path: `${ID}/members`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
  { method: 'post', path: `${ID}/members`, body: { userId: OTHER }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  { method: 'patch', path: `${ID}/members/${OTHER}`, body: { role: 'editor' }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  // groups:read on the route (self-leave); removing someone else needs groups:write.
  { method: 'delete', path: `${ID}/members/${OTHER}`, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  { method: 'get', path: `${ID}/invites`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
  { method: 'post', path: `${ID}/invites`, body: { email: 'new@example.com' }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
  { method: 'delete', path: `${ID}/invites/${INVITE}`, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
];

describe('/api/groups (#728)', () => {
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
    const prisma = context.prismaMock;
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.group.count.mockResolvedValue(0);
    prisma.group.findMany.mockResolvedValue([]);
    prisma.group.findFirst.mockResolvedValue(null);
    prisma.groupMember.findUnique.mockResolvedValue(null);
    prisma.groupInvite.findMany.mockResolvedValue([]);
    prisma.groupInvite.findFirst.mockResolvedValue(null);
    prisma.group.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => groupRow(data));
    prisma.groupMember.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data }));
    prisma.auditEvent.create.mockResolvedValue({});
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

  describe('RBAC matrix (the group does not exist)', () => {
    for (const row of MATRIX) {
      it(`${row.method.toUpperCase()} ${row.path.replace(GROUP, ':id').replace(OTHER, ':userId').replace(INVITE, ':inviteId')}`, async () => {
        const got: Record<string, number> = {};
        for (const role of ['org_admin', 'contributor', 'viewer'] as const) {
          got[role] = (await send(row, users[role]!.accessToken)).status;
        }
        got.anonymous = (await send(row)).status;
        expect(got).toEqual(row.expect);
      });
    }
  });

  it('scopes every query to the caller\'s active organization', async () => {
    await http().get('/api/groups').set(authHeader(users.contributor!.accessToken)).expect(200);
    expect(context.prismaMock.group.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG,
      members: { some: { userId: users.contributor!.id } },
    });
  });

  describe('404 non-disclosure', () => {
    beforeEach(() => {
      context.prismaMock.group.findFirst.mockResolvedValue(groupRow());
      context.prismaMock.groupMember.count.mockResolvedValue(2);
    });

    it('answers a non-member 404 (not 403) for an existing group', async () => {
      const res = await http().get(ID).set(authHeader(users.contributor!.accessToken)).expect(404);
      expect(res.body.message).toBe('Group not found');
      await http().get(`${ID}/members`).set(authHeader(users.viewer!.accessToken)).expect(404);
    });

    it('answers a groups:admin holder 200', async () => {
      const res = await http().get(ID).set(authHeader(users.org_admin!.accessToken)).expect(200);
      expect(res.body.data).toMatchObject({ id: GROUP, myRole: null, memberCount: 2 });
    });

    it('answers a member 200 with their role', async () => {
      context.prismaMock.groupMember.findUnique.mockResolvedValue({ role: 'viewer' });
      const res = await http().get(ID).set(authHeader(users.viewer!.accessToken)).expect(200);
      expect(res.body.data.myRole).toBe('viewer');
    });
  });

  it('reaches the static invites routes, never parsing "invites" as a group id', async () => {
    context.prismaMock.groupInvite.findMany.mockResolvedValue([
      {
        id: INVITE,
        groupId: GROUP,
        orgId: ORG,
        email: 'viewer@example.com',
        role: 'editor',
        invitedById: null,
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        group: { name: 'Family' },
      },
    ]);
    const res = await http().get('/api/groups/invites/mine').set(authHeader(users.viewer!.accessToken)).expect(200);
    expect(res.body.data.items).toEqual([expect.objectContaining({ id: INVITE, groupName: 'Family', role: 'editor' })]);
    expect(context.prismaMock.groupInvite.findMany.mock.calls[0][0].where).toMatchObject({ email: 'viewer@example.com' });
    // A non-uuid id on the :id routes is a validation error, not a lookup.
    await http().get('/api/groups/not-a-uuid').set(authHeader(users.viewer!.accessToken)).expect(400);
  });

  it('creates the group and the creator admin membership in one transaction', async () => {
    const res = await http().post('/api/groups').set(authHeader(users.contributor!.accessToken)).send({ name: 'Family' }).expect(201);
    expect(res.body.data).toMatchObject({ name: 'Family', myRole: 'admin', memberCount: 1 });
    expect(context.prismaMock.groupMember.create.mock.calls[0][0].data).toMatchObject({ userId: users.contributor!.id, role: 'admin', orgId: ORG });
    expect(context.prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(context.prismaMock.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'group:created', orgId: ORG });
  });

  it('validates the body with the contract schema (400 with details.issues)', async () => {
    const res = await http().post('/api/groups').set(authHeader(users.contributor!.accessToken)).send({ name: '' }).expect(400);
    expect(res.body.details.issues[0].path).toBe('name');
  });

  it('throttles failed member lookups by e-mail per account: 429 with Retry-After', async () => {
    const prisma = context.prismaMock;
    prisma.group.findFirst.mockResolvedValue(groupRow());
    prisma.groupMember.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.user.findFirst.mockResolvedValue(null);
    const admin = users.contributor!;
    for (let i = 0; i < 10; i += 1) {
      const res = await http().post(`${ID}/members`).set(authHeader(admin.accessToken)).send({ email: `nobody${i}@example.com` }).expect(422);
      expect(res.body.details.reason).toBe('NOT_AN_ORG_MEMBER');
    }
    const throttled = await http().post(`${ID}/members`).set(authHeader(admin.accessToken)).send({ email: 'one-more@example.com' }).expect(429);
    expect(throttled.body.details).toMatchObject({ reason: 'LOOKUP_THROTTLED', retryAfterMs: expect.any(Number) });
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    // Another account is not affected.
    await http().post(`${ID}/members`).set(authHeader(users.org_admin!.accessToken)).send({ email: 'nobody@example.com' }).expect(422);
  });

  it('refuses to demote the last admin with 409 LAST_GROUP_ADMIN', async () => {
    const prisma = context.prismaMock;
    prisma.group.findFirst.mockResolvedValue(groupRow());
    prisma.groupMember.findUnique.mockResolvedValue({
      id: 'm',
      groupId: GROUP,
      orgId: ORG,
      userId: users.contributor!.id,
      role: 'admin',
      addedById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { email: 'contributor@example.com', displayName: null, providerDisplayName: null },
    });
    prisma.groupMember.count.mockResolvedValue(1);
    const res = await http()
      .patch(`${ID}/members/${users.contributor!.id}`)
      .set(authHeader(users.contributor!.accessToken))
      .send({ role: 'viewer' })
      .expect(409);
    expect(res.body.details.reason).toBe('LAST_GROUP_ADMIN');
  });

  it('refuses a PATCH whose If-Match version is stale (409 VERSION_CONFLICT)', async () => {
    const prisma = context.prismaMock;
    prisma.group.findFirst.mockResolvedValue(groupRow({ version: 5 }));
    prisma.groupMember.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.group.updateMany.mockResolvedValue({ count: 0 });
    const res = await http().patch(ID).set(authHeader(users.contributor!.accessToken)).set('If-Match', '4').send({ name: 'New' }).expect(409);
    expect(res.body.details.reason).toBe('VERSION_CONFLICT');
    expect(prisma.group.updateMany.mock.calls[0][0].where.version).toBe(4);
  });
});

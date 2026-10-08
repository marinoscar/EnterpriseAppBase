// =============================================================================
// Org-targeted broadcasts: the RBAC matrix including org scope (issue #738)
// =============================================================================
//
// `/api/admin/broadcasts` is reached by two permission pairs:
//
//   broadcasts:read|write      SYSTEM scope (admin): every broadcast; may
//                              target every user or any one organization
//   org_broadcasts:read|write  ORG scope (org_admin): the caller's ACTIVE
//                              organization only; the target is forced, any
//                              other targetOrgId is a 422, another org's
//                              broadcast is a 404
//
// A caller holding neither is a 403.
// =============================================================================

import request from 'supertest';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { authHeader, createMockTestUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const BROADCAST_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444';

const VALID_BODY = {
  title: 'Planned maintenance on Sunday',
  body: 'The application will be unavailable between 02:00 and 04:00 UTC.',
  channels: ['email', 'browser'],
};

function broadcastRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BROADCAST_ID,
    title: VALID_BODY.title,
    body: VALID_BODY.body,
    link: null,
    ctaLabel: null,
    eventKey: 'admin.broadcast',
    channels: ['email', 'browser'],
    status: 'scheduled',
    scheduledFor: null,
    startedAt: null,
    finishedAt: null,
    canceledAt: null,
    audienceCutoff: null,
    cursorUserId: null,
    recipientsTargeted: null,
    recipientsDispatched: 0,
    lastError: null,
    createdById: null,
    targetOrgId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Org-targeted broadcasts (Integration, #738)', () => {
  let context: TestContext;
  let prisma: any;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  }, 60000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    prisma = context.prismaMock;
    prisma.notificationBroadcast.findMany.mockResolvedValue([]);
    prisma.notificationBroadcast.count.mockResolvedValue(0);
    prisma.notificationBroadcast.findUnique.mockResolvedValue(broadcastRow());
    prisma.notificationBroadcast.create.mockImplementation(async ({ data }: any) => broadcastRow(data));
    prisma.notificationBroadcast.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationDelivery.groupBy.mockResolvedValue([]);
    prisma.auditEvent.create.mockResolvedValue({});
    prisma.user.count.mockResolvedValue(12);
    prisma.job.create.mockResolvedValue({ id: 'job-1' });
    prisma.organization.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === OTHER_ORG_ID ? { id: OTHER_ORG_ID } : null,
    );
  });

  const server = () => context.app.getHttpServer();
  const orgAdmin = () => createMockTestUser(context, { systemRoles: [], orgRoleName: 'org_admin' });
  const systemAdmin = () => createMockTestUser(context, { systemRoles: ['admin'], orgRoleName: 'org_admin' });

  describe('an org_broadcasts holder (org_admin, no system role)', () => {
    it('lists only its active organization\'s broadcasts', async () => {
      const user = await orgAdmin();
      await request(server()).get('/api/admin/broadcasts').set(authHeader(user.accessToken)).expect(200);
      expect(prisma.notificationBroadcast.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ targetOrgId: MOCK_DEFAULT_ORG_ID }) }),
      );
    });

    it('creates a broadcast forced to its active organization', async () => {
      const user = await orgAdmin();
      const response = await request(server())
        .post('/api/admin/broadcasts')
        .set(authHeader(user.accessToken))
        .send(VALID_BODY)
        .expect(201);
      expect(prisma.notificationBroadcast.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ targetOrgId: MOCK_DEFAULT_ORG_ID }),
      });
      expect(response.body.data.broadcast.targetOrgId).toBe(MOCK_DEFAULT_ORG_ID);
    });

    it('is refused with 422 when it names another organization', async () => {
      const user = await orgAdmin();
      await request(server())
        .post('/api/admin/broadcasts')
        .set(authHeader(user.accessToken))
        .send({ ...VALID_BODY, targetOrgId: OTHER_ORG_ID })
        .expect(422);
      expect(prisma.notificationBroadcast.create).not.toHaveBeenCalled();
    });

    it("gets a 404 for another organization's broadcast, on reads and writes", async () => {
      prisma.notificationBroadcast.findUnique.mockResolvedValue(broadcastRow({ targetOrgId: OTHER_ORG_ID }));
      const user = await orgAdmin();
      await request(server()).get(`/api/admin/broadcasts/${BROADCAST_ID}`).set(authHeader(user.accessToken)).expect(404);
      await request(server())
        .post(`/api/admin/broadcasts/${BROADCAST_ID}/cancel`)
        .set(authHeader(user.accessToken))
        .expect(404);
      await request(server()).delete(`/api/admin/broadcasts/${BROADCAST_ID}`).set(authHeader(user.accessToken)).expect(404);
      expect(prisma.notificationBroadcast.updateMany).not.toHaveBeenCalled();
    });

    it('reads its own broadcast', async () => {
      prisma.notificationBroadcast.findUnique.mockResolvedValue(broadcastRow({ targetOrgId: MOCK_DEFAULT_ORG_ID }));
      const user = await orgAdmin();
      await request(server()).get(`/api/admin/broadcasts/${BROADCAST_ID}`).set(authHeader(user.accessToken)).expect(200);
    });

    it("counts its organization's active members as the audience", async () => {
      const user = await orgAdmin();
      await request(server()).get('/api/admin/broadcasts/audience').set(authHeader(user.accessToken)).expect(200);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          isActive: true,
          memberships: { some: { orgId: MOCK_DEFAULT_ORG_ID, status: 'active' } },
        }),
      });
      await request(server())
        .get(`/api/admin/broadcasts/audience?targetOrgId=${OTHER_ORG_ID}`)
        .set(authHeader(user.accessToken))
        .expect(422);
    });
  });

  describe('a broadcasts holder (system admin)', () => {
    it('targets any one organization, which must exist', async () => {
      const user = await systemAdmin();
      await request(server())
        .post('/api/admin/broadcasts')
        .set(authHeader(user.accessToken))
        .send({ ...VALID_BODY, targetOrgId: OTHER_ORG_ID })
        .expect(201);
      expect(prisma.notificationBroadcast.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ targetOrgId: OTHER_ORG_ID }),
      });

      await request(server())
        .post('/api/admin/broadcasts')
        .set(authHeader(user.accessToken))
        .send({ ...VALID_BODY, targetOrgId: '55555555-5555-4555-8555-555555555555' })
        .expect(422);
    });

    it('sends to every active user without a target, as before', async () => {
      const user = await systemAdmin();
      await request(server()).post('/api/admin/broadcasts').set(authHeader(user.accessToken)).send(VALID_BODY).expect(201);
      const [{ data }] = prisma.notificationBroadcast.create.mock.calls[0];
      expect(data).not.toHaveProperty('targetOrgId');
    });

    it("lists every organization's broadcasts and reads any of them", async () => {
      prisma.notificationBroadcast.findUnique.mockResolvedValue(broadcastRow({ targetOrgId: OTHER_ORG_ID }));
      const user = await systemAdmin();
      await request(server()).get('/api/admin/broadcasts').set(authHeader(user.accessToken)).expect(200);
      expect(prisma.notificationBroadcast.findMany.mock.calls[0][0].where).not.toHaveProperty('targetOrgId');
      await request(server()).get(`/api/admin/broadcasts/${BROADCAST_ID}`).set(authHeader(user.accessToken)).expect(200);
    });
  });

  it('refuses a caller holding neither permission pair', async () => {
    const viewer = await createMockViewerUser(context);
    await request(server()).get('/api/admin/broadcasts').set(authHeader(viewer.accessToken)).expect(403);
    await request(server()).post('/api/admin/broadcasts').set(authHeader(viewer.accessToken)).send(VALID_BODY).expect(403);
  });
});

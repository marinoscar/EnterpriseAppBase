// =============================================================================
// The user-data routes over HTTP (issue #743)
// =============================================================================
//
// /api/user-data/*: 401 without a session, the phrase re-checked server-side
// (400), 202 and dedup through the queue (the second request returns the job
// in flight; no findFirst pre-check), 404 for another user's job.
// /api/admin/factory-reset/*: Admin only (403 for a viewer), the saas gate
// (403 FACTORY_RESET_DISABLED_IN_SAAS), 404 for another job type.
// /api/admin/orgs/:orgId/offboarding/*: Admin only, 409 in single mode.
// Plus the permission metadata of every route.
// =============================================================================

import request from 'supertest';
import { JobsService } from '@marinoscar/platform-api/jobs';
import { USER_DATA_ENVIRONMENT } from '@marinoscar/platform-api/user-data';

import { userDataControllers } from '../../src/platform/user-data/user-data.config';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const JOB_ID = '7a1d1f0e-0000-4000-8000-000000000001';
const ORG_ID = '7a1d1f0e-0000-4000-8000-0000000000aa';

function routeMetadata(controller: object, method: string): string[] {
  const proto = (controller as { prototype: Record<string, unknown> }).prototype;
  const handler = proto[method] as object;
  const keys = Reflect.getMetadataKeys(handler) as string[];
  const permissions = keys.map((key) => Reflect.getMetadata(key, handler)).find((value) => Array.isArray(value) && value.every((v) => typeof v === 'string' && v.includes(':')));
  return (permissions as string[] | undefined) ?? [];
}

describe('User data routes', () => {
  let context: TestContext;
  let environment: { deploymentMode: () => 'self-hosted' | 'saas'; tenancyMode: () => 'single' | 'multi' };
  let enqueue: jest.SpyInstance;

  beforeAll(async () => {
    environment = { deploymentMode: () => 'self-hosted', tenancyMode: () => 'single' };
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: USER_DATA_ENVIRONMENT, useValue: environment }],
    });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    environment.deploymentMode = () => 'self-hosted';
    environment.tenancyMode = () => 'single';
    const inFlight = { id: JOB_ID, status: 'pending' };
    enqueue = jest.spyOn(context.app.get(JobsService), 'enqueue').mockResolvedValue(inFlight as never);
  });

  afterEach(() => enqueue.mockRestore());

  const server = () => context.app.getHttpServer();

  it('declares the exact permission on every route', () => {
    const { UserDataController, FactoryResetController, OrgOffboardingController } = userDataControllers;
    for (const method of ['summary', 'request', 'status']) {
      expect(routeMetadata(UserDataController!, method)).toEqual(['user_settings:write']);
      expect(routeMetadata(FactoryResetController!, method)).toEqual(['system:factory_reset']);
      expect(routeMetadata(OrgOffboardingController!, method)).toEqual(['orgs:offboard']);
    }
  });

  describe('/api/user-data', () => {
    it('answers 401 without a session', async () => {
      await request(server()).get('/api/user-data/summary').expect(401);
      await request(server()).post('/api/user-data/deletions').send({ scope: 'everything', confirmation: 'DELETE MY DATA' }).expect(401);
    });

    it('answers 400 on a wrong phrase or an unknown scope, and queues nothing', async () => {
      const viewer = await createMockViewerUser(context);
      const wrong = await request(server())
        .post('/api/user-data/deletions')
        .set(authHeader(viewer.accessToken))
        .send({ scope: 'everything', confirmation: 'delete my data' })
        .expect(400);
      expect(wrong.body.details.reason).toBe('CONFIRMATION_MISMATCH');
      const unknown = await request(server())
        .post('/api/user-data/deletions')
        .set(authHeader(viewer.accessToken))
        .send({ scope: 'nope', confirmation: 'NOPE' })
        .expect(400);
      expect(unknown.body.details.reason).toBe('UNKNOWN_SCOPE');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('answers 202 with the job, and a second request gets the job in flight (queue dedup)', async () => {
      const viewer = await createMockViewerUser(context);
      for (let i = 0; i < 2; i += 1) {
        const response = await request(server())
          .post('/api/user-data/deletions')
          .set(authHeader(viewer.accessToken))
          .send({ scope: 'everything', confirmation: 'DELETE MY DATA' })
          .expect(202);
        expect(response.body.data).toEqual({ jobId: JOB_ID, status: 'pending' });
      }
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'user.data.purge', subjectType: 'user', subjectId: viewer.id, payload: { userId: viewer.id, scope: 'everything' } }),
      );
      expect(prismaMock.job.findFirst).not.toHaveBeenCalled(); // no pre-check
    });

    it("answers 404 for a job that is not the caller's purge", async () => {
      const viewer = await createMockViewerUser(context);
      (prismaMock.job.findFirst as jest.Mock).mockResolvedValue(null);
      await request(server()).get(`/api/user-data/deletions/${JOB_ID}`).set(authHeader(viewer.accessToken)).expect(404);
      expect(prismaMock.job.findFirst).toHaveBeenCalledWith({
        where: { id: JOB_ID, type: 'user.data.purge', subjectType: 'user', subjectId: viewer.id },
      });
    });
  });

  describe('/api/admin/factory-reset', () => {
    it('is Admin only', async () => {
      const viewer = await createMockViewerUser(context);
      await request(server()).post('/api/admin/factory-reset').set(authHeader(viewer.accessToken)).send({ confirmation: 'FACTORY RESET' }).expect(403);
    });

    it('re-checks the phrase and queues one reset', async () => {
      const admin = await createMockAdminUser(context);
      await request(server()).post('/api/admin/factory-reset').set(authHeader(admin.accessToken)).send({ confirmation: 'factory reset' }).expect(400);
      expect(enqueue).not.toHaveBeenCalled();
      await request(server()).post('/api/admin/factory-reset').set(authHeader(admin.accessToken)).send({ confirmation: 'FACTORY RESET' }).expect(202);
      expect(enqueue).toHaveBeenCalledWith({ type: 'admin.factory_reset', reason: 'rerun', payload: { actorUserId: admin.id }, orgId: null });
    });

    it('answers 403 FACTORY_RESET_DISABLED_IN_SAAS in saas mode', async () => {
      environment.deploymentMode = () => 'saas';
      const admin = await createMockAdminUser(context);
      const response = await request(server()).post('/api/admin/factory-reset').set(authHeader(admin.accessToken)).send({ confirmation: 'FACTORY RESET' }).expect(403);
      expect(response.body.details.reason).toBe('FACTORY_RESET_DISABLED_IN_SAAS');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('answers 404 for another job type', async () => {
      const admin = await createMockAdminUser(context);
      (prismaMock.job.findFirst as jest.Mock).mockResolvedValue(null);
      await request(server()).get(`/api/admin/factory-reset/${JOB_ID}`).set(authHeader(admin.accessToken)).expect(404);
    });
  });

  describe('/api/admin/orgs/:orgId/offboarding', () => {
    it('is Admin only', async () => {
      const viewer = await createMockViewerUser(context);
      await request(server()).post(`/api/admin/orgs/${ORG_ID}/offboarding`).set(authHeader(viewer.accessToken)).send({ confirmation: 'acme' }).expect(403);
    });

    it('answers 409 OFFBOARDING_REQUIRES_MULTI_ORG in single-organization mode', async () => {
      const admin = await createMockAdminUser(context);
      const response = await request(server())
        .post(`/api/admin/orgs/${ORG_ID}/offboarding`)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'acme' })
        .expect(409);
      expect(response.body.details.reason).toBe('OFFBOARDING_REQUIRES_MULTI_ORG');
    });

    it('refuses the default organization in multi mode', async () => {
      environment.tenancyMode = () => 'multi';
      const admin = await createMockAdminUser(context);
      (prismaMock.organization.findUnique as jest.Mock).mockResolvedValue({ id: ORG_ID, name: 'Default', slug: 'default', isDefault: true });
      const response = await request(server())
        .post(`/api/admin/orgs/${ORG_ID}/offboarding`)
        .set(authHeader(admin.accessToken))
        .send({ confirmation: 'default' })
        .expect(409);
      expect(response.body.details.reason).toBe('DEFAULT_ORG_NOT_OFFBOARDABLE');
    });
  });
});

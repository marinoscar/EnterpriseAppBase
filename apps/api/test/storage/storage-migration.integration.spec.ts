// =============================================================================
// /api/admin/storage/migrations — routes, RBAC and the wire shape (issue #1093)
// =============================================================================
//
// Against the mocked database: every route declares the storage CONFIGURATION
// permission (never `storage:*`, which every Viewer holds), refuses an
// anonymous caller and a Viewer, and serves an administrator. The real
// database behaviour (the one-active-run index, the repoint) is
// `storage-migration.db.spec.ts`.
// =============================================================================

import request from 'supertest';

import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { StorageMigrationController } from '@marinoscar/platform-api/storage';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../helpers/auth-mock.helper';

const BASE = '/api/admin/storage/migrations';
const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';

const ROUTES: Array<['get' | 'post', string, Record<string, unknown> | undefined]> = [
  ['post', BASE, { sourceProvider: 's3', targetProvider: 'r2' }],
  ['get', BASE, undefined],
  ['get', `${BASE}/${RUN_ID}`, undefined],
  ['post', `${BASE}/${RUN_ID}/cancel`, undefined],
];

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    orgId: null,
    sourceProvider: 's3',
    targetProvider: 'r2',
    status: 'running',
    totalCount: 0,
    migratedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    plannedAt: null,
    startedById: null,
    cancelledById: null,
    startedAt: null,
    finishedAt: null,
    cancelledAt: null,
    lastError: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Storage migration admin routes (#1093)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  it.each([
    ['start', 'storage_config:write'],
    ['list', 'storage_config:read'],
    ['get', 'storage_config:read'],
    ['cancel', 'storage_config:write'],
  ] as const)('%s declares exactly %s', (handler, permission) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StorageMigrationController.prototype[handler])).toEqual([permission]);
  });

  it.each(ROUTES)('%s %s: an anonymous caller gets 401', async (method, path, body) => {
    const req = request(context.app.getHttpServer())[method](path);
    await (body ? req.send(body) : req).expect(401);
  });

  it.each(ROUTES)('%s %s: a viewer gets 403', async (method, path, body) => {
    const viewer = await createMockViewerUser(context);
    const req = request(context.app.getHttpServer())[method](path).set(authHeader(viewer.accessToken));
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(403);
  });

  it('an administrator lists runs with derived counts and a page meta', async () => {
    const admin = await createMockAdminUser(context);
    context.prismaMock.storageMigrationRun.findMany.mockResolvedValue([runRow()]);
    context.prismaMock.storageMigrationRun.count.mockResolvedValue(1);
    context.prismaMock.storageMigrationItem.groupBy.mockResolvedValue([
      { runId: RUN_ID, status: 'migrated', _count: { _all: 2 } },
      { runId: RUN_ID, status: 'pending', _count: { _all: 3 } },
    ] as never);

    const res = await request(context.app.getHttpServer()).get(BASE).set(authHeader(admin.accessToken)).expect(200);

    expect(res.body.data.meta).toEqual({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(res.body.data.items[0]).toMatchObject({ id: RUN_ID, totalCount: 5, migratedCount: 2, pendingCount: 3, status: 'running' });
  });

  it('an administrator gets 404 for an unknown run, and 400 for a start whose drivers are the same', async () => {
    const admin = await createMockAdminUser(context);
    context.prismaMock.storageMigrationRun.findUnique.mockResolvedValue(null);
    await request(context.app.getHttpServer()).get(`${BASE}/${RUN_ID}`).set(authHeader(admin.accessToken)).expect(404);

    await request(context.app.getHttpServer())
      .post(BASE)
      .set(authHeader(admin.accessToken))
      .send({ sourceProvider: 's3', targetProvider: 's3' })
      .expect(400);
  });

  it('an administrator cancels an active run, and gets 409 for a finished one', async () => {
    const admin = await createMockAdminUser(context);
    context.prismaMock.storageMigrationRun.updateMany.mockResolvedValue({ count: 1 });
    context.prismaMock.storageMigrationItem.updateMany.mockResolvedValue({ count: 0 });
    context.prismaMock.storageMigrationItem.groupBy.mockResolvedValue([] as never);
    context.prismaMock.storageMigrationRun.findUnique.mockResolvedValue(runRow({ status: 'cancelled' }));

    const res = await request(context.app.getHttpServer())
      .post(`${BASE}/${RUN_ID}/cancel`)
      .set(authHeader(admin.accessToken))
      .expect(200);
    expect(res.body.data.status).toBe('cancelled');

    context.prismaMock.storageMigrationRun.updateMany.mockResolvedValue({ count: 0 });
    context.prismaMock.storageMigrationRun.findUnique.mockResolvedValue({ status: 'completed' } as never);
    await request(context.app.getHttpServer()).post(`${BASE}/${RUN_ID}/cancel`).set(authHeader(admin.accessToken)).expect(409);
  });
});

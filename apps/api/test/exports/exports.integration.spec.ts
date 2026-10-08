// =============================================================================
// /api/exports over HTTP (issue #744)
// =============================================================================
//
// Authentication on every route, the source's permission (403), unknown
// source or format (400), the in-flight cap (429), another user's export
// (404), the 202 of a queued export and the sources a caller may use. The
// queue is spied (`JobsService.enqueue`): what the job does is the package's
// handler spec and the db specs.
// =============================================================================

import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { authHeader, createMockTestUser, createMockViewerUser } from '../helpers/auth-mock.helper';

describe('Exports (/api/exports)', () => {
  let context: TestContext;
  let enqueue: jest.SpyInstance;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    (prismaMock.job.count as jest.Mock).mockResolvedValue(0);
    enqueue = jest.spyOn(context.app.get(JobsService), 'enqueue').mockImplementation(async (input) => ({
      id: randomUUID(),
      status: 'pending',
      payload: input.payload,
      createdAt: new Date('2026-10-08T10:00:00.000Z'),
      finishedAt: null,
    }) as never);
  });

  afterEach(() => enqueue.mockRestore());

  const server = () => context.app.getHttpServer();

  it.each([
    ['get', '/api/exports/sources'],
    ['get', '/api/exports'],
    ['post', '/api/exports'],
    ['get', `/api/exports/${randomUUID()}`],
  ] as const)('%s %s answers 401 without a session', async (method, path) => {
    await request(server())[method](path).expect(401);
  });

  it('lists user-data (and the example source) for a viewer, but not org-data', async () => {
    const viewer = await createMockViewerUser(context);
    const response = await request(server()).get('/api/exports/sources').set(authHeader(viewer.accessToken)).expect(200);
    const ids = response.body.data.items.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['user-data', 'example-notification-inbox']));
    expect(ids).not.toContain('org-data');
    const userData = response.body.data.items.find((s: { id: string }) => s.id === 'user-data');
    expect(userData.formats.map((f: { id: string }) => f.id)).toEqual(['json', 'csv', 'xlsx']);
    const example = response.body.data.items.find((s: { id: string }) => s.id === 'example-notification-inbox');
    expect(example.formats.map((f: { id: string }) => f.id)).toEqual(['csv-single', 'json', 'csv', 'xlsx']);
    expect(example.fields.map((f: { key: string; kind: string }) => `${f.key}:${f.kind}`)).toEqual(['from:date', 'to:date', 'unreadOnly:boolean']);
  });

  it('POST user-data answers 202 with a pending export and queues export.run for the caller', async () => {
    const viewer = await createMockViewerUser(context);
    const response = await request(server())
      .post('/api/exports')
      .set(authHeader(viewer.accessToken))
      .send({ source: 'user-data', format: 'json' })
      .expect(202);
    expect(response.body.data).toMatchObject({ status: 'pending', source: 'user-data', format: 'json', scope: 'user', download: null });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'export.run', subjectType: 'user', subjectId: viewer.id, skipDedup: true }),
    );
  });

  it('400 for an unknown source, an unknown format, an extra key and a request the source refuses', async () => {
    const viewer = await createMockViewerUser(context);
    const post = (body: object) => request(server()).post('/api/exports').set(authHeader(viewer.accessToken)).send(body);
    await post({ source: 'nope', format: 'json' }).expect(400);
    await post({ source: 'user-data', format: 'pdf' }).expect(400);
    await post({ source: 'user-data', format: 'json', extra: true }).expect(400);
    await post({ source: 'example-notification-inbox', format: 'csv', request: { from: '2026-10-08', to: '2026-01-01' } }).expect(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("403 without the source's permission", async () => {
    const viewer = await createMockViewerUser(context);
    await request(server())
      .post('/api/exports')
      .set(authHeader(viewer.accessToken))
      .send({ source: 'org-data', format: 'json' })
      .expect(403);
  });

  it("org-data is queued for the active organization's admin", async () => {
    const orgAdmin = await createMockTestUser(context, { systemRoles: [], orgRoleName: 'org_admin' });
    await request(server()).post('/api/exports').set(authHeader(orgAdmin.accessToken)).send({ source: 'org-data', format: 'csv' }).expect(202);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'organization', subjectId: 'org-default' }));
  });

  it('429 for a fourth concurrent export of the same subject', async () => {
    (prismaMock.job.count as jest.Mock).mockResolvedValue(3);
    const viewer = await createMockViewerUser(context);
    await request(server()).post('/api/exports').set(authHeader(viewer.accessToken)).send({ source: 'user-data', format: 'csv' }).expect(429);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("404 for another user's export, and for an id that is not an export", async () => {
    const viewer = await createMockViewerUser(context);
    const id = randomUUID();
    const other = randomUUID();
    (prismaMock.job.findFirst as jest.Mock).mockResolvedValue({
      id,
      status: 'pending',
      createdAt: new Date(),
      finishedAt: null,
      subjectType: 'user',
      subjectId: other,
      payload: { source: 'user-data', format: 'json', request: {}, requestedById: other, scope: 'user', subjectId: other, orgId: 'org-default' },
    });
    await request(server()).get(`/api/exports/${id}`).set(authHeader(viewer.accessToken)).expect(404);
    (prismaMock.job.findFirst as jest.Mock).mockResolvedValue(null);
    await request(server()).get(`/api/exports/${id}`).set(authHeader(viewer.accessToken)).expect(404);
    await request(server()).get('/api/exports/not-a-uuid').set(authHeader(viewer.accessToken)).expect(400);
  });

  it("GET /api/exports lists the caller's exports", async () => {
    const viewer = await createMockViewerUser(context);
    (prismaMock.job.findMany as jest.Mock).mockResolvedValue([
      {
        id: randomUUID(),
        status: 'running',
        createdAt: new Date(),
        finishedAt: null,
        payload: { source: 'user-data', format: 'xlsx', request: {}, requestedById: viewer.id, scope: 'user', subjectId: viewer.id, orgId: 'org-default' },
      },
    ]);
    const response = await request(server()).get('/api/exports').set(authHeader(viewer.accessToken)).expect(200);
    expect(response.body.data.items.map((i: { status: string }) => i.status)).toEqual(['running']);
  });
});

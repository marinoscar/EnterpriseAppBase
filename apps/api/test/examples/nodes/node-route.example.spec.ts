// =============================================================================
// PP-14 seam #1076, proved from the app: an app route on the node plane
// =============================================================================
//
// An app mounts its own controller under `/api/nodes/:id/...` and marks it
// `@NodeRoute()`. This spec boots the REAL application plus a small feature
// module (the way a fork's own module sits beside the platform's), with only
// Prisma mocked, and proves over the real HTTP stack:
//
//   - the owner's `nod_` credential reaches the route and `@CurrentNode()` is the
//     node the guard verified;
//   - another user's node is a 403 and a missing node a 404 (the packaged
//     control plane's own answers), before the handler runs;
//   - a node-only route refuses a human's session JWT;
//   - a `nod_` credential is still refused outside `/api/nodes`.
//
// The recipe is in docs/EXTENDING.md ("Add a route on the node plane").
// =============================================================================

import { createHash, randomUUID } from 'crypto';

import { Controller, Get, Module } from '@nestjs/common';
import request from 'supertest';

import { CurrentNode, NodeRoute, NodeRouteModule } from '@marinoscar/platform-api/nodes';
import type { WorkerNode } from '@marinoscar/platform-api/jobs';

import { setupBaseMocks } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

/** Node-only: a human's PAT or session is for the web routes, not this one. */
@Controller('nodes/:id/reports')
@NodeRoute({ credentials: ['nod'] })
class ReportsController {
  @Get('latest')
  latest(@CurrentNode() node: WorkerNode) {
    return { nodeId: node.id, name: node.name };
  }
}

/** The default: every credential kind the platform's own node routes admit. */
@Controller('nodes/:id/summaries')
@NodeRoute()
class SummariesController {
  @Get()
  summary(@CurrentNode() node: WorkerNode) {
    return { nodeId: node.id };
  }
}

@Module({ imports: [NodeRouteModule], controllers: [ReportsController, SummariesController] })
class ExampleNodeReportsModule {}

describe('an app route on the node plane (@NodeRoute)', () => {
  let context: TestContext;
  let ownerId: string;
  let adminToken: string;

  const NODE_TOKEN = 'nod_example_node_route_fixture';
  const NODE_ID = '11111111-1111-4111-8111-111111111111';
  const server = () => request(context.app.getHttpServer());
  const node = (createdById: string) => ({ id: NODE_ID, name: 'reporter-1', createdById });

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true, imports: [ExampleNodeReportsModule] });
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();

    const admin = await createMockAdminUser(context);
    ownerId = admin.id;
    adminToken = admin.accessToken;
    const expected = createHash('sha256').update(NODE_TOKEN).digest('hex');
    const fullUser = await (context.prismaMock.user.findUnique as jest.Mock)({ where: { id: admin.id } });
    (context.prismaMock.nodeCredential.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { tokenHash: string } }) =>
      where.tokenHash !== expected
        ? null
        : { id: randomUUID(), userId: admin.id, name: 'fixture', tokenHash: expected, tokenPrefix: 'nod_exam', expiresAt: null, lastUsedAt: null, createdAt: new Date(), revokedAt: null, user: fullUser },
    );
    (context.prismaMock.nodeCredential.update as jest.Mock).mockResolvedValue({});
  });

  const asNode = () => ({ Authorization: `Bearer ${NODE_TOKEN}` });

  it('serves the owner\'s node credential, with the verified node', async () => {
    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue(node(ownerId));

    const response = await server().get(`/api/nodes/${NODE_ID}/reports/latest`).set(asNode()).expect(200);

    expect(response.body.data).toEqual({ nodeId: NODE_ID, name: 'reporter-1' });
  });

  it('refuses another user\'s node with 403 and a missing node with 404', async () => {
    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue(node('someone-else'));
    await server().get(`/api/nodes/${NODE_ID}/reports/latest`).set(asNode()).expect(403);

    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue(null);
    await server().get(`/api/nodes/${NODE_ID}/reports/latest`).set(asNode()).expect(404);
  });

  it('refuses a node id that is not a uuid before any lookup', async () => {
    await server().get('/api/nodes/not-a-uuid/reports/latest').set(asNode()).expect(400);

    expect(context.prismaMock.workerNode.findUnique).not.toHaveBeenCalled();
  });

  it('a node-only route refuses a session token; the default route admits it', async () => {
    (context.prismaMock.workerNode.findUnique as jest.Mock).mockResolvedValue(node(ownerId));

    await server().get(`/api/nodes/${NODE_ID}/reports/latest`).set(authHeader(adminToken)).expect(403);
    const response = await server().get(`/api/nodes/${NODE_ID}/summaries`).set(authHeader(adminToken)).expect(200);

    expect(response.body.data).toEqual({ nodeId: NODE_ID });
  });

  it('keeps a nod_ credential inside /api/nodes', async () => {
    await server().get('/api/users').set(asNode()).expect(403);
  });
});

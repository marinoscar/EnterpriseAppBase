// =============================================================================
// A node marked offline still notifies, through the slice's event (#734)
// =============================================================================
//
// Before #734 the fleet sweep called `NotificationsService` itself. The nodes
// slice is a package now and imports nothing from the notifications slice:
// the sweep emits `nodes.node.offline` (`NODE_OFFLINE_EVENT`) after its write
// returns, and the app's `NodeOfflineNotifier` (notifications/ops) raises the
// unchanged `nodes.node_offline` notification to `nodes:read` holders.
//
// Proven in the REAL app graph (mocked database): the listener is wired, the
// event key and the payload are what the email template reads, the dispatch
// happens only after the sweep's single `updateManyAndReturn` has resolved
// (after the write committed), and a failed write notifies nobody.
// =============================================================================

import { NODE_OFFLINE_EVENT, NodeFleetSweepHandler } from '@marinoscar/platform-api/nodes';

import { NotificationsService } from '../notifications/support/notifications';
import { createTestApp, closeTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';

describe('nodes.node.offline -> nodes.node_offline (#734)', () => {
  let context: TestContext;
  let sweep: NodeFleetSweepHandler;
  let notify: jest.SpyInstance;
  const order: string[] = [];

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    sweep = context.app.get(NodeFleetSweepHandler);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    order.length = 0;
    notify = jest
      .spyOn(context.app.get(NotificationsService), 'notifyPermissionHolders')
      .mockImplementation(async () => {
        order.push('notify');
        return undefined as never;
      });
  });

  afterEach(() => {
    notify.mockRestore();
  });

  it('uses the permanent event key', () => {
    expect(NODE_OFFLINE_EVENT).toBe('nodes.node.offline');
  });

  it("notifies nodes:read holders once per node the sweep flipped, after the sweep's write resolved", async () => {
    const lastHeartbeatAt = new Date('2026-10-01T10:00:00Z');
    context.prismaMock.workerNode.updateManyAndReturn.mockImplementation((async () => {
      order.push('write');
      return [
        { id: 'node-1', name: 'build-box-1', lastHeartbeatAt },
        { id: 'node-2', name: 'build-box-2', lastHeartbeatAt: null },
      ];
    }) as never);

    expect(await sweep.sweep()).toBe(2);

    expect(order).toEqual(['write', 'notify', 'notify']);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(
      1,
      'nodes.node_offline',
      'nodes:read',
      expect.objectContaining({
        nodeId: 'node-1',
        nodeName: 'build-box-1',
        lastHeartbeatAt,
        markedOfflineAt: expect.any(Date),
        staleAfterMinutes: expect.any(Number),
      }),
    );
    expect(notify.mock.calls[1][2]).toMatchObject({ nodeId: 'node-2', lastHeartbeatAt: null });
  });

  it('notifies nobody when no node changed, or when the write failed', async () => {
    context.prismaMock.workerNode.updateManyAndReturn.mockResolvedValueOnce([] as never);
    expect(await sweep.sweep()).toBe(0);

    context.prismaMock.workerNode.updateManyAndReturn.mockRejectedValueOnce(new Error('connection reset') as never);
    await expect(sweep.sweep()).rejects.toThrow('connection reset');

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the sweep alive when the dispatch rejects (the listener swallows and logs)', async () => {
    notify.mockRejectedValueOnce(new Error('smtp down'));
    context.prismaMock.workerNode.updateManyAndReturn.mockResolvedValueOnce([
      { id: 'node-3', name: 'build-box-3', lastHeartbeatAt: null },
    ] as never);

    await expect(sweep.sweep()).resolves.toBe(1);
  });
});

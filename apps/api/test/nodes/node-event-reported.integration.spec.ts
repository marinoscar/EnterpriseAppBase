// =============================================================================
// A node event reaches the app through the slice's event (#1045)
// =============================================================================
//
// A heartbeat's `events` are persisted to `worker_node_events` by the nodes
// slice, then announced as `nodes.node.event` (`NODE_EVENT_REPORTED`) once per
// accepted row, AFTER the write resolved. The slice raises no notification
// itself; an app subscribes with `@OnEvent(NODE_EVENT_REPORTED)`.
//
// Proven in the REAL app graph (mocked database): the service is wired to the
// app's event bus, the key and the payload are what a listener reads, and the
// listener runs only after `createMany` resolved.
// =============================================================================

import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NODE_EVENT_REPORTED,
  NodeEventReportedEvent,
  NodeEventsService,
} from '@marinoscar/platform-api/nodes';

import { createTestApp, closeTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';

describe('nodes.node.event (#1045)', () => {
  let context: TestContext;
  let events: NodeEventsService;
  let bus: EventEmitter2;
  const order: string[] = [];
  const seen: NodeEventReportedEvent[] = [];
  const listener = (event: NodeEventReportedEvent) => {
    order.push('listener');
    seen.push(event);
  };

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    events = context.app.get(NodeEventsService);
    bus = context.app.get(EventEmitter2);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    order.length = 0;
    seen.length = 0;
    bus.on(NODE_EVENT_REPORTED, listener);
  });

  afterEach(() => {
    bus.off(NODE_EVENT_REPORTED, listener);
  });

  it('uses the permanent event key', () => {
    expect(NODE_EVENT_REPORTED).toBe('nodes.node.event');
  });

  it('delivers the event to a listener on the app bus, after the write resolved', async () => {
    context.prismaMock.workerNodeEvent.createMany.mockImplementation((async () => {
      order.push('write');
      return { count: 1 };
    }) as never);

    const outcome = await events.ingest(
      { id: 'node-1', name: 'build-box-1', createdById: 'user-1' },
      [{ type: 'power.battery_low', severity: 'warning', at: new Date().toISOString(), attrs: { batteryPercent: 9 } }],
    );

    expect(outcome).toEqual({ accepted: 1, dropped: 0 });
    expect(order).toEqual(['write', 'listener']);
    expect(seen[0]).toMatchObject({
      nodeId: 'node-1',
      nodeName: 'build-box-1',
      ownerUserId: 'user-1',
      type: 'power.battery_low',
      severity: 'warning',
      attrs: { batteryPercent: 9 },
    });
  });

  it('announces nothing when the write fails, and does not reject', async () => {
    context.prismaMock.workerNodeEvent.createMany.mockRejectedValueOnce(new Error('connection reset') as never);

    await expect(
      events.ingest({ id: 'node-2', name: 'build-box-2', createdById: 'user-1' }, [
        { type: 'node.sleep_resumed', severity: 'info', at: new Date().toISOString() },
      ]),
    ).resolves.toEqual({ accepted: 0, dropped: 0 });
    expect(seen).toHaveLength(0);
  });
});

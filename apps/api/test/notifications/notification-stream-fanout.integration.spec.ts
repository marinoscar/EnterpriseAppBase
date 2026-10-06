// =============================================================================
// SSE fan-out across two simulated replicas (PP-1.11, issue #682)
// =============================================================================
//
// Two `NotificationStreamService` instances — "replica A" and "replica B" —
// over one fake network bus and one mocked notifications table. The
// properties under test are the ones the multi-replica deployment depends on:
//
//   - a user whose tab is on B gets a live frame for a notification published
//     on A, exactly once;
//   - a DIFFERENT user connected to B gets nothing (isolation across replicas
//     is as structural as it is within one);
//   - the publisher's own tabs still get exactly one frame (no echo);
//   - an oversize event crosses by reference, and the reference is resolved
//     with the notification id AND the user id.
// =============================================================================

import { Logger } from '@nestjs/common';

import {
  NOTIFICATION_SSE_EVENT,
  NotificationStreamEvent,
  NotificationStreamService,
  SseMessage,
} from '../../src/notifications/notification-stream.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FakeEventBusNetwork, flushEventBus } from '../helpers/fake-network-event-bus.helper';

function makeEvent(overrides: Partial<NotificationStreamEvent> = {}): NotificationStreamEvent {
  return {
    id: 'notif-1',
    eventKey: 'security.role_changed',
    title: 'Your roles changed',
    body: 'An administrator changed your roles.',
    link: '/settings',
    createdAt: '2026-01-01T00:00:00.000Z',
    toast: true,
    pushed: false,
    ...overrides,
  };
}

interface StoredRow {
  id: string;
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: Date;
}

describe('Notification stream fan-out across replicas (event bus)', () => {
  let rows: StoredRow[];
  let findFirst: jest.Mock;
  let replicaA: NotificationStreamService;
  let replicaB: NotificationStreamService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    rows = [];
    // A faithful-enough `findFirst`: every key in `where` must match.
    findFirst = jest.fn(async ({ where }: { where: Partial<StoredRow> }) => {
      const row = rows.find((candidate) =>
        Object.entries(where).every(([key, value]) => candidate[key as keyof StoredRow] === value),
      );
      return row ?? null;
    });
    const prisma = { notification: { findFirst } } as unknown as PrismaService;

    const network = new FakeEventBusNetwork();
    replicaA = new NotificationStreamService(network.join('replica-a'), prisma);
    replicaB = new NotificationStreamService(network.join('replica-b'), prisma);
    replicaA.onModuleInit();
    replicaB.onModuleInit();
  });

  afterEach(async () => {
    await Promise.all([replicaA.onModuleDestroy(), replicaB.onModuleDestroy()]);
    jest.restoreAllMocks();
  });

  function tab(service: NotificationStreamService, userId: string): SseMessage[] {
    const messages: SseMessage[] = [];
    service.subscribe(userId).subscribe((message) => messages.push(message));
    return messages;
  }

  const notifications = (messages: SseMessage[]) => messages.filter((m) => m.type === NOTIFICATION_SSE_EVENT);

  it('delivers a notification published on A to the user’s tab on B, once', async () => {
    const aliceOnB = tab(replicaB, 'alice');

    expect(replicaA.publish('alice', makeEvent())).toBe(0); // nobody on A
    await flushEventBus();

    expect(notifications(aliceOnB)).toEqual([{ type: NOTIFICATION_SSE_EVENT, data: makeEvent() }]);
  });

  it('never delivers it to a different user connected to B', async () => {
    const aliceOnB = tab(replicaB, 'alice');
    const bobOnB = tab(replicaB, 'bob');
    const bobOnA = tab(replicaA, 'bob');
    const bobBefore = [...bobOnB];

    replicaA.publish('alice', makeEvent());
    await flushEventBus();

    expect(notifications(aliceOnB)).toHaveLength(1);
    expect(bobOnB).toEqual(bobBefore);
    expect(notifications(bobOnA)).toEqual([]);
  });

  it('reaches the user’s tabs on BOTH replicas, each exactly once', async () => {
    const aliceOnA = tab(replicaA, 'alice');
    const aliceOnB = tab(replicaB, 'alice');

    expect(replicaA.publish('alice', makeEvent())).toBe(1);
    await flushEventBus();

    expect(notifications(aliceOnA)).toHaveLength(1);
    expect(notifications(aliceOnB)).toHaveLength(1);
  });

  it('crosses replicas by reference when the event is oversize, scoped to the user', async () => {
    const hugeBody = '\u{1F600}'.repeat(2_000); // 8,000 UTF-8 bytes
    rows.push({
      id: 'big-1',
      userId: 'alice',
      eventKey: 'security.role_changed',
      title: 'Your roles changed',
      body: hugeBody,
      link: '/settings',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const aliceOnB = tab(replicaB, 'alice');

    replicaA.publish('alice', makeEvent({ id: 'big-1', body: hugeBody, pushed: true }));
    await flushEventBus();

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'big-1', userId: 'alice' } }));
    expect(notifications(aliceOnB)).toEqual([
      { type: NOTIFICATION_SSE_EVENT, data: makeEvent({ id: 'big-1', body: hugeBody, pushed: true }) },
    ]);
  });

  it('cannot surface another user’s row through a reference', async () => {
    const hugeBody = '\u{1F600}'.repeat(2_000);
    // The row belongs to bob; the publish (wrongly) names alice.
    rows.push({
      id: 'bobs-row',
      userId: 'bob',
      eventKey: 'security.role_changed',
      title: 'Bob only',
      body: hugeBody,
      link: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const aliceOnB = tab(replicaB, 'alice');

    replicaA.publish('alice', makeEvent({ id: 'bobs-row', body: hugeBody }));
    await flushEventBus();

    expect(notifications(aliceOnB)).toEqual([]);
  });
});

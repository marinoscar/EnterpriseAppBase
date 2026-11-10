// =============================================================================
// A notification written on replica A reaches a tab on replica B (issue #738)
// =============================================================================
//
// The packaged stream over the app's host binding (`notificationsEventBusOf`,
// platform/notifications/notifications-host.module.ts) and the bus test double:
// the browser channel on replica A writes the inbox row and publishes it; the
// user's tab is connected to replica B only. The frame format is the one
// `GET /api/notifications/stream` serves (`event: notification`).
// =============================================================================

import { Logger } from '@nestjs/common';

import { notificationsEventBusOf } from '../../src/platform/notifications/notifications-host.module';
import { FakeEventBusNetwork, flushEventBus } from '@marinoscar/platform-api/host/testing';
import {
  BrowserNotificationChannel,
  NOTIFICATION_SSE_EVENT,
  NotificationStreamService,
  findEvent,
  type NotificationsPrisma,
  type SseMessage,
} from './support/notifications';

describe('notification stream across replicas through the host bus binding (#738)', () => {
  let replicaA: NotificationStreamService;
  let replicaB: NotificationStreamService;
  let channelA: BrowserNotificationChannel;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const prisma = {
      notification: {
        create: jest.fn(async () => ({ id: 'notif-42', createdAt: new Date('2026-01-01T00:00:00.000Z') })),
        findFirst: jest.fn(async () => null),
      },
    } as unknown as NotificationsPrisma;

    const network = new FakeEventBusNetwork();
    replicaA = new NotificationStreamService(notificationsEventBusOf(network.join('replica-a')), prisma);
    replicaB = new NotificationStreamService(notificationsEventBusOf(network.join('replica-b')), prisma);
    replicaA.onModuleInit();
    replicaB.onModuleInit();
    channelA = new BrowserNotificationChannel(prisma, replicaA);
  });

  afterEach(async () => {
    await Promise.all([replicaA.onModuleDestroy(), replicaB.onModuleDestroy()]);
    jest.restoreAllMocks();
  });

  it('delivers the frame to the tab on replica B exactly once, and to nobody else', async () => {
    const onB: SseMessage[] = [];
    const otherUserOnB: SseMessage[] = [];
    replicaB.subscribe('user-1').subscribe((message) => onB.push(message));
    replicaB.subscribe('user-2').subscribe((message) => otherUserOnB.push(message));

    const event = findEvent('user.welcome')!;
    const result = await channelA.deliver(
      {
        event,
        recipient: { userId: 'user-1', email: 'u1@example.test', preferences: {} },
        data: { recipientEmail: 'u1@example.test', recipientName: 'U1', roles: [] },
        channels: ['browser'],
      },
      'user-1',
    );
    await flushEventBus();

    expect(result.success).toBe(true);
    const frames = onB.filter((message) => message.type === NOTIFICATION_SSE_EVENT);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toMatchObject({ id: 'notif-42', eventKey: 'user.welcome', toast: true });
    expect(otherUserOnB.filter((message) => message.type === NOTIFICATION_SSE_EVENT)).toEqual([]);
  });
});

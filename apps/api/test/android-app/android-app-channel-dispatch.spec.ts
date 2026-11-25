// The `android_app` channel through the real dispatcher (#746): an event that
// declares the channel reaches the Android app sender, a dispatch resolving
// both `push` and `android_app` sends once (over `push`), and a user who
// muted `push` still gets `android_app`.
import { PLATFORM_PRISMA, withTemporaryEntries } from '@marinoscar/platform-api/core';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { createMockPrismaService, type MockPrismaService } from '../mocks/prisma.mock';
import {
  DEFAULT_NOTIFICATION_POLICY,
  NOTIFICATION_CHANNEL_SENDERS,
  NotificationDeliveryService,
  NotificationPolicyService,
  NotificationsService,
  notificationChannelRegistry,
  notificationEventRegistry,
  type NotificationChannelSender,
} from '../notifications/support/notifications';

function sender(channel: string): jest.Mocked<NotificationChannelSender> {
  return {
    channel,
    resolveTo: jest.fn((recipient: { userId: string | null }) => recipient.userId),
    deliver: jest.fn().mockResolvedValue({ success: true, messageId: `${channel}-1` }),
  } as unknown as jest.Mocked<NotificationChannelSender>;
}

describe('the android_app channel in the dispatcher (#746)', () => {
  let service: NotificationsService;
  let prisma: MockPrismaService;
  let push: jest.Mocked<NotificationChannelSender>;
  let android: jest.Mocked<NotificationChannelSender>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@example.test', userSettings: null } as never);
    prisma.notificationDelivery.create.mockResolvedValue({ id: 'd1' } as never);
    prisma.notificationDelivery.update.mockResolvedValue({} as never);
    push = sender('push');
    android = sender('android_app');
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationDeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PLATFORM_PRISMA, useValue: prisma },
        { provide: NotificationPolicyService, useValue: { getPolicy: jest.fn().mockResolvedValue(DEFAULT_NOTIFICATION_POLICY) } },
        { provide: NOTIFICATION_CHANNEL_SENDERS, useValue: [push, android] },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('is registered by the reference app manifest, covered by push', () => {
    expect(notificationChannelRegistry.get('android_app')?.coveredBy).toBe('push');
  });

  const event = (key: string, channels: string[]) => ({ key, label: 'Example', description: 'An example event.', channels, defaultEnabled: true });

  it('delivers an event that declares only android_app to the Android app sender', () =>
    withTemporaryEntries(notificationEventRegistry, [event('example.android_only', ['android_app'])], async () => {
      await service.notify('example.android_only', 'u1', {});
      await service.flush();
      expect(android.deliver).toHaveBeenCalledTimes(1);
      expect(push.deliver).not.toHaveBeenCalled();
    }));

  it('sends once when both push and android_app resolve', () =>
    withTemporaryEntries(notificationEventRegistry, [event('example.android_both', ['push', 'android_app'])], async () => {
      await service.notify('example.android_both', 'u1', {});
      await service.flush();
      expect(push.deliver).toHaveBeenCalledTimes(1);
      expect(android.deliver).not.toHaveBeenCalled();
    }));

  it('keeps android_app for a user who muted push', () =>
    withTemporaryEntries(notificationEventRegistry, [event('example.android_both', ['push', 'android_app'])], async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'u1@example.test',
        userSettings: { value: { notifications: { push: { 'example.android_both': false } } } },
      } as never);
      await service.notify('example.android_both', 'u1', {});
      await service.flush();
      expect(push.deliver).not.toHaveBeenCalled();
      expect(android.deliver).toHaveBeenCalledTimes(1);
    }));
});

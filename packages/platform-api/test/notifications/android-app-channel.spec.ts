// The `android_app` notification channel (#746, PP-9.4; harvested from
// EvoPath #312): the channel def and its `coveredBy` collapse, the sender's
// subscription scope, and the subscription upsert's platform re-tag rules.
import { withTemporaryEntries } from '../../src/core/registry/index';
import { AndroidAppNotificationChannel } from '../../src/notifications/channels/android-app-notification.channel';
import { PushNotificationChannel } from '../../src/notifications/channels/push-notification.channel';
import { PushSubscriptionService } from '../../src/notifications/push-subscription.service';
import {
  collapseOverlappingChannels,
  notificationChannelRegistry,
  registerNotificationChannel,
} from '../../src/notifications/registry/channel.registry';
import { NotificationChannelSenderRegistry } from '../../src/notifications/registry/channel-sender.registry';
import {
  ANDROID_APP_NOTIFICATION_CHANNEL,
  registerAndroidAppNotificationChannel,
} from '../../src/notifications/registry/platform-channels';
import type { NotificationDispatchContext } from '../../src/notifications/notification.types';
import { registerTestNotifications } from './support';

registerTestNotifications();
registerAndroidAppNotificationChannel();

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const KEYS = { p256dh: 'p', auth: 'a' };

function fakePushConfig(active: unknown = null) {
  return { resolveActiveVapidConfig: jest.fn().mockResolvedValue(active) } as never;
}

describe('the android_app channel definition', () => {
  it('registers once, covered by push', () => {
    expect(() => registerAndroidAppNotificationChannel()).not.toThrow();
    expect(notificationChannelRegistry.get('android_app')).toEqual(ANDROID_APP_NOTIFICATION_CHANNEL);
    expect(ANDROID_APP_NOTIFICATION_CHANNEL.coveredBy).toBe('push');
  });

  it('collapses android_app when push is also resolved, and keeps it alone', () => {
    expect(collapseOverlappingChannels(['browser', 'push', 'android_app'])).toEqual(['browser', 'push']);
    expect(collapseOverlappingChannels(['android_app', 'push'])).toEqual(['push']);
    expect(collapseOverlappingChannels(['browser', 'android_app'])).toEqual(['browser', 'android_app']);
    expect(collapseOverlappingChannels([])).toEqual([]);
  });

  it('refuses a channel covered by itself', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [], async () => {
      expect(() => registerNotificationChannel({ id: 'loop', label: 'Loop', description: 'Covers itself.', coveredBy: 'loop' })).toThrow(
        /coveredBy must name another channel/,
      );
    });
  });
});

describe('AndroidAppNotificationChannel', () => {
  function build(subscriptions: unknown[] = []) {
    const prisma = {
      pushSubscription: { findMany: jest.fn().mockResolvedValue(subscriptions) },
      notification: { create: jest.fn() },
    };
    const senders = new NotificationChannelSenderRegistry([]);
    const channel = new AndroidAppNotificationChannel(prisma as never, fakePushConfig(), senders);
    return { prisma, senders, channel };
  }

  const context = {
    event: { key: 'admin.broadcast', label: 'Announcement', description: 'An announcement.', channels: ['android_app'], defaultEnabled: true },
    recipient: { userId: 'u1', email: 'u1@example.test' },
    data: {},
  } as unknown as NotificationDispatchContext;

  it('is the push sender scoped to android_app subscriptions', async () => {
    const { prisma, channel } = build();
    expect(channel).toBeInstanceOf(PushNotificationChannel);
    expect(channel.channel).toBe('android_app');
    const result = await channel.deliver(context, 'u1');
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({ where: { platform: 'android_app', userId: 'u1' } });
    expect(result).toEqual({ success: false, error: 'No Android app push subscriptions for this user' });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('leaves the push channel unscoped', async () => {
    const prisma = { pushSubscription: { findMany: jest.fn().mockResolvedValue([]) } };
    const push = new PushNotificationChannel(prisma as never, fakePushConfig());
    await push.deliver(context, 'u1');
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('registers itself as the android_app sender', () => {
    const { senders, channel } = build();
    channel.onModuleInit();
    expect(senders.get('android_app')).toBe(channel);
  });
});

describe('PushSubscriptionService platform rules', () => {
  function build() {
    const upsert = jest.fn(async (args: { create: Record<string, unknown> }) => ({
      id: 's1',
      endpoint: ENDPOINT,
      platform: args.create.platform,
      createdAt: new Date('2026-10-08T00:00:00Z'),
    }));
    const prisma = { pushSubscription: { upsert } };
    const service = new PushSubscriptionService(prisma as never, fakePushConfig({ publicKey: 'k', privateKey: 'p', subject: 'mailto:a@b.c' }));
    return { service, upsert };
  }

  it('creates a browser row by default', async () => {
    const { service, upsert } = build();
    const result = await service.subscribe('u1', { endpoint: ENDPOINT, keys: KEYS }, undefined);
    expect(upsert.mock.calls[0]![0].create).toMatchObject({ platform: 'browser' });
    expect(upsert.mock.calls[0]![0]).not.toHaveProperty('update.platform');
    expect(result.platform).toBe('browser');
  });

  it('re-tags an existing row up to android_app', async () => {
    const { service, upsert } = build();
    await service.subscribe('u1', { endpoint: ENDPOINT, keys: KEYS, platform: 'android_app' }, undefined);
    expect(upsert.mock.calls[0]![0]).toMatchObject({ update: { platform: 'android_app' }, create: { platform: 'android_app' } });
  });

  it('never downgrades: a browser re-post leaves the stored platform alone', async () => {
    const { service, upsert } = build();
    await service.subscribe('u1', { endpoint: ENDPOINT, keys: KEYS, platform: 'browser' }, undefined);
    expect(Object.keys(upsert.mock.calls[0]![0] as object)).toContain('update');
    expect((upsert.mock.calls[0]![0] as unknown as { update: Record<string, unknown> }).update).not.toHaveProperty('platform');
  });
});

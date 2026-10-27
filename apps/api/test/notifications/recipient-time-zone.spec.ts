import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { emailTransportResolverStub } from '../helpers/email-transports.helper';
import { createMockPrismaService, MockPrismaService } from '../mocks/prisma.mock';
import {
  DEFAULT_NOTIFICATION_POLICY,
  EmailNotificationChannel,
  NOTIFICATION_CHANNEL_SENDERS,
  NotificationDeliveryService,
  NotificationPolicyService,
  NotificationsService,
  NOTIFICATION_EVENTS,
  type NotificationChannelSender,
  type NotificationDispatchContext,
} from './support/notifications';

// =============================================================================
// A message renders in the RECIPIENT's time zone
// =============================================================================
//
// The recipient's zone is read with the recipient (`profile.timezone` out of
// `user_settings.value`), travels on `NotificationRecipient.timeZone`, and the
// email channel hands it to the template as the render context's `timeZone`.
// An address with no account has no zone; the caller may pass a hint
// (`NotifyOptions.timeZone`), and an invalid hint is ignored.
// =============================================================================

const EVENT = 'example.webhook_test';
const USER_ID = 'user-1';

describe('NotificationRecipient.timeZone', () => {
  let prisma: MockPrismaService;
  let webhook: jest.Mocked<NotificationChannelSender>;

  async function build(): Promise<NotificationsService> {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationDeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PLATFORM_PRISMA, useValue: prisma },
        { provide: NotificationPolicyService, useValue: { getPolicy: jest.fn().mockResolvedValue(DEFAULT_NOTIFICATION_POLICY) } },
        { provide: NOTIFICATION_CHANNEL_SENDERS, useValue: [webhook] },
      ],
    }).compile();
    return module.get(NotificationsService);
  }

  const seenZone = () => (webhook.deliver.mock.calls[0]![0] as NotificationDispatchContext).recipient.timeZone;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.notificationDelivery.create.mockResolvedValue({ id: 'd-1' } as never);
    prisma.notificationDelivery.update.mockResolvedValue({} as never);
    webhook = {
      channel: 'webhook',
      resolveTo: jest.fn().mockReturnValue('hook:user-1'),
      deliver: jest.fn().mockResolvedValue({ success: true, messageId: 'm-1' }),
    } as unknown as jest.Mocked<NotificationChannelSender>;
  });

  const withSettings = (value: unknown) =>
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, email: 'u@example.test', userSettings: { value } } as never);

  it('carries the stored profile zone to the channel', async () => {
    withSettings({ profile: { imageSource: 'none', timezone: 'America/Costa_Rica' } });
    await (await build()).notifyNow(EVENT, USER_ID, {});
    expect(seenZone()).toBe('America/Costa_Rica');
  });

  it('has no zone for an account on Automatic, and a caller hint fills it', async () => {
    withSettings({ profile: { imageSource: 'none' } });
    await (await build()).notifyNow(EVENT, USER_ID, {});
    expect(seenZone()).toBeNull();

    webhook.deliver.mockClear();
    await (await build()).notifyNow(EVENT, USER_ID, {}, { timeZone: 'Asia/Tokyo' });
    expect(seenZone()).toBe('Asia/Tokyo');
  });

  it('prefers the recipient own zone over the hint, and ignores an invalid hint', async () => {
    withSettings({ profile: { imageSource: 'none', timezone: 'America/Chicago' } });
    await (await build()).notifyNow(EVENT, USER_ID, {}, { timeZone: 'Asia/Tokyo' });
    expect(seenZone()).toBe('America/Chicago');

    webhook.deliver.mockClear();
    withSettings({ profile: { imageSource: 'none' } });
    await (await build()).notifyNow(EVENT, USER_ID, {}, { timeZone: 'Not/AZone' });
    expect(seenZone()).toBeNull();
  });
});

describe('EmailNotificationChannel renders in the recipient zone', () => {
  const event = NOTIFICATION_EVENTS.find((e) => e.key === 'security.role_changed')!;
  const send = jest.fn().mockResolvedValue({ success: true, messageId: 'm' });
  const channel = new EmailNotificationChannel(
    { get: jest.fn().mockResolvedValue({ provider: 'ses', enabled: true, fromAddress: 'from@example.com' }) } as never,
    emailTransportResolverStub({ ses: { send }, smtp: { send } }) as never,
  );
  const data = {
    recipientEmail: 'u@example.com',
    previousRoles: ['viewer'],
    currentRoles: ['admin'],
    changedAt: new Date('2026-10-27T02:42:00.000Z'),
  };

  const textFor = async (timeZone: string | null) => {
    send.mockClear();
    const context: NotificationDispatchContext = {
      event,
      recipient: { userId: USER_ID, email: 'u@example.com', preferences: {}, timeZone },
      data,
      channels: event.channels,
    };
    await channel.deliver(context, 'u@example.com');
    return (send.mock.calls[0]![0] as { text: string }).text;
  };

  it('prints the local time with the zone label and the UTC time alongside', async () => {
    expect(await textFor('America/Chicago')).toContain('Oct 26, 2026, 9:42 PM CDT (Oct 27, 02:42 UTC)');
  });

  it('prints UTC, labelled, when the recipient has no zone', async () => {
    expect(await textFor(null)).toContain('Oct 27, 2026, 2:42 AM UTC');
  });
});

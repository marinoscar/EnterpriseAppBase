import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../mocks/prisma.mock';
import {
  DEFAULT_NOTIFICATION_POLICY,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFICATION_RECIPIENT_HANDLES,
  NotificationDeliveryService,
  NotificationPolicyService,
  NotificationsService,
  type NotificationChannelSender,
  type RecipientHandleSource,
  type ResolveRecipientContext,
} from './support/notifications';

// =============================================================================
// How the dispatcher resolves a recipient (PP-14.10)
// =============================================================================
//
// `resolveRecipient` is the async twin of `resolveTo`: it returns the
// destination the transport needs (`to`) and the label the delivery row stores
// (`display`). The row never stores `to`. `ResolveRecipientContext.handle()`
// reads the app's `RecipientHandleSource` for this recipient and channel.
// `webhook` is registered by the reference app's registrations, so it is a real
// channel of a real event (`example.webhook_test`); its sender here is a fake.
// =============================================================================

const EVENT = 'example.webhook_test';
const USER_ID = 'user-1';

function sender(overrides: Partial<NotificationChannelSender>): jest.Mocked<NotificationChannelSender> {
  return {
    channel: 'webhook',
    deliver: jest.fn().mockResolvedValue({ success: true, messageId: 'm-1' }),
    ...overrides,
  } as jest.Mocked<NotificationChannelSender>;
}

describe('NotificationsService resolves a recipient per channel (PP-14.10)', () => {
  let prisma: MockPrismaService;

  async function build(
    webhook: NotificationChannelSender,
    source?: RecipientHandleSource,
  ): Promise<NotificationsService> {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationDeliveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PLATFORM_PRISMA, useValue: prisma },
        {
          provide: NotificationPolicyService,
          useValue: { getPolicy: jest.fn().mockResolvedValue(DEFAULT_NOTIFICATION_POLICY) },
        },
        { provide: NOTIFICATION_CHANNEL_SENDERS, useValue: [webhook] },
        ...(source ? [{ provide: NOTIFICATION_RECIPIENT_HANDLES, useValue: source }] : []),
      ],
    }).compile();
    return module.get(NotificationsService);
  }

  const createdRow = () =>
    (prisma.notificationDelivery.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.user.findUnique.mockResolvedValue({ id: USER_ID, email: 'u@example.test', userSettings: null } as never);
    prisma.notificationDelivery.create.mockResolvedValue({ id: 'd-1' } as never);
    prisma.notificationDelivery.update.mockResolvedValue({} as never);
  });

  it('stores the redacted display in the row and hands the destination to deliver', async () => {
    const webhook = sender({
      resolveRecipient: jest.fn().mockResolvedValue({ to: 'secret-destination', display: '#ops-alerts' }),
    });
    const service = await build(webhook);

    await service.notifyNow(EVENT, USER_ID, { by: 'Ada' });

    expect(createdRow()).toMatchObject({ channel: 'webhook', recipient: '#ops-alerts', userId: USER_ID });
    expect(JSON.stringify(createdRow())).not.toContain('secret-destination');
    expect(webhook.deliver).toHaveBeenCalledWith(expect.objectContaining({ data: { by: 'Ada' } }), 'secret-destination');
  });

  it('prefers resolveRecipient over resolveTo when a sender has both', async () => {
    const resolveTo = jest.fn().mockReturnValue('legacy@example.test');
    const webhook = sender({
      resolveTo,
      resolveRecipient: jest.fn().mockResolvedValue({ to: 'new', display: 'new-display' }),
    });
    const service = await build(webhook);

    await service.notifyNow(EVENT, USER_ID, {});

    expect(resolveTo).not.toHaveBeenCalled();
    expect(createdRow().recipient).toBe('new-display');
  });

  it('keeps resolveTo working alone: the address is both the destination and the row label', async () => {
    const webhook = sender({ resolveTo: jest.fn().mockReturnValue('hook:user-1') });
    const service = await build(webhook);

    await service.notifyNow(EVENT, USER_ID, {});

    expect(createdRow().recipient).toBe('hook:user-1');
    expect(webhook.deliver).toHaveBeenCalledWith(expect.anything(), 'hook:user-1');
  });

  it('skips the channel with no row and no attempt when the sender cannot reach the recipient', async () => {
    const webhook = sender({ resolveRecipient: jest.fn().mockResolvedValue(null) });
    const service = await build(webhook);

    await service.notifyNow(EVENT, USER_ID, {});

    expect(prisma.notificationDelivery.create).not.toHaveBeenCalled();
    expect(webhook.deliver).not.toHaveBeenCalled();
  });

  it('treats a sender that throws while resolving as unreachable, and never rejects', async () => {
    const webhook = sender({ resolveRecipient: jest.fn().mockRejectedValue(new Error('lookup exploded')) });
    const service = await build(webhook);

    await expect(service.notifyNow(EVENT, USER_ID, {})).resolves.toEqual({ rateLimited: false, retryAfterMs: null });

    expect(prisma.notificationDelivery.create).not.toHaveBeenCalled();
    expect(webhook.deliver).not.toHaveBeenCalled();
  });

  it('never stores the destination when a sender forgot the display, and bounds a long one', async () => {
    const forgetful = sender({ resolveRecipient: jest.fn().mockResolvedValue({ to: 'sk-live-123' }) });
    await (await build(forgetful)).notifyNow(EVENT, USER_ID, {});
    expect(createdRow().recipient).toBe('(redacted)');
    expect(JSON.stringify(createdRow())).not.toContain('sk-live-123');

    prisma.notificationDelivery.create.mockClear();
    const verbose = sender({ resolveRecipient: jest.fn().mockResolvedValue({ to: 'x', display: 'd'.repeat(1000) }) });
    await (await build(verbose)).notifyNow(EVENT, USER_ID, {});
    expect((createdRow().recipient as string).length).toBe(255);
  });

  describe('context.handle()', () => {
    function capturingSender(): { webhook: jest.Mocked<NotificationChannelSender>; context: () => ResolveRecipientContext } {
      let captured: ResolveRecipientContext | undefined;
      const webhook = sender({
        resolveRecipient: jest.fn(async (_recipient, context) => {
          captured = context;
          return { to: 'x', display: 'x' };
        }),
      });
      return { webhook, context: () => captured as ResolveRecipientContext };
    }

    it("reads the app's handle source for this user and this channel", async () => {
      const source: RecipientHandleSource = {
        handleFor: jest.fn().mockResolvedValue({ to: 'U-1', display: '@ada' }),
      };
      const { webhook, context } = capturingSender();
      await (await build(webhook, source)).notifyNow(EVENT, USER_ID, {});

      await expect(context().handle()).resolves.toEqual({ to: 'U-1', display: '@ada' });
      expect(source.handleFor).toHaveBeenCalledWith(USER_ID, 'webhook');
      expect(context().channel).toBe('webhook');
      expect(context().event.key).toBe(EVENT);
    });

    it('answers null when no source is bound', async () => {
      const { webhook, context } = capturingSender();
      await (await build(webhook)).notifyNow(EVENT, USER_ID, {});

      await expect(context().handle()).resolves.toBeNull();
    });

    it('answers null, and does not throw, when the source fails', async () => {
      const source: RecipientHandleSource = { handleFor: jest.fn().mockRejectedValue(new Error('table missing')) };
      const { webhook, context } = capturingSender();
      await (await build(webhook, source)).notifyNow(EVENT, USER_ID, {});

      await expect(context().handle()).resolves.toBeNull();
    });
  });
});

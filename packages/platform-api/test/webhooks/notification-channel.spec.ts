import { withTemporaryEntries } from '../../src/core/index';
import {
  NotificationChannelSenderRegistry,
  eventBrowserTemplateRegistry,
  notificationChannelRegistry,
  notificationEventRegistry,
  type NotificationDispatchContext,
} from '../../src/notifications/index';
import {
  WEBHOOKS_NOTIFICATIONS,
  WEBHOOK_NOTIFICATION_CHANNEL,
  webhookEndpointDisabledBrowserTemplate,
  withWebhookChannel,
} from '../../src/webhooks/index';
import { WebhookNotificationChannel } from '../../src/webhooks/notifications/webhook-notification.channel';
import { KIT_ORG_ID, KIT_USER_A, KIT_USER_B, createWebhooksTestKit, makeWebhookOwner } from '../../src/webhooks/testing/index';

const EVENT = { key: 'example.thing_happened', label: 'Thing happened', description: 'A thing happened.', channels: ['browser', 'webhook'], defaultEnabled: true };
const CHANNELS = [{ id: 'browser', label: 'Browser', description: 'In the app.' }, WEBHOOK_NOTIFICATION_CHANNEL];

function dispatchContext(userId: string, data: unknown = { secretToken: 'do-not-forward', n: 1 }): NotificationDispatchContext {
  return {
    event: EVENT,
    recipient: { userId, email: `${userId}@example.test`, preferences: {}, orgId: KIT_ORG_ID },
    data,
    channels: ['webhook'],
  } as unknown as NotificationDispatchContext;
}

async function withRegistries<R>(fn: () => Promise<R>): Promise<R> {
  return withTemporaryEntries(notificationChannelRegistry, CHANNELS, () =>
    withTemporaryEntries(notificationEventRegistry, [EVENT], () =>
      withTemporaryEntries(eventBrowserTemplateRegistry, [{ eventKey: EVENT.key, render: ((data: { n: number }) => ({ title: 'Thing', body: `Count ${data.n}`, link: '/things' })) as never }], fn),
    ),
  );
}

function channelOver(kit = createWebhooksTestKit()) {
  const registry = new NotificationChannelSenderRegistry([] as never);
  const channel = new WebhookNotificationChannel(registry, kit.webhooks, kit.repository, { organization: { findFirst: async () => ({ id: KIT_ORG_ID }) } } as never);
  return { kit, channel, registry };
}

describe('the webhook notification channel', () => {
  it('is a user-configurable channel that renders raw data and is not critical-capable', () => {
    expect(WEBHOOK_NOTIFICATION_CHANNEL).toMatchObject({ id: 'webhook', label: 'Webhooks', userConfigurable: true, criticalCapable: false, broadcastDefault: false, rendersRawData: true });
    expect(WEBHOOK_NOTIFICATION_CHANNEL.id.length).toBeLessThanOrEqual(32);
  });

  it('registers itself as the sender of the webhook channel', async () => {
    await withRegistries(async () => {
      const { channel, registry } = channelOver();
      channel.onModuleInit();
      expect(registry.get('webhook')).toBe(channel);
    });
  });

  describe('resolveRecipient', () => {
    it('skips the channel (null) for a user with no endpoint subscribed to the event', async () => {
      const { channel, kit } = channelOver();
      const recipient = dispatchContext(KIT_USER_A).recipient;
      const context = { event: EVENT } as never;
      expect(await channel.resolveRecipient(recipient, context)).toBeNull();
      await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['notification.other.event'] });
      expect(await channel.resolveRecipient(recipient, context)).toBeNull();
      await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['notification.example.thing_happened'], enabled: false });
      expect(await channel.resolveRecipient(recipient, context)).toBeNull();
      await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_B, eventKeys: ['notification.*'] });
      expect(await channel.resolveRecipient(recipient, context)).toBeNull();
    });

    it.each([['notification.example.thing_happened'], ['notification.*'], ['*']])('resolves a user whose enabled endpoint subscribes to %s, with a redacted display', async (pattern) => {
      const { channel, kit } = channelOver();
      await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: [pattern] });
      const resolved = await channel.resolveRecipient(dispatchContext(KIT_USER_A).recipient, { event: EVENT } as never);
      expect(resolved).toEqual({ to: KIT_USER_A, display: 'your webhook endpoints' });
      expect(JSON.stringify(resolved)).not.toContain('receiver.example.test');
    });

    it('skips a recipient with no account', async () => {
      const { channel } = channelOver();
      expect(await channel.resolveRecipient({ userId: null, email: 'x@example.test', preferences: {} } as never, { event: EVENT } as never)).toBeNull();
    });
  });

  describe('deliver', () => {
    it('fans the rendered notification out as notification.<key> to the user\'s own endpoints, never the raw data', async () => {
      await withRegistries(async () => {
        const { channel, kit } = channelOver();
        const mine = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['notification.*'] });
        const theirs = await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_B, eventKeys: ['notification.*'] });
        for (const id of [KIT_USER_A, KIT_USER_B]) kit.repository.setOwner(makeWebhookOwner({ id, orgId: KIT_ORG_ID, permissions: ['webhooks:read'] }));

        const result = await channel.deliver(dispatchContext(KIT_USER_A), KIT_USER_A);
        expect(result).toEqual({ success: true });

        const rows = [...kit.repository.deliveries.values()];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ endpointId: mine.endpoint.id, eventKey: 'notification.example.thing_happened' });
        expect(rows[0]!.endpointId).not.toBe(theirs.endpoint.id);
        expect(rows[0]!.payload).toMatchObject({
          type: 'notification.example.thing_happened',
          org: { id: KIT_ORG_ID },
          data: { event: { key: 'example.thing_happened', label: 'Thing happened', description: 'A thing happened.' }, title: 'Thing', body: 'Count 1', link: '/things', fields: null },
        });
        expect(JSON.stringify(rows[0]!.payload)).not.toContain('do-not-forward');
        expect(kit.receiver.requests).toHaveLength(0);
      });
    });

    it('falls back to the event label when nothing renders it, and never throws', async () => {
      await withTemporaryEntries(notificationChannelRegistry, CHANNELS, () =>
        withTemporaryEntries(notificationEventRegistry, [EVENT], async () => {
          const { channel, kit } = channelOver();
          await kit.seedEndpoint({ scope: 'user', ownerUserId: KIT_USER_A, eventKeys: ['notification.*'] });
          kit.repository.setOwner(makeWebhookOwner({ id: KIT_USER_A, orgId: KIT_ORG_ID, permissions: ['webhooks:read'] }));
          await expect(channel.deliver(dispatchContext(KIT_USER_A), KIT_USER_A)).resolves.toEqual({ success: true });
          expect([...kit.repository.deliveries.values()][0]!.payload).toMatchObject({ data: { title: 'Thing happened', body: 'A thing happened.', link: null } });

          jest.spyOn(kit.webhooks, 'emitForUser').mockRejectedValueOnce(new Error('db down: postgres://user:pw@host/db'));
          const failed = await channel.deliver(dispatchContext(KIT_USER_A), KIT_USER_A);
          expect(failed).toEqual({ success: false, error: 'The webhook fan-out failed' });
          expect(JSON.stringify(failed)).not.toContain('postgres');
        }),
      );
    });

    it('survives a throwing renderer and every payload shape', async () => {
      await withTemporaryEntries(notificationChannelRegistry, CHANNELS, () =>
        withTemporaryEntries(notificationEventRegistry, [EVENT], () =>
          withTemporaryEntries(eventBrowserTemplateRegistry, [{ eventKey: EVENT.key, render: (() => { throw new Error('boom'); }) as never }], async () => {
            const { channel } = channelOver();
            const circular: Record<string, unknown> = {};
            circular.self = circular;
            for (const data of [undefined, null, 'text', circular]) {
              await expect(channel.deliver(dispatchContext(KIT_USER_A, data), KIT_USER_A)).resolves.toEqual(expect.objectContaining({ success: expect.any(Boolean) }));
            }
          }),
        ),
      );
    });
  });
});

describe('withWebhookChannel and the slice\'s own notification', () => {
  const base = { event: { key: 'a.b', label: 'L', description: 'D', channels: ['email'], defaultEnabled: true }, emailTemplate: 'x' } as never;

  it('appends the channel without touching the input, and is idempotent', () => {
    const input = [base];
    const once = withWebhookChannel(input);
    expect(once[0]!.event.channels).toEqual(['email', 'webhook']);
    expect((base as { event: { channels: string[] } }).event.channels).toEqual(['email']);
    expect(once[0]!.emailTemplate).toBe('x');
    expect(withWebhookChannel(once)[0]).toBe(once[0]);
  });

  it('leaves an event with no channels alone, so the registry still rejects it', () => {
    const empty = { event: { key: 'a.b', label: 'L', description: 'D', channels: [], defaultEnabled: true } } as never;
    expect(withWebhookChannel([empty])[0]).toBe(empty);
  });

  it('leaves the slice\'s own endpoint-disabled event alone', () => {
    expect(withWebhookChannel(WEBHOOKS_NOTIFICATIONS)[0]!.event.channels).toEqual(['email', 'browser']);
  });

  it('declares webhooks.endpoint_disabled on email and browser, on by default and not mandatory', () => {
    expect(WEBHOOKS_NOTIFICATIONS).toHaveLength(1);
    expect(WEBHOOKS_NOTIFICATIONS[0]).toMatchObject({
      event: { key: 'webhooks.endpoint_disabled', channels: ['email', 'browser'], defaultEnabled: true },
      emailTemplate: 'webhook-endpoint-disabled',
    });
    expect((WEBHOOKS_NOTIFICATIONS[0]!.event as { mandatory?: boolean }).mandatory).toBeUndefined();
  });

  it('words the bell notification for each reason and each scope, with a root-relative link', () => {
    const data = { endpointId: 'e', endpointName: 'Ops', scope: 'user', reason: 'circuit_open', host: 'receiver.example.test' };
    expect(webhookEndpointDisabledBrowserTemplate(data)).toEqual({
      title: 'A webhook endpoint was disabled',
      body: '"Ops" (receiver.example.test) was switched off because it failed too many times in a row. Fix the receiver, then enable it again.',
      link: '/settings/webhooks',
    });
    expect(webhookEndpointDisabledBrowserTemplate({ ...data, reason: 'gone', scope: 'org' })).toMatchObject({ link: '/admin/settings/org-webhooks', body: expect.stringContaining('410 Gone') });
    expect(webhookEndpointDisabledBrowserTemplate({ ...data, scope: 'system' }).link).toBe('/admin/settings/webhooks');
  });
});

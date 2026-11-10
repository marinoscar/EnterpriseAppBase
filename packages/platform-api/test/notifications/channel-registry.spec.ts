// The open channel registry (issue #738): an app registers a channel and an
// event with no edit to a package file, and the sender registry accepts its
// transport.
import { RegistryError } from '../../src/core/index';
import { withTemporaryEntries } from '../../src/core/registry/index';
import { NotificationChannelSenderRegistry } from '../../src/notifications/registry/channel-sender.registry';
import {
  isRegisteredNotificationChannel,
  listNotificationChannels,
  notificationChannelRegistry,
  registerNotificationChannel,
} from '../../src/notifications/registry/channel.registry';
import {
  eventBrowserTemplateRegistry,
  registerBrowserNotificationTemplate,
} from '../../src/notifications/registry/bindings.registry';
import { notificationEventRegistry, registerNotificationEvent } from '../../src/notifications/registry/event.registry';
import {
  PLATFORM_NOTIFICATION_CHANNELS,
  registerPlatformNotificationChannels,
} from '../../src/notifications/registry/platform-channels';
import type { NotificationChannelSender } from '../../src/notifications/notification.types';
import { registerTestNotifications } from './support';

registerTestNotifications();

function sender(channel: string): NotificationChannelSender {
  return { channel, resolveTo: () => 'to', deliver: async () => ({ success: true }) };
}

describe('the notification channel registry (#738)', () => {
  it('holds the platform channels first, and registering them again is a no-op', () => {
    expect(listNotificationChannels().map((channel) => channel.id)).toEqual(['email', 'browser', 'push']);
    expect(() => registerPlatformNotificationChannels()).not.toThrow();
    expect(notificationChannelRegistry.ids()).toEqual(PLATFORM_NOTIFICATION_CHANNELS.map((channel) => channel.id));
  });

  it('registers an app channel, an event over it and its renderer, with no package edit', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [], async () => {
      registerNotificationChannel({
        id: 'example_webhook',
        label: 'Webhook',
        description: 'A JSON POST to the account URL.',
        userConfigurable: true,
      });
      await withTemporaryEntries(notificationEventRegistry, [], async () => {
        registerNotificationEvent({
          key: 'billing.invoice_ready',
          label: 'Invoice ready',
          description: 'A new invoice is ready.',
          channels: ['example_webhook', 'browser'],
          defaultEnabled: true,
        });
        await withTemporaryEntries(eventBrowserTemplateRegistry, [], () => {
          registerBrowserNotificationTemplate('billing.invoice_ready', () => ({ title: 'Invoice', body: 'Ready' }));
          expect(isRegisteredNotificationChannel('example_webhook')).toBe(true);
          expect(eventBrowserTemplateRegistry.require('billing.invoice_ready').render({} as never)).toEqual({
            title: 'Invoice',
            body: 'Ready',
          });
        });
      });
    });
    // Restored: the temporary channel is gone again.
    expect(isRegisteredNotificationChannel('example_webhook')).toBe(false);
  });

  it('refuses a malformed id, an empty label, a duplicate and an over-long id', () => {
    const code = (fn: () => void): string | undefined => {
      try {
        fn();
      } catch (err) {
        return (err as RegistryError).code;
      }
      return undefined;
    };
    expect(code(() => registerNotificationChannel({ id: 'Bad-Id', label: 'x', description: 'x' }))).toBe('INVALID_ID');
    expect(code(() => registerNotificationChannel({ id: 'nolabel', label: '', description: 'x' }))).toBe('INVALID_ENTRY');
    expect(code(() => registerNotificationChannel({ id: 'email', label: 'Email', description: 'again' }))).toBe('DUPLICATE_ID');
    expect(code(() => registerNotificationChannel({ id: `c${'x'.repeat(40)}`, label: 'x', description: 'x' }))).toBe(
      'INVALID_ENTRY',
    );
  });

  it('accepts an app sender for a registered channel and refuses one for an undeclared channel', async () => {
    await withTemporaryEntries(
      notificationChannelRegistry,
      [{ id: 'example_webhook', label: 'Webhook', description: 'A JSON POST.' }],
      () => {
        const registry = new NotificationChannelSenderRegistry([sender('email'), sender('browser'), sender('push')]);
        const app = sender('example_webhook');
        registry.register(app);
        expect(registry.get('example_webhook')).toBe(app);
        // A platform sender is never handed out.
        expect(registry.get('email')).toBeUndefined();
        expect(() => registry.register(sender('sms'))).toThrow(/not a registered notification channel/);
        expect(() => registry.register(sender('email'))).toThrow(/Duplicate notification channel sender/);
      },
    );
  });
});

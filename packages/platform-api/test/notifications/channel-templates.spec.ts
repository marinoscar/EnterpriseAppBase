// Per-channel templates (PP-14.10): a registry validated like the email and
// browser bindings, atomic with the event in `registerNotification`, read by a
// sender through `renderChannelPayload`, and checked by the conformance suite.
import { RegistryError } from '../../src/core/index';
import { withTemporaryEntries } from '../../src/core/registry/index';
import {
  channelTemplateRegistry,
  registerChannelTemplate,
  renderChannelPayload,
} from '../../src/notifications/registry/channel-template.registry';
import { registerNotification } from '../../src/notifications/registry/bindings.registry';
import { notificationChannelRegistry, registerNotificationChannel } from '../../src/notifications/registry/channel.registry';
import { notificationEventRegistry } from '../../src/notifications/registry/event.registry';
import { checkChannelTemplates } from '../../src/notifications/testing/index';
import type { NotificationDispatchContext } from '../../src/notifications/notification.types';
import { registerTestNotifications } from './support';

registerTestNotifications();

const CHANNEL = { id: 'slack', label: 'Slack', description: 'A message in the user\'s Slack.' };
const EVENT = {
  key: 'billing.invoice_ready',
  label: 'Invoice ready',
  description: 'An invoice is ready.',
  channels: ['slack'],
  defaultEnabled: true,
};
const render = (data: { number: string }) => ({ title: 'Invoice ready', body: `Invoice ${data.number} is ready.`, link: '/billing' });

/** Runs `fn` with a Slack channel registered and the template registries restored afterwards. */
function withSlack(fn: () => void): Promise<void> {
  return withTemporaryEntries(notificationChannelRegistry, [], () =>
    withTemporaryEntries(notificationEventRegistry, [], () =>
      withTemporaryEntries(channelTemplateRegistry, [], () => {
        registerNotificationChannel(CHANNEL);
        fn();
      }),
    ),
  );
}

const code = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof RegistryError ? err.code : 'other';
  }
  return undefined;
};

describe('the channel template registry', () => {
  it('binds an event\'s template over a channel the event declares, and renders it', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT, channelTemplates: { slack: render } });

      const context = {
        event: EVENT,
        recipient: { userId: 'u1', email: null, preferences: {} },
        data: { number: '42' },
        channels: ['slack'],
      } as NotificationDispatchContext;
      expect(renderChannelPayload('slack', context)).toEqual({ title: 'Invoice ready', body: 'Invoice 42 is ready.', link: '/billing' });
      expect(renderChannelPayload('sms', context)).toBeNull();
    });
  });

  it('binds a template to an event another module registered', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT });
      registerChannelTemplate({ channelId: 'slack', eventKey: EVENT.key, render });
      expect(channelTemplateRegistry.has('slack:billing.invoice_ready')).toBe(true);
    });
  });

  it('refuses a template for an unregistered channel, an unregistered event, or an event that does not declare the channel', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT });
      expect(code(() => registerChannelTemplate({ channelId: 'sms', eventKey: EVENT.key, render }))).toBe('INVALID_ENTRY');
      expect(code(() => registerChannelTemplate({ channelId: 'slack', eventKey: 'no.such_event', render }))).toBe('INVALID_ENTRY');
      expect(code(() => registerChannelTemplate({ channelId: 'slack', eventKey: 'user.welcome', render }))).toBe('INVALID_ENTRY');
      expect(code(() => registerChannelTemplate({ channelId: 'slack', eventKey: EVENT.key, render: 'nope' as never }))).toBe('INVALID_ENTRY');
    });
  });

  it('refuses a second template for the same pair', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT, channelTemplates: { slack: render } });
      expect(code(() => registerChannelTemplate({ channelId: 'slack', eventKey: EVENT.key, render }))).toBe('DUPLICATE_ID');
    });
  });

  it('is atomic with the event: a bad template leaves no event behind', async () => {
    await withSlack(() => {
      expect(
        code(() => registerNotification({ event: EVENT, channelTemplates: { slack: render, sms: render } })),
      ).toBe('INVALID_ENTRY');
      expect(notificationEventRegistry.has(EVENT.key)).toBe(false);
      expect(channelTemplateRegistry.size).toBe(0);
    });
  });
});

describe('the channel-templates conformance check', () => {
  it('reports an event bound for an app channel that has no template', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT });
      expect(checkChannelTemplates()).toEqual([
        {
          file: 'notifications-channel-templates',
          message: expect.stringContaining('event "billing.invoice_ready" is bound for channel "slack" but has no template'),
        },
      ]);
    });
  });

  it('passes once the template is registered', async () => {
    await withSlack(() => {
      registerNotification({ event: EVENT, channelTemplates: { slack: render } });
      expect(checkChannelTemplates()).toEqual([]);
    });
  });

  it('passes a channel that declares it renders from the raw data', async () => {
    await withTemporaryEntries(notificationChannelRegistry, [], () =>
      withTemporaryEntries(notificationEventRegistry, [], () => {
        registerNotificationChannel({ ...CHANNEL, rendersRawData: true });
        registerNotification({ event: EVENT });
        expect(checkChannelTemplates()).toEqual([]);
      }),
    );
  });

  it('does not ask the platform channels for templates: they have registries of their own', () => {
    expect(checkChannelTemplates()).toEqual([]);
  });
});

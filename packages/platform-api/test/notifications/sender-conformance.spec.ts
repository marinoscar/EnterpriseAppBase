// The notification sender conformance kit (PP-14.10): a conformant sender passes
// it, and each contract violation fails the scenario that names it.
import { registerNotificationChannel } from '../../src/notifications/registry/channel.registry';
import type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationRecipient,
} from '../../src/notifications/notification.types';
import {
  describeNotificationSenderConformance,
  type NotificationSenderConformanceOptions,
} from '../../src/notifications/testing/index';
import { registerTestNotifications } from './support';

registerTestNotifications();
registerNotificationChannel({ id: 'kit_chat', label: 'Kit chat', description: 'A chat channel the kit tests.' });

const SECRET = 'xoxb-secret-token';
const REACHABLE: NotificationRecipient = { userId: 'user-1', email: null, preferences: {} };

/** A conformant sender: the base every violation below breaks in one way. */
function good(overrides: Partial<NotificationChannelSender> = {}): NotificationChannelSender {
  return {
    channel: 'kit_chat',
    async resolveRecipient(recipient) {
      return recipient.userId ? { to: `member-${recipient.userId}`, display: '@member' } : null;
    },
    async deliver(_context, to): Promise<ChannelDeliveryResult> {
      return to ? { success: true, messageId: 'kit-1' } : { success: false, error: 'No destination.' };
    },
    ...overrides,
  };
}

/** Runs the kit with a harness that collects each case's outcome instead of registering it with Jest. */
async function failures(
  sender: NotificationChannelSender,
  options: Partial<NotificationSenderConformanceOptions> = {},
): Promise<string[]> {
  const cases: Array<{ name: string; fn: () => Promise<void> }> = [];
  describeNotificationSenderConformance(sender, {
    describe: (_name, fn) => fn(),
    it: (name, fn) => cases.push({ name, fn }),
    expect: expect as never,
    recipient: REACHABLE,
    secrets: [SECRET],
    ...options,
  });
  const failed: string[] = [];
  for (const entry of cases) {
    try {
      await entry.fn();
    } catch {
      failed.push(entry.name);
    }
  }
  return failed;
}

// A conformant sender registers its cases with Jest like any other suite.
describeNotificationSenderConformance(good(), {
  describe,
  it,
  expect,
  recipient: REACHABLE,
  secrets: [SECRET],
  breakTransport: () => undefined,
  skip: ['transportDown'],
});

describe('what the sender conformance kit catches', () => {
  it('passes a conformant sender, with every scenario', async () => {
    expect(await failures(good())).toEqual([]);
  });

  it('fails a sender whose channel is not registered', async () => {
    expect(await failures(good({ channel: 'nobody_registered_this' }))).toContain('is a registered channel with a resolver');
  });

  it('fails a sender with no resolver at all', async () => {
    const failed = await failures(good({ resolveRecipient: undefined }));
    expect(failed).toContain('is a registered channel with a resolver');
  });

  it('fails a display that carries a secret', async () => {
    const failed = await failures(good({ resolveRecipient: async () => ({ to: 'x', display: `hook ${SECRET}` }) }));
    expect(failed).toContain('resolves a reachable recipient, with a redacted display that carries no secret');
  });

  it('fails a sender that reaches a recipient with no account', async () => {
    const failed = await failures(good({ resolveRecipient: async () => ({ to: 'everyone', display: 'everyone' }) }));
    expect(failed).toContain('resolves an unreachable recipient to null instead of throwing');
  });

  it('fails a deliver that throws, for a normal payload and for odd ones', async () => {
    const failed = await failures(
      good({
        async deliver() {
          throw new Error('boom');
        },
      }),
    );
    expect(failed).toEqual(
      expect.arrayContaining([
        'delivers to a reachable recipient and reports the outcome as a result',
        'never throws, whatever the payload',
        'fails a delivery to an empty destination with a reason',
      ]),
    );
  });

  it('fails a deliver that cannot cope with a circular payload', async () => {
    const failed = await failures(
      good({
        async deliver(context) {
          JSON.stringify(context.data);
          return { success: true };
        },
      }),
    );
    expect(failed).toContain('never throws, whatever the payload');
  });

  it('fails an error that echoes a secret, and a failure with no reason', async () => {
    expect(
      await failures(good({ deliver: async () => ({ success: false, error: `401 for ${SECRET}` }) })),
    ).toContain('puts no secret in the delivery row label, the error or the message id');
    expect(await failures(good({ deliver: async () => ({ success: false }) }))).toContain(
      'fails a delivery to an empty destination with a reason',
    );
  });

  it('fails a delivery to an empty destination that reports success', async () => {
    const failed = await failures(good({ deliver: async () => ({ success: true }) }));
    expect(failed).toContain('fails a delivery to an empty destination with a reason');
  });

  it('exercises a down transport only when it can be broken, and fails a sender that reports success through it', async () => {
    const down = { broken: false };
    const sender = good({
      async deliver() {
        return down.broken ? { success: true } : { success: true, messageId: 'ok' };
      },
    });
    const failed = await failures(sender, {
      breakTransport: () => {
        down.broken = true;
        return () => {
          down.broken = false;
        };
      },
    });
    expect(failed).toContain('reports a failed delivery, never a throw, when the transport is down');
    expect(await failures(good())).not.toContain('reports a failed delivery, never a throw, when the transport is down');
  });

  it('skips a scenario by name', async () => {
    const leaky = good({ resolveRecipient: async (recipient) => (recipient.userId ? { to: 'x', display: SECRET } : null) });
    expect(await failures(leaky)).not.toEqual([]);
    const failed = await failures(leaky, { skip: ['resolve', 'noSecret'] });
    expect(failed).toEqual([]);
  });
});

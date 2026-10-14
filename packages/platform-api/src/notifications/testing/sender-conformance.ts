// =============================================================================
// Notification channel sender conformance kit (PP-14.10)
// =============================================================================
//
// ONE suite every channel transport runs, so "implements
// `NotificationChannelSender`" means the same thing for the platform's senders
// and for an app's own (Slack, SMS, Teams, a webhook). It exercises the sender
// the way the dispatcher does: resolve the recipient, then deliver.
//
//   import { describeNotificationSenderConformance } from '@marinoscar/platform-api/notifications/testing';
//
//   describeNotificationSenderConformance(sender, {
//     describe, it, expect,
//     recipient: { userId: 'user-1', email: 'u1@example.test', preferences: {} },
//     secrets: [WEBHOOK_URL],
//   });
//
// Runner-agnostic like `describeStorageDriverConformance`: it receives
// `describe`, `it` and `expect`, so Jest and Vitest both work and the package
// imports no test framework. Nothing here needs a network: point the sender at
// a fake transport.
//
// WHAT IT CHECKS
//
//   - the definition: the channel is registered and the sender implements at
//     least one of `resolveRecipient` and `resolveTo`;
//   - a reachable recipient resolves to a destination with a non-empty
//     `display`, and the `display` (what the delivery row stores) carries none
//     of the declared `secrets`;
//   - an unreachable recipient resolves to `null` (the dispatcher then skips the
//     channel: no row, no attempt) and resolving never throws;
//   - `deliver` NEVER THROWS: for a normal payload, for payloads of every
//     shape (`undefined`, `null`, a string, a circular object), and when the
//     transport is down (the optional `breakTransport` hook);
//   - a destination that cannot be delivered to (empty) is a failed delivery
//     with a non-empty reason, not a throw and not a success;
//   - no secret in what the sender returns: `error` and `messageId` carry none
//     of the declared `secrets`, on success and on failure;
//   - the channel kill switch: with the channel switched off in the policy the
//     channel drops out of the event's channels for everyone, including a
//     `mandatory` event, while the policy's other channels are unaffected.
// =============================================================================

import { isChannelSwitchedOn, policyChannels, type NotificationPolicy } from '../notification-policy';
import { resolveChannels } from '../notification-preferences';
import type {
  ChannelDeliveryResult,
  NotificationChannelSender,
  NotificationDispatchContext,
  NotificationRecipient,
  RecipientHandle,
  ResolveRecipientContext,
} from '../notification.types';
import type { RecipientHandleSource } from '../ports';
import type { NotificationEventDef } from '../registry/event.registry';
import { notificationChannelRegistry } from '../registry/channel.registry';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface NotificationSenderConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type NotificationSenderConformanceScenario =
  | 'definition'
  | 'resolve'
  | 'unreachable'
  | 'deliver'
  | 'payloads'
  | 'transportDown'
  | 'badDestination'
  | 'noSecret'
  | 'killSwitch';

/**
 * Options of {@link describeNotificationSenderConformance}.
 *
 * @stability experimental
 */
export interface NotificationSenderConformanceOptions extends NotificationSenderConformanceHarness {
  /** A recipient the sender CAN reach (for a handle-based sender, one the {@link handles} source has a handle for). */
  recipient: NotificationRecipient;
  /** A recipient it cannot reach. Default: no account, no address, no preferences. */
  unreachableRecipient?: NotificationRecipient;
  /** The app's handle source, as the dispatcher would hand it to `resolveRecipient` through `context.handle()`. Default: none (`handle()` answers `null`). */
  handles?: RecipientHandleSource;
  /**
   * The event the sender is exercised with. Default: a synthetic event
   * declaring only the sender's channel. Pass a real event when the sender's
   * template is bound to it.
   */
  event?: NotificationEventDef;
  /** The payload of the normal delivery. Default `{ message: 'conformance' }`. */
  data?: unknown;
  /** Strings that must appear in neither the delivery row's `display`, nor `error`, nor `messageId` (tokens, webhook URLs, phone numbers). */
  secrets?: readonly string[];
  /**
   * Makes the transport fail (a fake that rejects, a refused connection) and
   * returns a function that restores it. Without it the `transportDown`
   * scenario has nothing to break and is skipped.
   */
  breakTransport?: () => (() => void) | void | Promise<(() => void) | void>;
  /** Scenarios to skip, each for a stated reason of the caller's. */
  skip?: readonly NotificationSenderConformanceScenario[];
}

const SYNTHETIC_EVENT_KEY = 'conformance.ping';

function syntheticEvent(channel: string, mandatory = false): NotificationEventDef {
  return {
    key: SYNTHETIC_EVENT_KEY,
    label: 'Conformance ping',
    description: 'A synthetic event the sender conformance kit dispatches.',
    channels: [channel],
    defaultEnabled: true,
    ...(mandatory ? { mandatory: true } : {}),
  };
}

function circular(): unknown {
  const value: Record<string, unknown> = { name: 'loop' };
  value.self = value;
  return value;
}

/**
 * Registers the notification channel sender conformance suite.
 *
 * @param sender - the transport under test (constructed with its fakes).
 * @param options - the runner, a reachable recipient and what the sender must never leak.
 *
 * @example
 * ```ts
 * import { describeNotificationSenderConformance } from '@marinoscar/platform-api/notifications/testing';
 *
 * describeNotificationSenderConformance(sender, { describe, it, expect, recipient, handles, secrets: [url] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeNotificationSenderConformance(
  sender: NotificationChannelSender,
  options: NotificationSenderConformanceOptions,
): void {
  const { describe, it, expect } = options;
  const skip = new Set(options.skip ?? []);
  const channel = sender.channel;
  const event = options.event ?? syntheticEvent(channel);
  const secrets = options.secrets ?? [];
  const unreachable: NotificationRecipient = options.unreachableRecipient ?? { userId: null, email: null, preferences: {} };

  const resolveContext = (): ResolveRecipientContext => ({
    channel,
    event,
    handle: async (): Promise<RecipientHandle | null> =>
      options.handles && options.recipient.userId ? options.handles.handleFor(options.recipient.userId, channel) : null,
  });

  const unreachableContext = (): ResolveRecipientContext => ({
    channel,
    event,
    handle: async (): Promise<RecipientHandle | null> =>
      options.handles && unreachable.userId ? options.handles.handleFor(unreachable.userId, channel) : null,
  });

  /** Resolves the way the dispatcher does. */
  const resolve = async (
    recipient: NotificationRecipient,
    context: ResolveRecipientContext,
  ): Promise<{ to: string; display: string } | null> => {
    if (sender.resolveRecipient) return sender.resolveRecipient(recipient, context);
    const to = sender.resolveTo?.(recipient) ?? null;
    return to ? { to, display: to } : null;
  };

  const dispatchContext = (data: unknown, recipient: NotificationRecipient = options.recipient): NotificationDispatchContext => ({
    event,
    recipient,
    data,
    channels: [channel],
  });

  const leaks = (text: string | undefined): string[] => secrets.filter((secret) => secret !== '' && (text ?? '').includes(secret));

  const checkResult = (result: ChannelDeliveryResult): void => {
    expect(typeof result).toBe('object');
    expect(typeof result.success).toBe('boolean');
    expect(leaks(result.error)).toEqual([]);
    expect(leaks(result.messageId)).toEqual([]);
    if (!result.success) {
      expect(typeof result.error).toBe('string');
      expect((result.error ?? '').length).toBeGreaterThan(0);
    }
  };

  const scenario = (name: NotificationSenderConformanceScenario, title: string, body: () => Promise<void>): void => {
    if (!skip.has(name)) it(title, body);
  };

  describe(`notification channel sender conformance: ${channel}`, () => {
    scenario('definition', 'is a registered channel with a resolver', async () => {
      expect(notificationChannelRegistry.has(channel)).toBe(true);
      expect(typeof sender.resolveRecipient === 'function' || typeof sender.resolveTo === 'function').toBe(true);
      expect(typeof sender.deliver).toBe('function');
    });

    scenario('resolve', 'resolves a reachable recipient, with a redacted display that carries no secret', async () => {
      const resolved = await resolve(options.recipient, resolveContext());
      expect(resolved).not.toBeNull();
      expect(typeof resolved?.to).toBe('string');
      expect((resolved?.to ?? '').length).toBeGreaterThan(0);
      expect(typeof resolved?.display).toBe('string');
      expect((resolved?.display ?? '').length).toBeGreaterThan(0);
      expect(leaks(resolved?.display)).toEqual([]);
    });

    scenario('unreachable', 'resolves an unreachable recipient to null instead of throwing', async () => {
      await expect(resolve(unreachable, unreachableContext())).resolves.toBeNull();
    });

    scenario('deliver', 'delivers to a reachable recipient and reports the outcome as a result', async () => {
      const resolved = await resolve(options.recipient, resolveContext());
      expect(resolved).not.toBeNull();
      const result = await sender.deliver(dispatchContext(options.data ?? { message: 'conformance' }), (resolved as { to: string }).to);
      checkResult(result);
    });

    scenario('payloads', 'never throws, whatever the payload', async () => {
      const resolved = await resolve(options.recipient, resolveContext());
      expect(resolved).not.toBeNull();
      const to = (resolved as { to: string }).to;
      for (const data of [undefined, null, 'text', 42, [], {}, circular()]) {
        const result = await sender.deliver(dispatchContext(data), to);
        checkResult(result);
      }
    });

    if (options.breakTransport) {
      const breakTransport = options.breakTransport;
      scenario('transportDown', 'reports a failed delivery, never a throw, when the transport is down', async () => {
        const resolved = await resolve(options.recipient, resolveContext());
        expect(resolved).not.toBeNull();
        const restore = await breakTransport();
        try {
          const result = await sender.deliver(dispatchContext(options.data ?? { message: 'conformance' }), (resolved as { to: string }).to);
          checkResult(result);
          expect(result.success).toBe(false);
        } finally {
          if (typeof restore === 'function') restore();
        }
      });
    }

    scenario('badDestination', 'fails a delivery to an empty destination with a reason', async () => {
      const result = await sender.deliver(dispatchContext({ message: 'conformance' }), '');
      checkResult(result);
      expect(result.success).toBe(false);
    });

    scenario('noSecret', 'puts no secret in the delivery row label, the error or the message id', async () => {
      const resolved = await resolve(options.recipient, resolveContext());
      expect(resolved).not.toBeNull();
      expect(leaks(resolved?.display)).toEqual([]);
      const ok = await sender.deliver(dispatchContext({ message: 'conformance' }), (resolved as { to: string }).to);
      expect(leaks(ok.error)).toEqual([]);
      expect(leaks(ok.messageId)).toEqual([]);
      const bad = await sender.deliver(dispatchContext({ message: 'conformance' }), '');
      expect(leaks(bad.error)).toEqual([]);
    });

    scenario('killSwitch', 'is dropped from every dispatch when an administrator switches the channel off', async () => {
      const off: NotificationPolicy = { browserEnabled: true, disabledEvents: [], channels: { [channel]: { enabled: false } } };
      const on: NotificationPolicy = { browserEnabled: true, disabledEvents: [], channels: { [channel]: { enabled: true } } };
      expect(isChannelSwitchedOn(channel, off)).toBe(false);
      expect(isChannelSwitchedOn(channel, on)).toBe(true);
      expect(isChannelSwitchedOn(channel, { browserEnabled: true, disabledEvents: [] })).toBe(true);

      for (const candidate of [syntheticEvent(channel), syntheticEvent(channel, true)]) {
        expect(policyChannels(candidate, on)).toContain(channel);
        expect(policyChannels(candidate, off)).not.toContain(channel);
        expect(resolveChannels(candidate, {}, off)).not.toContain(channel);
        expect(resolveChannels(candidate, {}, on)).toContain(channel);
      }
    });
  });
}

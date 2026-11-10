// Open preference keys (issue #738): the `notifications` user namespace is
// keyed by any well-formed channel id. A PATCH may only write a NEW preference
// for a registered, user-configurable channel; deleting any channel's
// preferences is always allowed; and a preference stored for a channel that is
// no longer registered survives a PATCH of another channel.
import { withTemporaryEntries } from '../../src/core/registry/index';
import { readNotificationPreferences, isChannelEnabled } from '../../src/notifications/notification-preferences';
import {
  NOTIFICATIONS_USER_SETTINGS,
  notificationsPatchSchema,
} from '../../src/notifications/notifications.user-settings';
import { notificationChannelRegistry } from '../../src/notifications/registry/channel.registry';
import { registerTestNotifications, WELCOME_EVENT } from './support';

registerTestNotifications();

const stored = {
  email: { 'user.welcome': false },
  // A channel an earlier build registered and this one does not.
  android_app: { 'user.welcome': true },
};

describe('open notification preference keys (#738)', () => {
  it('stores any well-formed channel id and refuses a malformed one', () => {
    expect(NOTIFICATIONS_USER_SETTINGS.schema.safeParse(stored).success).toBe(true);
    expect(NOTIFICATIONS_USER_SETTINGS.schema.safeParse({ 'Not An Id': {} }).success).toBe(false);
  });

  it('keeps preferences stored for an unregistered channel across a PATCH of another channel', () => {
    const patch = notificationsPatchSchema.parse({ email: { 'user.welcome': true } });
    const merged = NOTIFICATIONS_USER_SETTINGS.merge(stored, patch);
    expect(merged).toEqual({ email: { 'user.welcome': true }, android_app: { 'user.welcome': true } });
  });

  it('refuses a PATCH that writes a new preference for an unregistered channel', () => {
    const result = notificationsPatchSchema.safeParse({ sms: { 'user.welcome': true } });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/not a registered notification channel/);
  });

  it('allows deleting an unregistered channel, so a stale preference can be cleared', () => {
    const patch = notificationsPatchSchema.parse({ android_app: null });
    expect(NOTIFICATIONS_USER_SETTINGS.merge(stored, patch)).toEqual({ email: { 'user.welcome': false } });
  });

  it('accepts a newly registered app channel and refuses one users may not configure', async () => {
    await withTemporaryEntries(
      notificationChannelRegistry,
      [
        { id: 'example_webhook', label: 'Webhook', description: 'A JSON POST.' },
        { id: 'audit_sink', label: 'Audit', description: 'The audit sink.', userConfigurable: false },
      ],
      () => {
        expect(notificationsPatchSchema.safeParse({ example_webhook: { 'user.welcome': false } }).success).toBe(true);
        expect(notificationsPatchSchema.safeParse({ audit_sink: { 'user.welcome': false } }).success).toBe(false);
        // A non-configurable channel follows the event default whatever is stored.
        const prefs = readNotificationPreferences({ notifications: { audit_sink: { 'user.welcome': false } } });
        expect(isChannelEnabled(WELCOME_EVENT, 'audit_sink', prefs)).toBe(true);
      },
    );
  });

  it('ignores an unregistered channel when reading preferences for dispatch, without dropping it from storage', () => {
    const prefs = readNotificationPreferences({ notifications: stored });
    expect(prefs).toEqual({ email: { 'user.welcome': false } });
    expect(isChannelEnabled(WELCOME_EVENT, 'email', prefs)).toBe(false);
  });

  it('bounds the number of channels on the merged value', () => {
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i}`, { 'user.welcome': true }]));
    expect(() => NOTIFICATIONS_USER_SETTINGS.assertLimits(many)).toThrow(/Too many notification channels/);
  });
});

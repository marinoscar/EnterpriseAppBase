// The per-channel policy (PP-14.10): a switch for every channel in the
// `notifications` system namespace, `browserEnabled` kept as the browser
// channel's alias, an org layer that only tightens, and one function
// (`policyChannels`) both the preferences matrix and the dispatcher call.
import type { SettingsReadHelpers } from '../../src/settings/index';
import { NOTIFICATIONS_SYSTEM_SETTINGS, tightenNotificationsPolicy } from '../../src/notifications/notifications.system-settings';
import {
  DEFAULT_NOTIFICATION_POLICY,
  isBrowserToastAllowed,
  isChannelSwitchedOn,
  policyChannels,
  type NotificationPolicy,
} from '../../src/notifications/notification-policy';
import { resolveChannels } from '../../src/notifications/notification-preferences';
import type { NotificationEventDef } from '../../src/notifications/registry/event.registry';
import { registerTestNotifications } from './support';

registerTestNotifications();

/** The read helpers the settings service hands a namespace's `read` (the plain subset it uses). */
const helpers = {
  asPlainObject: (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined,
  readStringArray: (value: unknown, _schema: unknown, max: number) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, max) : [],
} as unknown as SettingsReadHelpers;

const read = (stored: unknown) => NOTIFICATIONS_SYSTEM_SETTINGS.read(stored, helpers);

const EVENT: NotificationEventDef = {
  key: 'billing.invoice_ready',
  label: 'Invoice ready',
  description: 'An invoice is ready.',
  channels: ['email', 'browser', 'push'],
  defaultEnabled: true,
};

describe('reading a stored notifications policy', () => {
  it('reads the shapes written before per-channel switches exactly as they were', () => {
    // FIXTURES: what `system_settings.value.notifications` holds on a deployment that predates `channels`.
    expect(read({ browserEnabled: true, disabledEvents: [] })).toEqual({ browserEnabled: true, disabledEvents: [] });
    expect(read({ browserEnabled: false, disabledEvents: ['security.role_changed'] })).toEqual({
      browserEnabled: false,
      disabledEvents: ['security.role_changed'],
    });
    expect(read(undefined)).toEqual({ browserEnabled: true, disabledEvents: [] });
    expect(read({ browserEnabled: 'yes' })).toEqual({ browserEnabled: true, disabledEvents: [] });
    expect('channels' in read({ browserEnabled: true, disabledEvents: [] })).toBe(false);
  });

  it('reads a channels record entry by entry, dropping what is malformed', () => {
    expect(
      read({
        browserEnabled: true,
        disabledEvents: [],
        channels: { slack: { enabled: false }, 'Bad Id': { enabled: false }, sms: { enabled: 'no' }, teams: 7, ok_one: { enabled: true } },
      }).channels,
    ).toEqual({ slack: { enabled: false }, ok_one: { enabled: true } });
    expect(read({ browserEnabled: true, disabledEvents: [], channels: 'nope' })).toEqual({ browserEnabled: true, disabledEvents: [] });
  });

  it('reads the browser alias as the stricter of its two spellings', () => {
    const stored = read({ browserEnabled: true, disabledEvents: [], channels: { browser: { enabled: false } } });
    expect(stored.browserEnabled).toBe(false);
    expect(stored.channels?.browser).toEqual({ enabled: false });
    expect(read({ browserEnabled: false, disabledEvents: [], channels: { browser: { enabled: true } } }).browserEnabled).toBe(false);
  });
});

describe('writing the policy', () => {
  const current = { browserEnabled: true, disabledEvents: ['a.b'] };

  it('keeps the original two-field shape for a patch that never names channels', () => {
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, { browserEnabled: false })).toEqual({ browserEnabled: false, disabledEvents: ['a.b'] });
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, {})).toEqual(current);
  });

  it('merges channels per channel and leaves the others alone', () => {
    const first = NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, { channels: { slack: { enabled: false } } });
    expect(first).toEqual({ browserEnabled: true, disabledEvents: ['a.b'], channels: { slack: { enabled: false } } });
    const second = NOTIFICATIONS_SYSTEM_SETTINGS.merge(first, { channels: { sms: { enabled: false } } });
    expect(second.channels).toEqual({ slack: { enabled: false }, sms: { enabled: false } });
  });

  it('writes the browser alias both ways', () => {
    // channels.browser moves browserEnabled...
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, { channels: { browser: { enabled: false } } })).toEqual({
      browserEnabled: false,
      disabledEvents: ['a.b'],
      channels: { browser: { enabled: false } },
    });
    // ...browserEnabled moves channels.browser once the record names it...
    const named = { browserEnabled: true, disabledEvents: [], channels: { browser: { enabled: true }, slack: { enabled: false } } };
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(named, { browserEnabled: false })).toEqual({
      browserEnabled: false,
      disabledEvents: [],
      channels: { browser: { enabled: false }, slack: { enabled: false } },
    });
    // ...and an explicit channels.browser beats a browserEnabled beside it.
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, { browserEnabled: true, channels: { browser: { enabled: false } } }).browserEnabled).toBe(false);
  });

  it('replaces disabledEvents wholesale, as before', () => {
    expect(NOTIFICATIONS_SYSTEM_SETTINGS.merge(current, { disabledEvents: [] }).disabledEvents).toEqual([]);
  });
});

describe('the organization layer only tightens', () => {
  const system = { browserEnabled: true, disabledEvents: [], channels: { slack: { enabled: true }, sms: { enabled: false } } };

  it('turns a channel off for the organization and never back on', () => {
    const effective = tightenNotificationsPolicy(system, { channels: { slack: { enabled: false }, sms: { enabled: true }, teams: { enabled: false } } });
    expect(effective.channels).toEqual({ slack: { enabled: false }, sms: { enabled: false }, teams: { enabled: false } });
  });

  it('keeps the original shape when neither layer names a channel', () => {
    expect(tightenNotificationsPolicy({ browserEnabled: true, disabledEvents: ['x.y'] }, { disabledEvents: ['z.w'] })).toEqual({
      browserEnabled: true,
      disabledEvents: ['x.y', 'z.w'],
    });
  });

  it('turns browser off through either spelling of the org layer', () => {
    expect(tightenNotificationsPolicy({ browserEnabled: true, disabledEvents: [] }, { browserEnabled: false }).browserEnabled).toBe(false);
    const viaRecord = tightenNotificationsPolicy({ browserEnabled: true, disabledEvents: [] }, { channels: { browser: { enabled: false } } });
    expect(viaRecord.browserEnabled).toBe(false);
    expect(viaRecord.channels?.browser).toEqual({ enabled: false });
  });
});

describe('policyChannels and the channel switches', () => {
  const off = (channel: string): NotificationPolicy => ({ browserEnabled: true, disabledEvents: [], channels: { [channel]: { enabled: false } } });

  it('drops a channel an administrator switched off, for any channel', () => {
    expect(policyChannels(EVENT, off('push'))).toEqual(['email', 'browser']);
    expect(policyChannels(EVENT, off('email'))).toEqual(['browser', 'push']);
  });

  it('is unchanged without channels, and an absent channel is on', () => {
    expect(policyChannels(EVENT, DEFAULT_NOTIFICATION_POLICY)).toEqual(['email', 'browser', 'push']);
    expect(isChannelSwitchedOn('anything', DEFAULT_NOTIFICATION_POLICY)).toBe(true);
    expect(isChannelSwitchedOn('constructor', { browserEnabled: true, disabledEvents: [], channels: {} })).toBe(true);
  });

  it('keeps a mandatory event its browser row, but honours the switch of every other channel', () => {
    const mandatory: NotificationEventDef = { ...EVENT, key: 'security.role_changed', mandatory: true };
    expect(policyChannels(mandatory, { browserEnabled: false, disabledEvents: [] })).toEqual(['email', 'browser', 'push']);
    expect(policyChannels(mandatory, off('email'))).toEqual(['browser', 'push']);
    expect(policyChannels(mandatory, off('browser'))).toEqual(['email', 'browser', 'push']);
  });

  it('answers to the browser alias in either spelling', () => {
    expect(policyChannels(EVENT, { browserEnabled: false, disabledEvents: [] })).toEqual(['email', 'push']);
    expect(policyChannels(EVENT, off('browser'))).toEqual(['email', 'push']);
    expect(isBrowserToastAllowed(EVENT.key, off('browser'))).toBe(false);
    expect(isBrowserToastAllowed(EVENT.key, DEFAULT_NOTIFICATION_POLICY)).toBe(true);
  });

  it('is the one function the dispatcher\'s resolution goes through', () => {
    expect(resolveChannels(EVENT, {}, off('push'))).toEqual(['email', 'browser']);
    expect(resolveChannels(EVENT, { email: { [EVENT.key]: false } }, off('push'))).toEqual(['browser']);
  });
});

// =============================================================================
// System settings namespace `notifications` (issue #677; namespace #225, epic #215)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the contract's
// zod schemas and constants). The app registers it in its system settings
// manifest (the reference app: `settings/registry/system-settings.manifest.ts`).
//
// THE ORG LAYER (#738, through #733): an organization may TIGHTEN the policy
// for its own members and never loosen it. Effective `browserEnabled` is the
// system value AND the org's; effective `disabledEvents` is the union. The
// one interpreter of the result is `notification-policy.ts`; a `mandatory`
// event's inbox row survives either layer.
// =============================================================================

import { z } from 'zod';
import {
  MAX_DISABLED_NOTIFICATION_EVENTS,
  notificationChannelIdSchema,
  notificationEventKeySchema,
  notificationsResponseSchema,
  notificationsSettingsPatchSchema,
  notificationsSettingsSchema,
  orgNotificationsSchema,
  systemNotificationsPatchSchema,
  systemNotificationsSchema,
  type SystemNotificationsValue,
} from '@marinoscar/platform-contract/notifications';
import type { SystemSettingsNamespace } from '../settings/index';

/**
 * The EFFECTIVE value's schema: the system value with an organization's
 * tightening applied. The same fields as the stored system value, with room
 * for both layers' `disabledEvents` (the union of two bounded lists); the wire
 * bodies keep the single-layer bound.
 */
const effectiveNotificationsSchema = systemNotificationsSchema.extend({
  /** Event keys suppressed (room for the org layer's union on top of the system list). */
  disabledEvents: z.array(notificationEventKeySchema).max(MAX_DISABLED_NOTIFICATION_EVENTS * 2),
});

/**
 * Tighten only: an organization can turn the browser channel off and disable
 * more events, never turn either back on for its members.
 *
 * @param system - the deployment's (salvaged) value.
 * @param org - the organization's stored overrides.
 * @returns the effective value for that organization's members.
 *
 * @stability experimental
 */
export function tightenNotificationsPolicy(
  system: SystemNotificationsValue,
  org: Partial<SystemNotificationsValue>,
): SystemNotificationsValue {
  const channels = tightenChannels(system.channels, org.channels);
  const browserEnabled =
    system.browserEnabled &&
    (org.browserEnabled ?? true) &&
    channels?.browser?.enabled !== false;
  return {
    browserEnabled,
    disabledEvents: [...new Set([...system.disabledEvents, ...(org.disabledEvents ?? [])])],
    // Present only when either layer names a channel, so a policy that never
    // used per-channel switches keeps its original two-field shape.
    ...(channels ? { channels: browserEnabled || !channels.browser ? channels : { ...channels, browser: { enabled: false } } } : {}),
  };
}

/**
 * The org layer of the per-channel switches: a channel is on only when both
 * layers have it on (an absent entry is on). `undefined` when neither names one.
 */
function tightenChannels(
  system: SystemNotificationsValue['channels'],
  org: SystemNotificationsValue['channels'],
): NonNullable<SystemNotificationsValue['channels']> | undefined {
  const ids = new Set([...Object.keys(system ?? {}), ...Object.keys(org ?? {})]);
  if (ids.size === 0) return undefined;
  const merged: Record<string, { enabled: boolean }> = {};
  for (const id of ids) {
    const sys = system && Object.prototype.hasOwnProperty.call(system, id) ? system[id]?.enabled : undefined;
    const own = org && Object.prototype.hasOwnProperty.call(org, id) ? org[id]?.enabled : undefined;
    merged[id] = { enabled: sys !== false && own !== false };
  }
  return merged;
}

/** The most channel entries a stored value keeps when read (a safety bound, far above any registry). */
const MAX_STORED_CHANNELS = 64;

/**
 * Reads a stored `channels` record entry by entry: a bad entry (a wrong type,
 * an id that is not a channel id) is dropped on its own and the rest survive.
 * `undefined` when nothing usable is stored.
 */
function readChannels(raw: unknown, helpers: { asPlainObject(value: unknown): Record<string, unknown> | undefined }): SystemNotificationsValue['channels'] {
  const stored = helpers.asPlainObject(raw);
  if (!stored) return undefined;
  const channels: Record<string, { enabled: boolean }> = {};
  for (const [id, entry] of Object.entries(stored).slice(0, MAX_STORED_CHANNELS)) {
    if (!notificationChannelIdSchema.safeParse(id).success) continue;
    const plain = helpers.asPlainObject(entry);
    if (typeof plain?.enabled !== 'boolean') continue;
    channels[id] = { enabled: plain.enabled };
  }
  return Object.keys(channels).length > 0 ? channels : undefined;
}

/**
 * ON by default, suppressing nothing. The opposite default would mean a fresh
 * deployment ships with a delivery channel silently off and no indication
 * anywhere that it was ever available — an operator opts OUT of browser
 * notifications, never into them.
 */
const NOTIFICATIONS_SYSTEM_DEFAULTS: SystemNotificationsValue = {
  browserEnabled: true,
  disabledEvents: [],
};

/**
 * The `notifications` system settings namespace: the deployment-wide
 * browser-notification policy (`browserEnabled`, `disabledEvents`), with an
 * org layer that may only tighten it (#738). Register it with
 * `registerSystemSettingsNamespaces` in the app's system settings manifest.
 *
 * @extensionPoint schema
 * @stability stable
 */
export const NOTIFICATIONS_SYSTEM_SETTINGS = {
  /** The namespace key; permanent. */
  key: 'notifications',
  /** What it holds. */
  description: 'Deployment-wide notification policy: whether the browser channel is on, which events are suppressed for everyone, and a switch per delivery channel.',
  /** The stored shape (also what an org-layer union may produce). */
  storedSchema: effectiveNotificationsSchema,
  /** The internal PATCH shape. */
  patchSchema: systemNotificationsPatchSchema,
  /** The `PUT /api/system-settings` block. */
  putSchema: notificationsSettingsSchema,
  /** The `PATCH /api/system-settings` block. */
  wirePatchSchema: notificationsSettingsPatchSchema,
  /** The response block. */
  responseSchema: notificationsResponseSchema,
  /** On, suppressing nothing. */
  defaults: NOTIFICATIONS_SYSTEM_DEFAULTS,
  /**
   * REQUIRED on PUT. A PUT that omits it is a 400 and not a silent reset to
   * the defaults: the value it would reset is an operator's decision to turn a
   * delivery channel off for everyone.
   */
  requiredOnPut: true,
  /**
   * Salvages a stored value: the hand ladder `readKnownSettings` has always
   * used for this namespace, two fields, `disabledEvents` salvaged entry by
   * entry rather than as a unit (the `readStringArray` helper, #733).
   */
  read(stored, helpers): SystemNotificationsValue {
    const storedNotifications = helpers.asPlainObject(stored);
    const channels = readChannels(storedNotifications?.channels, helpers);

    // `browserEnabled` and `channels.browser.enabled` are one switch spelled
    // twice. Writes keep them equal; a hand-edited row that disagrees reads as
    // the stricter of the two, so a half-applied edit never re-enables browser
    // delivery an operator turned off.
    const browserEnabled =
      (typeof storedNotifications?.browserEnabled === 'boolean'
        ? storedNotifications.browserEnabled
        : NOTIFICATIONS_SYSTEM_DEFAULTS.browserEnabled) && channels?.browser?.enabled !== false;

    return {
      browserEnabled,
      disabledEvents: helpers.readStringArray(
        storedNotifications?.disabledEvents,
        systemNotificationsSchema.shape.disabledEvents.element,
        MAX_DISABLED_NOTIFICATION_EVENTS,
      ),
      // Absent on a row written before per-channel switches, which reads as
      // every channel enabled; the key is left off rather than defaulted so an
      // untouched row keeps its two-field shape.
      ...(channels ? { channels: channels.browser ? { ...channels, browser: { enabled: browserEnabled } } : channels } : {}),
    };
  },
  /** The org layer (#738): an organization may only tighten the policy. */
  org: {
    /** What an organization may store. */
    schema: orgNotificationsSchema,
    /** System AND org for `browserEnabled`, the union for `disabledEvents`. */
    merge: tightenNotificationsPolicy,
    /** Reading the org's overrides (#733's org-settings permission). */
    readPermission: 'org_settings:read',
    /** Writing them, from the Organization settings page. */
    writePermission: 'org_settings:write',
  },
  /** Merges a PATCH field by field; `disabledEvents` is replaced wholesale, `channels` per channel. */
  merge(current, patch): SystemNotificationsValue {
    // Field by field, NOT by spread — and `disabledEvents` is therefore REPLACED wholesale when the caller sends
    // one. That is RFC 7396's rule for arrays and the only usable semantics
    // here: a merged list could only ever grow, so the admin page's "stop
    // suppressing this event" would have no way to say so.
    //
    // `channels` is a record keyed by an open id, so it merges per channel: a
    // patch that names one channel leaves the others as they are.
    //
    // THE BROWSER ALIAS. `browserEnabled` and `channels.browser.enabled` are one
    // switch. An explicit `channels.browser` in the patch wins over a
    // `browserEnabled` beside it (the record is the canonical spelling); either
    // one alone moves both. The `channels.browser` entry is only written when
    // the stored or patched record already names browser, so a deployment that
    // never touched per-channel switches keeps its original two-field shape.
    const patchedBrowser = patch?.channels?.browser;
    const browserEnabled = patchedBrowser ? patchedBrowser.enabled : (patch?.browserEnabled ?? current.browserEnabled);
    const channels: Record<string, { enabled: boolean }> = { ...(current.channels ?? {}), ...(patch?.channels ?? {}) };
    if (channels.browser || (patch?.browserEnabled !== undefined && current.channels)) {
      channels.browser = { enabled: browserEnabled };
    }
    return {
      browserEnabled,
      disabledEvents: patch?.disabledEvents ?? current.disabledEvents,
      ...(Object.keys(channels).length > 0 ? { channels } : {}),
    };
  },
} satisfies SystemSettingsNamespace<
  'notifications',
  SystemNotificationsValue,
  z.infer<typeof notificationsSettingsPatchSchema>
>;

declare module '../settings/index' {
  interface SystemSettingsNamespaces {
    /**
     * Deployment-wide browser-notification policy (#225, epic #215).
     *
     * REQUIRED, not optional, and modelled rather than an untyped flag — see
     * `systemNotificationsSchema` in schemas/settings.schema.ts for the full
     * argument. Required is what makes a PUT that omits the block a loud 400
     * instead of a silent reset: the value being reset would be an operator's
     * decision to turn a delivery channel OFF, and silently turning it back on is
     * the one failure mode a security-adjacent gate must not have.
     */
    notifications: SystemNotificationsValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `notifications` declaration. */
    notifications: typeof NOTIFICATIONS_SYSTEM_SETTINGS;
  }
}

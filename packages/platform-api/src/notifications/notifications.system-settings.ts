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
  return {
    browserEnabled: system.browserEnabled && (org.browserEnabled ?? true),
    disabledEvents: [...new Set([...system.disabledEvents, ...(org.disabledEvents ?? [])])],
  };
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
  key: 'notifications',
  description: 'Deployment-wide browser-notification policy: whether the browser channel is on, and which events are suppressed for everyone.',
  storedSchema: effectiveNotificationsSchema,
  patchSchema: systemNotificationsPatchSchema,
  putSchema: notificationsSettingsSchema,
  wirePatchSchema: notificationsSettingsPatchSchema,
  responseSchema: notificationsResponseSchema,
  defaults: NOTIFICATIONS_SYSTEM_DEFAULTS,
  // REQUIRED on PUT. A PUT that omits it is a 400 and not a silent reset to
  // the defaults: the value it would reset is an operator's decision to turn a
  // delivery channel off for everyone.
  requiredOnPut: true,
  // The hand ladder `readKnownSettings` has always used for this namespace:
  // two fields, and `disabledEvents` is salvaged entry by entry rather than as
  // a unit (the service's `readStringArray` helper, #733).
  read(stored, helpers) {
    const storedNotifications = helpers.asPlainObject(stored);

    return {
      browserEnabled:
        typeof storedNotifications?.browserEnabled === 'boolean'
          ? storedNotifications.browserEnabled
          : NOTIFICATIONS_SYSTEM_DEFAULTS.browserEnabled,
      disabledEvents: helpers.readStringArray(
        storedNotifications?.disabledEvents,
        systemNotificationsSchema.shape.disabledEvents.element,
        MAX_DISABLED_NOTIFICATION_EVENTS,
      ),
    };
  },
  org: {
    schema: orgNotificationsSchema,
    merge: tightenNotificationsPolicy,
    // The org-settings permissions of #733: an org administrator manages the
    // org's overrides from the Organization settings page.
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
  merge(current, patch) {
    // Field by field, NOT by spread — and `disabledEvents` is therefore REPLACED wholesale when the caller sends
    // one. That is RFC 7396's rule for arrays and the only usable semantics
    // here: a merged list could only ever grow, so the admin page's "stop
    // suppressing this event" would have no way to say so.
    return {
      browserEnabled: patch?.browserEnabled ?? current.browserEnabled,
      disabledEvents: patch?.disabledEvents ?? current.disabledEvents,
    };
  },
} satisfies SystemSettingsNamespace<
  'notifications',
  SystemNotificationsValue,
  z.infer<typeof notificationsSettingsPatchSchema>
>;

declare module '../settings/registry/system-settings-namespace' {
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
    notifications: typeof NOTIFICATIONS_SYSTEM_SETTINGS;
  }
}

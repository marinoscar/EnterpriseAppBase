// =============================================================================
// System settings namespace `notifications` (issue #677; namespace #225, epic #215)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the per-namespace
// zod schemas, the wire and response branches, constants). Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
// =============================================================================

import type { z } from 'zod';
import {
  MAX_DISABLED_NOTIFICATION_EVENTS,
  systemNotificationsPatchSchema,
  systemNotificationsSchema,
  type SystemNotificationsValue,
} from '../common/schemas/settings.schema';
import {
  notificationsSettingsPatchSchema,
  notificationsSettingsSchema,
} from '../common/schemas/system-settings-wire.schemas';
import { notificationsResponseSchema } from '../common/schemas/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

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

export const NOTIFICATIONS_SYSTEM_SETTINGS = {
  key: 'notifications',
  description: 'Deployment-wide browser-notification policy: whether the browser channel is on, and which events are suppressed for everyone.',
  storedSchema: systemNotificationsSchema,
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

declare module '@marinoscar/platform-api/settings' {
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

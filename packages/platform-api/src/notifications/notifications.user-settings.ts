// =============================================================================
// User settings namespace `notifications` (issue #677; namespace #126, epic #109)
// =============================================================================
//
// Declaration file: pure data, imports only leaf modules (the per-namespace
// zod schemas and constants, and Nest's exception type). Registered by
// `settings/registry/user-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`. The merge and cap bodies moved verbatim from
// `UserSettingsService` (`mergeNotifications`, `assertNotificationLimit`).
// =============================================================================

import { BadRequestException } from '@nestjs/common';
import {
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL,
  notificationsPatchSchema,
  notificationsSchema,
  type NotificationChannelPreferencesValue,
  type NotificationsPatchValue,
  type NotificationsValue,
} from '../common/schemas/user-settings-namespaces.schema';
import type { NotificationChannel } from './notification-events';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';

export const NOTIFICATIONS_USER_SETTINGS = {
  key: 'notifications',
  description: 'Per-channel, per-event notification preferences, channel-outer; sparse at every level.',
  schema: notificationsSchema,
  // Three nullable levels, three different deletes: the namespace (the outer
  // `.nullable()` the composition adds), one channel, one event key. See
  // notificationsPatchSchema.
  patchSchema: notificationsPatchSchema,
  /**
   * Merge the `notifications` namespace (#126, epic #109) using JSON Merge
   * Patch semantics, PER CHANNEL and then PER EVENT KEY.
   *
   * - patch absent                       -> keep the stored namespace untouched
   * - patch is `null`                    -> clear the whole namespace
   * - `{ email: null }`                  -> clear the `email` channel, leaving
   *   any `browser` preferences alone
   * - `{ email: { 'user.welcome': null } }` -> DELETE that one event key, so
   *   the event falls back to the registry's `defaultEnabled`. This is the
   *   operation the preferences page sends when a control returns to its
   *   default; storing the default value instead would pin that user to
   *   today's default forever and re-materialise the key the sparse contract
   *   exists to keep absent.
   * - `{ email: { 'user.welcome': false } }` -> set that one key, touching
   *   nothing else on the channel.
   *
   * WHY THIS DEEP-MERGES WHERE mergeDataTables REPLACES. A data table entry is
   * one coherent view state, so a client sending it is stating the whole
   * entry. A channel's preferences are the opposite: a row of INDEPENDENT
   * per-event choices, and #126 PATCHes exactly the one key the user just
   * toggled. Replacing the channel wholesale would therefore erase every other
   * preference on that channel on every single toggle — silently re-enabling
   * mail the user had already turned off, which is the loudest possible
   * regression for a notifications feature.
   *
   * COLLAPSING IS LOAD-BEARING AT BOTH LEVELS. A channel whose last key was
   * deleted is removed rather than stored as `{}`, and an empty namespace
   * returns `undefined` so the caller omits the key entirely. Absent means
   * "use the built-in defaults"; `{}` is a second spelling of the same state
   * that the read path does not produce (`readNotificationPreferences` drops
   * empty maps too), and two spellings of one state is how the UI and the
   * dispatcher end up disagreeing about whether a user has an opinion.
   *
   * DELIBERATELY NO `mandatory` CHECK HERE. A stored `false` for a mandatory
   * event is accepted and is inert: `isChannelEnabled` (#125) tests
   * `event.mandatory` before it ever looks at stored preferences, so the value
   * is never consulted. That resolver is the single security gate on purpose —
   * it also covers rows written before an event became mandatory, and requests
   * that never went near the UI. A second gate here could only disagree with
   * the one that actually decides delivery.
   *
   * Event keys are NOT validated against the registry — see the header of
   * user-settings-namespaces.schema.ts for the three ways that breaks.
   */
  merge(
    current: NotificationsValue | undefined,
    patch: NotificationsPatchValue | null | undefined,
  ): NotificationsValue | undefined {
    if (patch === undefined) {
      return current;
    }

    if (patch === null) {
      return undefined;
    }

    const merged: NotificationsValue = {};

    // Copy the stored namespace one level deep. A shallow `{ ...current }`
    // would share the per-channel objects with the value we just read, and the
    // `delete` below would then mutate them in place.
    for (const [channel, events] of Object.entries(current ?? {})) {
      if (events !== undefined) {
        merged[channel as NotificationChannel] = { ...events };
      }
    }

    for (const [channel, channelPatch] of Object.entries(patch)) {
      const key = channel as NotificationChannel;

      if (channelPatch === null) {
        delete merged[key];
        continue;
      }

      if (channelPatch === undefined) {
        continue;
      }

      const events: NotificationChannelPreferencesValue = {
        ...(merged[key] ?? {}),
      };

      for (const [eventKey, choice] of Object.entries(channelPatch)) {
        if (choice === null) {
          delete events[eventKey];
        } else if (choice !== undefined) {
          events[eventKey] = choice;
        }
      }

      if (Object.keys(events).length > 0) {
        merged[key] = events;
      } else {
        // Last key deleted: the channel goes away rather than persisting as
        // `{}`. See "COLLAPSING IS LOAD-BEARING" above.
        delete merged[key];
      }
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
  },
  /**
   * Enforce the per-user cap on persisted notification preferences.
   *
   * The event level is an OPEN map — event keys are registry data and are
   * deliberately not validated against the registry (see
   * user-settings-namespaces.schema.ts) — so without a cap an authenticated
   * user can inflate their own `user_settings` row without limit by PATCHing
   * arbitrary keys. The channel level is closed by the enum, so bounding the
   * entries per channel bounds the namespace.
   *
   * Enforced here, not in zod, for the same two reasons as
   * assertDataTableLimit: `z.record()` has no key-count refinement, and the
   * cap has to be checked against the MERGED result rather than the request
   * body. A ZodError thrown from the service would escape as a 500 instead of
   * the 400 the client deserves, hence the explicit BadRequestException.
   */
  assertLimits(notifications: NotificationsValue | undefined): void {
    if (!notifications) {
      return;
    }

    for (const [channel, events] of Object.entries(notifications)) {
      const count = Object.keys(events ?? {}).length;
      if (count > NOTIFICATION_MAX_EVENTS_PER_CHANNEL) {
        throw new BadRequestException(
          `Too many notification preferences for channel "${channel}": ${count} exceeds the maximum of ${NOTIFICATION_MAX_EVENTS_PER_CHANNEL}. Remove preferences you no longer need (send them as null) before adding new ones.`,
        );
      }
    }
  },
} satisfies UserSettingsNamespace<'notifications', NotificationsValue, NotificationsPatchValue>;

declare module '@marinoscar/platform-api/settings' {
  interface UserSettingsNamespaces {
    /**
     * Per-channel, per-event notification preferences (#126), channel-outer:
     * `{ email: { 'user.welcome': false } }`.
     *
     * SPARSE AND OPTIONAL AT EVERY LEVEL. Absent namespace, absent channel and
     * absent event key all mean the same thing — "use the event's
     * `defaultEnabled` from the registry" — which is what lets this feature ship
     * with no migration and no backfill, and is why an untouched account is not
     * muted. The dispatcher resolves it; see
     * notifications/notification-preferences.ts.
     */
    notifications: NotificationsValue;
  }
  interface UserSettingsNamespaceDeclarations {
    notifications: typeof NOTIFICATIONS_USER_SETTINGS;
  }
}

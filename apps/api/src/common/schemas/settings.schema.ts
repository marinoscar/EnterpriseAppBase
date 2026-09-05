import { z } from 'zod';
import {
  dataTablesSchema,
  dataTablesPatchSchema,
  navigationSchema,
  navigationPatchSchema,
  notificationsSchema,
  notificationsPatchSchema,
  notificationEventKeySchema,
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL,
} from './user-settings-namespaces.schema';

// =============================================================================
// User Settings Schema
// =============================================================================

export const userSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean(),
    customImageUrl: z.string().url().nullable().optional(),
  }),
  // Optional namespaces. Absent means "use built-in defaults" — see
  // user-settings-namespaces.schema.ts for why these must never get `.default()`.
  dataTables: dataTablesSchema.optional(),
  navigation: navigationSchema.optional(),
  // `notifications` (#126) is optional for the reason the other two are, only
  // more so: absent means "use each event's registry default", and every
  // existing account is absent. Making it required — or defaulting it — would
  // materialise a preference blob for the whole user base at the first PUT
  // and freeze them at today's defaults. See notification-preferences.ts.
  notifications: notificationsSchema.optional(),
});

export type UserSettingsDto = z.infer<typeof userSettingsSchema>;

// Partial schema for PATCH operations (zod v4: deepPartial removed, use manual deep partial)
export const userSettingsPatchSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean().optional(),
    customImageUrl: z.string().url().nullable().optional(),
  }).optional(),
  // The outer `.nullable()` is what lets `{ "dataTables": null }` clear the
  // whole namespace; the inner nullability (in dataTablesPatchSchema) is what
  // lets `{ "dataTables": { "jobs": null } }` delete a single entry.
  dataTables: dataTablesPatchSchema.nullable().optional(),
  navigation: navigationPatchSchema.nullable().optional(),
  // Three nullable levels, three different deletes: the namespace, one
  // channel, one event key. See notificationsPatchSchema.
  notifications: notificationsPatchSchema.nullable().optional(),
});

// =============================================================================
// System Settings Schema
// =============================================================================

/**
 * Upper bound on `notifications.disabledEvents` (#225, epic #215).
 *
 * Reuses the user-preferences bound rather than inventing a second number:
 * both lists are indexed by the SAME registry (`NOTIFICATION_EVENTS`), so
 * whatever count is considered a sane ceiling for one event-keyed collection is
 * the ceiling for the other. A cap is required at all because this array is
 * caller-supplied and lands in JSONB — unbounded growth in a row every request
 * reads is the failure `notificationChannelPreferencesSchema` already bounds on
 * its own axis.
 */
export const MAX_DISABLED_NOTIFICATION_EVENTS =
  NOTIFICATION_MAX_EVENTS_PER_CHANNEL;

/**
 * Deployment-wide browser-notification policy.
 *
 * WHY THIS IS A MODELLED BLOCK AND NOT A KEY IN `features` (#225). `features`
 * is `z.record(z.string(), z.boolean())` — no shape, no default, no place to
 * write down what any particular key means — and it is deliberately owned by
 * downstream forks to fill with their own operational flags. This gate is
 * neither of those things: it is framework-level and security-adjacent (an
 * operator turning off a delivery channel for everyone, or silencing one noisy
 * event), so it gets a real type, a real default, and somewhere for its
 * semantics to live. Putting it in `features` would also collide with a fork's
 * own flag namespace the first time someone picked the same string.
 *
 * WHAT ENFORCES IT (#226). Three consumers, all reading through
 * `notifications/notification-policy.ts`, which is the only place these two
 * fields are interpreted:
 *
 *   * `resolveChannels` — the dispatcher's gate. A `browser` channel this
 *     policy disallows is not delivered over.
 *   * `GET /api/notifications/events` — the same filter, so the preferences
 *     matrix cannot offer a channel the dispatcher would refuse.
 *   * the SSE payload's `toast` flag, and `GET /api/notifications/config`,
 *     which is how a non-admin client learns the capability is off without
 *     being granted `system_settings:read`.
 *
 * WHAT IT DELIBERATELY DOES NOT SWITCH OFF: the `notifications` row itself for
 * a `mandatory` event. Muting a toast must not mute an audit-relevant inbox
 * entry — see notification-policy.ts, which carries the full argument.
 *
 * Web Push (#229/#230) will read the same block when it lands.
 *
 * `disabledEvents` holds `NOTIFICATION_EVENTS` keys and is validated with
 * `notificationEventKeySchema` — the same syntactic bound the per-user
 * preference keys use. A second, hand-rolled pattern here would be a second
 * place for the `<area>.<event>` convention to be wrong, and the wrong direction
 * is an event key an operator cannot suppress because the admin page 400s.
 * It is a syntactic bound, NOT a registry check: an entry naming an event this
 * build does not declare is stored and simply never matches, which is what keeps
 * a rollback across the addition of an event uneventful.
 */
export const systemNotificationsSchema = z.object({
  browserEnabled: z.boolean(),
  disabledEvents: z
    .array(notificationEventKeySchema)
    .max(MAX_DISABLED_NOTIFICATION_EVENTS),
});

export type SystemNotificationsValue = z.infer<typeof systemNotificationsSchema>;

export const systemSettingsSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean(),
  }),
  features: z.record(z.string(), z.boolean()),
  notifications: systemNotificationsSchema,
});

export type SystemSettingsDto = z.infer<typeof systemSettingsSchema>;

// Partial schema for PATCH operations (zod v4: deepPartial removed, use manual deep partial)
export const systemSettingsPatchSchema = z.object({
  ui: z.object({
    allowUserThemeOverride: z.boolean().optional(),
  }).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  // `disabledEvents` REPLACES wholesale rather than merging, which is both RFC
  // 7396's rule for arrays and the only sane one here: a merge has no way to
  // express "re-enable this event", so a patch that could only ever add would
  // make the admin page's uncheck a no-op.
  notifications: z
    .object({
      browserEnabled: z.boolean().optional(),
      disabledEvents: z
        .array(notificationEventKeySchema)
        .max(MAX_DISABLED_NOTIFICATION_EVENTS)
        .optional(),
    })
    .optional(),
});

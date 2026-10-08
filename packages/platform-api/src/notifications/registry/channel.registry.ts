// =============================================================================
// Notification channel registry (issue #678, PP-1.6)
// =============================================================================
//
// The set of delivery channels an event may declare. Until #678 this was the
// closed literal `NOTIFICATION_CHANNELS = ['email', 'browser', 'push'] as const`
// in notification-events.ts, so an app that added a transport (EvoPath's
// `android_app`) had to edit a platform file. Now the platform registers its
// three channels from `platform-channels.ts`, an app registers its own from
// `app-registrations/notifications.ts`, and notification-events.ts derives the
// old tuple from this registry so `z.enum(NOTIFICATION_CHANNELS)` keeps working.
//
// A CHANNEL ID IS A PERSISTED IDENTIFIER. It is the outer key of every user's
// stored notification preferences (`user_settings.value.notifications`) and the
// `channel` column of `notification_deliveries`. Never rename one; add a new id.
//
// This file declares WHICH channels exist. It does not deliver anything: the
// transport for a channel is a `NotificationChannelSender`, held by the DI
// registry in `channel-sender.registry.ts`. A channel declared here with no
// sender is the documented "declared before its transport lands" state, which
// the dispatcher skips quietly.
//
// FRAMEWORK-FREE: imports only the registry primitive, so DTOs built at module
// evaluation time, the seed and standalone scripts can read it.
// =============================================================================

import { defineRegistry } from '@marinoscar/platform-api/core';

/** One delivery channel, described for documentation and diagnostics. */
export interface NotificationChannelDef {
  /**
   * Stable id: lower-case letters, digits and `_`, starting with a letter
   * (`email`, `android_app`). Persisted in preferences and delivery rows.
   */
  readonly id: string;
  /** Short human label (`Email`, `Browser`). */
  readonly label: string;
  /** One sentence on what the channel delivers to. */
  readonly description: string;
}

/**
 * The channel ids the TYPE SYSTEM knows about.
 *
 * Module augmentation is how an app widens {@link NotificationChannel}: the
 * platform declares its three ids here, and an app adds its own next to the
 * runtime registration in `app-registrations/notifications.ts`:
 *
 * ```ts
 * declare module '../notifications/registry/channel.registry' {
 *   interface NotificationChannelIds { android_app: true }
 * }
 * ```
 *
 * The runtime registry is the authority on which channels exist; this
 * interface only lets `switch`es and `Record<NotificationChannel, ...>` maps see
 * the app's ids. Declaring an id here without registering it is harmless (the
 * registry refuses an event that declares an unregistered channel).
 */
export interface NotificationChannelIds {
  email: true;
  browser: true;
  push: true;
}

/** A delivery channel id. See {@link NotificationChannelIds}. */
export type NotificationChannel = keyof NotificationChannelIds & string;

/** What every channel id must look like. */
export const NOTIFICATION_CHANNEL_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Every delivery channel, in registration order (platform first, then the
 * app's). Filled by `notification.manifest.ts`; frozen once the application has
 * bootstrapped.
 */
export const notificationChannelRegistry = defineRegistry<NotificationChannelDef>({
  name: 'notification-channels',
  idOf: (channel) => channel.id,
  idPattern: NOTIFICATION_CHANNEL_ID_PATTERN,
  validate: (channel) => {
    if (typeof channel.label !== 'string' || channel.label.trim() === '') {
      throw new Error('a channel needs a non-empty label');
    }
    if (typeof channel.description !== 'string' || channel.description.trim() === '') {
      throw new Error('a channel needs a non-empty description');
    }
  },
  describeDuplicate: (existing) =>
    `Duplicate notification channel "${existing.id}". Channel ids are persisted ` +
    'in preferences and delivery rows; pick a new id instead of reusing one.',
});

/**
 * Registers delivery channels, all or nothing.
 *
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 */
export function registerNotificationChannels(channels: readonly NotificationChannelDef[]): void {
  notificationChannelRegistry.registerAll(channels);
}

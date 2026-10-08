// =============================================================================
// Platform notification channels (issue #678, PP-1.6)
// =============================================================================
//
// The three channels the platform ships a transport for. Pure data, registered
// by `notification.manifest.ts` before the app's own channels.
//
// Until #678 these were the closed literal `['email', 'browser', 'push']` in
// notification-events.ts. Its long comment on why the channel axis exists from
// day one still applies: preferences are persisted per event AND per channel,
// so storing a bare boolean and growing a channel axis later would be a data
// migration over live user preferences. Order matters for the same reason it
// did there: `listNotificationChannels()` and the preferences matrix list
// channels in registration order.
// =============================================================================

import { ANDROID_APP_NOTIFICATION_CHANNEL_ID } from '@marinoscar/platform-contract/notifications';

import { notificationChannelRegistry, type NotificationChannelDef } from './channel.registry';

/**
 * The platform's three channels, in registration order: `email`, `browser`
 * (the in-app inbox and its stream), `push` (Web Push).
 *
 * @stability stable
 */
export const PLATFORM_NOTIFICATION_CHANNELS: readonly NotificationChannelDef[] = [
  {
    id: 'email',
    label: 'Email',
    description: 'A message sent to the address on the account, through the configured email provider.',
  },
  {
    id: 'browser',
    label: 'Browser',
    description:
      "A row in the user's in-app notification centre, streamed to any open tab, which may show it as a toast.",
  },
  {
    id: 'push',
    label: 'Web Push',
    description: 'An operating-system notification delivered through Web Push to every browser the user subscribed.',
  },
];

/**
 * Registers the platform's three channels (`email`, `browser`, `push`), in
 * that order, unless they already are: idempotent, like the email slice's
 * `registerPlatformEmailTemplates()`, so an app's manifest and a test can both
 * call it. Call it first: an event may only declare a registered channel, and
 * an app channel registered before it would list ahead of the platform's.
 *
 * @throws RegistryError `FROZEN` after bootstrap, or `DUPLICATE_ID` when an
 *   app registered a channel under a platform id first.
 *
 * @stability stable
 */
export function registerPlatformNotificationChannels(): void {
  if (PLATFORM_NOTIFICATION_CHANNELS.every((channel) => notificationChannelRegistry.has(channel.id))) return;
  notificationChannelRegistry.registerAll(PLATFORM_NOTIFICATION_CHANNELS);
}

/**
 * The `android_app` channel (#746, PP-9.4; EvoPath #312): Web Push to the
 * subscriptions registered from inside the Android companion
 * (`push_subscriptions.platform = 'android_app'`) only. `coveredBy: 'push'`:
 * a dispatch that resolves both sends once, over `push`. Events opt in by
 * listing it in `channels` (EvoPath: the two broadcast events). The id is
 * permanent.
 *
 * @stability experimental
 */
export const ANDROID_APP_NOTIFICATION_CHANNEL: NotificationChannelDef = Object.freeze({
  id: ANDROID_APP_NOTIFICATION_CHANNEL_ID,
  label: 'Android app',
  description:
    'An operating-system notification on the phones where the user enabled notifications inside the Android app (Web Push to those subscriptions only).',
  coveredBy: 'push',
});

/**
 * Registers {@link ANDROID_APP_NOTIFICATION_CHANNEL}. Idempotent; call it from
 * the app's notification manifest after
 * {@link registerPlatformNotificationChannels} and before any event lists the
 * channel. Its sender, `AndroidAppNotificationChannel`, is provided by
 * `AndroidAppModule` (`@marinoscar/platform-api/android-app`).
 *
 * @example
 * ```ts
 * registerPlatformNotificationChannels();
 * registerAndroidAppNotificationChannel();
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAndroidAppNotificationChannel(): void {
  if (notificationChannelRegistry.has(ANDROID_APP_NOTIFICATION_CHANNEL.id)) return;
  notificationChannelRegistry.register(ANDROID_APP_NOTIFICATION_CHANNEL);
}

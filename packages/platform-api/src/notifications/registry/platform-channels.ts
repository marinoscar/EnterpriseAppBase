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

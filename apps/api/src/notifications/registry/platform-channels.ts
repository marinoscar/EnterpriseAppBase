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
// did there: `NOTIFICATION_CHANNELS` (and every `z.enum` built from it, and so
// the OpenAPI document) lists channels in registration order.
// =============================================================================

import type { NotificationChannelDef } from './channel.registry';

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

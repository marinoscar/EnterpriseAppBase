// =============================================================================
// Allowlist notifications (issue #678, PP-1.6)
// =============================================================================
//
// Pure data: the notifications this module raises, declared next to the code
// that raises them and registered by
// `notifications/registry/notification.manifest.ts`. No side effect on import,
// no Nest, no settings: the manifest is the one place that registers, so
// "which notifications exist?" stays answerable from one file.
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key. The definitions moved verbatim from the closed
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#128).
//
// NO BROWSER RENDERER, DELIBERATELY. `allowlist.invitation` is email-only
// because its recipient HAS NO ACCOUNT and therefore no inbox row to write and
// no tab to push to (`BrowserNotificationChannel.resolveTo` returns `null` for
// that recipient). A renderer here would be dead code that reads as a live
// feature.
// =============================================================================

import type { NotificationRegistration } from '../../notifications/registry/bindings.registry';

export const ALLOWLIST_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'allowlist.invitation',
      label: 'Invitation to join',
      description:
        'Sent when an administrator adds your email address to the allowlist, inviting you to sign in.',
      // Email only, and NOT because #127 has not landed. The recipient has no
      // account, no session and no open tab at the moment this fires — that is
      // what being newly allowlisted means — so no in-app channel can reach
      // them. This entry is the worked example of `channels` carrying real
      // per-event information rather than being copied between rows.
      channels: ['email'],
      defaultEnabled: true,
    },
    emailTemplate: 'allowlist-invitation',
  },
];

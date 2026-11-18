// =============================================================================
// Auth notifications (issue #678, PP-1.6)
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
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#121, #128).
//
// NO BROWSER RENDERER, DELIBERATELY. `user.welcome` is email-only: it would fire
// while the user is looking at the very page that welcomes them, a toast with
// no reader. A renderer here would be dead code that reads as a live feature.
// =============================================================================

import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const AUTH_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'user.welcome',
      label: 'Welcome',
      description: 'Sent once, the first time you sign in to this application.',
      // Email only. A browser notification here would fire while the user is
      // looking at the very page that welcomes them — it has no reader.
      channels: ['email'],
      defaultEnabled: true,
    },
    emailTemplate: 'user-welcome',
  },
];

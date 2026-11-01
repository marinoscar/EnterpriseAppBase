// =============================================================================
// Users notifications (issue #678, PP-1.6)
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
// =============================================================================

import { roleChangedBrowserTemplate } from '@marinoscar/platform-api/notifications';
import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const USERS_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'security.role_changed',
      label: 'Your roles changed',
      description:
        'Sent when an administrator changes the roles assigned to your account, which changes what you can access.',
      // Both channels: a privilege change is worth surfacing immediately to an
      // open tab AND leaving a durable record in the user's inbox.
      channels: ['email', 'browser'],
      defaultEnabled: true,
      // A privilege change the user never hears about is the failure mode this
      // whole flag exists for: an account silently gains or loses access and
      // nobody outside the admin console can tell. Not silenceable.
      mandatory: true,
    },
    emailTemplate: 'role-changed',
    browserTemplate: roleChangedBrowserTemplate,
  },
];

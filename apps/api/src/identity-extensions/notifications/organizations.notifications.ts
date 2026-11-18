// =============================================================================
// Organization notifications (issue #726, PP-6.7)
// =============================================================================
//
// Pure data: the notifications this module raises, declared next to the code
// that raises them and registered by
// `notifications/registry/notification.manifest.ts` (appended after the
// platform's existing events, so the preferences matrix keeps its order).
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key.
//
// EMAIL ONLY, like `allowlist.invitation` and for the same reason: the
// recipient may have no account, no session and no open tab when an
// administrator invites them, so no in-app channel can reach them. Not
// mandatory: an invitation is not a security event.
// =============================================================================

import type { NotificationRegistration } from '@marinoscar/platform-api/notifications';

export const ORGANIZATIONS_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'org.invitation',
      label: 'Invitation to an organization',
      description:
        'Sent when an organization administrator invites your email address to join their organization.',
      channels: ['email'],
      defaultEnabled: true,
    },
    emailTemplate: 'org-invitation',
  },
];

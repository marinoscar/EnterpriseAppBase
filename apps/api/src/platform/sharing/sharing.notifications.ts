// =============================================================================
// The sharing slice's notification, registered with the app's registries
// (issue #728, PP-7.1)
// =============================================================================
//
// `groups.invitation` (channels `email` and `browser`, not mandatory): the
// event and the browser renderer are the slice's
// (`@marinoscar/platform-api/sharing`), the e-mail template is this app's
// binding of the slice's renderer to its layout
// (`email/templates/group-invitation.email.ts`). Registered by
// `notifications/registry/notification.manifest.ts` after the platform's
// organization events. Pure data, no side effect.
// =============================================================================

import {
  GROUPS_INVITATION_EVENT,
  GROUP_INVITATION_EMAIL_TEMPLATE,
  groupInvitationBrowserTemplate,
} from '@marinoscar/platform-api/sharing';

import type { BrowserNotificationTemplate } from '../../notifications/channels/browser-templates';
import type { NotificationRegistration } from '../../notifications/registry/bindings.registry';

export const SHARING_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: GROUPS_INVITATION_EVENT.key,
      label: GROUPS_INVITATION_EVENT.label,
      description: GROUPS_INVITATION_EVENT.description,
      channels: [...GROUPS_INVITATION_EVENT.channels],
      defaultEnabled: GROUPS_INVITATION_EVENT.defaultEnabled,
    },
    emailTemplate: GROUP_INVITATION_EMAIL_TEMPLATE,
    browserTemplate: groupInvitationBrowserTemplate as BrowserNotificationTemplate,
  },
];

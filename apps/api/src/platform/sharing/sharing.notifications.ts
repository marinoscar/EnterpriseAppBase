// =============================================================================
// The sharing slice's notifications, registered with the app's registries
// (issues #728 and #729)
// =============================================================================
//
// `groups.invitation` (#728) and `sharing.shared_with_you` (#729), both on
// channels `email` and `browser`, not mandatory. The events and the browser
// renderers are the slice's (`@marinoscar/platform-api/sharing`), the e-mail
// templates are this app's bindings of the slice's renderers to its layout
// (`email/templates/group-invitation.email.ts`,
// `email/templates/shared-with-you.email.ts`). Registered by
// `notifications/registry/notification.manifest.ts` after the platform's
// organization events. Pure data, no side effect.
// =============================================================================

import {
  GROUPS_INVITATION_EVENT,
  GROUP_INVITATION_EMAIL_TEMPLATE,
  SHARED_WITH_YOU_EMAIL_TEMPLATE,
  SHARED_WITH_YOU_EVENT,
  groupInvitationBrowserTemplate,
  sharedWithYouBrowserTemplate,
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
  // #729: a record shared with the user (a new user grant, or its role changed).
  {
    event: {
      key: SHARED_WITH_YOU_EVENT.key,
      label: SHARED_WITH_YOU_EVENT.label,
      description: SHARED_WITH_YOU_EVENT.description,
      channels: [...SHARED_WITH_YOU_EVENT.channels],
      defaultEnabled: SHARED_WITH_YOU_EVENT.defaultEnabled,
    },
    emailTemplate: SHARED_WITH_YOU_EMAIL_TEMPLATE,
    browserTemplate: sharedWithYouBrowserTemplate as BrowserNotificationTemplate,
  },
];

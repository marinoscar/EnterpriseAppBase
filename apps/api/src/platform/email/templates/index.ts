import type { EmailTemplate, EmailTemplateEntry } from '@marinoscar/platform-api/email';

import { groupInvitationEmail, type GroupInvitationEmailData } from './group-invitation.email';
import { orgInvitationEmail, type OrgInvitationEmailData } from './org-invitation.email';
import { sharedWithYouEmail, type SharedWithYouEmailData } from './shared-with-you.email';

// =============================================================================
// Email templates other slices own the words of (issue #737)
// =============================================================================
//
// `org-invitation` (identity, #726), `group-invitation` and `shared-with-you`
// (sharing, #728/#729). Their words come from the identity and sharing slices
// (or are the reference app's own, for `org-invitation`); the layout and the
// escaping are the email slice's. The email package cannot import the sharing
// slice (packages/platform-slices.json), so the adapters live here, register
// through the email template registry like any app template, and widen the
// typed data map below. The names are stable ids: notification events map to
// them.
//
// Registered by `notifications/registry/notification.manifest.ts`, after the
// platform's nine and before the app's own.
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'org-invitation': OrgInvitationEmailData;
    'group-invitation': GroupInvitationEmailData;
    'shared-with-you': SharedWithYouEmailData;
  }
}

/** The three slice-owned templates, in the order the manifest registers them. */
export const SLICE_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'org-invitation', render: orgInvitationEmail as EmailTemplate<never>, registrant: 'identity' },
  { name: 'group-invitation', render: groupInvitationEmail as EmailTemplate<never>, registrant: 'sharing' },
  { name: 'shared-with-you', render: sharedWithYouEmail as EmailTemplate<never>, registrant: 'sharing' },
];

export { groupInvitationEmail, orgInvitationEmail, sharedWithYouEmail };
export type { GroupInvitationEmailData, OrgInvitationEmailData, SharedWithYouEmailData };

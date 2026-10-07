import type { EmailTemplate } from './email-template.types';
import {
  type AllowlistInvitationEmailData,
  allowlistInvitationEmail,
} from './allowlist-invitation.email';
import { type BroadcastEmailData, broadcastEmail } from './broadcast.email';
import {
  type BackupFailedEmailData,
  backupFailedEmail,
} from './backup-failed.email';
import { type JobFailedEmailData, jobFailedEmail } from './job-failed.email';
import {
  type NodeOfflineEmailData,
  nodeOfflineEmail,
} from './node-offline.email';
import {
  type RestoreCompletedEmailData,
  restoreCompletedEmail,
} from './restore-completed.email';
import { type RoleChangedEmailData, roleChangedEmail } from './role-changed.email';
import { type TestEmailData, testEmail } from './test-email.email';
import { type OrgInvitationEmailData, orgInvitationEmail } from './org-invitation.email';
import { type UserWelcomeEmailData, userWelcomeEmail } from './user-welcome.email';

// =============================================================================
// The platform's email templates (issue #678, PP-1.6; templates date from #123)
// =============================================================================
//
// Pure data, registered into `emailTemplateRegistry` by
// `notifications/registry/notification.manifest.ts` before the app's own
// templates (`app-registrations/notifications.ts`).
//
// -----------------------------------------------------------------------------
// THE THREE-WAY LOCK, FOR PLATFORM TEMPLATES
// -----------------------------------------------------------------------------
//
// Adding a platform template means editing TWO places in this file, and the
// compiler forces the second:
//
//   1. add `'thing': ThingEmailData` to `PlatformEmailTemplateDataMap`
//   2. add `'thing': thingEmail` to `PLATFORM_EMAIL_TEMPLATES`
//
// `PlatformEmailTemplateName` is DERIVED from the data map, so step 1 cannot
// produce a name with no data type. `PLATFORM_EMAIL_TEMPLATES` is a mapped type
// over it, so step 1 without step 2 is a compile error, and step 2 without
// step 1 is an excess-property error. There is no ordering in which a
// half-registered platform template compiles. `EmailTemplateDataMap` in
// `./index.ts` extends this map, and an app augments THAT interface for its own
// templates (it cannot get the same lock, because its renderers are registered
// at runtime from a separate file).
//
// No imports beyond the template files and types: the manifest imports this
// file, and `./index.ts` imports the manifest, so importing `./index.ts` here
// would be a cycle.
// =============================================================================

/**
 * Every platform template, mapped to the data it renders from.
 *
 * #128 added the three real event templates. NAMES ARE KEBAB-CASE AND MATCH
 * THE FILE, while the notification event keys that select them are dotted
 * (`user.welcome` -> `user-welcome`): the mapping between the two is the
 * `emailTemplate` of each `registerNotification` entry (the
 * `eventEmailTemplateRegistry`), and is deliberately explicit rather than
 * derived, so a rename on either side is a registration error or a reviewed
 * edit instead of a silent "template not found" at send time.
 */
export interface PlatformEmailTemplateDataMap {
  'test-email': TestEmailData;
  'user-welcome': UserWelcomeEmailData;
  'allowlist-invitation': AllowlistInvitationEmailData;
  'role-changed': RoleChangedEmailData;
  // #322 (epic #319). The odd one out: every entry above renders content this
  // codebase wrote, and this one renders a title and body an administrator
  // typed. Its data type carries no recipient, because a broadcast reads the
  // same for everybody — see broadcast.email.ts.
  broadcast: BroadcastEmailData;

  // #288 (epic #254). The four OPERATIONAL messages. What sets them apart from
  // every entry above is the recipient: these are addressed to whoever holds an
  // administrative permission, not to a user something happened to — see
  // `NotificationsService.notifyPermissionHolders`. Their payloads are
  // correspondingly free of any per-recipient field.
  'job-failed': JobFailedEmailData;
  'node-offline': NodeOfflineEmailData;
  'backup-failed': BackupFailedEmailData;
  'restore-completed': RestoreCompletedEmailData;

  // #726 (PP-6.7). An invitation to one ORGANIZATION, addressed (like
  // `allowlist-invitation`) to somebody who may have no account yet.
  'org-invitation': OrgInvitationEmailData;
}

/** A platform template name. */
export type PlatformEmailTemplateName = keyof PlatformEmailTemplateDataMap & string;

/**
 * Platform name -> renderer, in the order the manifest registers them.
 *
 * The mapped type is what makes this exhaustive: every
 * `PlatformEmailTemplateName` must appear, and each entry's data parameter is
 * pinned to that name's entry in {@link PlatformEmailTemplateDataMap}, so a
 * template cannot be registered under a key whose payload it does not accept.
 */
export const PLATFORM_EMAIL_TEMPLATES: {
  readonly [K in PlatformEmailTemplateName]: EmailTemplate<PlatformEmailTemplateDataMap[K]>;
} = {
  'test-email': testEmail,
  'user-welcome': userWelcomeEmail,
  'allowlist-invitation': allowlistInvitationEmail,
  'role-changed': roleChangedEmail,
  broadcast: broadcastEmail,
  'job-failed': jobFailedEmail,
  'node-offline': nodeOfflineEmail,
  'backup-failed': backupFailedEmail,
  'restore-completed': restoreCompletedEmail,
  'org-invitation': orgInvitationEmail,
};

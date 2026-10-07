import {
  renderGroupInvitationEmail,
  type GroupInvitationNotificationData,
} from '@marinoscar/platform-api/sharing';

import { APP_NAME, SafeHtml, html, plainText, renderLayout } from './layout';
import { TRANSACTIONAL_EMAIL_HEADERS, type RenderedEmail } from './email-template.types';

// =============================================================================
// "Invitation to a group" template — `groups.invitation` (#728, PP-7.1)
// =============================================================================
//
// The words are the sharing slice's (`renderGroupInvitationEmail` in
// `@marinoscar/platform-api/sharing`); the layout, the escaping `html` tag and
// the plain-text renderer are this app's, so the message looks like every
// other one it sends. The group name is user-typed: every interpolation goes
// through `html`, which escapes it, and the name stays out of the subject.
// =============================================================================

/** Everything the group invitation renders. */
export type GroupInvitationEmailData = GroupInvitationNotificationData;

/** Render the group invitation. */
export function groupInvitationEmail(data: GroupInvitationEmailData): RenderedEmail {
  return renderGroupInvitationEmail(data, {
    appName: APP_NAME,
    html,
    empty: SafeHtml.EMPTY,
    renderLayout: (options) => renderLayout({ ...options, bodyHtml: options.bodyHtml as SafeHtml }),
    plainText,
    headers: TRANSACTIONAL_EMAIL_HEADERS,
  });
}

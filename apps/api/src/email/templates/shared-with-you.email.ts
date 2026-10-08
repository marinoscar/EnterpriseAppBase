import {
  renderSharedWithYouEmail,
  type SharedWithYouNotificationData,
} from '@marinoscar/platform-api/sharing';

import { APP_NAME, SafeHtml, html, plainText, renderLayout } from './layout';
import { TRANSACTIONAL_EMAIL_HEADERS, type RenderedEmail } from './email-template.types';

// =============================================================================
// "Something was shared with you" template — `sharing.shared_with_you` (#729)
// =============================================================================
//
// The words are the sharing slice's (`renderSharedWithYouEmail` in
// `@marinoscar/platform-api/sharing`); the layout, the escaping `html` tag and
// the plain-text renderer are this app's. The record's title comes from its
// resource type's `describe()` and is user-typed: every interpolation goes
// through `html`, which escapes it, and the title stays out of the subject.
// =============================================================================

/** Everything the share notification renders. */
export type SharedWithYouEmailData = SharedWithYouNotificationData;

/** Render the share notification. */
export function sharedWithYouEmail(data: SharedWithYouEmailData): RenderedEmail {
  return renderSharedWithYouEmail(data, {
    appName: APP_NAME,
    html,
    empty: SafeHtml.EMPTY,
    renderLayout: (options) => renderLayout({ ...options, bodyHtml: options.bodyHtml as SafeHtml }),
    plainText,
    headers: TRANSACTIONAL_EMAIL_HEADERS,
  });
}

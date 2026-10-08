// =============================================================================
// The `sharing.shared_with_you` notification and its templates (issue #729)
// =============================================================================
//
// Sent to the user a record was shared with, when a USER grant is created or
// its role changes (kvox's `changed` rule): never for an unchanged re-grant,
// never for a group grant (a group grant notifies nobody by default), and
// always after the grant's transaction committed.
//
// Declared here as data, like `groups.invitation`: the app registers the
// event with its notification registry and binds the e-mail template to its
// own layout and `safe-html` helpers (the reference app:
// `apps/api/src/email/templates/shared-with-you.email.ts`). Every
// interpolation goes through the kit's escaping `html` tag. The record's
// title comes from the resource type's `describe()` and is user-typed: it is
// escaped, and it stays out of the subject. Without `describe()` the message
// is the generic "An item was shared with you".
// =============================================================================

import type { GroupInvitationEmailKit, SafeHtmlLike } from './group-invitation.templates';

/**
 * The notification event key. Persisted in preferences and delivery rows:
 * never rename it.
 *
 * @stability experimental
 */
export const SHARED_WITH_YOU_EVENT_KEY = 'sharing.shared_with_you';

/**
 * The e-mail template name the event is bound to.
 *
 * @stability experimental
 */
export const SHARED_WITH_YOU_EMAIL_TEMPLATE = 'shared-with-you';

/**
 * Where the browser notification links to when the type gives no path: the
 * "shared with me" page (root-relative).
 *
 * @stability experimental
 */
export const SHARED_WITH_ME_PATH = '/shared';

/**
 * The notification event, in the shape the reference app's notification
 * registry takes.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const SHARED_WITH_YOU_EVENT: {
  /** The event key. */
  readonly key: 'sharing.shared_with_you';
  /** Shown in the preferences matrix. */
  readonly label: string;
  /** Shown in the preferences matrix. */
  readonly description: string;
  /** E-mail and the in-app bell. */
  readonly channels: readonly ['email', 'browser'];
  /** On unless the user turns it off. */
  readonly defaultEnabled: true;
} = {
  key: SHARED_WITH_YOU_EVENT_KEY,
  label: 'Something was shared with you',
  description: 'Sent when someone in your organization shares an item with you or changes your role on it.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
};

/**
 * What the notification renders. No other user's address, no token.
 *
 * @stability experimental
 */
export interface SharedWithYouNotificationData {
  /** The record's resource type. */
  resourceType: string;
  /** The record. */
  resourceId: string;
  /** The role granted. */
  role: string;
  /** The role before, when it changed (`undefined` for a new share). */
  previousRole?: string;
  /** The record's title, when the type describes its records. User-typed: escaped. */
  title?: string;
  /** The record's root-relative path, when the type describes its records. */
  path?: string;
  /** Who shared it (display name or e-mail), when known. */
  sharedBy?: string;
  /** When the share expires (ISO 8601), when it does. */
  expiresAt?: string;
  /** Absolute URL of the record (or the app), added by the app; the layout omits the button without it. */
  openUrl?: string;
}

/**
 * The bell row and toast of `sharing.shared_with_you`.
 *
 * @stability experimental
 */
export interface SharedWithYouBrowserContent {
  /** One short line. */
  title: string;
  /** A sentence of detail. */
  body: string;
  /** Root-relative path. */
  link: string;
}

/** "a viewer", "an editor". */
function article(role: string): string {
  return /^[aeiou]/.test(role) ? `an ${role}` : `a ${role}`;
}

/** Only a root-relative path is ever linked (never `//host` or a scheme). */
function safePath(path: string | undefined): string {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : SHARED_WITH_ME_PATH;
}

/**
 * Renders the bell row and toast.
 *
 * @param data - the notification data.
 * @returns plain text and a root-relative link.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function sharedWithYouBrowserTemplate(data: SharedWithYouNotificationData): SharedWithYouBrowserContent {
  const what = data.title ? `"${data.title}"` : 'An item';
  const changed = data.previousRole !== undefined;
  return {
    title: changed ? 'Your access changed' : 'Something was shared with you',
    body: changed ? `${what}: you are now ${article(data.role)}.` : `${what} was shared with you as ${article(data.role)}.`,
    link: safePath(data.path),
  };
}

/**
 * One rendered e-mail.
 *
 * @stability experimental
 */
export interface RenderedSharedWithYouEmail {
  /** Plain-text subject. */
  subject: string;
  /** The HTML document. */
  html: string;
  /** The plain-text alternative. */
  text: string;
  /** Extra headers. */
  headers: Record<string, string>;
}

/**
 * Renders the `shared-with-you` e-mail with the app's layout and escaping
 * helpers (the same kit as the group invitation). Pure: no I/O, no clock.
 *
 * @param data - the notification data.
 * @param kit - the app's e-mail helpers.
 * @returns subject, HTML, text and headers.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function renderSharedWithYouEmail(data: SharedWithYouNotificationData, kit: GroupInvitationEmailKit): RenderedSharedWithYouEmail {
  const sharedBy = data.sharedBy?.trim();
  const role = article(data.role);
  const changed = data.previousRole !== undefined;
  // The title stays out of the subject: it is user-typed, and a subject is a
  // header no escaping protects.
  const subject = changed ? `Your access to an item on ${kit.appName} changed` : `An item was shared with you on ${kit.appName}`;
  const heading = changed ? 'Your access changed' : data.title ? `${data.title} was shared with you` : 'An item was shared with you';

  const what: SafeHtmlLike = data.title ? kit.html`<strong>${data.title}</strong>` : kit.html`An item`;
  const by: SafeHtmlLike = sharedBy ? kit.html` by <strong>${sharedBy}</strong>` : kit.empty;
  const lead: SafeHtmlLike = changed
    ? kit.html`<p style="margin:0 0 16px 0;">Your role on ${what} was changed${by}: you are now ${role}.</p>`
    : kit.html`<p style="margin:0 0 16px 0;">${what} was shared with you${by} as ${role}.</p>`;
  const expiry = data.expiresAt
    ? kit.html`<p style="margin:0 0 16px 0;">Your access ends on ${data.expiresAt.slice(0, 10)}.</p>`
    : kit.empty;
  const bodyHtml = kit.html`
    ${lead}
    ${expiry}
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      You can find everything shared with you under "Shared with me" in ${kit.appName}.
    </p>
  `;

  const html = kit.renderLayout({
    title: heading,
    previewText: changed ? 'Your role on a shared item changed.' : 'An item was shared with you.',
    bodyHtml,
    ...(data.openUrl ? { ctaLabel: 'Open', ctaUrl: data.openUrl } : {}),
  });

  const name = data.title ?? 'An item';
  const byText = sharedBy ? ` by ${sharedBy}` : '';
  const lines: [string, ...string[]] = [
    changed ? `Your role on ${name} was changed${byText}: you are now ${role}.` : `${name} was shared with you${byText} as ${role}.`,
  ];
  if (data.expiresAt) lines.push('', `Your access ends on ${data.expiresAt.slice(0, 10)}.`);
  lines.push('', `You can find everything shared with you under "Shared with me" in ${kit.appName}.`);
  const text = kit.plainText({ title: heading, lines, ...(data.openUrl ? { ctaLabel: 'Open', ctaUrl: data.openUrl } : {}) });

  return { subject, html, text, headers: { ...kit.headers } };
}

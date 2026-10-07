// =============================================================================
// The `groups.invitation` notification and its templates (issue #728)
// =============================================================================
//
// Declared here as data; the app registers the event with its notification
// registry and binds the e-mail template to its own shared layout and
// `safe-html` helpers (the reference app:
// `apps/api/src/email/templates/group-invitation.email.ts`), because the
// layout (brand, colours, footer) is the app's. The renderer below never builds
// HTML by concatenation: every interpolation goes through the kit's `html`
// tagged template, which escapes it.
//
// Channels `email` and `browser`; not mandatory (an invitation is not a
// security event). The payload carries the group's name and the role, never
// another member's address; the recipient's own address is in the e-mail
// because the e-mail must say which address was invited.
// =============================================================================

import type { GroupRole } from '@marinoscar/platform-contract/sharing';

/**
 * The notification event key. Persisted in preferences and delivery rows:
 * never rename it.
 *
 * @stability experimental
 */
export const GROUPS_INVITATION_EVENT_KEY = 'groups.invitation';

/**
 * The e-mail template name the event is bound to.
 *
 * @stability experimental
 */
export const GROUP_INVITATION_EMAIL_TEMPLATE = 'group-invitation';

/**
 * Where the browser notification links to: the page that lists the caller's
 * invitations (root-relative).
 *
 * @stability experimental
 */
export const GROUP_INVITATIONS_PATH = '/groups/invites';

/**
 * The notification event, in the shape the reference app's notification
 * registry takes (`key`, `label`, `description`, `channels`, `defaultEnabled`).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const GROUPS_INVITATION_EVENT: {
  /** The event key. */
  readonly key: 'groups.invitation';
  /** Shown in the preferences matrix. */
  readonly label: string;
  /** Shown in the preferences matrix. */
  readonly description: string;
  /** E-mail (reaches an address with no account) and the in-app bell. */
  readonly channels: readonly ['email', 'browser'];
  /** On unless the user turns it off. */
  readonly defaultEnabled: true;
} = {
  key: GROUPS_INVITATION_EVENT_KEY,
  label: 'Invitation to a group',
  description: 'Sent when a group admin invites your email address to join a group in your organization.',
  channels: ['email', 'browser'],
  defaultEnabled: true,
};

/**
 * What the invitation renders. No ids of other users, no token.
 *
 * @stability experimental
 */
export interface GroupInvitationNotificationData {
  /** The invited address (the e-mail says which address to sign in with). */
  recipientEmail: string;
  /** The group's display name. */
  groupName: string;
  /** The role the invitee gets on acceptance. */
  role: GroupRole;
  /** Who invited them (display name or e-mail), when known. */
  invitedBy?: string;
  /** When the invite expires (ISO 8601), or absent for never. */
  expiresAt?: string;
  /** Absolute URL of the app's sign-in page; added by the app, the layout omits the button without it. */
  signInUrl?: string;
}

/** The role as a reader should see it. */
function describeRole(role: GroupRole): string {
  switch (role) {
    case 'admin':
      return 'an admin';
    case 'editor':
      return 'an editor';
    default:
      return 'a viewer';
  }
}

/**
 * What a browser notification renders to (bell row and toast): plain text and
 * a root-relative link.
 *
 * @stability experimental
 */
export interface GroupInvitationBrowserContent {
  /** One short line. */
  title: string;
  /** A sentence of detail. */
  body: string;
  /** Root-relative path. */
  link: string;
}

/**
 * Renders the bell row and toast of `groups.invitation`.
 *
 * @param data - the notification data.
 * @returns plain text and a root-relative link.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function groupInvitationBrowserTemplate(data: GroupInvitationNotificationData): GroupInvitationBrowserContent {
  return {
    title: 'You are invited to a group',
    body: `Join "${data.groupName}" as ${describeRole(data.role)}.`,
    link: GROUP_INVITATIONS_PATH,
  };
}

/**
 * Escaped HTML, as the app's `html` tagged template produces it. Opaque to
 * the renderer.
 *
 * @stability experimental
 */
export type SafeHtmlLike = object;

/**
 * The app's e-mail helpers the renderer composes with: the shared layout, the
 * plain-text renderer and the escaping `html` tagged template.
 *
 * @stability experimental
 */
export interface GroupInvitationEmailKit {
  /** The product name. */
  appName: string;
  /** The escaping tagged template: every interpolation is escaped. */
  html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtmlLike;
  /** An empty fragment. */
  empty: SafeHtmlLike;
  /** The full HTML document around a body. */
  renderLayout(options: { title: string; previewText: string; bodyHtml: SafeHtmlLike; ctaLabel?: string; ctaUrl?: string }): string;
  /** The plain-text alternative. */
  plainText(options: { title: string; lines: [string, ...string[]]; ctaLabel?: string; ctaUrl?: string }): string;
  /** Headers every system message carries (`Auto-Submitted`, ...). */
  headers: Readonly<Record<string, string>>;
}

/**
 * One rendered e-mail.
 *
 * @stability experimental
 */
export interface RenderedGroupInvitationEmail {
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
 * Renders the `group-invitation` e-mail with the app's layout and escaping
 * helpers. Pure: no I/O, no clock.
 *
 * @param data - the notification data.
 * @param kit - the app's e-mail helpers.
 * @returns subject, HTML, text and headers.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function renderGroupInvitationEmail(data: GroupInvitationNotificationData, kit: GroupInvitationEmailKit): RenderedGroupInvitationEmail {
  const invitedBy = data.invitedBy?.trim();
  const role = describeRole(data.role);
  // The group's name stays out of the subject: it is typed by a user, and a
  // subject is a header no escaping protects.
  const subject = `You have been invited to join a group on ${kit.appName}`;

  const attribution = invitedBy
    ? kit.html`<p style="margin:0 0 16px 0;"><strong>${invitedBy}</strong> sent this invitation, so they are the person to ask if you were not expecting it.</p>`
    : kit.empty;
  const expiry = data.expiresAt
    ? kit.html`<p style="margin:0 0 16px 0;">The invitation expires on ${data.expiresAt.slice(0, 10)}.</p>`
    : kit.empty;

  const bodyHtml = kit.html`
    <p style="margin:0 0 16px 0;">
      <strong>${data.recipientEmail}</strong> has been invited to join the group
      <strong>${data.groupName}</strong> on ${kit.appName} as ${role}.
    </p>
    ${attribution}
    ${expiry}
    <p style="margin:0 0 16px 0;">
      Sign in with that same address and open your group invitations to accept or decline it.
    </p>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      If you do not recognise this group, you can ignore this message: nothing happens until you accept.
    </p>
  `;

  const html = kit.renderLayout({
    title: `Join ${data.groupName}`,
    previewText: `${data.recipientEmail} has been invited to ${data.groupName}.`,
    bodyHtml,
    ...(data.signInUrl ? { ctaLabel: 'Sign in', ctaUrl: data.signInUrl } : {}),
  });

  const lines: [string, ...string[]] = [`${data.recipientEmail} has been invited to join the group ${data.groupName} on ${kit.appName} as ${role}.`];
  if (invitedBy) lines.push('', `${invitedBy} sent this invitation, so they are the person to ask if you were not expecting it.`);
  if (data.expiresAt) lines.push('', `The invitation expires on ${data.expiresAt.slice(0, 10)}.`);
  lines.push(
    '',
    'Sign in with that same address and open your group invitations to accept or decline it.',
    '',
    'If you do not recognise this group, you can ignore this message: nothing happens until you accept.',
  );

  const text = kit.plainText({
    title: `Join ${data.groupName}`,
    lines,
    ...(data.signInUrl ? { ctaLabel: 'Sign in', ctaUrl: data.signInUrl } : {}),
  });

  return { subject, html, text, headers: { ...kit.headers } };
}

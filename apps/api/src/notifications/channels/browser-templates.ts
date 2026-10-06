// =============================================================================
// Platform browser / push renderers (issue #678, PP-1.6; renderers date from #128)
// =============================================================================
//
// The renderers that turn an event's payload into a bell row and an OS toast,
// moved out of `browser-notification.channel.ts` so the platform modules that
// declare their notifications (`users/users.notifications.ts`,
// `nodes/nodes.notifications.ts`, ...) can bind them without importing the
// channel class. The class imports the notification registry, and the
// registry's manifest imports those declaration files: importing the class
// from them would be a cycle under CommonJS. So this file is a LEAF: pure
// functions, importing only types (the payload types of the email templates).
//
// ONE RENDERER SERVES BOTH CHANNELS. `push-notification.channel.ts` reads the
// same browser binding as `browser-notification.channel.ts`, so binding a
// renderer to an event once (`registerNotification({ browserTemplate })`) is
// enough for both; do not add a second map.
//
// The payload is the SAME OBJECT the email template renders (one `notify()`
// call, one payload, two channels), so each payload type is imported rather
// than restated. A per-channel payload type would let the two drift and would
// put the burden of building both on every call site.
// =============================================================================

import type { BackupFailedEmailData } from '../../email/templates/backup-failed.email';
import type { BroadcastEmailData } from '../../email/templates/broadcast.email';
import type { NodeOfflineEmailData } from '../../email/templates/node-offline.email';
import type { RestoreCompletedEmailData } from '../../email/templates/restore-completed.email';
import type { RoleChangedEmailData } from '../../email/templates/role-changed.email';

/**
 * What a browser notification renders to.
 *
 * The browser-channel analogue of #123's `{ subject, html, text }` email
 * contract — three fields, no HTML, because the destinations are a bell row
 * and an OS toast, both of which render plain text and neither of which will
 * ever run markup from this payload.
 */
export interface BrowserNotificationContent {
  /** One short line. The toast headline and the bell row's heading. */
  title: string;

  /** A sentence or two of detail. */
  body: string;

  /**
   * Where clicking it should go, as a ROOT-RELATIVE PATH (`/settings/roles`).
   *
   * Never an absolute URL. See {@link sanitizeLink} — this value ends up in a
   * link the user clicks, so it is a security boundary and it is validated
   * before it is stored, not before it is rendered.
   */
  link?: string;
}

/** Renders one event's payload into what the user actually sees. */
export type BrowserNotificationTemplate = (
  data: never,
) => BrowserNotificationContent;

/**
 * Role names as the bell row should show them, or an explicit word for none.
 *
 * A SECOND, SMALLER COPY of the formatter in `role-changed.email.ts`, and not
 * an import from it. The two surfaces have different budgets — an email
 * paragraph versus a two-line toast — and sharing the formatter is how a
 * wording change made for one silently rewrites the other. What IS shared is
 * the payload type, which is the part where a divergence would be a bug.
 *
 * The empty case gets a word for the same reason it does in the email: an
 * account left with no roles at all is the most alarming outcome this event
 * reports, and rendering it as a blank reads as a formatting fault rather than
 * as a loss of access.
 */
function formatRoles(roles: string[]): string {
  if (roles.length === 0) return 'none';

  return roles
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(', ');
}

/**
 * The browser/push rendering of an administrator's broadcast (#322, epic #319).
 *
 * A PROJECTION AND NOTHING MORE — and every one of the things it does not do
 * is done for it, one layer down:
 *
 *   * It does NOT truncate. The channel applies `MAX_TITLE_LENGTH` /
 *     `MAX_BODY_LENGTH` once, to the values it both stores and publishes, so a
 *     second cap here would be a second chance for the row and the toast to
 *     disagree about what the message said.
 *   * It does NOT validate the link. `sanitizeLink` runs in the channel, at
 *     write time, for the reasons set out on that function — a template that
 *     pre-checked would move a security control away from the boundary that
 *     enforces it.
 *   * It does NOT escape. These destinations are a bell row and an OS toast,
 *     both of which render plain text and neither of which will ever parse
 *     markup from this payload. The escaping belongs to the email half, which
 *     is the only channel emitting HTML.
 *
 * It does not branch on `critical` either. The email adds a "you cannot turn
 * this off" footer because a mailbox has no other place to say it; a toast has
 * two short lines, and spending one of them on preference mechanics rather than
 * on the administrator's message would be a poor trade.
 *
 * PUSH NEEDS NO SEPARATE REGISTRATION: `push-notification.channel.ts` reads
 * the same browser binding (and imports `sanitizeLink` from the browser
 * channel), so one binding serves both channels — do not add a third map.
 *
 * The parameter is typed `never` by `BrowserNotificationTemplate` and cast at
 * the top, the same boundary the channel's `render` describes at length: the
 * map is reached with an unchecked `data: unknown`, and a payload that does not
 * match is a recorded delivery failure inside the channel's try/catch, never a
 * thrown broadcast.
 */
export const broadcastBrowserTemplate: BrowserNotificationTemplate = (data: never): BrowserNotificationContent => {
  const { title, body, link } = data as BroadcastEmailData;

  // THE ONE THING A PURE PROJECTION STILL HAS TO DO: fail INSIDE the template.
  //
  // The channel's `render` wraps this call in a try/catch, but `truncate` and
  // `sanitizeLink` run AFTER it returns, outside that catch. Every other
  // template happens to touch its payload's fields and therefore throws inside
  // the catch on a malformed one; a projection touches nothing, so a payload
  // with no `title` would sail through here and throw in `truncate` instead —
  // past the containment that turns a bad payload into a recorded delivery
  // failure, and straight into the caller. Checking the shape here is what
  // keeps this template's failure mode identical to the others'.
  if (typeof title !== 'string' || typeof body !== 'string') {
    throw new TypeError(
      'A broadcast payload needs a string `title` and a string `body`.',
    );
  }

  return { title, body, link };
};

/**
 * The browser/push rendering of `security.role_changed` (#128).
 *
 * The parameter is typed `never` by `BrowserNotificationTemplate` (the map is
 * reached with an unchecked `data: unknown`), so the cast here is the same
 * boundary the channel's `render` describes at length. It is inside the
 * channel's try/catch, so a payload that does not match is a recorded
 * delivery failure, never a thrown role change.
 */
export const roleChangedBrowserTemplate: BrowserNotificationTemplate = (data: never): BrowserNotificationContent => {
  const { previousRoles, currentRoles } = data as RoleChangedEmailData;

  return {
    title: 'Your roles changed',
    // Before AND after, for the reason spelled out in the email template:
    // the delta is the alertable fact, and "you are now a Viewer" cannot
    // tell the reader whether they gained access or lost it.
    body:
      `An administrator changed your access: ${formatRoles(previousRoles)} ` +
      `\u2192 ${formatRoles(currentRoles)}. If you were not expecting this, ` +
      `contact an administrator.`,
    // NO LINK, DELIBERATELY. `link` would make the bell row clickable, and
    // there is no page in this application that shows a user their own roles
    // — `/settings/profile` does not. Sending the reader somewhere that does
    // not answer the question the notification just raised is worse than
    // leaving the row inert, and `sanitizeLink` would happily accept the
    // useless path.
  };
};

// -----------------------------------------------------------------------------
// THE OPERATIONAL RENDERERS (#288, epic #254)
// -----------------------------------------------------------------------------
//
// Every `link` below is ROOT-RELATIVE and is the path its own admin card
// declares in `apps/web/src/config/adminSections.tsx`. `sanitizeLink` in
// browser-notification.channel.ts enforces the root-relative part at write
// time; matching the registry is what keeps the destination REAL, and it is
// the same rule the Settings UI Pattern applies to `permission` — use the
// string the other side actually uses, never an approximation of it.
//
// (`jobs.job_failed` has none; `notifications/ops/ops.notifications.ts` says why.)

/** The browser/push rendering of `nodes.node_offline` (#288). */
export const nodeOfflineBrowserTemplate: BrowserNotificationTemplate = (data: never): BrowserNotificationContent => {
  const { nodeName, lastHeartbeatAt } = data as NodeOfflineEmailData;

  const heard =
    lastHeartbeatAt === null
      ? 'It never sent a heartbeat.'
      : `Last heartbeat ${lastHeartbeatAt.toISOString()}.`;

  return {
    title: 'Worker node went offline',
    body:
      `${nodeName} stopped responding and was marked offline. ${heard} ` +
      'Fleet capacity is reduced until it comes back.',
    link: '/admin/settings/workers',
  };
};

/** The browser/push rendering of `db_backup.backup_failed` (#288). */
export const backupFailedBrowserTemplate: BrowserNotificationTemplate = (data: never): BrowserNotificationContent => {
  const { runId, outcome, error } = data as BackupFailedEmailData;

  const reason =
    outcome === 'stale'
      ? 'it stopped heartbeating and was given up on'
      : (error ?? 'no reason was recorded');

  return {
    title: 'Database backup failed',
    body:
      `Backup run ${runId} did not complete: ${reason}. There is one fewer ` +
      'recovery point than the retention policy assumes; the next scheduled ' +
      'backup is the retry.',
    link: '/admin/settings/db-backup',
  };
};

/** The browser/push rendering of `db_backup.restore_completed` (#288). */
export const restoreCompletedBrowserTemplate: BrowserNotificationTemplate = (data: never): BrowserNotificationContent => {
  const { runId, backupTakenAt } = data as RestoreCompletedEmailData;

  const takenAt =
    backupTakenAt === null ? 'an unrecorded time' : backupTakenAt.toISOString();

  return {
    title: 'Database restored from a backup',
    // THE CUT-OFF IS THE WHOLE MESSAGE. A row that said only "restore
    // completed" would leave the reader to work out what is missing; the
    // archive's own timestamp is the fact that answers it.
    body:
      `The live database was replaced from backup run ${runId}. It now holds ` +
      `the state from ${takenAt}; anything written after that is not present.`,
    link: '/admin/settings/db-backup',
  };
};

// =============================================================================
// Operational notifications: jobs (issue #678, PP-1.6)
// =============================================================================
//
// Pure data: the notifications this module raises, declared next to the code
// that raises them and registered by
// `notifications/registry/notification.manifest.ts`. No side effect on import,
// no Nest, no settings: the manifest is the one place that registers, so
// "which notifications exist?" stays answerable from one file.
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key. The definitions moved verbatim from the closed
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#288).
//
// NO BROWSER RENDERER, DELIBERATELY. `jobs.job_failed` is email-only, and the
// reason is the `link` field rather than the copy: a failed job's detail is not
// a page in this application (it is a filter on the jobs list), so a bell row
// for it would either be inert or would send the reader somewhere that does not
// answer the question it just raised. The other three operational events each
// have a real destination, which is exactly why they carry a link.
// =============================================================================

import type { NotificationRegistration } from '../registry/bindings.registry';

// ===========================================================================
// OPERATIONAL FAILURES (#288, epic #254) — AND WHY THEIR AUDIENCE IS A
// PERMISSION RATHER THAN A USER
// ===========================================================================
//
// (Moved verbatim. The four events it describes are declared in
// `notifications/ops/ops.notifications.ts`, `nodes/nodes.notifications.ts` and
// `db-backup/db-backup.notifications.ts`; "above this block" means the
// auth, allowlist, users and broadcast declarations.)
//
// Every event above this block has ONE natural recipient the trigger already
// knows: the user who signed in, the address an admin allowlisted, the
// account whose roles changed. The four below have none. A job that ran out
// of retries, a worker node that stopped heartbeating, a backup that failed
// and a restore that completed are facts about the DEPLOYMENT, and the
// question "who should hear about this?" has no user id in it.
//
// The answer this epic settles on is: WHOEVER CAN ACT ON IT — which is a
// permission, not a person and not a role. `NotificationsService
// .notifyPermissionHolders` resolves that set, and its header states the
// full argument (in short: a role is a bundle that a fork renames or splits,
// while the permission string is the SAME string the controller enforces, so
// the audience for "your backup failed" is by construction the set of people
// the API would let look at the backup).
//
// ⚠ THREE OF THE FOUR ARE MUTEABLE AND ONE IS NOT, and the split is the same
// one `security.role_changed` draws. A failure is a thing an operator may
// reasonably decide to watch elsewhere (a dashboard, an alerting stack) and
// silence here. A COMPLETED RESTORE is not: the database this application
// serves has just been replaced with an older copy of itself, and everybody
// who can act on that must be told, whatever their preferences say.
//
// ROLL-UP IS DELIBERATELY NOT BUILT. A fork whose queue carries thousands of
// a single job type will want digesting — see docs/specs/browser-
// notifications.md's operational-events section — but nothing in this
// template can produce that volume, and a roll-up nobody needs is a second
// scheduler, a second state table and a second way for a failure to be late.
// ===========================================================================

export const OPS_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'jobs.job_failed',
      label: 'Background job failed',
      description:
        'Sent when a background job exhausts its retry budget and is given up on. Retries and deferrals are silent; only the final give-up raises this.',
      // EMAIL ONLY, and not for want of a browser template. This is the one
      // event of the four with NO ADMIN PAGE THAT ANSWERS IT: a failed job's
      // detail lives behind a filter on the jobs list, and a toast whose click
      // target cannot show the thing it is about is worse than no toast. The
      // email carries the type, the error and the attempt count, which is the
      // whole of what a reader needs before deciding to go and look.
      channels: ['email'],
      defaultEnabled: true,
    },
    emailTemplate: 'job-failed',
  },
];

// =============================================================================
// OpenAPI tag taxonomy (issue #53)
// =============================================================================
//
// The single declaration of every `@ApiTags(...)` name used in this API, its
// human description, and which sidebar section it belongs to.
//
// The tag NAMES here were already consistent across the ten controllers, so
// unlike the rest of this pass nothing was renamed. What was missing is what
// this file adds: a description for each (an undescribed tag renders as a bare
// heading) and a grouping (an ungrouped tag renders outside every section).
//
// One rule this file exists to enforce: NO undeclared and NO orphaned tags. A
// tag used by a controller but not listed here would render with no description
// and land outside every group; a tag listed here but used by nobody would
// render an empty section. Both are failed assertions in
// `test/openapi/openapi-document.spec.ts` rather than something a reviewer has
// to notice.
//
// Ordering is deliberate: `TAG_GROUPS` is emitted as `x-tagGroups`, and the
// flattened tag order becomes the document's `tags` array, which is what a
// renderer falls back to when it has no group support.
//
// THE LIST IS NO LONGER CLOSED (issue #698). Importing this file registers
// the app's taxonomy, in this order, into `openApiTags`, the OpenAPI tag
// registry of `@marinoscar/platform-api/core`, and `document.ts` builds the
// published `tags` and `x-tagGroups` from the registry. A packaged slice (or a
// fork's own module) registers its tags there too, at module scope before
// bootstrap, instead of editing this file; a tag joins an existing group by
// naming it, or starts a new one after these.
// =============================================================================

import { openApiTags } from '@marinoscar/platform-api/core';

/** One tag of this app's taxonomy, before it is registered with its group. */
interface AppOpenApiTag {
  /** Must match the controller's `@ApiTags(...)` argument byte-for-byte. */
  name: string;
  /** One or two sentences. Rendered under the section heading in the sidebar. */
  description: string;
}

interface AppOpenApiTagGroup {
  name: string;
  tags: AppOpenApiTag[];
}

/**
 * Sidebar sections, in render order.
 *
 * A group is a product area rather than a module boundary — `Allowlist` sits
 * with authentication because it gates sign-in, even though it is administered
 * from the same screen as `Users`.
 */
const TAG_GROUPS: AppOpenApiTagGroup[] = [
  {
    name: 'Authentication & Access',
    tags: [
      {
        name: 'Authentication',
        description:
          'Google OAuth sign-in, access-token refresh, logout, and the current-user lookup. ' +
          'Start here: every other section assumes a bearer token obtained through one of these routes.',
      },
      {
        name: 'Device Authorization',
        description:
          'RFC 8628 device authorization grant — how a CLI or other browserless client obtains a ' +
          'token by showing the user a code to approve elsewhere, plus management of the resulting ' +
          'device sessions.',
      },
      {
        name: 'Personal Access Tokens',
        description:
          'Long-lived `pat_` bearer credentials for scripts and automation. A PAT carries the full ' +
          'permission set of the user that minted it and is accepted on every authenticated route.',
      },
      {
        name: 'Allowlist',
        description:
          'Pre-authorized email addresses. Access is allowlist-gated: an email absent from this list ' +
          'cannot complete OAuth sign-in at all. Admin only.',
      },
      {
        name: 'Organizations',
        description:
          'Organizations, their members and invitations (multi-organization deployments). `/api/org/*` acts ' +
          'on the organization the caller\'s token is bound to, never on an org id from the request, and needs ' +
          'org permissions (`org_members:*`, `org_invites:*`, held by `org_admin`). `/api/admin/organizations` ' +
          'is the deployment operator\'s list of organizations (`organizations:*`).',
      },
      {
        name: 'Test Authentication',
        description:
          'Token minting for automated tests. The module is registered only when ' +
          '`NODE_ENV !== "production"`, so these routes are absent from a production document entirely.',
      },
    ],
  },
  {
    name: 'Account & Settings',
    tags: [
      {
        name: 'Users',
        description:
          'User administration: listing, inspecting, activating and deactivating accounts, and ' +
          'assigning system roles. Admin only.',
      },
      {
        name: 'User Settings',
        description:
          'The calling user\'s own preferences, stored as a JSON document. Supports full replacement ' +
          '(`PUT`) and JSON Merge Patch (`PATCH`).',
      },
      {
        name: 'System Settings',
        description:
          'Deployment-wide configuration, stored as a JSON document. Readable by any signed-in user; ' +
          'writable only with `system_settings:write`.',
      },
      {
        name: 'Email Settings',
        description:
          'Mail transport configuration (SES or SMTP), the sender identity, and a test send that ' +
          'reports the provider\'s actual error so a misconfiguration can be diagnosed. Gated on ' +
          '`system_settings:read`/`:write`. The SMTP password is write-only: it is held in the ' +
          'encrypted credential store, is never returned, and submitting it empty preserves it.',
      },
      {
        name: 'Notifications',
        description:
          'The registry of events this application can raise, and which channels each supports. ' +
          'Readable by any signed-in user, because every user renders their own notification ' +
          'preferences against it.',
      },
      {
        name: 'Push Configuration',
        description:
          'Runtime-configurable Web Push (VAPID) keys: generate, rotate, enable/disable and ' +
          'remove, with no restart required. Gated on `push:read`/`push:write`, separately from ' +
          '`system_settings:*`, because rotating or removing the key pair knocks every existing ' +
          'push subscriber offline until they resubscribe — a materially different act from an ' +
          'ordinary settings edit. The VAPID private key is write-only: it is held in the ' +
          'encrypted credential store and is never returned by any endpoint.',
      },
      {
        name: 'Organization Settings',
        description:
          'The caller\'s active organization\'s overrides of the org-overridable system settings ' +
          'namespaces, with the effective (system then organization) value of each. Org permissions ' +
          '`org_settings:read`/`:write`; each namespace\'s own permissions gate its fields. Supports ' +
          '`If-Match`.',
      },
      {
        name: 'Onboarding',
        description:
          'First-run onboarding: the caller\'s Get started checklist and, for an administrator ' +
          '(`system_settings:read`), the Setup guide, both DERIVED from the data on every request ' +
          '(Doctor checks, the allowlist, the caller\'s settings), never stored; plus aggregate ' +
          'new-user activation metrics. Read-only; the welcome and dismiss state is written through ' +
          '`PATCH /api/user-settings` (`onboarding` namespace).',
      },
    ],
  },
  {
    name: 'Storage',
    tags: [
      {
        name: 'Storage',
        description:
          'File objects: simple upload, resumable multipart upload, signed download URLs, metadata, ' +
          'and deletion. A caller sees only the objects they uploaded.',
      },
      {
        name: 'Exports',
        description:
          'Data exports: a copy of the caller\'s own data (`user-data`, every role through ' +
          '`user_settings:read`) or of an organization\'s (`org-data`, its administrators through ' +
          '`org_members:read`), as JSON, a zip of CSVs or an Excel workbook. A request queues an ' +
          '`export.run` job (`202`); the export id is the job id and its status is derived. A ready ' +
          'export read by id carries a short-lived signed download; files expire after the ' +
          'retention period. The permission is the source\'s, checked per request.',
      },
      {
        name: 'Storage Configuration',
        description:
          'Which object store this deployment writes to, and with whose credential: provider, ' +
          'bucket, region, endpoint, plus a connection test and a bucket provisioner. Gated on ' +
          '`storage_config:read`/`storage_config:write`, separately from `storage:*` (which every ' +
          'signed-in user holds for object access) and from `system_settings:*` (a wrong value here ' +
          'breaks every upload, avatar, job artifact and backup at once). The secret access key is ' +
          'write-only: it is held in the encrypted credential store and is never returned by any ' +
          'endpoint.',
      },
    ],
  },
  {
    name: 'AI',
    tags: [
      {
        name: 'AI Administration',
        description:
          'The AI platform\'s deployment-wide configuration: the kill switch, the key policy, ' +
          'which providers are enabled, each provider\'s admin (org) key, a connection test, and ' +
          'the model catalog — which models are enabled, their capability overrides, and catalog ' +
          'refresh. Gated on `ai_config:read`/`ai_config:write` (Admin only) and reachable while ' +
          'AI is disabled, so it can always be turned back on. Admin keys are write-only: held ' +
          'in the encrypted credential store and never returned.',
      },
      {
        name: 'AI',
        description:
          'Using AI as a signed-in user: `GET /api/ai/config` (is AI on, which key policy, which ' +
          'providers — readable by anyone, even while AI is off), your own provider keys (bring ' +
          'your own key: verified before it is stored, encrypted at rest, write-only), and the ' +
          'models you can actually call. Everything except `GET /api/ai/config` requires ' +
          '`ai:use` and answers `403` with `details.reason: "AI_DISABLED"` while AI is disabled.',
      },
    ],
  },
  {
    name: 'Operations',
    tags: [
      {
        name: 'Health',
        description:
          'Liveness and readiness probes for orchestrators and load balancers. Public — a probe that ' +
          'needed a token could not report that authentication is down.',
      },
      // ----------------------------------------------------------------------
      // Reserved ahead of their controllers (#256, epic #254)
      // ----------------------------------------------------------------------
      //
      // The four tags below are declared before any operation carries them, so
      // that the epic's later issues add a controller and not a taxonomy
      // argument. That is safe here and needs no exception in the tests:
      // `applyTagGroups` (openapi/document.ts) publishes only the tags an
      // operation actually uses, so an unused declaration is PRUNED from
      // `document.tags` and from `x-tagGroups` rather than rendering an empty
      // section. `test/openapi/openapi-document.spec.ts` asserts orphans
      // against the PUBLISHED tags for exactly that reason — the same mechanism
      // that already lets `Test Authentication` be declared here and absent
      // from a production document.
      //
      // The rule that has no slack is the other direction: a tag USED by a
      // controller and missing from this file is undeclared, undescribed and
      // ungrouped, and that assertion stays strict. So each issue below adds
      // its operations to a tag that is already described and already grouped.
      {
        name: 'Jobs',
        description:
          'The background job queue: what is queued, running, finished or failed, and the controls ' +
          'to retry or cancel a job. Gated on `jobs:read`/`jobs:write`.',
      },
      {
        name: 'Worker Nodes',
        description:
          'The worker fleet that executes queued jobs — registration, heartbeats, health, and ' +
          'draining a node before it is retired. Gated on `nodes:read`/`nodes:write`, separately ' +
          'from the queue itself.',
      },
      {
        name: 'Database Backup',
        description:
          'Scheduled database backups, their history, and restore. Reading and scheduling are ' +
          '`db_backup:read`/`db_backup:write`; restoring requires `db_backup:restore`, which is a ' +
          'permission of its own because it renames the live database and restarts the process.',
      },
      {
        name: 'Notification Broadcasts',
        description:
          'Announcements an administrator composes and sends to every active user, immediately ' +
          'or on a schedule, over the channels the deployment supports. Gated on ' +
          '`broadcasts:read`/`broadcasts:write`, separately from `Notifications` — that section ' +
          'is every signed-in user\'s own preferences and registry, this one sends to all of ' +
          'them. Grouped with Operations rather than with Account & Settings because a ' +
          'broadcast is an operational action (maintenance windows, incident updates, policy ' +
          'changes), not a per-account setting.',
      },
      {
        name: 'About',
        description:
          'What is actually deployed here: the API version this process resolved for itself, ' +
          'the deploy document `appctl deploy` leaves on disk, and a database liveness fact. ' +
          'Gated on `system_settings:read` — deliberately an existing permission rather than ' +
          'a new one, because a read-only report of the deployment has no blast radius of its ' +
          'own. Always answers 200: a missing or malformed document, and an unreachable ' +
          'database, are fields rather than status codes.',
      },
      {
        name: 'Doctor',
        description:
          'Read-only configuration and health checks for every capability of this deployment, ' +
          'each with a status, a one-line detail and — when something needs attention — a ' +
          'remedy and the settings page that fixes it. Gated on `system_settings:read`. ' +
          'Always answers 200: a failing check is a row, not a status code.',
      },
      {
        name: 'Telemetry',
        description:
          'Observability: whether traces, logs and metrics are exported to the telemetry store ' +
          '(GreptimeDB), how long they are retained, and the store\'s status. The policy is ' +
          '`telemetry:read`/`telemetry:write`; running queries against the data is ' +
          '`telemetry:query`. `GET /api/telemetry/config` is readable by any signed-in user — ' +
          'it is how a client learns whether to show telemetry surfaces at all.',
      },
      {
        name: 'Maintenance',
        description:
          'The maintenance window: turning it on, the message callers see while it is open, and ' +
          'whether administrators keep access. Gated on `system_settings:write`.',
      },
    ],
  },  {
    name: 'Sharing',
    tags: [
      {
        name: 'Groups',
        description:
          'Groups inside the caller\'s active organization: their members (roles `admin`, `editor`, `viewer`) and ' +
          'their invitations. Org permissions `groups:read`, `groups:write` and `groups:admin`; a group you may ' +
          'not see is always 404, never 403. Invitees answer from `/api/groups/invites/mine`.',
      },
      {
        name: 'Grants',
        description:
          'Share one record of a registered resource type with a user or a group of the caller\'s active ' +
          'organization, with a role and an optional expiry; one role per grantee, revocation is soft. Org ' +
          'permissions `sharing:read`, `sharing:write` and `sharing:admin` (the `share` action on every record); a ' +
          'record you may not share is 404. `/api/grants/shared-with-me` lists what is shared with you.',
      },
    ],
  },
  {
    name: 'Android',
    tags: [
      {
        name: 'Android App',
        description:
          'The Android companion (a Trusted Web Activity plus an optional native module): the trusted apps and the ' +
          'public `/.well-known/assetlinks.json` (`system_settings:read`/`write`), the hosted APK releases, signed ' +
          'ten-minute download links for any signed-in user, and the Android test notification.',
      },
    ],
  },
];

// Registered once, at import, in group order: the registry keeps registration
// order, so the published `tags` and `x-tagGroups` order is exactly the order
// of TAG_GROUPS above.
openApiTags.registerAll(
  TAG_GROUPS.flatMap((group) => group.tags.map((tag) => ({ ...tag, group: group.name }))),
);

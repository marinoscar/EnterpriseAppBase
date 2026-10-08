// =============================================================================
// Platform model ownership inventory (issue #725, PP-6.5)
// =============================================================================
//
// Every platform model is exactly one kind (see
// `@marinoscar/platform-api/core` `OwnershipKind`):
//
//   org           NOT NULL `org_id`, row-level security FORCED. Reached through
//                 `PrismaService.forOrg` / `runInOrg`, or the system client.
//   org-optional  nullable `org_id`, no row-level security.
//   user          personal to one user; no organisation.
//   system        deployment-wide; no organisation.
//
// The tripwires (test/tenancy/model-ownership.spec.ts, and
// test/tenancy/rls-coverage.db.spec.ts against the catalogue) fail when a model
// has no entry, when an `org` model lacks the column or the policy, and when a
// table carries `org_id` without its model saying why. A fork classifies its
// own models in `app-registrations/model-ownership.ts`, never here.
// =============================================================================

import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

export const PLATFORM_MODEL_OWNERSHIP: readonly ModelOwnershipDef<Prisma.ModelName>[] = [
  // ---------------------------------------------------------------------------
  // org: tenant data. Policy `<table>_org_isolation`, FORCE ROW LEVEL SECURITY.
  // ---------------------------------------------------------------------------
  {
    model: 'StorageObject',
    kind: 'org',
    rationale: 'An uploaded file belongs to the organisation it was uploaded in; another organisation must never list, fetch or sign it.',
  },
  {
    model: 'StorageObjectChunk',
    kind: 'org',
    rationale:
      'A multipart-upload part of a StorageObject. Carries its own org_id (a policy cannot join through its parent) and a composite foreign key (object_id, org_id) to the parent, so a chunk can never point at another organisation\'s object.',
  },
  {
    model: 'AiRun',
    kind: 'org',
    rationale: 'A background AI run holds the full prompt of a user of one organisation; it is that organisation\'s data.',
  },
  {
    model: 'AiUsageEvent',
    kind: 'org',
    orgField: 'orgId',
    rationale:
      'One provider round trip, attributed to the organisation that made it. The column stays nullable so a deployment-wide event (a catalogue sync) and the history of a deleted organisation (onDelete SetNull) survive; the policy then shows such a row to the system client only.',
  },

  // ---------------------------------------------------------------------------
  // org-optional: a nullable org_id, no row-level security in this release.
  // ---------------------------------------------------------------------------
  {
    model: 'AuditEvent',
    kind: 'org-optional',
    rationale:
      'Audit history outlives the organisation (onDelete SetNull) and system events (settings, backups, restores) belong to no organisation, so org_id is NULL for them. Organisation audit views come later; until then the table is read by administrators only.',
  },
  {
    model: 'Job',
    kind: 'org-optional',
    rationale:
      'The job queue. org_id (#734) records whose work a job is, and is NULL for a system job (housekeeping, fleet sweeps, backups) and after its organisation is deleted (onDelete SetNull). No row-level security, deliberately: the claim is one cross-organisation statement; isolation is at the API (system routes), and a handler reaches tenant tables through JobScope.run.',
  },

  // ---------------------------------------------------------------------------
  // user: personal data, reached with forUser; no organisation.
  // ---------------------------------------------------------------------------
  { model: 'UserSettings', kind: 'user', rationale: "The user's own preferences." },
  { model: 'Notification', kind: 'user', rationale: "A user's inbox entry." },
  { model: 'NotificationDelivery', kind: 'user', rationale: "A delivery attempt of one user's notification." },
  { model: 'PushSubscription', kind: 'user', rationale: "A user's own browser push endpoint." },
  { model: 'UserAiKey', kind: 'user', rationale: "A user's own bring-your-own AI key." },
  { model: 'UserIdentity', kind: 'user', rationale: 'A provider identity the user signs in with.' },
  {
    model: 'RefreshToken',
    kind: 'user',
    orgReference: 'orgId',
    rationale: 'A rotating session credential. org_id records the organisation the session is active in; it is read at refresh, before any scope exists, so it carries no policy.',
  },
  {
    model: 'PersonalAccessToken',
    kind: 'user',
    orgReference: 'orgId',
    rationale: 'A user\'s API token. org_id binds the token to an organisation; it is read at authentication, before any scope exists, so it carries no policy.',
  },
  {
    model: 'DeviceCode',
    kind: 'user',
    orgReference: 'orgId',
    rationale: 'A device-authorization exchange. org_id records the approver\'s organisation; read before any scope exists, so it carries no policy.',
  },

  // ---------------------------------------------------------------------------
  // system: deployment-wide tables.
  // ---------------------------------------------------------------------------
  { model: 'User', kind: 'system', rationale: 'The identity itself, read across organisations at login. A Membership links it to organisations.' },
  { model: 'SystemSettings', kind: 'system', rationale: 'Deployment-wide settings.' },
  { model: 'AiModel', kind: 'system', rationale: 'The deployment-wide AI model catalogue.' },
  { model: 'Role', kind: 'system', rationale: 'Global role rows (system and org scoped).' },
  { model: 'Permission', kind: 'system', rationale: 'Global permission rows.' },
  { model: 'RolePermission', kind: 'system', rationale: 'Global role-to-permission grants.' },
  { model: 'UserRole', kind: 'system', rationale: "A user's system role assignment; operates the deployment, not an organisation." },
  { model: 'AllowedEmail', kind: 'system', rationale: 'The deployment-wide sign-in allowlist.' },
  { model: 'DatabaseBackupRun', kind: 'system', rationale: 'A deployment-wide database backup or restore record.' },
  { model: 'WorkerNode', kind: 'system', rationale: 'A deployment-wide worker node.' },
  { model: 'NodeCredential', kind: 'system', rationale: 'A deployment-wide worker-node credential.' },
  { model: 'JobStatsRollup', kind: 'system', rationale: 'Deployment-wide queue statistics.' },
  { model: 'JobNodeSecret', kind: 'system', rationale: 'The handle of a credential brokered to a node for one job; never material.' },
  { model: 'NotificationBroadcast', kind: 'system', rationale: 'An administrator broadcast to the deployment. Organisation targeting is #738.' },
  { model: 'Organization', kind: 'system', rationale: 'The tenant itself, read across organisations at login and guarded by service code.' },
  {
    model: 'Membership',
    kind: 'system',
    orgReference: 'orgId',
    rationale: 'Links a user to an organisation; read across organisations at login, guarded by service code, so no policy.',
  },
  {
    model: 'Invite',
    kind: 'system',
    orgReference: 'orgId',
    rationale: 'An invitation to an organisation; read before the invitee has any scope, so no policy.',
  },
];

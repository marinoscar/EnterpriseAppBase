// =============================================================================
// Platform user-owned model inventory (issue #688, PP-1.9)
// =============================================================================
//
// Every platform model with a foreign key to `User`, classified against its
// block comment and `onDelete` in prisma/schema.prisma. Pure data: no side
// effect on import; user-owned-model.manifest.ts registers it.
//
// One file for now because every platform model lives in one schema file; the
// entries move next to their slices when the slices become packages.
//
// OWNER: the row belongs to the user (a scoped client may read and write it).
// ACTOR: the row only names a user who acted (a scoped client refuses it).
// The tripwire (test/prisma/user-owned-models.spec.ts, the `userOwnedData`
// conformance suite) fails when this list and the schema disagree. A fork
// registers its own models in app-registrations/user-owned-models.ts, never
// here. The entry type is the package's, narrowed to this app's model names.
// =============================================================================

import type { UserOwnedModelDef } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

export const PLATFORM_USER_OWNED_MODELS = [
  // ---------------------------------------------------------------------------
  // Owner models, deleted with the user (onDelete: Cascade)
  // ---------------------------------------------------------------------------
  {
    model: 'UserIdentity',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale:
      'The provider identities the user signs in with. It stores no provider tokens, only the subject and the email the provider reported.',
  },
  {
    model: 'UserRole',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "The user's role assignments; meaningless without the user.",
  },
  {
    model: 'UserSettings',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "The user's own preferences.",
  },
  {
    model: 'RefreshToken',
    ownerField: 'userId',
    purge: 'delete',
    export: 'exclude',
    rationale: 'Session state, not user data: a hash of a rotating credential with no value to the user outside this deployment.',
  },
  {
    model: 'PersonalAccessToken',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    exportOmit: ['tokenHash'],
    rationale: "The user's own API tokens. The export lists names, prefixes and dates; the hash never leaves the server.",
  },
  {
    model: 'DeviceCode',
    ownerField: 'userId',
    purge: 'delete',
    export: 'exclude',
    rationale:
      'A short-lived device authorization exchange; nothing worth exporting. The owner is null until a user approves the code.',
  },
  {
    model: 'Membership',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale:
      "The user's membership of an organization (PP-6.1). It means nothing without the user; the export lists which organizations the user belongs to.",
  },
  {
    model: 'Notification',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "The user's in-app inbox.",
  },
  {
    model: 'PushSubscription',
    ownerField: 'userId',
    purge: 'delete',
    export: 'exclude',
    rationale: "A browser's Web Push endpoint and keys: device state that is useless elsewhere and must not be copied around.",
  },
  {
    model: 'NodeCredential',
    ownerField: 'userId',
    purge: 'delete',
    export: 'exclude',
    rationale: 'A worker node identity token hash; a credential, not user data.',
  },
  {
    model: 'UserAiKey',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    exportOmit: ['secret'],
    rationale: "The user's own AI provider keys. The export lists providers and hints; the ciphertext never leaves the server.",
  },
  {
    model: 'WorkerNode',
    ownerField: 'createdById',
    purge: 'delete',
    export: 'exclude',
    rationale:
      'A worker node is managed only by the user who registered it, so an ownerless node could never be managed again; job history survives through Job.claimedByNode (SetNull). Fleet inventory, not personal data.',
  },

  // ---------------------------------------------------------------------------
  // Owner models, detached from the user (onDelete: SetNull)
  // ---------------------------------------------------------------------------
  {
    model: 'StorageObject',
    ownerField: 'uploadedById',
    purge: 'detach',
    export: 'include',
    rationale:
      "The user's uploads. Rows survive their uploader so the object store and the table stay in step; the storage purge removes the bytes.",
  },
  {
    model: 'NotificationDelivery',
    ownerField: 'userId',
    purge: 'detach',
    export: 'include',
    rationale: 'The delivery log of what was sent to the user. Kept, unlinked, for operational history.',
  },
  {
    model: 'AiRun',
    ownerField: 'userId',
    purge: 'detach',
    export: 'include',
    rationale: "The user's AI runs. Kept, unlinked, so usage accounting and job history stay whole.",
  },
  {
    model: 'AiUsageEvent',
    ownerField: 'userId',
    purge: 'detach',
    export: 'include',
    rationale: "The user's AI usage and cost. Kept, unlinked, so deployment totals stay correct.",
  },

  // ---------------------------------------------------------------------------
  // Actor-only models: the row names who acted (onDelete: SetNull)
  // ---------------------------------------------------------------------------
  {
    model: 'SystemSettings',
    actorFields: ['updatedByUserId'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'Deployment configuration; the user only last changed it.',
  },
  {
    model: 'AuditEvent',
    actorFields: ['actorUserId'],
    purge: 'detach',
    export: 'include',
    rationale:
      'The audit trail outlives the actor. A user is entitled to the record of what they did, so the export includes the events naming them.',
  },
  {
    model: 'AllowedEmail',
    actorFields: ['addedById', 'claimedById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'The deployment allowlist; it records who added an entry and who claimed it, neither of whom owns it.',
  },
  {
    model: 'NotificationBroadcast',
    actorFields: ['createdById'],
    purge: 'detach',
    export: 'exclude',
    rationale: "An administrator's broadcast to everyone; it belongs to the deployment, not its author.",
  },
  {
    model: 'DatabaseBackupRun',
    actorFields: ['createdById', 'restoredById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A deployment backup; it records who started it and who restored it.',
  },
  {
    model: 'Organization',
    actorFields: ['createdById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A tenancy boundary, owned by the deployment and its members, not by the user who created it (PP-6.1); the creator is only recorded.',
  },
  {
    model: 'Invite',
    actorFields: ['invitedById', 'acceptedById'],
    purge: 'detach',
    export: 'exclude',
    rationale:
      'An organization invitation (PP-6.1). It records who invited the address and who accepted; neither owns it, and it outlives both users (SetNull).',
  },
  {
    model: 'AiModel',
    actorFields: ['updatedByUserId'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'The deployment AI model catalog; the user only last changed an entry.',
  },
] as const satisfies readonly UserOwnedModelDef<Prisma.ModelName>[];

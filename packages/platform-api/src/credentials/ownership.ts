// =============================================================================
// The credentials slice's model ownership and user-owned data (issue #735)
// =============================================================================
//
// Pure data for the app's two registries (the reference app registers them in
// `prisma/ownership/*.manifest.ts`, beside the platform's other entries):
//
//   Credential.updatedByUserId       ACTOR: purge sets null (SetNull)    system table
//   UserCredential.userId            OWNER: purge deletes (Cascade)      user table
//   OrgCredential.updatedByUserId    ACTOR: purge sets null (SetNull)    org table (RLS)
// =============================================================================

import type { ModelOwnershipDef, UserOwnedModelDef } from '../core/index';

/**
 * The slice's three models in the model ownership registry
 * (`registerModelOwnership`): the deployment store is `system`, a user's own
 * store `user`, and an organization's store `org` (row-level security on
 * `org_id`, policy `org_credentials_org_isolation`).
 *
 * @example
 * ```ts
 * registerModelOwnership(CREDENTIALS_MODEL_OWNERSHIP);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const CREDENTIALS_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'Credential' | 'UserCredential' | 'OrgCredential'>[] = [
  { model: 'Credential', kind: 'system', rationale: 'Deployment-wide encrypted credentials (SMTP, storage, VAPID).' },
  { model: 'UserCredential', kind: 'user', rationale: "A user's own encrypted key." },
  {
    model: 'OrgCredential',
    kind: 'org',
    rationale: "An organization's own encrypted key, encrypted under the org-bound sub-key; another organization must never read or overwrite it.",
  },
];

/**
 * The slice's models with a foreign key to `User`, for the app's
 * user-owned-data registry (`registerUserOwnedModels`).
 *
 * @example
 * ```ts
 * registerUserOwnedModels(CREDENTIALS_USER_OWNED_MODELS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const CREDENTIALS_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Credential' | 'UserCredential' | 'OrgCredential'>[] = [
  {
    model: 'UserCredential',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    exportOmit: ['secret'],
    rationale:
      "The user's own encrypted keys (bring your own key). The export lists the addresses and hints; the ciphertext never leaves the server.",
  },
  {
    model: 'Credential',
    actorFields: ['updatedByUserId'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A deployment-owned secret; the user only last changed it.',
  },
  {
    model: 'OrgCredential',
    actorFields: ['updatedByUserId'],
    purge: 'detach',
    export: 'exclude',
    rationale: "An organization-owned secret; the user only last changed it, and it outlives them.",
  },
];

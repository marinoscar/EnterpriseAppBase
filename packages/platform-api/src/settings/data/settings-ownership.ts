// =============================================================================
// The settings slice's models in the app's data registries (issue #733)
// =============================================================================
//
// `OrgSettings` is the slice's one org table (FORCEd row-level security on
// org_id, `org_settings_org_isolation`); its `updatedByUserId` only records who
// last changed it. The app registers both lists in its manifests, beside the
// platform and sharing entries.
// =============================================================================

import type { ModelOwnershipDef, UserOwnedModelDef } from '../../core/index';

/**
 * The slice's org-owned models for the model ownership registry
 * (`registerModelOwnership`).
 *
 * @example
 * ```ts
 * registerModelOwnership(SETTINGS_MODEL_OWNERSHIP);
 * ```
 *
 * @stability experimental
 */
export const SETTINGS_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'OrgSettings'>[] = [
  {
    model: 'OrgSettings',
    kind: 'org',
    rationale: "One organization's settings overrides; another organization must never read or change them.",
  },
];

/**
 * The slice's new model with a foreign key to `User`, for the app's
 * user-owned-data registry (`registerUserOwnedModels`). `SystemSettings` and
 * `UserSettings` keep the app's existing entries.
 *
 * @example
 * ```ts
 * registerUserOwnedModels(SETTINGS_USER_OWNED_MODELS);
 * ```
 *
 * @stability experimental
 */
export const SETTINGS_USER_OWNED_MODELS: readonly UserOwnedModelDef<'OrgSettings'>[] = [
  {
    model: 'OrgSettings',
    actorFields: ['updatedByUserId'],
    purge: 'detach',
    export: 'exclude',
    rationale: "An organization's configuration; the user only last changed it.",
  },
];

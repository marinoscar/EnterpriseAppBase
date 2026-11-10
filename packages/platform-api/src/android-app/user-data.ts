// The android-app slice's entries for the app's two model registries (#746).

import type { ModelOwnershipDef, UserOwnedModelDef } from '../core/index';

/**
 * The slice's model with a foreign key to `User`, for the app's
 * user-owned-data registry (`registerUserOwnedModels`): the uploader of a
 * release is only recorded, so a user-data reset detaches them and keeps the
 * release (a deployment artifact).
 *
 * @stability experimental
 */
export const ANDROID_APP_USER_OWNED_MODELS: readonly UserOwnedModelDef<'AndroidAppRelease'>[] = [
  {
    model: 'AndroidAppRelease',
    actorFields: ['uploadedById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A hosted APK release is a deployment artifact; it records who uploaded it, who does not own it.',
  },
];

/**
 * The slice's model in the model ownership registry
 * (`registerModelOwnership`): `android_app_releases` is deployment-wide.
 *
 * @stability experimental
 */
export const ANDROID_APP_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'AndroidAppRelease'>[] = [
  {
    model: 'AndroidAppRelease',
    kind: 'system',
    rationale: 'The APKs the deployment hosts; at most one is current deployment-wide (android_app_releases_one_current_uniq_idx).',
  },
];

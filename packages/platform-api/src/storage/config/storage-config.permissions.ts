// =============================================================================
// Object-storage configuration permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { StoragePermissionDeclaration } from '../storage.permissions';

// #375, epic #372 — ADMIN ONLY, same reasoning: this pair decides which
// object store the whole deployment writes to and under whose key, so it
// starts as narrow as the surfaces above and can be widened later without
// a migration, since these are rows. Note that Contributor and Viewer keep
// `storage:*` (object ACCESS) below and gain nothing here — that split is
// the entire point of a separate pair.
/**
 * The storage CONFIGURATION permissions (`storage_config:read`,
 * `storage_config:write`): system scope, `admin` only, deliberately distinct
 * from both `system_settings:*` and `storage:*`. The admin `Storage` card
 * declares `storage_config:read`, the exact string
 * `StorageConfigController` enforces.
 *
 * @stability stable
 */
export const STORAGE_CONFIG_PERMISSIONS = {
  // Object-storage CONFIGURATION — the bucket, the endpoint and the credential
  // this deployment writes every byte through (#375, epic #372).
  //
  // DELIBERATELY NOT `system_settings:*`, for the same reason `nodes:*`,
  // `db_backup:*`, `broadcasts:*` and `push:*` above are not: the blast radius
  // is not a settings edit's. A wrong bucket, a wrong endpoint or a rotated-out
  // secret access key does not degrade one feature — it breaks every upload,
  // every avatar, every job artifact and every database backup in the
  // deployment at once, and it does so the moment it is saved, because the
  // configuration is resolved per call with no restart in between. That is an
  // authority worth granting on purpose rather than inheriting from "may edit a
  // system setting".
  //
  // DELIBERATELY NOT `storage:*` EITHER, which is the closer-looking mistake.
  // `storage:read`/`storage:write`/`storage:delete_any` gate OBJECT ACCESS and
  // are held by Viewer and Contributor — every ordinary user of this
  // application has `storage:read`. Reusing that pair here would hand the
  // deployment's credential-bearing configuration screen to the whole user
  // base. The two pairs answer different questions: `storage:*` is "may this
  // person use the object store", `storage_config:*` is "may this person decide
  // WHICH object store, with WHOSE key".
  //
  // The Settings UI Pattern (CLAUDE.md rule 3) requires a hub card's
  // `permission` to be the exact string its controller enforces, so #376's
  // Storage card mirrors these two and nothing else.
  STORAGE_CONFIG_READ: {
    id: 'storage_config:read',
    description:
      'View the object-storage configuration and the masked status of its stored secret key',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  STORAGE_CONFIG_WRITE: {
    id: 'storage_config:write',
    description:
      'Change the object-storage provider, bucket, endpoint and credential, test a configuration, and provision a bucket',
    scope: 'system',
    defaultGrants: ['admin'],
  },
} as const satisfies Record<string, StoragePermissionDeclaration>;

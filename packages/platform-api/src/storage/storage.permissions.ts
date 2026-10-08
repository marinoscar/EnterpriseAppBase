// =============================================================================
// Object-storage access permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

/**
 * One permission the storage slice declares, in the shape an app's permission
 * registry takes (structurally the reference app's `PermissionDeclaration`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export interface StoragePermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'org'` for object access, `'system'` for operating the deployment. */
  readonly scope: 'system' | 'org';
  /** Role ids seeded into `role_permissions`; the seed only adds grants. */
  readonly defaultGrants: readonly string[];
}

// Object ACCESS. `storage:read` and `storage:write` are ORG scope (issue #723):
// a member's own objects, held through the membership role. `storage:delete_any`
// stays SYSTEM scope: deleting anybody's object is an operator's act, held by
// the system `admin` role only. The storage CONFIGURATION pair (`storage_config:*`) is a
// separate, Admin-only declaration in `config/storage-config.permissions.ts`.
/**
 * The storage slice's object-access permissions, keyed by the `PERMISSIONS`
 * constant name the reference app derives from them: `storage:read` and
 * `storage:write` (org scope, held through the membership role) and
 * `storage:delete_any` (system scope, `admin`). Register them with the app's
 * permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(STORAGE_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const STORAGE_PERMISSIONS = {
  // Storage
  STORAGE_READ: {
    id: 'storage:read',
    description: 'Read object metadata, get download URLs',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  STORAGE_WRITE: {
    id: 'storage:write',
    description: 'Upload, update metadata',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  STORAGE_DELETE_ANY: {
    id: 'storage:delete_any',
    description: 'Admin: delete any object',
    scope: 'system',
    defaultGrants: ['admin'],
  },
} as const satisfies Record<string, StoragePermissionDeclaration>;

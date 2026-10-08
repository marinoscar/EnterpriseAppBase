// =============================================================================
// Users and RBAC permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; the manifest slice (`registerPlatformPermissions()`)
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { IdentityPermissionDeclaration as PermissionDeclaration } from '../identity.permissions';

/**
 * The permissions of users and RBAC: `users:read`, `users:write`, `rbac:manage` (all system), with descriptions and default grants, keyed by
 * the `PERMISSIONS` constant name the reference app derives from them.
 * Register them with the app's permission registry.
 *
 * @stability stable
 */
export const USERS_PERMISSIONS: {
  /** `users:read`: view user list and details. */
  readonly USERS_READ: PermissionDeclaration<'users:read'>;
  /** `users:write`: modify user accounts. */
  readonly USERS_WRITE: PermissionDeclaration<'users:write'>;
  /** `rbac:manage`: manage roles and permissions. */
  readonly RBAC_MANAGE: PermissionDeclaration<'rbac:manage'>;
} = {
  // Users
  USERS_READ: {
    id: 'users:read',
    description: 'View user list and details',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  USERS_WRITE: {
    id: 'users:write',
    description: 'Modify user accounts',
    scope: 'system',
    defaultGrants: ['admin'],
  },

  // RBAC
  RBAC_MANAGE: {
    id: 'rbac:manage',
    description: 'Manage roles and permissions',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

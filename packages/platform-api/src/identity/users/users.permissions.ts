// =============================================================================
// Users and RBAC permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { IdentityPermissionDeclarationMap as PermissionDeclarationMap } from '../identity.permissions';

export const USERS_PERMISSIONS = {
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
} as const satisfies PermissionDeclarationMap;

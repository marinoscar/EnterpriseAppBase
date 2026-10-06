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

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

export const USERS_PERMISSIONS = {
  // Users
  USERS_READ: {
    id: 'users:read',
    description: 'View user list and details',
    defaultGrants: ['admin'],
  },
  USERS_WRITE: {
    id: 'users:write',
    description: 'Modify user accounts',
    defaultGrants: ['admin'],
  },

  // RBAC
  RBAC_MANAGE: {
    id: 'rbac:manage',
    description: 'Manage roles and permissions',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

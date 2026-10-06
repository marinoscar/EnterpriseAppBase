// =============================================================================
// Settings permissions (issue #676, PP-1.4)
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

export const SETTINGS_PERMISSIONS = {
  // System settings
  SYSTEM_SETTINGS_READ: {
    id: 'system_settings:read',
    description: 'Read system settings',
    defaultGrants: ['admin'],
  },
  SYSTEM_SETTINGS_WRITE: {
    id: 'system_settings:write',
    description: 'Modify system settings',
    defaultGrants: ['admin'],
  },

  // User settings
  USER_SETTINGS_READ: {
    id: 'user_settings:read',
    description: 'Read own user settings',
    defaultGrants: ['admin', 'contributor', 'viewer'],
  },
  USER_SETTINGS_WRITE: {
    id: 'user_settings:write',
    description: 'Modify own user settings',
    defaultGrants: ['admin', 'contributor', 'viewer'],
  },
} as const satisfies PermissionDeclarationMap;

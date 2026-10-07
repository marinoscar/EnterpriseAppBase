// =============================================================================
// Allowlist permissions (issue #676, PP-1.4)
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

export const ALLOWLIST_PERMISSIONS = {
  // Allowlist
  ALLOWLIST_READ: {
    id: 'allowlist:read',
    description: 'View allowlisted emails',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  ALLOWLIST_WRITE: {
    id: 'allowlist:write',
    description: 'Manage allowlisted emails',
    scope: 'system',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

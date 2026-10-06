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

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

// Object ACCESS. The storage CONFIGURATION pair (`storage_config:*`) is a
// separate, Admin-only declaration in `config/storage-config.permissions.ts`.
export const STORAGE_PERMISSIONS = {
  // Storage
  STORAGE_READ: {
    id: 'storage:read',
    description: 'Read object metadata, get download URLs',
    defaultGrants: ['admin', 'contributor', 'viewer'],
  },
  STORAGE_WRITE: {
    id: 'storage:write',
    description: 'Upload, update metadata',
    defaultGrants: ['admin', 'contributor'],
  },
  STORAGE_DELETE_ANY: {
    id: 'storage:delete_any',
    description: 'Admin: delete any object',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

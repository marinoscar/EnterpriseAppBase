// =============================================================================
// Platform roles (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: the three roles every deployment seeds. `roles.constants.ts`
// derives `ROLES` from this map, and `permission.manifest.ts` registers it
// before any permission (each permission's `defaultGrants` must name a
// registered role). An app adds its own roles in
// `app-registrations/permissions.ts`, never here.
// =============================================================================

import type { RoleDeclarationMap } from './permission.types';

export const PLATFORM_ROLES = {
  ADMIN: {
    id: 'admin',
    description: 'Full system access - manage users, roles, and all settings',
  },
  CONTRIBUTOR: {
    id: 'contributor',
    description: 'Standard user - can manage own settings and future features',
  },
  VIEWER: {
    id: 'viewer',
    description: 'Read-only access - can view content and manage own settings',
  },
} as const satisfies RoleDeclarationMap;

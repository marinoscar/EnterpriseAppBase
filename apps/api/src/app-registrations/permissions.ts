// =============================================================================
// This app's own roles and permissions (issue #676, PP-1.4). APP-OWNED.
// =============================================================================
//
// Upstream keeps both arrays empty forever, so a fork's edits here never
// conflict on merge. The manifest (`common/permissions/permission.manifest.ts`)
// registers these AFTER every platform declaration, roles before permissions:
// a collision with a platform id fails at import time with `DUPLICATE_ID`,
// and a grant naming an unknown role with `INVALID_ENTRY`.
//
// After a change: `npm run catalog:permissions --workspace=api`, commit the
// regenerated `prisma/catalog/permissions.json`, and re-seed
// (`npm run prisma:seed`). Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclaration, RoleDeclaration } from '../common/permissions/permission.types';

/** This app's own roles, seeded after the platform's admin, contributor, viewer and org_admin. */
export const APP_ROLES: readonly RoleDeclaration[] = [
  // { id: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org' },
];

/** This app's own permissions, seeded after every platform permission. */
export const APP_PERMISSIONS: readonly PermissionDeclaration[] = [
  // { id: 'workouts:read', description: 'Read own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'viewer'] },
];

// Typed ids for `@Auth({ permissions: [...] })` and `@Roles(...)`: add each id
// declared above, so a typo fails `npm run typecheck`.
declare module '../common/permissions/permission.types' {
  interface AppPermissionIds {
    // 'workouts:read': true;
  }
  interface AppRoleIds {
    // coach: true;
  }
}

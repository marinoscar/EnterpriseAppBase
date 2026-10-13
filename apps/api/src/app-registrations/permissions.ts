// =============================================================================
// This app's own roles and permissions (issue #676, PP-1.4). APP-OWNED.
// =============================================================================
//
// Upstream keeps both arrays empty forever, so a fork's edits here never
// conflict on merge. The manifest (`common/permissions/permission.manifest.ts`,
// through `registerPlatformPermissions()` of `@marinoscar/platform-api/manifest`)
// registers these AFTER every platform declaration, roles before permissions:
// a collision with a platform id fails at import time with `DUPLICATE_ID`,
// and a grant naming an unknown role with `INVALID_ENTRY`.
//
// App roles are assignable on invitations, memberships and users as soon as they
// are registered (they appear at `GET /api/roles`); `label` and `assignable` on a
// role shape what the dialogs show and which routes may hand it out.
//
// After a change: `npm run catalog:permissions --workspace=api`, commit the
// regenerated `prisma/catalog/permissions.json`, and re-seed
// (`npm run prisma:seed`). Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclaration, RoleDeclaration, RoleGrantDeclaration } from '@marinoscar/platform-api/core';

/** This app's own roles, seeded after the platform's admin, contributor, viewer and org_admin. */
export const APP_ROLES: readonly RoleDeclaration[] = [
  // { id: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org' },
];

/** This app's own permissions, seeded after every platform permission. */
export const APP_PERMISSIONS: readonly PermissionDeclaration[] = [
  // { id: 'workouts:read', description: 'Read own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'viewer'] },
];

/**
 * Permissions to give this app's own roles on top of the permissions' own
 * `defaultGrants`: how an app role receives a PLATFORM permission, which an app
 * cannot edit (`{ role: 'support', permissions: ['users:read'] }`). Each grant
 * is validated at import time (the role and the permission exist, their scopes
 * match, a platform role is not the target) and lands in the seed catalog's
 * `rolePermissions`. A worked, tested example: `coach` (org role) and `support`
 * (system role granted `users:read`) in
 * `platform-extensions/identity/coach-support.roles.ts`.
 */
export const APP_GRANTS: readonly RoleGrantDeclaration[] = [
  // { role: 'support', permissions: ['users:read'] },
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

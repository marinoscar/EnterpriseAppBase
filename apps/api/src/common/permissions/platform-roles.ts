// =============================================================================
// Platform roles (issue #676, PP-1.4; scopes: issue #723, PP-6.3)
// =============================================================================
//
// Pure data: the roles every deployment seeds. `roles.constants.ts` derives
// `ROLES` from this map, and `permission.manifest.ts` registers it before any
// permission (each permission's `defaultGrants` must name a registered role of
// the same scope). An app adds its own roles in
// `app-registrations/permissions.ts`, never here.
//
// TWO KINDS (spec: "Tenancy and access model" → Roles):
//   - SYSTEM roles operate the deployment and are held in `user_roles`:
//     `admin`.
//   - ORG roles operate one organization and are held on a membership
//     (`memberships.role_id`): `org_admin`, `contributor`, `viewer`.
// A user's effective permissions are the union of their system roles' grants
// and the grants of the role on their current organization's membership
// (`auth/principal.factory.ts`).
//
// Order is seed order: `org_admin` is appended so existing rows keep their
// position in the catalog.
// =============================================================================

import type { RoleDeclarationMap } from './permission.types';

export const PLATFORM_ROLES = {
  ADMIN: {
    id: 'admin',
    description: 'System administrator - operate the deployment: users, roles and all system settings',
    scope: 'system',
  },
  CONTRIBUTOR: {
    id: 'contributor',
    description: 'Organization member - manage own settings and storage objects, use AI',
    scope: 'org',
  },
  VIEWER: {
    id: 'viewer',
    description: 'Read-only organization member - view content and manage own settings',
    scope: 'org',
  },
  ORG_ADMIN: {
    id: 'org_admin',
    description: 'Organization administrator - everything a contributor can do, plus manage the organization members and invites',
    scope: 'org',
  },
} as const satisfies RoleDeclarationMap;

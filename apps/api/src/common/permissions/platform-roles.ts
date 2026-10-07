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

import { IDENTITY_ROLES } from '@marinoscar/platform-api/identity';

import type { RoleDeclarationMap } from './permission.types';

/**
 * The platform roles, declared by the identity slice (`IDENTITY_ROLES`,
 * `@marinoscar/platform-api/identity`, #727) and registered here like every
 * other declaration.
 */
export const PLATFORM_ROLES = IDENTITY_ROLES satisfies RoleDeclarationMap;

// =============================================================================
// Organization permissions (issue #723, PP-6.3)
// =============================================================================
//
// Pure data: the organization surface's permissions and their default role
// grants. Imports only types and has no side effect;
// `common/permissions/permission.manifest.ts` registers it, and
// `common/constants/roles.constants.ts` derives `PERMISSIONS` from it. After a
// change, run `npm run catalog:permissions --workspace=api` and commit the
// regenerated `prisma/catalog/permissions.json`. Recipe:
// common/permissions/README.md.
//
// ORG SCOPE, ORG ADMIN ONLY. These gate one organization's own membership: who
// is in it, with which org role, and who is invited. They are declared here and
// seeded; `org-members.controller.ts` and `org-invites.controller.ts` (#726)
// enforce them, and the `Organization` settings card uses these exact
// strings. A customer's organization administrator holds them through the
// `org_admin` membership role without becoming a deployment operator: none of
// them is a system permission, and the system `admin` role does not hold them
// (an administrator's own `org_admin` membership does).
//
// SYSTEM SCOPE, ADMIN ONLY (#726). `organizations:read` / `organizations:write`
// gate the deployment's LIST of organizations (`/api/admin/organizations`):
// creating one and renaming one. That is a deployment operator's question,
// not a customer org admin's, so they are system permissions held by the
// system `admin` role; no org role may hold them (the registry refuses it).
// =============================================================================

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

export const ORGANIZATIONS_PERMISSIONS = {
  ORG_MEMBERS_READ: {
    id: 'org_members:read',
    description: 'View the members of the organization and their organization roles',
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_MEMBERS_WRITE: {
    id: 'org_members:write',
    description: 'Change organization members: their organization role, suspend or remove them',
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_INVITES_READ: {
    id: 'org_invites:read',
    description: 'View pending and past invitations to the organization',
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_INVITES_WRITE: {
    id: 'org_invites:write',
    description: 'Invite people to the organization and revoke invitations',
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORGANIZATIONS_READ: {
    id: 'organizations:read',
    description: "List the deployment's organizations and their member counts",
    scope: 'system',
    defaultGrants: ['admin'],
  },
  ORGANIZATIONS_WRITE: {
    id: 'organizations:write',
    description: 'Create organizations (with a first administrator invitation) and rename them',
    scope: 'system',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

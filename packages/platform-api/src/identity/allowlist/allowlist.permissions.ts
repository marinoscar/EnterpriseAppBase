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

import type { IdentityPermissionDeclaration as PermissionDeclaration } from '../identity.permissions';

/**
 * The permissions of the allowlist: `allowlist:read`, `allowlist:write` (system), with descriptions and default grants, keyed by
 * the `PERMISSIONS` constant name the reference app derives from them.
 * Register them with the app's permission registry.
 *
 * @stability stable
 */
export const ALLOWLIST_PERMISSIONS: {
  /** `allowlist:read`: view allowlisted emails. */
  readonly ALLOWLIST_READ: PermissionDeclaration<'allowlist:read'>;
  /** `allowlist:write`: manage allowlisted emails. */
  readonly ALLOWLIST_WRITE: PermissionDeclaration<'allowlist:write'>;
} = {
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
};

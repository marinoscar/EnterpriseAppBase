// =============================================================================
// The seed's view of the registries (issue #676, PP-1.4)
// =============================================================================
//
// A pure function of the role and permission registries. The generator
// (`scripts/generate-permission-catalog.ts`, `npm run catalog:permissions
// --workspace=api`) writes it to `prisma/catalog/permissions.json`, which
// `prisma/seed-data.ts` reads; `test/prisma/permission-catalog.spec.ts` fails
// when the committed JSON no longer equals this function's output.
// =============================================================================

import { permissionRegistry, roleRegistry } from './permission.registry';

/** What `prisma/seed.ts` upserts: roles, permissions and default role grants. */
export interface PermissionCatalog {
  /** Every registered role, in registration order. */
  roles: Array<{ name: string; description: string }>;
  /** Every registered permission, in registration order. */
  permissions: Array<{ name: string; description: string }>;
  /** Role → permission ids it is granted by default, in permission registration order. Every role has a key. */
  rolePermissions: Record<string, string[]>;
}

/**
 * Builds the seed catalog from the registries as they are now.
 *
 * Import it through `../common/permissions` (which fills the registries first).
 */
export function buildPermissionCatalog(): PermissionCatalog {
  const roles = roleRegistry.list();
  const permissions = permissionRegistry.list();

  const rolePermissions: Record<string, string[]> = {};
  for (const role of roles) rolePermissions[role.id] = [];
  for (const permission of permissions) {
    for (const role of permission.defaultGrants) (rolePermissions[role] ??= []).push(permission.id);
  }

  return {
    roles: roles.map((role) => ({ name: role.id, description: role.description })),
    permissions: permissions.map((permission) => ({
      name: permission.id,
      description: permission.description,
    })),
    rolePermissions,
  };
}

// =============================================================================
// Role and permission registries (issue #676, PP-1.4)
// =============================================================================
//
// Two static registries on the #675 primitive (../registry). Filled at import
// time by ./permission.manifest.ts, in this order: platform roles, app roles,
// platform permissions, app permissions. Roles come first because the
// permission validator checks every default grant against the registered roles.
//
// Read them through the folder (`import { permissionRegistry } from
// '../common/permissions'`), which imports the manifest first; importing this
// file directly gives you empty registries.
//
// Who reads them:
//   - `buildPermissionCatalog()` (./permission-catalog.ts), which
//     `npm run catalog:permissions --workspace=api` writes to
//     `prisma/catalog/permissions.json` for the seed (the production image has
//     no `src/`, so the seed cannot import this file).
//   - `roles.constants.ts` does NOT: it derives `ROLES` and `PERMISSIONS` from
//     the declaration files directly, so it stays free of side effects.
// =============================================================================

import { defineRegistry } from '../registry';
import type {
  PermissionDeclaration,
  PermissionDeclarationMap,
  RoleDeclaration,
  RoleDeclarationMap,
} from './permission.types';

/** Every role the seed creates, in registration order (platform roles first). */
export const roleRegistry = defineRegistry<RoleDeclaration>({
  name: 'roles',
  idOf: (role) => role.id,
  idPattern: /^[a-z][a-z0-9_-]*$/,
  validate: (role) => {
    if (typeof role.description !== 'string' || role.description.trim() === '') {
      throw new Error('a role needs a non-empty description');
    }
  },
});

/** Every permission the seed creates, in registration order (platform permissions first). */
export const permissionRegistry = defineRegistry<PermissionDeclaration>({
  name: 'permissions',
  idOf: (permission) => permission.id,
  idPattern: /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/,
  validate: (permission) => {
    if (typeof permission.description !== 'string' || permission.description.trim() === '') {
      throw new Error('a permission needs a non-empty description');
    }
    if (!Array.isArray(permission.defaultGrants)) {
      throw new Error('defaultGrants must be an array of role ids (use [] for none)');
    }
    const seen = new Set<string>();
    for (const role of permission.defaultGrants) {
      if (!roleRegistry.has(role)) {
        throw new Error(
          `defaultGrants names unknown role "${role}" (registered roles: ${roleRegistry.ids().join(', ') || '(none)'}); ` +
            'register the role before the permission',
        );
      }
      if (seen.has(role)) throw new Error(`defaultGrants names role "${role}" twice`);
      seen.add(role);
    }
  },
});

function entriesOf<T>(declarations: readonly T[] | Readonly<Record<string, T>>): readonly T[] {
  return Array.isArray(declarations) ? declarations : Object.values(declarations as Record<string, T>);
}

/**
 * Registers roles, all or nothing. Accepts an array or a {@link RoleDeclarationMap}
 * (registered in the map's key order).
 *
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`, naming the id.
 */
export function registerRoles(roles: readonly RoleDeclaration[] | RoleDeclarationMap): void {
  roleRegistry.registerAll(entriesOf(roles));
}

/**
 * Registers permissions, all or nothing. Accepts an array or a
 * {@link PermissionDeclarationMap} (registered in the map's key order). Every
 * role in `defaultGrants` must already be registered.
 *
 * @throws RegistryError `INVALID_ID` (not `<resource>:<action>`), `INVALID_ENTRY`
 * (empty description, unknown or repeated grant), `DUPLICATE_ID` or `FROZEN`, naming the id.
 */
export function registerPermissions(
  permissions: readonly PermissionDeclaration[] | PermissionDeclarationMap,
): void {
  permissionRegistry.registerAll(entriesOf(permissions));
}

export { permissionIds, roleIds } from './permission-ids';

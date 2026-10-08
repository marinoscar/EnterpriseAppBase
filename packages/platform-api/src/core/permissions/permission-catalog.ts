// =============================================================================
// The seed's view of the role and permission registries (issue #676; packaged #866)
// =============================================================================
//
// Pure functions from declarations to the catalog a seed upserts: roles,
// permissions and default grants, in registration order. The shape is
// `PermissionCatalogSnapshot` of `@marinoscar/platform-db/seed`, so the result
// goes straight into `platformSeedInputFrom()`. The reference app renders it
// into `prisma/catalog/permissions.json` (its seed runs in an image without
// `src/`); an app whose seed can import its packages may compose it directly.
// =============================================================================

import { Registry } from '../registry/registry';
import {
  entriesOf,
  permissionRegistry,
  permissionRegistryOptions,
  roleRegistry,
  roleRegistryOptions,
} from './permission.registry';
import type { Declarations, PermissionDeclaration, PermissionScope, RoleDeclaration } from './permission.types';

/**
 * What a seed upserts: roles, permissions and default role grants.
 *
 * @stability stable
 */
export interface PermissionCatalog {
  /** Every registered role, in registration order, with its scope. */
  roles: Array<{ name: string; description: string; scope: PermissionScope }>;
  /** Every registered permission, in registration order, with its scope. */
  permissions: Array<{ name: string; description: string; scope: PermissionScope }>;
  /** Role to the permission ids it is granted by default, in permission registration order. Every role has a key. */
  rolePermissions: Record<string, string[]>;
}

/**
 * Where {@link buildPermissionCatalog} reads roles and permissions from: any
 * pair of lists in registration order (the static registries by default).
 *
 * @stability stable
 */
export interface PermissionCatalogSource {
  /** The roles, in registration order. */
  readonly roles: { list(): readonly RoleDeclaration[] };
  /** The permissions, in registration order. */
  readonly permissions: { list(): readonly PermissionDeclaration[] };
}

/**
 * Builds the seed catalog from the registries as they are now.
 *
 * @param source - the registries to read; {@link roleRegistry} and {@link permissionRegistry} by default.
 * @returns the catalog, every role keyed in `rolePermissions` (with `[]` when it holds nothing).
 *
 * @example
 * ```ts
 * import './permission.manifest'; // fills the registries first
 * const catalog = buildPermissionCatalog();
 * ```
 *
 * @stability stable
 */
export function buildPermissionCatalog(
  source: PermissionCatalogSource = { roles: roleRegistry, permissions: permissionRegistry },
): PermissionCatalog {
  const roles = source.roles.list();
  const permissions = source.permissions.list();

  const rolePermissions: Record<string, string[]> = {};
  for (const role of roles) rolePermissions[role.id] = [];
  for (const permission of permissions) {
    for (const role of permission.defaultGrants) (rolePermissions[role] ??= []).push(permission.id);
  }

  return {
    roles: roles.map((role) => ({ name: role.id, description: role.description, scope: role.scope })),
    permissions: permissions.map((permission) => ({
      name: permission.id,
      description: permission.description,
      scope: permission.scope,
    })),
    rolePermissions,
  };
}

/**
 * Declarations to compose a catalog from, in registration order.
 *
 * @stability stable
 */
export interface PermissionCatalogDeclarations {
  /** Batches of roles, registered first, in order. */
  readonly roles: ReadonlyArray<Declarations<RoleDeclaration>>;
  /** Batches of permissions, registered after every role, in order. */
  readonly permissions: ReadonlyArray<Declarations<PermissionDeclaration>>;
}

/**
 * Composes a catalog from declarations without touching the static
 * registries: the same validation, duplicate rule and order as
 * {@link registerRoles} and {@link registerPermissions}, on detached
 * registries. For a seed or a test that wants the catalog of a set of
 * declarations, not of the process.
 *
 * @param declarations - role batches, then permission batches.
 * @returns the catalog.
 * @throws RegistryError exactly as registering the same batches would.
 *
 * @example
 * ```ts
 * const catalog = composePermissionCatalog({ roles: [IDENTITY_ROLES], permissions: [JOBS_PERMISSIONS, APP_PERMISSIONS] });
 * ```
 *
 * @stability stable
 */
export function composePermissionCatalog(declarations: PermissionCatalogDeclarations): PermissionCatalog {
  const roles = new Registry<RoleDeclaration>(roleRegistryOptions());
  const permissions = new Registry<PermissionDeclaration>(permissionRegistryOptions(roles));
  for (const batch of declarations.roles) roles.registerAll(entriesOf(batch));
  for (const batch of declarations.permissions) permissions.registerAll(entriesOf(batch));
  return buildPermissionCatalog({ roles, permissions });
}

/**
 * The catalog's default grants as `{ role, permission }` pairs, in role
 * order then permission order: the `grants` option of the identity
 * conformance suite.
 *
 * @param catalog - a catalog.
 * @returns one pair per default grant.
 *
 * @example
 * ```ts
 * identity: { rootModule: AppModule, permissions, roles, grants: catalogGrants(catalog) }
 * ```
 *
 * @stability stable
 */
export function catalogGrants(catalog: Pick<PermissionCatalog, 'rolePermissions'>): Array<{ role: string; permission: string }> {
  return Object.entries(catalog.rolePermissions).flatMap(([role, permissions]) =>
    permissions.map((permission) => ({ role, permission })),
  );
}

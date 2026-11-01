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
  expandGrants,
  grantRegistryOptions,
  permissionRegistry,
  permissionRegistryOptions,
  roleGrantRegistry,
  roleRegistry,
  roleRegistryOptions,
  type RoleGrantEntry,
} from './permission.registry';
import type {
  Declarations,
  PermissionDeclaration,
  PermissionScope,
  RoleDeclaration,
  RoleGrantDeclaration,
} from './permission.types';

/**
 * One role or permission as a seed writes it.
 *
 * @stability stable
 */
export interface PermissionCatalogEntry {
  /** The unique name (`admin`, `jobs:read`). */
  name: string;
  /** What it is for. */
  description: string;
  /** `'system'` or `'org'`. */
  scope: PermissionScope;
}

/**
 * What a seed upserts: roles, permissions and default role grants.
 *
 * @stability stable
 */
export interface PermissionCatalog {
  /** Every registered role, in registration order, with its scope. */
  roles: PermissionCatalogEntry[];
  /** Every registered permission, in registration order, with its scope. */
  permissions: PermissionCatalogEntry[];
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
  readonly roles: DeclarationList<RoleDeclaration>;
  /** The permissions, in registration order. */
  readonly permissions: DeclarationList<PermissionDeclaration>;
  /**
   * The explicit role grants ({@link grantPermissions}), in registration order.
   * Optional so a source built before grants existed keeps working.
   */
  readonly grants?: DeclarationList<RoleGrantEntry>;
}

/**
 * Anything that lists declarations in registration order (a `Registry` does).
 *
 * @typeParam T - the declaration type.
 *
 * @stability stable
 */
export interface DeclarationList<T> {
  /**
   * The declarations.
   *
   * @returns them in registration order.
   */
  list(): readonly T[];
}

/**
 * One default grant: a role and a permission it holds.
 *
 * @stability stable
 */
export interface CatalogGrant {
  /** The role name. */
  role: string;
  /** The permission name. */
  permission: string;
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
  source: PermissionCatalogSource = { roles: roleRegistry, permissions: permissionRegistry, grants: roleGrantRegistry },
): PermissionCatalog {
  const roles = source.roles.list();
  const permissions = source.permissions.list();

  // A role's permissions are its default grants and its explicit grants, in
  // permission registration order (so a role that gets nothing extra keeps
  // exactly the list it always had).
  const explicit = new Map<string, Set<string>>();
  for (const grant of source.grants?.list() ?? []) {
    const set = explicit.get(grant.role) ?? new Set<string>();
    set.add(grant.permission);
    explicit.set(grant.role, set);
  }
  const rolePermissions: Record<string, string[]> = {};
  for (const role of roles) rolePermissions[role.id] = [];
  for (const permission of permissions) {
    for (const role of permission.defaultGrants) (rolePermissions[role] ??= []).push(permission.id);
    for (const [role, held] of explicit) {
      if (held.has(permission.id)) (rolePermissions[role] ??= []).push(permission.id);
    }
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
  /** Batches of explicit role grants, registered after every permission, in order. */
  readonly grants?: ReadonlyArray<readonly RoleGrantDeclaration[]>;
}

/**
 * Composes a catalog from declarations without touching the static
 * registries: the same validation, duplicate rule and order as
 * {@link registerRoles}, {@link registerPermissions} and
 * {@link grantPermissions}, on detached registries. For a seed or a test that wants the catalog of a set of
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
  const grants = new Registry<RoleGrantEntry>(grantRegistryOptions(roles, permissions));
  for (const batch of declarations.roles) roles.registerAll(entriesOf(batch));
  for (const batch of declarations.permissions) permissions.registerAll(entriesOf(batch));
  for (const batch of declarations.grants ?? []) grants.registerAll(expandGrants(batch));
  return buildPermissionCatalog({ roles, permissions, grants });
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
export function catalogGrants(catalog: Pick<PermissionCatalog, 'rolePermissions'>): CatalogGrant[] {
  return Object.entries(catalog.rolePermissions).flatMap(([role, permissions]) =>
    permissions.map((permission) => ({ role, permission })),
  );
}

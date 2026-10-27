// =============================================================================
// Role and permission registries (issue #676; scopes #723; packaged #866)
// =============================================================================
//
// Two static registries on the registry primitive (../registry), one per
// process. An app fills them once, at import time, from one manifest, in this
// order: platform roles, app roles, platform permissions, app permissions.
// Roles come first because the permission validator checks every default
// grant against the roles registered so far. The platform's part of that
// order is `registerPlatformPermissions()` of `@marinoscar/platform-api/manifest`.
//
// Who reads them: `buildPermissionCatalog()` (./permission-catalog.ts), which
// an app renders into the committed seed catalog, and the identity
// conformance suite. The same validation also builds detached registries for
// `composePermissionCatalog()`, which never touches these two.
//
// FRAMEWORK-FREE, like the primitive: seeds and generators load it with no
// Nest container.
// =============================================================================

import { Registry, defineRegistry } from '../registry/registry';
import type { Declarations, PermissionDeclaration, PermissionScope, RoleDeclaration, RoleGrantDeclaration } from './permission.types';

/**
 * One expanded grant: a role and a permission it holds.
 *
 * @stability experimental
 */
export interface RoleGrantEntry {
  /** The role name. */
  readonly role: string;
  /** The permission name. */
  readonly permission: string;
}

/** A role id: lower case, digits, `_` and `-`. */
const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** A permission id: `<resource>:<action>`, lower case, digits and `_`. */
const PERMISSION_ID_PATTERN = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

/** The two scopes. Checked at run time: a JS caller can pass anything. */
function isScope(value: unknown): value is PermissionScope {
  return value === 'system' || value === 'org';
}

/** Refuses a role without a description or a scope. */
function validateRole(role: RoleDeclaration): void {
  if (typeof role.description !== 'string' || role.description.trim() === '') {
    throw new Error('a role needs a non-empty description');
  }
  if (!isScope(role.scope)) {
    throw new Error(`a role needs a scope of 'system' or 'org' (got ${JSON.stringify(role.scope)})`);
  }
  if (role.label !== undefined && (typeof role.label !== 'string' || role.label.trim() === '' || role.label.length > 64)) {
    throw new Error('a role label must be a non-blank string of at most 64 characters');
  }
  if (role.assignable !== undefined && typeof role.assignable !== 'boolean') {
    throw new Error(`a role's assignable flag must be a boolean (got ${JSON.stringify(role.assignable)})`);
  }
}

/** A permission validator that checks every default grant against `roles`. */
function permissionValidator(roles: Registry<RoleDeclaration>): (permission: PermissionDeclaration) => void {
  return (permission) => {
    if (typeof permission.description !== 'string' || permission.description.trim() === '') {
      throw new Error('a permission needs a non-empty description');
    }
    if (!isScope(permission.scope)) {
      throw new Error(`a permission needs a scope of 'system' or 'org' (got ${JSON.stringify(permission.scope)})`);
    }
    if (!Array.isArray(permission.defaultGrants)) {
      throw new Error('defaultGrants must be an array of role ids (use [] for none)');
    }
    const seen = new Set<string>();
    for (const role of permission.defaultGrants) {
      if (!roles.has(role)) {
        throw new Error(
          `defaultGrants names unknown role "${role}" (registered roles: ${roles.ids().join(', ') || '(none)'}); ` +
            'register the role before the permission',
        );
      }
      const roleScope = roles.get(role)?.scope;
      if (roleScope !== permission.scope) {
        throw new Error(
          `defaultGrants names ${roleScope} role "${role}" for a ${permission.scope} permission; ` +
            'a role is granted only permissions of its own scope (grant the permission to a role of that scope)',
        );
      }
      if (seen.has(role)) throw new Error(`defaultGrants names role "${role}" twice`);
      seen.add(role);
    }
  };
}

/** A grant id: `<role>|<permission>`. */
const GRANT_ID_PATTERN = /^[a-z][a-z0-9_-]*\|[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

/** A grant validator that checks the role, the permission and their scopes against the two registries. */
function grantValidator(
  roles: Registry<RoleDeclaration>,
  permissions: Registry<PermissionDeclaration>,
): (grant: RoleGrantEntry) => void {
  return (grant) => {
    const role = roles.get(grant.role);
    if (!role) {
      throw new Error(
        `grant names unknown role "${grant.role}" (registered roles: ${roles.ids().join(', ') || '(none)'}); ` +
          'register the role before granting it permissions',
      );
    }
    const permission = permissions.get(grant.permission);
    if (!permission) {
      throw new Error(
        `grant names unknown permission "${grant.permission}"; register the permission before granting it`,
      );
    }
    if (role.scope !== permission.scope) {
      throw new Error(
        `grant gives the ${permission.scope} permission "${grant.permission}" to the ${role.scope} role "${grant.role}"; ` +
          'a role is granted only permissions of its own scope',
      );
    }
    if (permission.defaultGrants.includes(grant.role)) {
      throw new Error(`role "${grant.role}" already holds "${grant.permission}" through its default grants; remove the redundant grant`);
    }
  };
}

/**
 * The options of a grant registry whose entries are checked against `roles` and `permissions`.
 *
 * @param roles - the role registry grants must name.
 * @param permissions - the permission registry grants must name.
 * @internal
 */
export function grantRegistryOptions(
  roles: Registry<RoleDeclaration>,
  permissions: Registry<PermissionDeclaration>,
): { name: string; idOf: (grant: RoleGrantEntry) => string; idPattern: RegExp; validate: (grant: RoleGrantEntry) => void } {
  return {
    name: 'role-grants',
    idOf: (grant) => `${grant.role}|${grant.permission}`,
    idPattern: GRANT_ID_PATTERN,
    validate: grantValidator(roles, permissions),
  };
}

/**
 * Expands grant declarations into one entry per role and permission.
 *
 * @param grants - the declarations.
 * @returns the entries, in declaration order.
 * @throws Error when a declaration names no permission.
 *
 * @internal
 */
export function expandGrants(grants: readonly RoleGrantDeclaration[]): RoleGrantEntry[] {
  return grants.flatMap((declaration) => {
    if (!Array.isArray(declaration.permissions) || declaration.permissions.length === 0) {
      throw new Error(`the grant for role "${declaration.role}" names no permission`);
    }
    return declaration.permissions.map((permission) => ({ role: declaration.role, permission }));
  });
}

/**
 * The options of a role registry, shared by the static one and the detached
 * ones `composePermissionCatalog()` builds.
 *
 * @internal
 */
export function roleRegistryOptions(): { name: string; idOf: (role: RoleDeclaration) => string; idPattern: RegExp; validate: (role: RoleDeclaration) => void } {
  return { name: 'roles', idOf: (role) => role.id, idPattern: ROLE_ID_PATTERN, validate: validateRole };
}

/**
 * The options of a permission registry whose grants are checked against `roles`.
 *
 * @param roles - the role registry grants must name.
 * @internal
 */
export function permissionRegistryOptions(roles: Registry<RoleDeclaration>): {
  name: string;
  idOf: (permission: PermissionDeclaration) => string;
  idPattern: RegExp;
  validate: (permission: PermissionDeclaration) => void;
} {
  return { name: 'permissions', idOf: (permission) => permission.id, idPattern: PERMISSION_ID_PATTERN, validate: permissionValidator(roles) };
}

/**
 * Every role the seed creates, in registration order (platform roles first).
 * Fill it with {@link registerRoles}, or with `registerPlatformPermissions()`
 * of `@marinoscar/platform-api/manifest`.
 *
 * Ids match `/^[a-z][a-z0-9_-]*$/`; every role has a non-blank description
 * and a scope.
 *
 * @example
 * ```ts
 * roleRegistry.ids(); // ['admin', 'contributor', 'viewer', 'org_admin', ...app roles]
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export const roleRegistry: Registry<RoleDeclaration> = defineRegistry<RoleDeclaration>(roleRegistryOptions());

/**
 * Every permission the seed creates, in registration order (platform
 * permissions first). Fill it with {@link registerPermissions}, or with
 * `registerPlatformPermissions()` of `@marinoscar/platform-api/manifest`.
 *
 * Ids are `<resource>:<action>` (`/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/`); every
 * permission has a non-blank description, a scope, and default grants that
 * name roles of its own scope registered earlier, each at most once.
 *
 * @example
 * ```ts
 * permissionRegistry.require('jobs:read').defaultGrants; // ['admin']
 * ```
 *
 * @extensionPoint registry
 * @stability stable
 */
export const permissionRegistry: Registry<PermissionDeclaration> = defineRegistry<PermissionDeclaration>(
  permissionRegistryOptions(roleRegistry),
);

/**
 * Every explicit grant of a permission to a role, in registration order. These
 * are the grants {@link grantPermissions} adds on top of the permissions'
 * `defaultGrants`; `buildPermissionCatalog()` folds both into the one
 * `rolePermissions` map the seed writes into `role_permissions`.
 *
 * Ids are `<role>|<permission>`; the role and the permission must be
 * registered, of the same scope, and not already granted by default.
 *
 * @example
 * ```ts
 * roleGrantRegistry.has('support|users:read'); // true after the support example registers
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const roleGrantRegistry: Registry<RoleGrantEntry> = defineRegistry<RoleGrantEntry>(
  grantRegistryOptions(roleRegistry, permissionRegistry),
);

/**
 * The entries of an array or of a declaration map (in key order).
 *
 * @internal
 */
export function entriesOf<T>(declarations: Declarations<T>): readonly T[] {
  return Array.isArray(declarations) ? declarations : Object.values(declarations as Readonly<Record<string, T>>);
}

/**
 * Registers roles in {@link roleRegistry}, all or nothing. Accepts an array or
 * a {@link RoleDeclarationMap} (registered in the map's key order).
 *
 * @param roles - the declarations.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (empty description or
 * missing scope), `DUPLICATE_ID` or `FROZEN`, naming the id.
 *
 * @example
 * ```ts
 * registerRoles([{ id: 'coach', description: 'Reviews the workouts of assigned athletes', scope: 'org' }]);
 * ```
 *
 * @stability stable
 */
export function registerRoles(roles: Declarations<RoleDeclaration>): void {
  roleRegistry.registerAll(entriesOf(roles));
}

/**
 * Registers permissions in {@link permissionRegistry}, all or nothing. Accepts
 * an array or a {@link PermissionDeclarationMap} (registered in the map's key
 * order). Every role in `defaultGrants` must already be registered.
 *
 * @param permissions - the declarations.
 * @throws RegistryError `INVALID_ID` (not `<resource>:<action>`), `INVALID_ENTRY`
 * (empty description, missing scope, unknown or repeated grant, or a grant to a
 * role of the other scope), `DUPLICATE_ID` or `FROZEN`, naming the id.
 *
 * @example
 * ```ts
 * registerPermissions([
 *   { id: 'workouts:read', description: 'Read own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'viewer'] },
 * ]);
 * ```
 *
 * @stability stable
 */
export function registerPermissions(permissions: Declarations<PermissionDeclaration>): void {
  permissionRegistry.registerAll(entriesOf(permissions));
}

/**
 * Grants registered permissions to registered roles, all or nothing: how an
 * app gives its own role a platform permission (`support` gets `users:read`)
 * without editing the platform's declaration. Call it after
 * {@link registerRoles} and {@link registerPermissions}; the grants appear in
 * `buildPermissionCatalog().rolePermissions`, so the seed writes them into
 * `role_permissions` exactly as it writes default grants and the permission
 * resolver reads them back the same way.
 *
 * @param grants - the role and the permission ids it receives.
 * @throws RegistryError `INVALID_ENTRY` (unknown role or permission, a role of
 * the other scope, a grant the permission already makes by default),
 * `DUPLICATE_ID` (the same grant twice) or `FROZEN`, naming the grant; Error
 * for a declaration naming no permission.
 *
 * @example
 * ```ts
 * registerRoles([{ id: 'support', description: 'Reads the user list', scope: 'system' }]);
 * grantPermissions([{ role: 'support', permissions: ['users:read'] }]);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function grantPermissions(grants: readonly RoleGrantDeclaration[]): void {
  roleGrantRegistry.registerAll(expandGrants(grants));
}

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
import type { Declarations, PermissionDeclaration, PermissionScope, RoleDeclaration } from './permission.types';

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

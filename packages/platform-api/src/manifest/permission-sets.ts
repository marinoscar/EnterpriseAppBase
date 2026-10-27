// =============================================================================
// Permission sets of slices outside the platform (PP-14.15)
// =============================================================================
//
// The platform's own slices are a fixed list (`PLATFORM_PERMISSION_SLICES`):
// their declarations and their seed order are data in this package. A slice
// that lives OUTSIDE the platform (an app's own package, `@kappa/reports`)
// declares its roles and permissions the same way and registers them here, at
// import time, BEFORE the app's manifest calls `registerPlatformPermissions()`.
// The manifest then registers them after the platform's own sets and before the
// app's permissions, and a `slices` option can select them by id like any
// platform slice.
// =============================================================================

import { defineRegistry, type Declarations, type PermissionDeclaration, type Registry, type RoleDeclaration } from '../core/index';
import { PLATFORM_PERMISSION_SLICES } from './platform-permissions';

/**
 * The roles and permissions one slice outside the platform declares.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PermissionSetRegistration {
  /**
   * The slice id: lower-case letters, digits and `-`, 2 to 48 characters, not
   * the id of a platform slice. Selected by `registerPlatformPermissions({ slices })`
   * like a platform slice and unique per registration.
   */
  readonly slice: string;
  /** The slice's roles, registered after the platform roles and before the app's. Optional. */
  readonly roles?: Declarations<RoleDeclaration>;
  /** The slice's permissions, registered after every platform permission and before the app's. Optional. */
  readonly permissions?: Declarations<PermissionDeclaration>;
}

/** A slice id: `kappa-reports`. */
const SLICE_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * The permission sets registered by slices outside the platform, in
 * registration order. Read by {@link registerPlatformPermissions} and
 * {@link platformPermissionCatalog}; `registerPlatformPermissions()` freezes it
 * once it has consumed it, so a set registered afterwards fails with `FROZEN`
 * instead of silently missing from the seed.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const permissionSetRegistry: Registry<PermissionSetRegistration> = defineRegistry<PermissionSetRegistration>({
  name: 'permission-sets',
  idOf: (set) => set.slice,
  idPattern: SLICE_ID_PATTERN,
  validate: (set) => {
    if ((PLATFORM_PERMISSION_SLICES as readonly string[]).includes(set.slice)) {
      throw new Error(`"${set.slice}" is a platform slice; register a set under your own slice id`);
    }
    if (set.roles === undefined && set.permissions === undefined) {
      throw new Error('a permission set needs `roles`, `permissions` or both');
    }
  },
});

/**
 * Registers the roles and permissions of a slice outside the platform. Call it
 * at import time, before `registerPlatformPermissions()` runs (import the
 * slice's package before the app's permission manifest).
 *
 * @param set - the slice id and its declarations.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY` (a platform slice id, or a
 *   set with neither roles nor permissions), `DUPLICATE_ID` or `FROZEN`, naming the slice.
 *
 * @example
 * ```ts
 * // @kappa/reports, imported before the app's permission manifest
 * registerPermissionSet({
 *   slice: 'kappa-reports',
 *   roles: [{ id: 'analyst', description: 'Runs reports', scope: 'org' }],
 *   permissions: [{ id: 'reports:run', description: 'Run a report', scope: 'org', defaultGrants: ['org_admin', 'analyst'] }],
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerPermissionSet(set: PermissionSetRegistration): void {
  permissionSetRegistry.register(set);
}

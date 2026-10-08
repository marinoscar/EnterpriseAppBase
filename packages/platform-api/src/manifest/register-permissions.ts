// =============================================================================
// Registering the platform's roles and permissions plus an app's (issue #866)
// =============================================================================
//
// One function fills core's static registries in the one order every app
// uses: platform roles, app roles, platform permissions (seed order), app
// permissions. Its pure twin builds the same catalog without touching them,
// for a seed that imports its packages. Both read the same batches, so the
// two can never disagree.
// =============================================================================

import {
  composePermissionCatalog,
  registerPermissions,
  registerRoles,
  type Declarations,
  type PermissionCatalog,
  type PermissionDeclaration,
  type RoleDeclaration,
} from '../core/index';
import { PLATFORM_PERMISSION_SETS, PLATFORM_PERMISSION_SLICES, PLATFORM_ROLES, type PlatformPermissionSlice } from './platform-permissions';

/**
 * What to register next to the platform's roles and permissions.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PlatformPermissionOptions {
  /**
   * The slices whose permissions to include, in any order (the sets keep
   * their seed order). Default: every slice. `identity` is required: every
   * app mounts it, and its roles are the platform roles. List each slice
   * whose permissions the app's mounted slices enforce; a slice without
   * declarations of its own (credentials, email, android-app...) enforces
   * the `settings` slice's.
   */
  readonly slices?: readonly PlatformPermissionSlice[];
  /** The app's own roles and permissions, registered after the platform's. */
  readonly app?: {
    /** Batches of app roles, registered after the platform roles, in order. */
    readonly roles?: ReadonlyArray<Declarations<RoleDeclaration>>;
    /** Batches of app permissions, registered after every platform permission, in order. */
    readonly permissions?: ReadonlyArray<Declarations<PermissionDeclaration>>;
  };
}

/**
 * The batches {@link registerPlatformPermissions} registers, in order.
 *
 * @stability experimental
 */
export interface PlatformPermissionDeclarations {
  /** Role batches: the platform roles, then the app's. */
  roles: ReadonlyArray<Declarations<RoleDeclaration>>;
  /** Permission batches: the selected platform sets in seed order, then the app's. */
  permissions: ReadonlyArray<Declarations<PermissionDeclaration>>;
}

/**
 * The role batches and permission batches, in registration order.
 *
 * @param options - see {@link PlatformPermissionOptions}.
 * @returns what to register, in order.
 * @throws Error when `slices` names an unknown slice or leaves out `identity`.
 *
 * @example
 * ```ts
 * const { roles, permissions } = platformPermissionDeclarations({ slices: ['identity', 'settings'] });
 * ```
 *
 * @stability experimental
 */
export function platformPermissionDeclarations(options: PlatformPermissionOptions = {}): PlatformPermissionDeclarations {
  const selected = selectedSlices(options.slices);
  return {
    roles: [PLATFORM_ROLES, ...(options.app?.roles ?? [])],
    permissions: [
      ...PLATFORM_PERMISSION_SETS.filter((set) => selected.has(set.slice)).map((set) => set.permissions),
      ...(options.app?.permissions ?? []),
    ],
  };
}

/** The selected slices, checked. */
function selectedSlices(slices: readonly PlatformPermissionSlice[] | undefined): ReadonlySet<string> {
  if (slices === undefined) return new Set(PLATFORM_PERMISSION_SLICES);
  const known = new Set<string>(PLATFORM_PERMISSION_SLICES);
  const unknown = slices.filter((slice) => !known.has(slice));
  if (unknown.length > 0) {
    throw new Error(
      `platform permissions: unknown slice(s) ${unknown.map((slice) => JSON.stringify(slice)).join(', ')}; ` +
        `the slices that declare permissions are ${PLATFORM_PERMISSION_SLICES.join(', ')}.`,
    );
  }
  if (!slices.includes('identity')) {
    throw new Error("platform permissions: `slices` must include 'identity': every app mounts it, and its roles are the platform roles.");
  }
  return new Set(slices);
}

/**
 * Fills core's `roleRegistry` and `permissionRegistry`: the platform roles,
 * the app's roles, the platform permissions in seed order, then the app's
 * permissions. Call it once, at import time, from the app's permission
 * manifest; the registries are frozen when the application bootstraps.
 *
 * @param options - see {@link PlatformPermissionOptions}.
 * @throws RegistryError when a declaration is refused (an app id equal to a
 *   platform id is `DUPLICATE_ID`; a grant to an unknown role `INVALID_ENTRY`),
 *   naming the id; Error for a bad `slices` list.
 *
 * @example
 * ```ts
 * registerPlatformPermissions({ app: { roles: [APP_ROLES], permissions: [APP_PERMISSIONS] } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerPlatformPermissions(options: PlatformPermissionOptions = {}): void {
  const { roles, permissions } = platformPermissionDeclarations(options);
  for (const batch of roles) registerRoles(batch);
  for (const batch of permissions) registerPermissions(batch);
}

/**
 * The seed catalog of the platform's roles and permissions plus the app's,
 * composed without touching core's registries. Exactly what
 * `buildPermissionCatalog()` returns after `registerPlatformPermissions()`
 * with the same options. Pass it to `platformSeedInputFrom()` of
 * `@marinoscar/platform-db/seed` as `permissions`.
 *
 * @param options - see {@link PlatformPermissionOptions}.
 * @returns the catalog.
 *
 * @example
 * ```ts
 * const permissions = platformPermissionCatalog({ slices: ['identity', 'settings', 'jobs', 'nodes'], app: { permissions: [NOTES_PERMISSIONS] } });
 * await seedPlatform(prisma, platformSeedInputFrom({ permissions, settings }, process.env));
 * ```
 *
 * @stability experimental
 */
export function platformPermissionCatalog(options: PlatformPermissionOptions = {}): PermissionCatalog {
  return composePermissionCatalog(platformPermissionDeclarations(options));
}

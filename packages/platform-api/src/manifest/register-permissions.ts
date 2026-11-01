// =============================================================================
// Registering the platform's roles and permissions plus an app's (issue #866;
// grants and open slices: PP-14.15)
// =============================================================================
//
// One function fills core's static registries in the one order every app
// uses:
//
//   1. platform roles          2. roles of registered slices   3. app roles
//   4. platform permissions    5. permissions of registered slices
//   6. app permissions         7. app grants
//
// "Registered slices" are the sets packages outside the platform add with
// `registerPermissionSet()` (./permission-sets.ts). Its pure twin builds the
// same catalog without touching the registries, for a seed that imports its
// packages. Both read the same batches, so the two can never disagree.
// =============================================================================

import {
  composePermissionCatalog,
  grantPermissions,
  registerPermissions,
  registerRoles,
  type Declarations,
  type PermissionCatalog,
  type PermissionDeclaration,
  type RoleDeclaration,
  type RoleGrantDeclaration,
} from '../core/index';
import { permissionSetRegistry } from './permission-sets';
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
   * their seed order). Default: every platform slice and every slice a package
   * registered with `registerPermissionSet()`. `identity` is required: every
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
    /**
     * Permissions to give app roles on top of the permissions' own
     * `defaultGrants`: how an app role receives a PLATFORM permission
     * (`{ role: 'support', permissions: ['users:read'] }`). Each grant is
     * validated (the role and the permission exist, the scopes match) and
     * lands in the catalog's `rolePermissions`, so the seed writes it into
     * `role_permissions` and the permission resolver reads it like a default
     * grant. A platform role cannot be the target: the platform's matrix is
     * the platform's (declare an app permission with `defaultGrants` to give a
     * platform role something new).
     */
    readonly grants?: readonly RoleGrantDeclaration[];
  };
}

/**
 * The batches {@link registerPlatformPermissions} registers, in order.
 *
 * @stability experimental
 */
export interface PlatformPermissionDeclarations {
  /** Role batches: the platform roles, those of registered slices, then the app's. */
  roles: ReadonlyArray<Declarations<RoleDeclaration>>;
  /** Permission batches: the selected platform sets in seed order, those of registered slices, then the app's. */
  permissions: ReadonlyArray<Declarations<PermissionDeclaration>>;
  /** Grant batches: the app's grants (one batch, or none). */
  grants: ReadonlyArray<readonly RoleGrantDeclaration[]>;
}

/**
 * The role, permission and grant batches, in registration order.
 *
 * @param options - see {@link PlatformPermissionOptions}.
 * @returns what to register, in order.
 * @throws Error when `slices` names an unknown slice or leaves out `identity`,
 *   or a grant names a platform role.
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
  const registered = permissionSetRegistry.list().filter((set) => selected.has(set.slice));
  const grants = options.app?.grants ?? [];
  refusePlatformRoleGrants(grants);
  return {
    roles: [
      PLATFORM_ROLES,
      ...registered.flatMap((set) => (set.roles === undefined ? [] : [set.roles])),
      ...(options.app?.roles ?? []),
    ],
    permissions: [
      ...PLATFORM_PERMISSION_SETS.filter((set) => selected.has(set.slice)).map((set) => set.permissions),
      ...registered.flatMap((set) => (set.permissions === undefined ? [] : [set.permissions])),
      ...(options.app?.permissions ?? []),
    ],
    grants: grants.length > 0 ? [grants] : [],
  };
}

/** The selected slices, checked: the platform's and the registered ones. */
function selectedSlices(slices: readonly PlatformPermissionSlice[] | undefined): ReadonlySet<string> {
  const known = new Set<string>([...PLATFORM_PERMISSION_SLICES, ...permissionSetRegistry.ids()]);
  if (slices === undefined) return known;
  const unknown = slices.filter((slice) => !known.has(slice));
  if (unknown.length > 0) {
    throw new Error(
      `platform permissions: unknown slice(s) ${unknown.map((slice) => JSON.stringify(slice)).join(', ')}; ` +
        `the slices that declare permissions are ${[...known].join(', ')} ` +
        '(a package adds its own with registerPermissionSet(), before this call).',
    );
  }
  if (!slices.includes('identity')) {
    throw new Error("platform permissions: `slices` must include 'identity': every app mounts it, and its roles are the platform roles.");
  }
  return new Set(slices);
}

/** Refuses a grant whose target is a platform role: the platform's role matrix is not an app's to widen. */
function refusePlatformRoleGrants(grants: readonly RoleGrantDeclaration[]): void {
  const platformRoles = new Set<string>(Object.values(PLATFORM_ROLES).map((role) => role.id));
  const refused = grants.filter((grant) => platformRoles.has(grant.role)).map((grant) => grant.role);
  if (refused.length > 0) {
    throw new Error(
      `platform permissions: app grants cannot target the platform role(s) ${[...new Set(refused)].map((role) => JSON.stringify(role)).join(', ')}; ` +
        'grant permissions to your own roles, or declare an app permission whose defaultGrants name the platform role.',
    );
  }
}

/**
 * Fills core's `roleRegistry`, `permissionRegistry` and `roleGrantRegistry`:
 * the platform roles, those of registered slices, the app's roles, the
 * platform permissions in seed order, those of registered slices, the app's
 * permissions, then the app's grants. Call it once, at import time, from the
 * app's permission manifest; the registries are frozen when the application
 * bootstraps. It also freezes the permission-set registry, so a package that
 * calls `registerPermissionSet()` too late fails loudly instead of missing the
 * seed.
 *
 * @param options - see {@link PlatformPermissionOptions}.
 * @throws RegistryError when a declaration is refused (an app id equal to a
 *   platform id is `DUPLICATE_ID`; a grant to an unknown role `INVALID_ENTRY`),
 *   naming the id; Error for a bad `slices` list or a grant to a platform role.
 *
 * @example
 * ```ts
 * registerPlatformPermissions({
 *   app: {
 *     roles: [APP_ROLES],
 *     permissions: [APP_PERMISSIONS],
 *     grants: [{ role: 'support', permissions: ['users:read'] }],
 *   },
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerPlatformPermissions(options: PlatformPermissionOptions = {}): void {
  const { roles, permissions, grants } = platformPermissionDeclarations(options);
  for (const batch of roles) registerRoles(batch);
  for (const batch of permissions) registerPermissions(batch);
  for (const batch of grants) grantPermissions(batch);
  permissionSetRegistry.freeze();
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

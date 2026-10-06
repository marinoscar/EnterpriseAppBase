// =============================================================================
// Role and permission declaration types (issue #676, PP-1.4)
// =============================================================================
//
// Pure types. Every declaration file (`<module>.permissions.ts`, the platform
// roles, the app-owned `app-registrations/permissions.ts`) imports from here with
// `import type`, so declaring a permission never pulls in a registry, Nest or
// Prisma. Recipe: ./README.md.
// =============================================================================

/** A role every deployment seeds into `roles`. */
export interface RoleDeclaration {
  /** The role name, e.g. `'admin'`. Seeded into `roles.name`; never rename one that has been seeded. */
  readonly id: string;
  /** Seeded into `roles.description`. */
  readonly description: string;
}

/** A permission every deployment seeds into `permissions`, with its default role grants. */
export interface PermissionDeclaration {
  /** `'<resource>:<action>'`, e.g. `'jobs:read'`. The exact string `@Auth({ permissions })` enforces. */
  readonly id: string;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /**
   * Role ids seeded into `role_permissions` for this permission. Every id must
   * be a registered role. The seed only adds grants; it never removes one an
   * administrator has granted or revoked since.
   */
  readonly defaultGrants: readonly string[];
}

/**
 * Map form used by declaration files, keyed by the `PERMISSIONS` constant name
 * (`JOBS_READ`), so `roles.constants.ts` keeps literal key-to-id types.
 */
export type PermissionDeclarationMap = Readonly<Record<string, PermissionDeclaration>>;

/** Map form of role declarations, keyed by the `ROLES` constant name (`ADMIN`). */
export type RoleDeclarationMap = Readonly<Record<string, RoleDeclaration>>;

/**
 * The app's own permission ids, added by module augmentation so they type-check
 * in `@Auth({ permissions })` and `@Permissions(...)`:
 *
 * ```ts
 * declare module '../common/permissions/permission.types' {
 *   interface AppPermissionIds {
 *     'workouts:read': true;
 *   }
 * }
 * ```
 *
 * Empty upstream, forever.
 */
export interface AppPermissionIds {}

/** The app's own role ids, added by module augmentation like {@link AppPermissionIds}. Empty upstream. */
export interface AppRoleIds {}

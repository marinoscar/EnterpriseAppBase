// =============================================================================
// Role and permission declaration types (issue #676, PP-1.4)
// =============================================================================
//
// Pure types. Every declaration file (`<module>.permissions.ts`, the platform
// roles, the app-owned `app-registrations/permissions.ts`) imports from here with
// `import type`, so declaring a permission never pulls in a registry, Nest or
// Prisma. Recipe: ./README.md.
// =============================================================================

/**
 * What a role or a permission operates (issue #723, PP-6.3).
 *
 * - `'system'`: the deployment (backups, the Doctor, telemetry, storage
 *   configuration, nodes, users). Held through `user_roles`.
 * - `'org'`: one organization (members, invites, the member's own settings,
 *   storage objects, AI use). Held through the role on the user's membership
 *   of the current organization.
 *
 * Seeded into `roles.scope` / `permissions.scope`. A role is granted only
 * permissions of its own scope; the registry refuses anything else.
 */
export type PermissionScope = 'system' | 'org';

/** A role every deployment seeds into `roles`. */
export interface RoleDeclaration {
  /** The role name, e.g. `'admin'`. Seeded into `roles.name`; never rename one that has been seeded. */
  readonly id: string;
  /** Seeded into `roles.description`. */
  readonly description: string;
  /**
   * `'system'` (assigned in `user_roles`) or `'org'` (assigned on a
   * membership). Required: there is no default.
   */
  readonly scope: PermissionScope;
}

/** A permission every deployment seeds into `permissions`, with its default role grants. */
export interface PermissionDeclaration {
  /** `'<resource>:<action>'`, e.g. `'jobs:read'`. The exact string `@Auth({ permissions })` enforces. */
  readonly id: string;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /**
   * `'system'` or `'org'`. Required: there is no default. Every role in
   * `defaultGrants` must have the same scope.
   */
  readonly scope: PermissionScope;
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

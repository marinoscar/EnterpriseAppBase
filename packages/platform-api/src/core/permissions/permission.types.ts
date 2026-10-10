// =============================================================================
// Role and permission declaration types (issue #676; scopes #723; packaged #866)
// =============================================================================
//
// Pure types. Every declaration file (a slice's `<slice>.permissions.ts`, the
// identity slice's roles, an app's own `app-registrations/permissions.ts`)
// types its entries with these, so declaring a permission never pulls in a
// registry, Nest or Prisma. Recipe: ./README.md.
// =============================================================================

/**
 * What a role or a permission operates.
 *
 * - `'system'`: the deployment (backups, the Doctor, telemetry, storage
 *   configuration, nodes, users). Held through `user_roles`.
 * - `'org'`: one organization (members, invites, the member's own settings,
 *   storage objects, AI use). Held through the role on the user's membership
 *   of the current organization.
 *
 * Seeded into `roles.scope` / `permissions.scope`. A role is granted only
 * permissions of its own scope; the registry refuses anything else.
 *
 * @stability stable
 */
export type PermissionScope = 'system' | 'org';

/**
 * A role every deployment seeds into `roles`.
 *
 * @typeParam Id - the role name.
 *
 * @stability stable
 */
export interface RoleDeclaration<Id extends string = string> {
  /** The role name, e.g. `'admin'`. Seeded into `roles.name`; never rename one that has been seeded. */
  readonly id: Id;
  /** Seeded into `roles.description`. */
  readonly description: string;
  /** `'system'` (assigned in `user_roles`) or `'org'` (assigned on a membership). Required: there is no default. */
  readonly scope: PermissionScope;
}

/**
 * A permission every deployment seeds into `permissions`, with its default
 * role grants.
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export interface PermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`, e.g. `'jobs:read'`: the exact string `@Auth({ permissions })` enforces. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'system'` or `'org'`. Required: there is no default. Every role in `defaultGrants` has the same scope. */
  readonly scope: PermissionScope;
  /**
   * Role ids seeded into `role_permissions` for this permission. Every id must
   * be a role registered earlier. The seed only adds grants; it never removes
   * one an administrator has granted or revoked since.
   */
  readonly defaultGrants: readonly string[];
}

/**
 * Map form used by declaration files, keyed by the `PERMISSIONS` constant name
 * (`JOBS_READ`), so an app's derived constants keep literal key-to-id types.
 *
 * @stability stable
 */
export type PermissionDeclarationMap = Readonly<Record<string, PermissionDeclaration>>;

/**
 * Map form of role declarations, keyed by the `ROLES` constant name (`ADMIN`).
 *
 * @stability stable
 */
export type RoleDeclarationMap = Readonly<Record<string, RoleDeclaration>>;

/**
 * Role or permission declarations, as an array or as a map (registered in the
 * map's key order).
 *
 * @typeParam T - the declaration type.
 *
 * @stability stable
 */
export type Declarations<T> = readonly T[] | Readonly<Record<string, T>>;

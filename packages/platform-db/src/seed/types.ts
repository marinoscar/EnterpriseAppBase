// Types of the platform seed (issue #712). Kept apart from the functions so the
// structural `SeedPrisma` can be read, and mocked, without importing a client.

/**
 * A JSON value, the shape of a `SystemSettings.value` column.
 *
 * @stability experimental
 */
export type SeedJsonValue = string | number | boolean | null | SeedJsonValue[] | { [key: string]: SeedJsonValue };

/**
 * What a role or a permission operates: the deployment (`'system'`) or one
 * organization (`'org'`). The values of the `RoleScope` database enum.
 *
 * @stability experimental
 */
export type SeedScope = 'system' | 'org';

/**
 * A role or a permission as the seed writes it.
 *
 * @stability experimental
 */
export interface SeedNamedEntry {
  /** The unique name (`admin`, `jobs:read`). */
  name: string;
  /** What it is for; refreshed on every run. */
  description: string;
  /**
   * The scope, refreshed on every run like the description. Optional so a
   * catalog written before scopes existed keeps working: an entry without one
   * is written without one (the column default, `'system'`, applies on create
   * and an existing row keeps its scope).
   */
  scope?: SeedScope;
}

/**
 * Everything `seedPlatform` writes. Every field a later slice adds (org-scoped
 * roles, a default organization) is added as an **optional** field, so a
 * caller written today keeps compiling.
 *
 * @example
 * ```ts
 * const input = platformSeedInputFrom({ permissions, settings }, process.env);
 * await seedPlatform(prisma, input, { info: console.log });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface PlatformSeedInput {
  /** Roles, upserted by `name`; the description is updated on every run. */
  roles: ReadonlyArray<SeedNamedEntry>;
  /** Permissions, upserted by `name`; the description is updated on every run. */
  permissions: ReadonlyArray<SeedNamedEntry>;
  /** Default grants: role name to permission names. A name that no row carries is skipped, never created. */
  roleGrants: Readonly<Record<string, readonly string[]>>;
  /** The value of the `global` system settings row, composed from the namespaces. Written once, never overwritten. */
  systemSettingsDefaults: Readonly<Record<string, unknown>>;
  /** The email of the initial administrator. When set, it is added to the allowlist (lower-cased, never updated). */
  initialAdminEmail?: string;
  /**
   * The default organization created when the database has none (default:
   * `Default organization`, slug `default`). Never updated afterwards: an
   * administrator may rename it.
   */
  defaultOrganization?: SeedDefaultOrganization;
}

/**
 * The default organization as the seed creates it.
 *
 * @stability experimental
 */
export interface SeedDefaultOrganization {
  /** Display name. */
  name: string;
  /** Unique slug, lower-case `[a-z0-9-]`, 2 to 63 characters. */
  slug: string;
}

/**
 * Where `seedPlatform` reports progress. The package logs nothing by itself.
 *
 * @stability experimental
 */
export interface SeedLogger {
  /**
   * Report one line of progress.
   *
   * @param msg - The line, without a trailing newline.
   */
  info(msg: string): void;
}

/**
 * What one `seedPlatform` run did.
 *
 * @stability experimental
 */
export interface SeedSummary {
  /** Roles upserted. */
  roles: number;
  /** Permissions upserted. */
  permissions: number;
  /** Role-permission grants upserted (a grant naming an unknown role or permission is not counted). */
  rolePermissions: number;
  /** Grants skipped because the role or the permission has no row, as `role: permission` (`role` alone for an unknown role). */
  skippedGrants: string[];
  /** The allowlisted initial administrator (lower-cased), or `null` when none was given. */
  allowlistedEmail: string | null;
  /** True when this run created the default organization; false when one already existed. */
  defaultOrganizationCreated: boolean;
}

/**
 * The arguments of an upsert, as the seed writes them.
 *
 * @stability experimental
 */
export interface SeedUpsertArgs<Where, Update, Create> {
  /** The natural unique the row is found by. */
  where: Where;
  /** What an existing row is updated with (`{}` never overwrites). */
  update: Update;
  /** What a missing row is created with. */
  create: Create;
}

/**
 * The delegate of a table the seed upserts by `name` and looks up by `name`
 * (`role`, `permission`).
 *
 * @stability experimental
 */
export interface SeedNamedDelegate {
  /**
   * Create the row, or refresh its description.
   *
   * @param args - Keyed on `name`.
   * @returns Anything awaitable.
   */
  upsert(args: SeedUpsertArgs<{ name: string }, { description: string; scope?: SeedScope }, SeedNamedEntry>): PromiseLike<unknown>;
  /**
   * Find the row id by name.
   *
   * @param args - Keyed on `name`.
   * @returns The row, or `null` when none exists.
   */
  findUnique(args: { where: { name: string } }): PromiseLike<SeedRowId | null>;
}

/**
 * The only column of a looked-up row the seed reads.
 *
 * @stability experimental
 */
export interface SeedRowId {
  /** The row's primary key. */
  id: string;
}

/**
 * The delegate of `role_permissions`.
 *
 * @stability experimental
 */
export interface SeedRolePermissionDelegate {
  /**
   * Create the grant when it is missing; an existing grant is left as it is.
   *
   * @param args - Keyed on `roleId_permissionId`.
   * @returns Anything awaitable.
   */
  upsert(
    args: SeedUpsertArgs<
      { roleId_permissionId: { roleId: string; permissionId: string } },
      Record<string, never>,
      { roleId: string; permissionId: string }
    >,
  ): PromiseLike<unknown>;
}

/**
 * The delegate of `system_settings`.
 *
 * @stability experimental
 */
export interface SeedSystemSettingsDelegate {
  /**
   * Create the `global` row when it is missing; an existing row is left as it is.
   *
   * @param args - Keyed on `key`.
   * @returns Anything awaitable.
   */
  upsert(
    args: SeedUpsertArgs<{ key: string }, Record<string, never>, { key: string; value: { [key: string]: SeedJsonValue }; version: number }>,
  ): PromiseLike<unknown>;
}

/**
 * The delegate of `allowed_emails`.
 *
 * @stability experimental
 */
export interface SeedAllowedEmailDelegate {
  /**
   * Create the allowlist entry when it is missing; an existing entry is left as it is.
   *
   * @param args - Keyed on `email`.
   * @returns Anything awaitable.
   */
  upsert(args: SeedUpsertArgs<{ email: string }, Record<string, never>, { email: string; notes: string }>): PromiseLike<unknown>;
}

/**
 * The delegate of `organizations`.
 *
 * @stability experimental
 */
export interface SeedOrganizationDelegate {
  /**
   * Find the default organization, whatever its slug has become.
   *
   * @param args - Filters on `isDefault`.
   * @returns The row, or `null` when none is flagged default.
   */
  findFirst(args: { where: { isDefault: true } }): PromiseLike<SeedRowId | null>;
  /**
   * Create the default organization when its slug is free; an existing row is left as it is.
   *
   * @param args - Keyed on `slug`.
   * @returns Anything awaitable.
   */
  upsert(args: SeedUpsertArgs<{ slug: string }, Record<string, never>, { name: string; slug: string; isDefault: true }>): PromiseLike<unknown>;
}

/**
 * The part of a generated Prisma client the seed uses, as a structural type.
 * The package compiles against these types and never imports or bundles a
 * client: pass the app's `PrismaClient` (or a fake in a test).
 *
 * @stability experimental
 */
export interface SeedPrisma {
  /** The `roles` table. */
  role: SeedNamedDelegate;
  /** The `permissions` table. */
  permission: SeedNamedDelegate;
  /** The `role_permissions` table. */
  rolePermission: SeedRolePermissionDelegate;
  /** The `system_settings` table. */
  systemSettings: SeedSystemSettingsDelegate;
  /** The `allowed_emails` table. */
  allowedEmail: SeedAllowedEmailDelegate;
  /** The `organizations` table. */
  organization: SeedOrganizationDelegate;
}

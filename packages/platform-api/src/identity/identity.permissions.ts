// =============================================================================
// Identity's roles and permissions, as data (issue #727; declarations: #676,
// scopes: #723)
// =============================================================================
//
// Identity DECLARES its roles and permissions here and beside the module that
// enforces each (`users/users.permissions.ts`, `allowlist/allowlist.permissions.ts`,
// `organizations/organizations.permissions.ts`). It registers nothing: the
// app's permission registry (the reference app: `common/permissions/`)
// registers these maps next to every other slice's, with their scopes, and
// seeds them. The shapes are structurally the app's declaration types.
//
// TWO KINDS OF ROLE (spec: "Tenancy and access model" -> Roles):
//   - SYSTEM roles operate the deployment and are held in `user_roles`: `admin`.
//   - ORG roles operate one organization and are held on a membership
//     (`memberships.role_id`): `org_admin`, `contributor`, `viewer`.
// A user's effective permissions are the union of their system roles' grants
// and the grants of the role on their current organization's membership
// (`auth/principal.factory.ts`).
//
// Order is seed order: `org_admin` is appended so existing rows keep their
// position in the catalog.
// =============================================================================

import { ALLOWLIST_PERMISSIONS } from './allowlist/allowlist.permissions';
import { ORGANIZATIONS_PERMISSIONS } from './organizations/organizations.permissions';
import { USERS_PERMISSIONS } from './users/users.permissions';

/**
 * What a role or a permission operates: the deployment (`'system'`, held
 * through `user_roles`) or one organization (`'org'`, held through the role on
 * the user's membership of the current organization). A role is granted only
 * permissions of its own scope.
 *
 * @stability stable
 */
export type IdentityPermissionScope = 'system' | 'org';

/**
 * A role every deployment seeds into `roles`.
 *
 * @typeParam Id - the role name.
 *
 * @stability stable
 */
export interface IdentityRoleDeclaration<Id extends string = string> {
  /** The role name, e.g. `'admin'`. Never rename one that has been seeded. */
  readonly id: Id;
  /** Seeded into `roles.description`. */
  readonly description: string;
  /** `'system'` (assigned in `user_roles`) or `'org'` (assigned on a membership). */
  readonly scope: IdentityPermissionScope;
}

/**
 * A permission every deployment seeds into `permissions`, with its default
 * role grants.
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export interface IdentityPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string `@Auth({ permissions })` enforces. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'system'` or `'org'`; every role in `defaultGrants` has the same scope. */
  readonly scope: IdentityPermissionScope;
  /** Role ids seeded into `role_permissions`; the seed only adds grants. */
  readonly defaultGrants: readonly string[];
}

/**
 * A map of permission declarations keyed by constant name (`USERS_READ`).
 *
 * @stability stable
 */
export type IdentityPermissionDeclarationMap = Readonly<Record<string, IdentityPermissionDeclaration>>;

/**
 * A map of role declarations keyed by constant name (`ADMIN`).
 *
 * @stability stable
 */
export type IdentityRoleDeclarationMap = Readonly<Record<string, IdentityRoleDeclaration>>;

/**
 * The platform roles: one system role (`admin`) and three org roles.
 *
 * @stability stable
 */
export const IDENTITY_ROLES: {
  /** `admin` (system). */
  readonly ADMIN: IdentityRoleDeclaration<'admin'>;
  /** `contributor` (org). */
  readonly CONTRIBUTOR: IdentityRoleDeclaration<'contributor'>;
  /** `viewer` (org). */
  readonly VIEWER: IdentityRoleDeclaration<'viewer'>;
  /** `org_admin` (org). */
  readonly ORG_ADMIN: IdentityRoleDeclaration<'org_admin'>;
} = {
  /** System administrator. */
  ADMIN: {
    id: 'admin',
    description: 'System administrator - operate the deployment: users, roles and all system settings',
    scope: 'system',
  },
  /** Organization member who manages own settings and storage objects and uses AI. */
  CONTRIBUTOR: {
    id: 'contributor',
    description: 'Organization member - manage own settings and storage objects, use AI',
    scope: 'org',
  },
  /** Read-only organization member. */
  VIEWER: {
    id: 'viewer',
    description: 'Read-only organization member - view content and manage own settings',
    scope: 'org',
  },
  /** Organization administrator. */
  ORG_ADMIN: {
    id: 'org_admin',
    description: 'Organization administrator - everything a contributor can do, plus manage the organization members and invites',
    scope: 'org',
  },
};

/**
 * Every permission identity enforces, in seed order: users and RBAC, the
 * allowlist, then organizations, members and invites.
 *
 * @stability stable
 */
export const IDENTITY_PERMISSION_DECLARATIONS: typeof USERS_PERMISSIONS & typeof ALLOWLIST_PERMISSIONS & typeof ORGANIZATIONS_PERMISSIONS = {
  ...USERS_PERMISSIONS,
  ...ALLOWLIST_PERMISSIONS,
  ...ORGANIZATIONS_PERMISSIONS,
};

/** Turns a declaration map into a map of its ids, keeping the literal types. */
function idsOf<M extends Readonly<Record<string, { readonly id: string }>>>(map: M): { readonly [K in keyof M]: M[K]['id'] } {
  const ids: Record<string, string> = {};
  for (const key of Object.keys(map)) ids[key] = map[key]!.id;
  return Object.freeze(ids) as { readonly [K in keyof M]: M[K]['id'] };
}

/**
 * The role ids: `{ ADMIN: 'admin', CONTRIBUTOR: 'contributor', VIEWER: 'viewer', ORG_ADMIN: 'org_admin' }`.
 *
 * @stability stable
 */
export const IDENTITY_ROLE_IDS: {
  /** `admin`. */
  readonly ADMIN: 'admin';
  /** `contributor`. */
  readonly CONTRIBUTOR: 'contributor';
  /** `viewer`. */
  readonly VIEWER: 'viewer';
  /** `org_admin`. */
  readonly ORG_ADMIN: 'org_admin';
} = idsOf(IDENTITY_ROLES);

/**
 * The permission ids identity enforces, keyed by constant name
 * (`USERS_READ: 'users:read'`).
 *
 * @stability stable
 */
export const IDENTITY_PERMISSION_IDS: {
  /** `users:read`. */
  readonly USERS_READ: 'users:read';
  /** `users:write`. */
  readonly USERS_WRITE: 'users:write';
  /** `rbac:manage`. */
  readonly RBAC_MANAGE: 'rbac:manage';
  /** `allowlist:read`. */
  readonly ALLOWLIST_READ: 'allowlist:read';
  /** `allowlist:write`. */
  readonly ALLOWLIST_WRITE: 'allowlist:write';
  /** `org_members:read`. */
  readonly ORG_MEMBERS_READ: 'org_members:read';
  /** `org_members:write`. */
  readonly ORG_MEMBERS_WRITE: 'org_members:write';
  /** `org_invites:read`. */
  readonly ORG_INVITES_READ: 'org_invites:read';
  /** `org_invites:write`. */
  readonly ORG_INVITES_WRITE: 'org_invites:write';
  /** `organizations:read`. */
  readonly ORGANIZATIONS_READ: 'organizations:read';
  /** `organizations:write`. */
  readonly ORGANIZATIONS_WRITE: 'organizations:write';
} = idsOf(IDENTITY_PERMISSION_DECLARATIONS);

/**
 * The org role a new membership gets: every sign-up's role in the default
 * organization, and the role a NULL `org_invites.role_id` stands for. The
 * default of `IdentityModule.forRoot({ defaultOrgRole })`.
 *
 * @stability stable
 */
export const DEFAULT_ORG_ROLE = IDENTITY_ROLE_IDS.VIEWER;

/**
 * The org role that administers one organization. The initial administrator
 * holds it on the default organization, alongside the system `admin` role.
 *
 * @stability stable
 */
export const ORG_ADMIN_ROLE = IDENTITY_ROLE_IDS.ORG_ADMIN;

// ---- typed names, widened by the app ------------------------------------------------

/**
 * The permission ids `@Auth({ permissions })` and `@Permissions(...)` accept.
 * Empty here; an app widens it by module augmentation so its own registry's ids
 * type-check (and a typo does not):
 *
 * ```ts
 * declare module '@marinoscar/platform-api/identity' {
 *   interface IdentityPermissionIds extends Record<PermissionName, true> {}
 * }
 * ```
 *
 * While nobody augments it, any string is accepted.
 *
 * @stability experimental
 */
export interface IdentityPermissionIds {}

/**
 * The role ids `@Auth({ roles })` and `@Roles(...)` accept; widened by the app
 * like {@link IdentityPermissionIds}.
 *
 * @stability experimental
 */
export interface IdentityRoleIds {}

/**
 * A permission id: the app's set when it augmented {@link IdentityPermissionIds}, else any string.
 *
 * @stability stable
 */
export type PermissionName = [keyof IdentityPermissionIds] extends [never] ? string : keyof IdentityPermissionIds & string;

/**
 * A role id: the app's set when it augmented {@link IdentityRoleIds}, else any string.
 *
 * @stability stable
 */
export type RoleName = [keyof IdentityRoleIds] extends [never] ? string : keyof IdentityRoleIds & string;

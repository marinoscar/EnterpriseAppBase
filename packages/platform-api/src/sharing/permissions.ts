// =============================================================================
// Sharing permissions (issue #728, PP-7.1)
// =============================================================================
//
// Pure data: the slice's three permissions and their default role grants. The
// app registers the declarations with its own permission registry (the
// reference app: `common/permissions/permission.manifest.ts`, which also
// derives `PERMISSIONS` from them), and the seed derives the rows from it. The
// strings never change: they are rows in `permissions` and the exact strings
// the routes enforce.
//
// ORG SCOPE. Groups live inside one organization, so every grant is held
// through the member's org role (`org_admin`, `contributor`, `viewer`) in the
// active organization, never through a system role.
//
//   groups:read   list and read the groups you belong to, accept your invites,
//                 leave a group
//   groups:write  create groups; administer the ones you are an admin of
//   groups:admin  read and administer EVERY group of the organization
// =============================================================================

/**
 * One permission the sharing slice declares, in the shape an app's permission
 * registry takes.
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export interface SharingPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** Always `'org'`: groups live inside one organization. */
  readonly scope: 'system' | 'org';
  /** Org role ids the permission is granted to by default (seeded into `role_permissions`). */
  readonly defaultGrants: readonly string[];
}

/**
 * The sharing permissions with their descriptions and default grants, keyed
 * by the `PERMISSIONS` constant name the reference app derives from them.
 * Register them with the app's permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(SHARING_PERMISSION_DECLARATIONS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const SHARING_PERMISSION_DECLARATIONS: {
  /** `groups:read`: every org role. */
  readonly GROUPS_READ: SharingPermissionDeclaration<'groups:read'>;
  /** `groups:write`: `org_admin` and `contributor`. */
  readonly GROUPS_WRITE: SharingPermissionDeclaration<'groups:write'>;
  /** `groups:admin`: `org_admin` only. */
  readonly GROUPS_ADMIN: SharingPermissionDeclaration<'groups:admin'>;
} = {
  GROUPS_READ: {
    id: 'groups:read',
    description: 'View the groups you belong to, answer your group invitations and leave a group',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  GROUPS_WRITE: {
    id: 'groups:write',
    description: 'Create groups and manage the members and invitations of groups you administer',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  GROUPS_ADMIN: {
    id: 'groups:admin',
    description: "View and administer every group of the organization, including groups you do not belong to",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
};

/**
 * The permission strings the group routes enforce.
 *
 * @stability experimental
 */
export const SHARING_PERMISSIONS: {
  /** `groups:read`. */
  readonly GROUPS_READ: 'groups:read';
  /** `groups:write`. */
  readonly GROUPS_WRITE: 'groups:write';
  /** `groups:admin`. */
  readonly GROUPS_ADMIN: 'groups:admin';
} = {
  GROUPS_READ: SHARING_PERMISSION_DECLARATIONS.GROUPS_READ.id,
  GROUPS_WRITE: SHARING_PERMISSION_DECLARATIONS.GROUPS_WRITE.id,
  GROUPS_ADMIN: SHARING_PERMISSION_DECLARATIONS.GROUPS_ADMIN.id,
};

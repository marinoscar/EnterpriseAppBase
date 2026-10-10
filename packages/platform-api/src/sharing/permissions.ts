// =============================================================================
// Sharing permissions (issues #728 and #729)
// =============================================================================
//
// Pure data: the slice's six permissions and their default role grants. The
// app registers the declarations with its own permission registry (the
// reference app: the manifest slice (`registerPlatformPermissions()`), which also
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
//
//   sharing:read  list a record's grants (with the `share` action on it), list
//                 what is shared with you, remove your own access (#729)
//   sharing:write share records you may share, change and revoke their grants
//   sharing:admin the `share` action on EVERY record of every type, so an org
//                 admin can revoke a leak
// =============================================================================

import type { PermissionDeclaration } from '../core/index';

/**
 * One permission this slice declares: core's `PermissionDeclaration`, the
 * entry type of the permission registry (`registerPermissions`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export type SharingPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

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
  /** `sharing:read`: every org role. */
  readonly SHARING_READ: SharingPermissionDeclaration<'sharing:read'>;
  /** `sharing:write`: `org_admin` and `contributor`. */
  readonly SHARING_WRITE: SharingPermissionDeclaration<'sharing:write'>;
  /** `sharing:admin`: `org_admin` only. */
  readonly SHARING_ADMIN: SharingPermissionDeclaration<'sharing:admin'>;
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
  SHARING_READ: {
    id: 'sharing:read',
    description: 'View what is shared with you and who a record you can share is shared with, and remove your own access',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  SHARING_WRITE: {
    id: 'sharing:write',
    description: 'Share records you are allowed to share with people and groups of the organization, and change or revoke those shares',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor'],
  },
  SHARING_ADMIN: {
    id: 'sharing:admin',
    description: 'Manage the shares of every record of the organization, including records you do not own',
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
  /** `sharing:read`. */
  readonly SHARING_READ: 'sharing:read';
  /** `sharing:write`. */
  readonly SHARING_WRITE: 'sharing:write';
  /** `sharing:admin`. */
  readonly SHARING_ADMIN: 'sharing:admin';
} = {
  GROUPS_READ: SHARING_PERMISSION_DECLARATIONS.GROUPS_READ.id,
  GROUPS_WRITE: SHARING_PERMISSION_DECLARATIONS.GROUPS_WRITE.id,
  GROUPS_ADMIN: SHARING_PERMISSION_DECLARATIONS.GROUPS_ADMIN.id,
  SHARING_READ: SHARING_PERMISSION_DECLARATIONS.SHARING_READ.id,
  SHARING_WRITE: SHARING_PERMISSION_DECLARATIONS.SHARING_WRITE.id,
  SHARING_ADMIN: SHARING_PERMISSION_DECLARATIONS.SHARING_ADMIN.id,
};

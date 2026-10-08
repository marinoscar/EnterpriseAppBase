// The user-data slice's permissions (issue #743, PP-9.1). `user_settings:write`
// is the settings slice's and held by every role; the slice declares only the
// two Admin-only SYSTEM permissions.

/**
 * One permission the slice declares, in the shape an app's permission
 * registry takes (structurally the reference app's `PermissionDeclaration`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export interface UserDataPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** Both are `'system'`: they operate the deployment. */
  readonly scope: 'system' | 'org';
  /** Role ids seeded into `role_permissions`. */
  readonly defaultGrants: readonly string[];
}

/**
 * `system:factory_reset` and `orgs:offboard`, both system scope and granted
 * to `admin` only. Never grant `system:factory_reset` to a role merely
 * because it holds `system_settings:write` (EvoPath's rule): that permission
 * is held by roles that must not be able to erase the deployment.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerPermissions(USER_DATA_PERMISSIONS);
 * ```
 */
export const USER_DATA_PERMISSIONS: {
  /** `system:factory_reset`: erase every user and all application data. */
  readonly SYSTEM_FACTORY_RESET: UserDataPermissionDeclaration<'system:factory_reset'>;
  /** `orgs:offboard`: delete an organization with all its data. */
  readonly ORGS_OFFBOARD: UserDataPermissionDeclaration<'orgs:offboard'>;
} = {
  SYSTEM_FACTORY_RESET: {
    id: 'system:factory_reset',
    description: 'Factory reset: delete every other user and all application data, keeping configuration and backups',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  ORGS_OFFBOARD: {
    id: 'orgs:offboard',
    description: 'Offboard an organization: delete it with all its data, members and invitations',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

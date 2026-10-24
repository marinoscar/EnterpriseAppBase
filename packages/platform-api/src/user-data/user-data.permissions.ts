// The user-data slice's permissions (issue #743, PP-9.1). `user_settings:write`
// is the settings slice's and held by every role; the slice declares only the
// two Admin-only SYSTEM permissions.

import type { PermissionDeclaration } from '../core/index';

/**
 * One permission this slice declares: core's `PermissionDeclaration`, the
 * entry type of the permission registry (`registerPermissions`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export type UserDataPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

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

import type { PermissionDeclaration } from '../core/index';

/**
 * One permission this slice declares.
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export type AlertsPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

/**
 * The alerts slice's permissions, keyed by the `PERMISSIONS` constant name the
 * reference app derives from them. System scope, granted to `admin`.
 *
 * @example
 * ```ts
 * registerPermissions(ALERTS_PERMISSIONS);
 * ```
 *
 * @stability experimental
 */
export const ALERTS_PERMISSIONS: {
  /** `alerts:read`: view alert rules, incidents and the firing summary. */
  readonly ALERTS_READ: AlertsPermissionDeclaration<'alerts:read'>;
  /** `alerts:write`: create, edit and delete rules; test them; acknowledge incidents. */
  readonly ALERTS_WRITE: AlertsPermissionDeclaration<'alerts:write'>;
} = {
  ALERTS_READ: {
    id: 'alerts:read',
    description: 'View alert rules, incidents and the firing summary',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  ALERTS_WRITE: {
    id: 'alerts:write',
    description: 'Create, edit and delete alert rules; test them; acknowledge incidents',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

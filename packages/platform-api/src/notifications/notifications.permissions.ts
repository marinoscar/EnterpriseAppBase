// =============================================================================
// The notifications slice's permissions (issues #229, #355, #366, #738)
// =============================================================================
//
// Declared once, here, in the shape an app's permission registry takes; the
// reference app registers them in the manifest slice (`registerPlatformPermissions()`)
// (seed order: broadcasts, then push, then the org broadcasts appended last)
// and derives its `PERMISSIONS` constant from them. Every controller of the
// slice enforces these exact strings, and the settings cards declare them
// (CLAUDE.md, Settings UI Pattern, rule 3).
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
export type NotificationsPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

/**
 * The admin broadcast permissions (#366): `broadcasts:read` and
 * `broadcasts:write`, SYSTEM scope, granted to `admin`. They gate
 * `/api/admin/broadcasts` for the whole deployment: a holder may target every
 * user or any one organization.
 *
 * @example
 * ```ts
 * registerPermissions(BROADCASTS_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const BROADCASTS_PERMISSIONS: {
  /** `broadcasts:read`: list broadcasts and their delivery history. */
  readonly BROADCASTS_READ: NotificationsPermissionDeclaration<'broadcasts:read'>;
  /** `broadcasts:write`: compose, schedule, cancel and send them. */
  readonly BROADCASTS_WRITE: NotificationsPermissionDeclaration<'broadcasts:write'>;
} = {
  BROADCASTS_READ: {
    id: 'broadcasts:read',
    description: 'View notification broadcasts and their delivery history',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  BROADCASTS_WRITE: {
    id: 'broadcasts:write',
    description: 'Compose, schedule, cancel and send notification broadcasts',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

/**
 * The Web Push configuration permissions (#355): `push:read` and
 * `push:write`, SYSTEM scope, granted to `admin`. They gate
 * `/api/admin/push-config`.
 *
 * @example
 * ```ts
 * registerPermissions(PUSH_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const PUSH_PERMISSIONS: {
  /** `push:read`: view the Web Push (VAPID) configuration. */
  readonly PUSH_READ: NotificationsPermissionDeclaration<'push:read'>;
  /** `push:write`: generate, rotate, enable, disable and remove the key pair. */
  readonly PUSH_WRITE: NotificationsPermissionDeclaration<'push:write'>;
} = {
  PUSH_READ: {
    id: 'push:read',
    description: 'View Web Push (VAPID) configuration',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  PUSH_WRITE: {
    id: 'push:write',
    description: 'Generate, rotate, enable/disable and remove Web Push VAPID keys',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

/**
 * The organization broadcast permissions (#738): `org_broadcasts:read` and
 * `org_broadcasts:write`, ORG scope, granted to `org_admin`. A holder of only
 * these may list and create broadcasts for the caller's ACTIVE organization
 * and nothing else: the target is forced from the principal, and a body
 * naming another organization is a `422`. Same routes as
 * {@link BROADCASTS_PERMISSIONS} (`/api/admin/broadcasts`). Registered AFTER
 * every existing declaration (append-only seed order).
 *
 * @example
 * ```ts
 * registerPermissions(ORG_BROADCASTS_PERMISSIONS);
 * ```
 *
 * @stability experimental
 */
export const ORG_BROADCASTS_PERMISSIONS: {
  /** `org_broadcasts:read`: list the active organization's broadcasts. */
  readonly ORG_BROADCASTS_READ: NotificationsPermissionDeclaration<'org_broadcasts:read'>;
  /** `org_broadcasts:write`: compose, schedule, cancel and send them. */
  readonly ORG_BROADCASTS_WRITE: NotificationsPermissionDeclaration<'org_broadcasts:write'>;
} = {
  ORG_BROADCASTS_READ: {
    id: 'org_broadcasts:read',
    description: "View the active organization's notification broadcasts",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_BROADCASTS_WRITE: {
    id: 'org_broadcasts:write',
    description: "Compose, schedule, cancel and send notification broadcasts to the active organization",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
};

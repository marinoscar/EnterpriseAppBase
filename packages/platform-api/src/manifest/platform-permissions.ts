// =============================================================================
// The platform's roles and permissions, in seed order (issue #866)
// =============================================================================
//
// Every slice DECLARES its permissions beside the routes that enforce them,
// typed with core's `PermissionDeclaration` (`<slice>.permissions.ts`); the
// identity slice also declares the four roles. This file is the one place
// that knows their ORDER: the order the reference app's manifest has always
// registered them in, so the committed seed catalog
// (`apps/api/prisma/catalog/permissions.json`) and the rows `seedPlatform`
// writes stay byte-for-byte what they were before this list was packaged.
//
// Order is append-only. A new platform permission set goes at the END (a set
// appended later, like org broadcasts, sits after every older set even when
// its slice appears earlier), so no deployment's catalog reorders.
// =============================================================================

import type { PermissionDeclarationMap, RoleDeclarationMap } from '../core/index';
import { AI_PERMISSIONS } from '../ai/index';
import { DB_BACKUP_PERMISSIONS } from '../db-backup/index';
import { ALLOWLIST_PERMISSIONS, IDENTITY_ROLES, ORGANIZATIONS_PERMISSIONS, USERS_PERMISSIONS } from '../identity/index';
import { JOBS_PERMISSIONS } from '../jobs/index';
import { NODES_PERMISSIONS } from '../nodes/index';
import { BROADCASTS_PERMISSIONS, ORG_BROADCASTS_PERMISSIONS, PUSH_PERMISSIONS } from '../notifications/index';
import { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from '../settings/index';
import { SHARING_PERMISSION_DECLARATIONS } from '../sharing/index';
import { STORAGE_CONFIG_PERMISSIONS, STORAGE_PERMISSIONS } from '../storage/index';
import { TELEMETRY_PERMISSION_DECLARATIONS } from '../telemetry/index';
import { USER_DATA_PERMISSIONS } from '../user-data/index';

/**
 * The slices that declare permissions. Every other slice (credentials,
 * email, exports, onboarding, android-app, doctor) enforces permissions one of
 * these declares, mostly the settings slice's `system_settings:*`.
 *
 * @stability experimental
 */
export const PLATFORM_PERMISSION_SLICES: readonly [
  'settings',
  'identity',
  'storage',
  'jobs',
  'nodes',
  'db-backup',
  'notifications',
  'ai',
  'telemetry',
  'sharing',
  'user-data',
] = ['settings', 'identity', 'storage', 'jobs', 'nodes', 'db-backup', 'notifications', 'ai', 'telemetry', 'sharing', 'user-data'];

/**
 * A slice that declares permissions: one of {@link PLATFORM_PERMISSION_SLICES}.
 *
 * @stability experimental
 */
export type PlatformPermissionSlice = (typeof PLATFORM_PERMISSION_SLICES)[number];

/**
 * One batch of platform permissions: a declaration map and the slice that
 * declares (and enforces) it.
 *
 * @stability experimental
 */
export interface PlatformPermissionSet {
  /** The declaring slice. */
  readonly slice: PlatformPermissionSlice;
  /** The declaration map's exported name, for messages and docs (`'JOBS_PERMISSIONS'`). */
  readonly name: string;
  /** The declarations, registered in key order. */
  readonly permissions: PermissionDeclarationMap;
}

/**
 * The platform roles, declared by the identity slice: `admin` (system) and
 * `contributor`, `viewer`, `org_admin` (org). Registered before every
 * permission.
 *
 * @stability stable
 */
export const PLATFORM_ROLES: typeof IDENTITY_ROLES = IDENTITY_ROLES satisfies RoleDeclarationMap;

/**
 * Every platform permission set, in seed order. Registering them in this
 * order (after the roles) is what reproduces the reference app's committed
 * catalog exactly.
 *
 * @stability experimental
 */
export const PLATFORM_PERMISSION_SETS: readonly PlatformPermissionSet[] = Object.freeze([
  { slice: 'settings', name: 'SETTINGS_PERMISSIONS', permissions: SETTINGS_PERMISSIONS },
  { slice: 'identity', name: 'USERS_PERMISSIONS', permissions: USERS_PERMISSIONS },
  { slice: 'identity', name: 'ALLOWLIST_PERMISSIONS', permissions: ALLOWLIST_PERMISSIONS },
  { slice: 'storage', name: 'STORAGE_PERMISSIONS', permissions: STORAGE_PERMISSIONS },
  { slice: 'jobs', name: 'JOBS_PERMISSIONS', permissions: JOBS_PERMISSIONS },
  { slice: 'nodes', name: 'NODES_PERMISSIONS', permissions: NODES_PERMISSIONS },
  { slice: 'db-backup', name: 'DB_BACKUP_PERMISSIONS', permissions: DB_BACKUP_PERMISSIONS },
  { slice: 'notifications', name: 'BROADCASTS_PERMISSIONS', permissions: BROADCASTS_PERMISSIONS },
  { slice: 'notifications', name: 'PUSH_PERMISSIONS', permissions: PUSH_PERMISSIONS },
  { slice: 'storage', name: 'STORAGE_CONFIG_PERMISSIONS', permissions: STORAGE_CONFIG_PERMISSIONS },
  { slice: 'ai', name: 'AI_PERMISSIONS', permissions: AI_PERMISSIONS },
  { slice: 'telemetry', name: 'TELEMETRY_PERMISSION_DECLARATIONS', permissions: TELEMETRY_PERMISSION_DECLARATIONS },
  { slice: 'identity', name: 'ORGANIZATIONS_PERMISSIONS', permissions: ORGANIZATIONS_PERMISSIONS },
  { slice: 'sharing', name: 'SHARING_PERMISSION_DECLARATIONS', permissions: SHARING_PERMISSION_DECLARATIONS },
  { slice: 'settings', name: 'ORG_SETTINGS_PERMISSIONS', permissions: ORG_SETTINGS_PERMISSIONS },
  // #738: org-scoped broadcasts, appended after every earlier set.
  { slice: 'notifications', name: 'ORG_BROADCASTS_PERMISSIONS', permissions: ORG_BROADCASTS_PERMISSIONS },
  // #743: the user-data slice's two Admin-only system permissions.
  { slice: 'user-data', name: 'USER_DATA_PERMISSIONS', permissions: USER_DATA_PERMISSIONS },
] satisfies PlatformPermissionSet[]);

/**
 * Every platform permission as one map, in seed order, keyed by the constant
 * name (`JOBS_READ`). `permissionIds(PLATFORM_PERMISSIONS)` is the app's
 * `PERMISSIONS` constant with literal ids.
 *
 * @stability experimental
 */
export const PLATFORM_PERMISSIONS: typeof SETTINGS_PERMISSIONS &
  typeof USERS_PERMISSIONS &
  typeof ALLOWLIST_PERMISSIONS &
  typeof STORAGE_PERMISSIONS &
  typeof JOBS_PERMISSIONS &
  typeof NODES_PERMISSIONS &
  typeof DB_BACKUP_PERMISSIONS &
  typeof BROADCASTS_PERMISSIONS &
  typeof PUSH_PERMISSIONS &
  typeof STORAGE_CONFIG_PERMISSIONS &
  typeof AI_PERMISSIONS &
  typeof TELEMETRY_PERMISSION_DECLARATIONS &
  typeof ORGANIZATIONS_PERMISSIONS &
  typeof SHARING_PERMISSION_DECLARATIONS &
  typeof ORG_SETTINGS_PERMISSIONS &
  typeof ORG_BROADCASTS_PERMISSIONS &
  typeof USER_DATA_PERMISSIONS = Object.freeze({
  ...SETTINGS_PERMISSIONS,
  ...USERS_PERMISSIONS,
  ...ALLOWLIST_PERMISSIONS,
  ...STORAGE_PERMISSIONS,
  ...JOBS_PERMISSIONS,
  ...NODES_PERMISSIONS,
  ...DB_BACKUP_PERMISSIONS,
  ...BROADCASTS_PERMISSIONS,
  ...PUSH_PERMISSIONS,
  ...STORAGE_CONFIG_PERMISSIONS,
  ...AI_PERMISSIONS,
  ...TELEMETRY_PERMISSION_DECLARATIONS,
  ...ORGANIZATIONS_PERMISSIONS,
  ...SHARING_PERMISSION_DECLARATIONS,
  ...ORG_SETTINGS_PERMISSIONS,
  ...ORG_BROADCASTS_PERMISSIONS,
  ...USER_DATA_PERMISSIONS,
});

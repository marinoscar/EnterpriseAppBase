// =============================================================================
// Role and permission constants (derived, issue #676, PP-1.4)
// =============================================================================
//
// Nothing is declared here any more. Each role and permission is declared
// once, beside the module that enforces it (`<module>.permissions.ts`, and
// `common/permissions/platform-roles.ts` for the roles), with its description
// and default role grants; the rationale for each split lives there too. This
// file only DERIVES the constants every guard and decorator already imports, so
// none of those import sites change.
//
// ⚠ Imports the declaration files directly, never `common/permissions/index.ts`:
// the index runs the manifest (a side effect), and this file is imported by
// ~55 modules under `emitDecoratorMetadata`, where an import cycle bites. The
// declaration files and `permission-ids.ts` import nothing but types, so this
// stays a leaf (the same rule as `storage/storage-key-prefixes.ts`).
//
// An app adds its own ids in `app-registrations/permissions.ts`, including the
// `AppPermissionIds` / `AppRoleIds` augmentation that widens `PermissionName`
// and `RoleName` below. Recipe: common/permissions/README.md.
// =============================================================================

import { AI_PERMISSIONS } from '../../ai/ai.permissions';
import { ALLOWLIST_PERMISSIONS } from '../../allowlist/allowlist.permissions';
import { DB_BACKUP_PERMISSIONS } from '../../db-backup/db-backup.permissions';
import { JOBS_PERMISSIONS } from '../../jobs/jobs.permissions';
import { NODES_PERMISSIONS } from '../../nodes/nodes.permissions';
import { BROADCASTS_PERMISSIONS } from '../../notifications/broadcasts/broadcasts.permissions';
import { PUSH_PERMISSIONS } from '../../notifications/push.permissions';
import { SETTINGS_PERMISSIONS } from '../../settings/settings.permissions';
import { STORAGE_CONFIG_PERMISSIONS } from '../../storage/config/storage-config.permissions';
import { STORAGE_PERMISSIONS } from '../../storage/storage.permissions';
import { TELEMETRY_PERMISSIONS } from '../../telemetry/telemetry.permissions';
import { USERS_PERMISSIONS } from '../../users/users.permissions';
import { permissionIds, roleIds } from '../permissions/permission-ids';
import type { AppPermissionIds, AppRoleIds } from '../permissions/permission.types';
import { PLATFORM_ROLES } from '../permissions/platform-roles';

// =============================================================================
// Role Constants
// =============================================================================

/** The platform roles: `{ ADMIN: 'admin', CONTRIBUTOR: 'contributor', VIEWER: 'viewer' }`. */
export const ROLES = roleIds(PLATFORM_ROLES);

/** A platform role id, or an app role id added to `AppRoleIds` by augmentation. */
export type RoleName = (typeof ROLES)[keyof typeof ROLES] | (keyof AppRoleIds & string);

// =============================================================================
// Permission Constants
// =============================================================================

/** Every platform permission id, keyed as before (`JOBS_READ: 'jobs:read'`), in seed order. */
export const PERMISSIONS = {
  ...permissionIds(SETTINGS_PERMISSIONS),
  ...permissionIds(USERS_PERMISSIONS),
  ...permissionIds(ALLOWLIST_PERMISSIONS),
  ...permissionIds(STORAGE_PERMISSIONS),
  ...permissionIds(JOBS_PERMISSIONS),
  ...permissionIds(NODES_PERMISSIONS),
  ...permissionIds(DB_BACKUP_PERMISSIONS),
  ...permissionIds(BROADCASTS_PERMISSIONS),
  ...permissionIds(PUSH_PERMISSIONS),
  ...permissionIds(STORAGE_CONFIG_PERMISSIONS),
  ...permissionIds(AI_PERMISSIONS),
  ...permissionIds(TELEMETRY_PERMISSIONS),
} as const;

/** A platform permission id, or an app permission id added to `AppPermissionIds` by augmentation. */
export type PermissionName =
  | (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
  | (keyof AppPermissionIds & string);

// =============================================================================
// Default Role
// =============================================================================

export const DEFAULT_ROLE = ROLES.VIEWER;

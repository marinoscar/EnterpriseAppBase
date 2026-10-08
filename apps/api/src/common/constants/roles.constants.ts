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
import {
  ALLOWLIST_PERMISSIONS,
  USERS_PERMISSIONS,
  ORGANIZATIONS_PERMISSIONS,
} from '@marinoscar/platform-api/identity';
import { DB_BACKUP_PERMISSIONS } from '../../db-backup/db-backup.permissions';
import { JOBS_PERMISSIONS } from '@marinoscar/platform-api/jobs';
import { NODES_PERMISSIONS } from '@marinoscar/platform-api/nodes';
import { BROADCASTS_PERMISSIONS } from '@marinoscar/platform-api/notifications';
import { PUSH_PERMISSIONS } from '@marinoscar/platform-api/notifications';
import { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from '@marinoscar/platform-api/settings';
import { STORAGE_CONFIG_PERMISSIONS } from '@marinoscar/platform-api/storage';
import { STORAGE_PERMISSIONS } from '@marinoscar/platform-api/storage';
import { TELEMETRY_PERMISSION_DECLARATIONS } from '@marinoscar/platform-api/telemetry';
import { SHARING_PERMISSION_DECLARATIONS } from '@marinoscar/platform-api/sharing';
import { permissionIds, roleIds } from '../permissions/permission-ids';
import type { AppPermissionIds, AppRoleIds } from '../permissions/permission.types';
import { PLATFORM_ROLES } from '../permissions/platform-roles';

// =============================================================================
// Role Constants
// =============================================================================

/**
 * The platform roles: `{ ADMIN: 'admin', CONTRIBUTOR: 'contributor', VIEWER: 'viewer', ORG_ADMIN: 'org_admin' }`.
 *
 * `ADMIN` is the SYSTEM administrator (held in `user_roles`), so every
 * `@Auth({ roles: [ROLES.ADMIN] })` keeps meaning "deployment operator". The
 * other three are ORG roles, held on a membership (issue #723).
 */
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
  ...permissionIds(TELEMETRY_PERMISSION_DECLARATIONS),
  ...permissionIds(ORGANIZATIONS_PERMISSIONS),
  ...permissionIds(SHARING_PERMISSION_DECLARATIONS),
  ...permissionIds(ORG_SETTINGS_PERMISSIONS),
} as const;

/** A platform permission id, or an app permission id added to `AppPermissionIds` by augmentation. */
export type PermissionName =
  | (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
  | (keyof AppPermissionIds & string);

// =============================================================================
// Default roles (issue #723: system vs org)
// =============================================================================

/**
 * The org role a new membership gets: every sign-up's role in the default
 * organization, and the role a NULL `org_invites.role_id` stands for.
 */
export const DEFAULT_ORG_ROLE = ROLES.VIEWER;

/**
 * Kept for existing imports: the default role is the default MEMBERSHIP role,
 * {@link DEFAULT_ORG_ROLE}. New code uses that name.
 */
export const DEFAULT_ROLE = DEFAULT_ORG_ROLE;

/**
 * The org role that administers one organization. The initial administrator
 * holds it on the default organization, alongside the system `admin` role.
 */
export const ORG_ADMIN_ROLE = ROLES.ORG_ADMIN;

// =============================================================================
// Typed names in the identity slice's decorators (issue #727)
// =============================================================================
//
// `@Auth({ permissions, roles })`, `@Permissions(...)` and `@Roles(...)` live
// in `@marinoscar/platform-api/identity`, which cannot know this app's ids. This
// augmentation widens the slice's `PermissionName` and `RoleName` to exactly
// this app's (every slice's, plus `app-registrations/`), so a typo in a route's
// permission stays a compile error.
declare module '@marinoscar/platform-api/identity' {
  interface IdentityPermissionIds extends Record<PermissionName, true> {}
  interface IdentityRoleIds extends Record<RoleName, true> {}
}

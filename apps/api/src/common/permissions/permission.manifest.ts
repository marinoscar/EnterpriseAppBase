// =============================================================================
// Role and permission manifest (issue #676, PP-1.4)
// =============================================================================
//
// The explicit, grep-able list of every role and permission declaration, in
// SEED ORDER. Order matters twice: roles register before permissions (each
// permission's `defaultGrants` is checked against the registered roles), and
// permission order is the order `prisma/catalog/permissions.json` lists, and
// the seed upserts, them.
//
//   1. platform roles   2. app roles   3. platform permissions   4. app permissions
//
// Adding a PLATFORM entry is one appended import and one appended line. An APP
// never edits this file: it fills `app-registrations/permissions.ts`.
// =============================================================================

import { APP_PERMISSIONS, APP_ROLES } from '../../app-registrations/permissions';
import { AI_PERMISSIONS } from '@marinoscar/platform-api/ai';
import {
  ALLOWLIST_PERMISSIONS,
  USERS_PERMISSIONS,
  ORGANIZATIONS_PERMISSIONS,
} from '@marinoscar/platform-api/identity';
import { DB_BACKUP_PERMISSIONS } from '../../db-backup/db-backup.permissions';
import { JOBS_PERMISSIONS } from '@marinoscar/platform-api/jobs';
import { NODES_PERMISSIONS } from '@marinoscar/platform-api/nodes';
import {
  BROADCASTS_PERMISSIONS,
  ORG_BROADCASTS_PERMISSIONS,
  PUSH_PERMISSIONS,
} from '@marinoscar/platform-api/notifications';
import { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from '@marinoscar/platform-api/settings';
import { STORAGE_CONFIG_PERMISSIONS } from '@marinoscar/platform-api/storage';
import { STORAGE_PERMISSIONS } from '@marinoscar/platform-api/storage';
import { TELEMETRY_PERMISSION_DECLARATIONS } from '@marinoscar/platform-api/telemetry';
import { SHARING_PERMISSION_DECLARATIONS } from '@marinoscar/platform-api/sharing';
import { registerPermissions, registerRoles } from './permission.registry';
import { PLATFORM_ROLES } from './platform-roles';

// 1-2. Roles.
registerRoles(PLATFORM_ROLES);
registerRoles(APP_ROLES);

// 3. Platform permissions, in the order the seed has always written them.
registerPermissions(SETTINGS_PERMISSIONS);
registerPermissions(USERS_PERMISSIONS);
registerPermissions(ALLOWLIST_PERMISSIONS);
registerPermissions(STORAGE_PERMISSIONS);
registerPermissions(JOBS_PERMISSIONS);
registerPermissions(NODES_PERMISSIONS);
registerPermissions(DB_BACKUP_PERMISSIONS);
registerPermissions(BROADCASTS_PERMISSIONS);
registerPermissions(PUSH_PERMISSIONS);
registerPermissions(STORAGE_CONFIG_PERMISSIONS);
registerPermissions(AI_PERMISSIONS);
registerPermissions(TELEMETRY_PERMISSION_DECLARATIONS);
registerPermissions(ORGANIZATIONS_PERMISSIONS);
registerPermissions(SHARING_PERMISSION_DECLARATIONS);
registerPermissions(ORG_SETTINGS_PERMISSIONS);
// #738: org-scoped broadcasts, appended after every existing declaration.
registerPermissions(ORG_BROADCASTS_PERMISSIONS);

// 4. App-owned permissions last, so a collision with a platform id names the app.
registerPermissions(APP_PERMISSIONS);

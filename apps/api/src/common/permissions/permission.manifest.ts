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
import { TELEMETRY_PERMISSION_DECLARATIONS } from '@marinoscar/platform-api/telemetry';
import { USERS_PERMISSIONS } from '../../users/users.permissions';
import { ORGANIZATIONS_PERMISSIONS } from '../../organizations/organizations.permissions';
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

// 4. App-owned permissions last, so a collision with a platform id names the app.
registerPermissions(APP_PERMISSIONS);

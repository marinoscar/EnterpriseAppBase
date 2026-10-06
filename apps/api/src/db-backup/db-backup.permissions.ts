// =============================================================================
// Database backup permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

// Default grants: ADMIN ONLY, including the read half, for the reason given on
// `JOBS_PERMISSIONS` in `jobs/jobs.permissions.ts` (#256, epic #254: the queue,
// the fleet and the backup history are operational surfaces).
export const DB_BACKUP_PERMISSIONS = {
  // Database backup (#256, epic #254).
  //
  // `:restore` IS A THIRD PERMISSION, not part of `:write`, because the two
  // are not the same act. Writing is routine scheduling — change the hour,
  // change how many copies are kept — and is reversible by writing again.
  // Restoring renames the live database and restarts the process: it is
  // destructive, it interrupts every session, and it is exactly the operation
  // an operator should have to be granted on purpose. Folding it into `:write`
  // would mean anyone allowed to adjust the backup schedule is also allowed to
  // roll the database back over the top of production.
  DB_BACKUP_READ: {
    id: 'db_backup:read',
    description: 'View backup schedule, history and status',
    defaultGrants: ['admin'],
  },
  DB_BACKUP_WRITE: {
    id: 'db_backup:write',
    description: 'Configure the backup schedule and run a backup',
    defaultGrants: ['admin'],
  },
  DB_BACKUP_RESTORE: {
    id: 'db_backup:restore',
    description: 'Restore the database from a backup',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;

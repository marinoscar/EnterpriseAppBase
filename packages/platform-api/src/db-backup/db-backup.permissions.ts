// =============================================================================
// Database backup permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this slice's permissions and their default role grants. No
// import and no side effect; the app's permission manifest registers it, and
// its `roles.constants.ts` derives `PERMISSIONS` from it. After a change, run
// `npm run catalog:permissions --workspace=api` and commit the regenerated
// `prisma/catalog/permissions.json`. All three are SYSTEM scope: a restore is
// deployment-wide and rolls back every organization, so no org role may ever
// hold one (#723, #740).
// =============================================================================

import type { PermissionDeclaration } from '../core/index';

/**
 * One permission this slice declares: core's `PermissionDeclaration`, the
 * entry type of the permission registry (`registerPermissions`).
 *
 * @typeParam Id - the permission string.
 *
 * @stability stable
 */
export type DbBackupPermissionDeclaration<Id extends string = string> = PermissionDeclaration<Id>;

// Default grants: ADMIN ONLY, including the read half, for the reason given on
// `JOBS_PERMISSIONS` in the jobs slice (#256, epic #254: the queue, the fleet
// and the backup history are operational surfaces).
/**
 * The db-backup permissions (`db_backup:read`, `db_backup:write`,
 * `db_backup:restore`): system scope, `admin` only. The admin
 * `Database backups` card declares `db_backup:read`, the exact string
 * `DatabaseBackupController` enforces.
 *
 * @example
 * ```ts
 * registerPermissions(DB_BACKUP_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const DB_BACKUP_PERMISSIONS: {
  /** `db_backup:read`: view the schedule, history and status. */
  readonly DB_BACKUP_READ: DbBackupPermissionDeclaration<'db_backup:read'>;
  /** `db_backup:write`: configure the schedule and run a backup. */
  readonly DB_BACKUP_WRITE: DbBackupPermissionDeclaration<'db_backup:write'>;
  /** `db_backup:restore`: restore the database from a backup. */
  readonly DB_BACKUP_RESTORE: DbBackupPermissionDeclaration<'db_backup:restore'>;
} = {
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
    scope: 'system',
    defaultGrants: ['admin'],
  },
  DB_BACKUP_WRITE: {
    id: 'db_backup:write',
    description: 'Configure the backup schedule and run a backup',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  DB_BACKUP_RESTORE: {
    id: 'db_backup:restore',
    description: 'Restore the database from a backup',
    scope: 'system',
    defaultGrants: ['admin'],
  },
};

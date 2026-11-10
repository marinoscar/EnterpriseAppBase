// The permission strings the db-backup slice's routes and notifications
// enforce, derived from its declarations (`db-backup.permissions.ts`). The
// keys are the reference app's `PERMISSIONS` names, so the moved code reads
// exactly as it did before the move (#740). `ROLES.ADMIN` is the system
// `admin` role (#723): an org admin in multi-org mode holds none of these.

import { IDENTITY_ROLE_IDS } from '../identity/index';
import { DB_BACKUP_PERMISSIONS } from './db-backup.permissions';

/**
 * The permission ids the slice checks, by their `PERMISSIONS` name.
 *
 * @internal
 *
 * @stability experimental
 */
export const PERMISSIONS = Object.freeze({
  DB_BACKUP_READ: DB_BACKUP_PERMISSIONS.DB_BACKUP_READ.id,
  DB_BACKUP_WRITE: DB_BACKUP_PERMISSIONS.DB_BACKUP_WRITE.id,
  DB_BACKUP_RESTORE: DB_BACKUP_PERMISSIONS.DB_BACKUP_RESTORE.id,
} as const);

/**
 * The identity slice's role ids.
 *
 * @internal
 *
 * @stability experimental
 */
export const ROLES = IDENTITY_ROLE_IDS;

/**
 * The `audit_events.action` of a mirror copy that landed and was read back.
 * Its `meta` is a `BackupMirrorResult` (`@marinoscar/platform-contract/db-backup`).
 * Permanent: the `backup.mirrors` Doctor check reads it.
 *
 * @stability experimental
 */
export const MIRROR_AUDIT_COMPLETED = 'db_backup.mirror.completed';

/**
 * The `audit_events.action` of a mirror copy that failed. The run is unaffected.
 *
 * @stability experimental
 */
export const MIRROR_AUDIT_FAILED = 'db_backup.mirror.failed';

/**
 * The `audit_events.target_type` of both mirror rows (`target_id` is the run id).
 *
 * @stability experimental
 */
export const MIRROR_AUDIT_TARGET_TYPE = 'database_backup_run';

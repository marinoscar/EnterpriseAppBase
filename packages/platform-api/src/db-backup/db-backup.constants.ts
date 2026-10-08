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

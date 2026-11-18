// The permission strings the storage slice's routes enforce, derived from its
// declarations (`storage.permissions.ts`, `config/storage-config.permissions.ts`)
// and the settings slice's (the profile-image routes are user-settings writes).
// The keys are the reference app's `PERMISSIONS` names, so a controller reads
// exactly as it did before the move (#736).

import { SETTINGS_PERMISSIONS } from '../settings/index';
import { STORAGE_CONFIG_PERMISSIONS } from './config/storage-config.permissions';
import { STORAGE_PERMISSIONS } from './storage.permissions';

/**
 * The permission ids the slice's routes check, by their `PERMISSIONS` name.
 *
 * @internal
 *
 * @stability experimental
 */
export const PERMISSIONS = Object.freeze({
  STORAGE_READ: STORAGE_PERMISSIONS.STORAGE_READ.id,
  STORAGE_WRITE: STORAGE_PERMISSIONS.STORAGE_WRITE.id,
  STORAGE_DELETE_ANY: STORAGE_PERMISSIONS.STORAGE_DELETE_ANY.id,
  STORAGE_CONFIG_READ: STORAGE_CONFIG_PERMISSIONS.STORAGE_CONFIG_READ.id,
  STORAGE_CONFIG_WRITE: STORAGE_CONFIG_PERMISSIONS.STORAGE_CONFIG_WRITE.id,
  USER_SETTINGS_READ: SETTINGS_PERMISSIONS.USER_SETTINGS_READ.id,
  USER_SETTINGS_WRITE: SETTINGS_PERMISSIONS.USER_SETTINGS_WRITE.id,
} as const);

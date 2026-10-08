// =============================================================================
// The db-backup slice's object-storage key prefix (issue #740; registry #679,
// #736)
// =============================================================================
//
// Every archive lives under `database-backups/` (deployment scope: a backup
// is the whole deployment, never one organization). Declared here, beside the
// key builder that uses it (`db-backup-storage.ts`), and registered through
// the storage slice's key-prefix registry, so `allKeyPrefixes()` (what
// `npm run storage:purge` enumerates) knows it. A no-import leaf apart from
// the registry's types.
// =============================================================================

import { registerStorageKeyPrefixes, storageKeyPrefixRegistry, type StorageKeyPrefixDef } from '../storage/index';

/**
 * Where every database backup archive is written. Permanent: a restore finds
 * an archive by the key recorded on its run.
 *
 * @stability stable
 */
export const DATABASE_BACKUPS_KEY_PREFIX = 'database-backups/';

/**
 * The slice's one key-prefix declaration (`id: 'database-backups'`, scope
 * `deployment`). An app that lists the platform's prefixes in its own purge
 * order (the reference app's `platform-storage-prefixes.ts`) places this
 * entry; `DbBackupModule.forRoot()` registers it otherwise (idempotent).
 *
 * @stability stable
 */
export const DB_BACKUP_KEY_PREFIX: StorageKeyPrefixDef = Object.freeze({
  id: 'database-backups',
  prefix: DATABASE_BACKUPS_KEY_PREFIX,
  owner: 'db-backup',
  scope: 'deployment' as const,
  description: 'Database backup archives.',
  // The admin factory reset's undo (`@marinoscar/platform-api/user-data`,
  // #743): it keeps the archives under this prefix.
  survivesFactoryReset: true,
});

/**
 * Registers {@link DB_BACKUP_KEY_PREFIX} unless it is registered already or
 * the registry is frozen. Called by `DbBackupModule.forRoot()`.
 *
 * @stability experimental
 */
export function registerDbBackupKeyPrefix(): void {
  if (storageKeyPrefixRegistry.has(DB_BACKUP_KEY_PREFIX.id) || storageKeyPrefixRegistry.frozen) return;
  registerStorageKeyPrefixes([DB_BACKUP_KEY_PREFIX]);
}

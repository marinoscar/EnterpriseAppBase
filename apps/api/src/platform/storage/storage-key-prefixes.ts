// =============================================================================
// The object-key prefix the reference app still declares for a slice that is
// not packaged yet (issue #736)
// =============================================================================
//
// The storage slice registers its own prefixes (`uploads`, `avatars`,
// `node-outputs`, `storage-config-test`; `@marinoscar/platform-api/storage`)
// and the AI slice its own (`ai-outputs`, `AI_STORAGE_KEY_PREFIXES`;
// `@marinoscar/platform-api/ai`, #739). `database-backups` belongs to the
// db-backup slice (#740); until it is packaged and registers its own, the app
// declares it here with its unchanged value, so `allKeyPrefixes()` (what
// `npm run storage:purge` enumerates) stays complete. A no-import leaf: the
// writer (`db-backup/db-backup-storage.ts`) imports this constant.
// =============================================================================

/** Database backup archives. */
export const DATABASE_BACKUPS_KEY_PREFIX = 'database-backups/';

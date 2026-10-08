// =============================================================================
// The object-key prefixes the reference app still declares for slices that
// are not packaged yet (issue #736)
// =============================================================================
//
// The storage slice registers its own prefixes (`uploads`, `avatars`,
// `node-outputs`, `storage-config-test`; `@marinoscar/platform-api/storage`).
// `database-backups` belongs to the db-backup slice (#740) and `ai-outputs` to
// the AI slice (#739); until each is packaged and registers its own, the app
// declares them here with their unchanged values, so `allKeyPrefixes()` (what
// `npm run storage:purge` enumerates) stays complete. A no-import leaf: the
// writers (`db-backup/db-backup-storage.ts`, `ai/storage/ai-output-writer.ts`)
// import these constants.
// =============================================================================

/** Database backup archives. */
export const DATABASE_BACKUPS_KEY_PREFIX = 'database-backups/';

/**
 * Files an AI operation produced for a user (#437: generated/edited images;
 * later audio). Individual objects live under `ai-outputs/<userId>/<runId>/`,
 * built by `aiOutputKeyPrefix` in `ai/storage/ai-output-writer.ts`.
 */
export const AI_OUTPUTS_KEY_PREFIX = 'ai-outputs/';

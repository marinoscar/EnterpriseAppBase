// =============================================================================
// The platform's object-storage key prefixes, in purge order (issue #679;
// packaged in #736)
// =============================================================================
//
// Pure data, no side effect on import: `storage-key-prefix.manifest.ts`
// registers it. The storage slice's four entries are its own definitions
// (`STORAGE_SLICE_KEY_PREFIXES`), `database-backups` is the db-backup slice's
// (`DB_BACKUP_KEY_PREFIX`, #740) and `ai-outputs` is the AI slice's
// (`AI_STORAGE_KEY_PREFIXES`, #739). Order is the purge's order and must not
// change.
//
// An APP declares its own prefixes in `app-registrations/storage-prefixes.ts`,
// never here.
// =============================================================================

import { AI_STORAGE_KEY_PREFIXES } from '@marinoscar/platform-api/ai';
import { DB_BACKUP_KEY_PREFIX } from '@marinoscar/platform-api/db-backup';
import { STORAGE_SLICE_KEY_PREFIXES, type StorageKeyPrefixDef } from '@marinoscar/platform-api/storage';
import { EXPORTS_KEY_PREFIXES } from '@marinoscar/platform-api/exports';

function slice(id: string): StorageKeyPrefixDef {
  const def = STORAGE_SLICE_KEY_PREFIXES.find((entry) => entry.id === id);
  if (def === undefined) throw new Error(`the storage slice declares no key prefix "${id}"`);
  return def;
}

/** The eight prefixes the platform writes, in purge order. */
export const PLATFORM_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze([
  slice('uploads'),
  slice('avatars'),
  // The db-backup slice's own declaration (#740).
  DB_BACKUP_KEY_PREFIX,
  slice('node-outputs'),
  // The AI slice's own definition (#739): `AiModule.forRoot()` registers the
  // same object, so registering it here first only fixes the purge order.
  ...AI_STORAGE_KEY_PREFIXES,
  slice('storage-config-test'),
  // Data exports (#744): exports/users/<userId>/ and exports/orgs/<orgId>/.
  ...EXPORTS_KEY_PREFIXES,
]);

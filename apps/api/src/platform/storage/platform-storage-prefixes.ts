// =============================================================================
// The platform's object-storage key prefixes, in purge order (issue #679;
// packaged in #736)
// =============================================================================
//
// Pure data, no side effect on import: `storage-key-prefix.manifest.ts`
// registers it. The storage slice's four entries are its own definitions
// (`STORAGE_SLICE_KEY_PREFIXES`); the two between them are the app's, for
// the slices that are not packaged yet (./storage-key-prefixes.ts). Order is
// the purge's order and must not change.
//
// An APP declares its own prefixes in `app-registrations/storage-prefixes.ts`,
// never here.
// =============================================================================

import { STORAGE_SLICE_KEY_PREFIXES, type StorageKeyPrefixDef } from '@marinoscar/platform-api/storage';
import { EXPORTS_KEY_PREFIXES } from '@marinoscar/platform-api/exports';

import { AI_OUTPUTS_KEY_PREFIX, DATABASE_BACKUPS_KEY_PREFIX } from './storage-key-prefixes';

function slice(id: string): StorageKeyPrefixDef {
  const def = STORAGE_SLICE_KEY_PREFIXES.find((entry) => entry.id === id);
  if (def === undefined) throw new Error(`the storage slice declares no key prefix "${id}"`);
  return def;
}

/** The eight prefixes the platform writes, in purge order. */
export const PLATFORM_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze([
  slice('uploads'),
  slice('avatars'),
  Object.freeze({
    id: 'database-backups',
    prefix: DATABASE_BACKUPS_KEY_PREFIX,
    owner: 'db-backup',
    scope: 'deployment' as const,
    description: 'Database backup archives.',
  }),
  slice('node-outputs'),
  Object.freeze({
    id: 'ai-outputs',
    prefix: AI_OUTPUTS_KEY_PREFIX,
    owner: 'ai',
    scope: 'user' as const,
    description: 'Files an AI operation produced for a user, under ai-outputs/<userId>/<runId>/.',
  }),
  slice('storage-config-test'),
  // Data exports (#744): exports/users/<userId>/ and exports/orgs/<orgId>/.
  ...EXPORTS_KEY_PREFIXES,
]);

// =============================================================================
// The platform's own object-storage key prefixes (issue #679, PP-1.7)
// =============================================================================
//
// Pure data, no side effect on import: `storage-key-prefix.manifest.ts`
// registers it. Built from the constants in `storage-key-prefixes.ts`, which
// the writers import, so a declaration here can never drift from the value a
// writer uses. Order is the purge's order and must not change.
//
// An APP declares its prefixes in `app-registrations/storage-prefixes.ts`,
// never here.
// =============================================================================

import type { StorageKeyPrefixDef } from './storage-key-prefix.registry';
import {
  AI_OUTPUTS_KEY_PREFIX,
  AVATARS_KEY_PREFIX,
  DATABASE_BACKUPS_KEY_PREFIX,
  NODE_OUTPUTS_KEY_PREFIX,
  STORAGE_TEST_KEY_PREFIX,
  UPLOADS_KEY_PREFIX,
} from './storage-key-prefixes';

/** The six prefixes the platform writes, in purge order. */
export const PLATFORM_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze([
  {
    id: 'uploads',
    prefix: UPLOADS_KEY_PREFIX,
    owner: 'storage',
    description: 'Files uploaded through the storage objects API.',
  },
  {
    id: 'avatars',
    prefix: AVATARS_KEY_PREFIX,
    owner: 'settings/profile-image',
    description: 'Per-user profile images, under avatars/<userId>/.',
  },
  {
    id: 'database-backups',
    prefix: DATABASE_BACKUPS_KEY_PREFIX,
    owner: 'db-backup',
    description: 'Database backup archives.',
  },
  {
    id: 'node-outputs',
    prefix: NODE_OUTPUTS_KEY_PREFIX,
    owner: 'nodes',
    description: 'Artifacts a worker node uploaded for a job it executed.',
  },
  {
    id: 'ai-outputs',
    prefix: AI_OUTPUTS_KEY_PREFIX,
    owner: 'ai',
    description: 'Files an AI operation produced for a user, under ai-outputs/<userId>/<runId>/.',
  },
  {
    id: 'storage-config-test',
    prefix: STORAGE_TEST_KEY_PREFIX,
    owner: 'storage/config',
    description: 'Probe objects the storage connection test writes; they linger after a failed round trip.',
  },
].map((def) => Object.freeze(def)));

// =============================================================================
// STORAGE_KEY_PREFIXES: the frozen view of the key-prefix registry (issue #679)
// =============================================================================
//
// The only list a destructive path may enumerate (`storage-purge.main.ts`).
// Importing this file loads the manifest, so the view always holds every
// registered prefix: the platform's six first, in their historical order, then
// the app's.
//
// It lives in its own file, not in `storage-key-prefixes.ts`, because that file
// is a no-import leaf the writers import, and loading the manifest from it
// would create a cycle through `platform-storage-prefixes.ts`.
// =============================================================================

import './storage-key-prefix.manifest';

import { storageKeyPrefixRegistry } from './storage-key-prefix.registry';

/**
 * Every registered prefix, in registration order. A plain frozen array, built
 * once at import time (after the manifest ran, before the registry freezes),
 * so a caller cannot narrow it in place and then believe it purged everything.
 */
export const STORAGE_KEY_PREFIXES: readonly string[] = Object.freeze(
  storageKeyPrefixRegistry.list().map((d) => d.prefix),
);

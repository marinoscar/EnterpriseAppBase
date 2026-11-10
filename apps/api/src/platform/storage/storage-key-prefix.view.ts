// =============================================================================
// STORAGE_KEY_PREFIXES: the frozen view of the key-prefix registry (issue #679)
// =============================================================================
//
// Importing this file loads the manifest, so the view always holds every
// registered prefix: the platform's six first, in their historical order, then
// the app's. The purge itself reads `allKeyPrefixes()` of the BOOTED app
// (`runStoragePurge`, #736); this view is for code and tests that want the
// list without booting anything.
// =============================================================================

import './storage-key-prefix.manifest';

import { allKeyPrefixes } from '@marinoscar/platform-api/storage';

/**
 * Every registered prefix, in registration order. A plain frozen array, built
 * once at import time, so a caller cannot narrow it in place and then believe
 * it purged everything.
 */
export const STORAGE_KEY_PREFIXES: readonly string[] = allKeyPrefixes();

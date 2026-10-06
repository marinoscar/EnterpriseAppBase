// The storage key-prefix manifest (issue #679): the explicit, grep-able list of
// everything `storageKeyPrefixRegistry` holds. Platform declarations first, the
// app's last, so a collision with a platform entry names the app's entry.
// Loaded by `storage-key-prefix.view.ts`; recipe: packages/platform-api/src/core/registry/README.md.

import { APP_STORAGE_KEY_PREFIXES } from '../app-registrations/storage-prefixes';
import { PLATFORM_STORAGE_KEY_PREFIXES } from './platform-storage-prefixes';
import { registerStorageKeyPrefixes } from './storage-key-prefix.registry';

registerStorageKeyPrefixes(PLATFORM_STORAGE_KEY_PREFIXES);

// App-owned entries last, so a collision with a platform entry names the app.
registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);

// The storage key-prefix manifest (issue #679): the explicit, grep-able list of
// everything `storageKeyPrefixRegistry` (`@marinoscar/platform-api/storage`)
// holds. Platform declarations first, the app's last, so a collision with a
// platform entry names the app's entry. Loaded by ./storage.config.ts before
// `StorageModule.forRoot()`, whose own registration of the slice's prefixes is
// then a no-op. Recipe: packages/platform-api/src/storage/README.md.

import { registerStorageKeyPrefixes } from '@marinoscar/platform-api/storage';

import { APP_STORAGE_KEY_PREFIXES } from '../../app-registrations/storage-prefixes';
import { PLATFORM_STORAGE_KEY_PREFIXES } from './platform-storage-prefixes';

registerStorageKeyPrefixes(PLATFORM_STORAGE_KEY_PREFIXES);

// App-owned entries last, so a collision with a platform entry names the app.
registerStorageKeyPrefixes(APP_STORAGE_KEY_PREFIXES);

// =============================================================================
// The reference app's storage slice, configured once (issue #736)
// =============================================================================
//
// `StorageModule` and `ProfileImageModule` are the CONFIGURED dynamic modules
// of `@marinoscar/platform-api/storage`, built once at import time; every
// importer gets the same object (one module to Nest). The provider, bucket,
// region, endpoint and credential stay runtime settings (no option here
// decides them, and no environment variable ever may).
//
// ORDER IS LOAD-BEARING: the key-prefix manifest registers the platform's six
// prefixes in their historical purge order before `forRoot()` registers the
// slice's own (a no-op then), the settings registry is loaded before
// `ProfileImageModule.forRoot()` builds the controller whose response embeds
// the composed user-settings schema, and the app's storage drivers register
// before the application bootstraps (`app-registrations/storage.ts`).
// =============================================================================

import '../../settings/registry';
import './storage-key-prefix.manifest';
// The app's own storage drivers (PP-14.7), registered at import time like the
// key prefixes above: the registry freezes once the application has bootstrapped.
import '../../app-registrations/storage';

import {
  ProfileImageModule as PlatformProfileImageModule,
  StorageModule as PlatformStorageModule,
} from '@marinoscar/platform-api/storage';

import { StorageHostModule } from './storage-host.module';

/** The objects API, its status route, the cleanup sweep and the processing job. */
export const StorageModule = PlatformStorageModule.forRoot({ imports: [StorageHostModule] });

/** The profile-image routes (`/api/user-settings/profile-image`, the public avatar route). */
export const ProfileImageModule = PlatformProfileImageModule.forRoot();

export { StorageConfigModule, StorageProvidersModule } from '@marinoscar/platform-api/storage';

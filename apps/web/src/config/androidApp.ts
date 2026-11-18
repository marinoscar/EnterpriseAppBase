// The reference app's Android companion identity (#746): one derivation,
// shared with the API, the CLI and the Gradle build
// (`packages/shared/identity.json` and its optional `android` block).

import { ANDROID_IDENTITY_SOURCE } from '@app/shared';
import { androidIdentity } from '@marinoscar/platform-web/android-app/headless';

/** The application id, deep-link scheme, storage prefix and APK stem. */
export const ANDROID_IDENTITY = androidIdentity(ANDROID_IDENTITY_SOURCE);

/**
 * The prefix of the TWA's `sessionStorage` keys and the update banner's
 * dismissal key: the identity's storage prefix, so two apps on one origin
 * never read each other's launch flags.
 */
export const ANDROID_TWA_KEY_PREFIX = ANDROID_IDENTITY.storagePrefix;

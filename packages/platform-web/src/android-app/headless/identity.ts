// The Android identity, re-exported for the web (#746): one derivation for
// the API, the web, the CLI and (in Kotlin) the Gradle build.

import { androidIdentity as contractAndroidIdentity } from '@marinoscar/platform-contract/android-app';
import type { AndroidIdentity, AndroidIdentitySource } from '@marinoscar/platform-contract/android-app';

/**
 * Resolves the Android app's identity from `packages/shared/identity.json`
 * (and its optional `android` block): the application id (the default
 * trusted package), the deep-link scheme, the on-device storage prefix and
 * the APK stem. The same rule the Gradle build applies.
 *
 * @param identity - `ANDROID_IDENTITY_SOURCE` of `@app/shared`, or the same shape.
 * @returns the resolved identity.
 *
 * @example
 * ```ts
 * const { applicationId, apkStem } = androidIdentity(ANDROID_IDENTITY_SOURCE);
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function androidIdentity(identity: AndroidIdentitySource): AndroidIdentity {
  return contractAndroidIdentity(identity);
}

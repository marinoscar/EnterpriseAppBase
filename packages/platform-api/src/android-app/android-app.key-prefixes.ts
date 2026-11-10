// The android-app slice's storage key prefix (issue #746): the hosted APKs.

import { ANDROID_RELEASES_KEY_PREFIX } from '@marinoscar/platform-contract/android-app';

import { registerStorageKeyPrefixes, storageKeyPrefixRegistry, type StorageKeyPrefixDef } from '../storage/index';

/**
 * The `android-releases/` prefix: one object per APK release,
 * `android-releases/<releaseId>.apk`. Deployment-scoped, and kept by the
 * admin factory reset (`survivesFactoryReset: true`, consumed by #743): an
 * APK is a deployment artifact, like a database backup.
 *
 * @stability experimental
 */
export const ANDROID_RELEASES_KEY_PREFIX_DEF: StorageKeyPrefixDef = Object.freeze({
  id: 'android-releases',
  prefix: ANDROID_RELEASES_KEY_PREFIX,
  owner: 'android-app',
  scope: 'deployment' as const,
  description: 'Android APK releases the deployment hosts, android-releases/<releaseId>.apk (kept by the factory reset).',
  survivesFactoryReset: true,
});

/**
 * Registers {@link ANDROID_RELEASES_KEY_PREFIX_DEF}. Idempotent for the
 * identical entry; call it from the app's storage key-prefix manifest.
 *
 * @stability experimental
 */
export function registerAndroidAppKeyPrefixes(): void {
  if (storageKeyPrefixRegistry.has(ANDROID_RELEASES_KEY_PREFIX_DEF.id)) return;
  registerStorageKeyPrefixes([ANDROID_RELEASES_KEY_PREFIX_DEF]);
}

/**
 * The object key of one release's APK.
 *
 * @param releaseId - the release id (a UUID).
 * @returns `android-releases/<releaseId>.apk`.
 *
 * @stability experimental
 */
export function androidReleaseKey(releaseId: string): string {
  return `${ANDROID_RELEASES_KEY_PREFIX}${releaseId}.apk`;
}

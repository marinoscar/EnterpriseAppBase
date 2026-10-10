import { ANDROID_IDENTITY_SOURCE, APP_NAME } from '@app/shared';
import { AndroidAppModule, androidDeviceSourceRegistry } from '@marinoscar/platform-api/android-app';
import { androidIdentity } from '@marinoscar/platform-contract/android-app';

import { EMPTY_DEVICE_SOURCE, registerEmptyDeviceSource } from '../../examples/android-app/empty-device-source';

// =============================================================================
// The reference app's Android companion (#746)
// =============================================================================
//
// The manifest half runs at import, before any module composes: the device
// sources (here the empty one: the reference shell has no native capability).
// The `android_app` channel is declared in the notification manifest and the
// `android-releases/` prefix in the storage key-prefix manifest.
// =============================================================================

if (!androidDeviceSourceRegistry.has(EMPTY_DEVICE_SOURCE.id)) registerEmptyDeviceSource();

/** The Android identity every surface shares (identity.json, plus its optional `android` block). */
export const ANDROID_IDENTITY = androidIdentity(ANDROID_IDENTITY_SOURCE);

/** The slice, mounted once in AppModule. */
export const androidAppModule = AndroidAppModule.forRoot({
  appName: APP_NAME,
  apkStem: ANDROID_IDENTITY.apkStem,
  testNotificationLink: '/',
});

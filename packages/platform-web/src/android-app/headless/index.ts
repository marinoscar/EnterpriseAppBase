// `@marinoscar/platform-web/android-app/headless`: the Android companion's
// web logic with no component (issue #746): the TWA launch helpers, the API
// client, the hooks and the shared Android identity. Documented in
// ../README.md.

export type {
  AdminRelease,
  AndroidAppResponse,
  AndroidAppTestNotificationResponse,
  AndroidIdentity,
  AndroidIdentitySource,
  DownloadLink,
  PublicRelease,
  ReportedAndroidApp,
  TrustedAndroidApp,
} from '@marinoscar/platform-contract/android-app';
export { androidIdentity } from './identity.js';
export { DEFAULT_TWA_KEY_PREFIX, captureTwaLaunch, getInstalledAppVersion, isRunningInTwa, twaSessionKeys } from './twa.js';
export type { InstalledAppVersion, TwaSessionKeys } from './twa.js';
export { createAndroidAppClient } from './client.js';
export type { AndroidAppClient, AndroidAppTransport, AndroidReleaseUploadInput } from './client.js';
export { useAndroidAppClient, useAndroidAppConfig, useAndroidRelease } from './hooks.js';
export type { UseAndroidAppConfigReturn, UseAndroidReleaseReturn } from './hooks.js';

// `@marinoscar/platform-web/android-app/ui`: the Android companion's MUI
// components (issue #746): the admin page, the update banner, the download
// button and the packaged settings page. Documented in ../README.md.

export { ANDROID_PACKAGE_ERROR, ANDROID_SHA_ERROR, AndroidAppPage } from './AndroidAppPage.js';
export { AndroidUpdateBanner } from './AndroidUpdateBanner.js';
export type { AndroidUpdateBannerProps } from './AndroidUpdateBanner.js';
export { DownloadApkButton } from './DownloadApkButton.js';
export type { DownloadApkButtonProps } from './DownloadApkButton.js';
export {
  ANDROID_APP_DESCRIPTION,
  ANDROID_APP_PATH,
  ANDROID_APP_READ_ONLY_MESSAGE,
  ANDROID_APP_READ_PERMISSION,
  ANDROID_APP_TITLE,
  ANDROID_APP_WRITE_PERMISSION,
} from './copy.js';
export { androidAppSettingsPage } from './settings-page.js';

// The android-app slice's user-facing strings (#746). The admin card in the
// app's registry repeats the title and description word for word.

/**
 * The admin page's route, the `android` card of the admin hub.
 *
 * @stability experimental
 */
export const ANDROID_APP_PATH = '/admin/settings/android';

/**
 * The page and card title.
 *
 * @stability experimental
 */
export const ANDROID_APP_TITLE = 'Android app';

/**
 * The page and card description.
 *
 * @stability experimental
 */
export const ANDROID_APP_DESCRIPTION =
  'Publish the Android app’s APK, trust its signing certificate so it opens full screen, and send a test notification to the app.';

/**
 * Shown to a holder of `system_settings:read` without `:write`.
 *
 * @stability experimental
 */
export const ANDROID_APP_READ_ONLY_MESSAGE =
  'You can view these settings. Changing the trusted apps or releases needs permission to change system settings.';

/**
 * The permission the page reads with (the card's `permission`).
 *
 * @stability experimental
 */
export const ANDROID_APP_READ_PERMISSION = 'system_settings:read';

/**
 * The permission every write control needs.
 *
 * @stability experimental
 */
export const ANDROID_APP_WRITE_PERMISSION = 'system_settings:write';

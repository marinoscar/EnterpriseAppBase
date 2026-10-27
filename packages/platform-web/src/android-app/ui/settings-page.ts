import PhoneAndroidOutlinedIcon from '@mui/icons-material/PhoneAndroidOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { AndroidAppPage } from './AndroidAppPage.js';
import { ANDROID_APP_DESCRIPTION, ANDROID_APP_PATH, ANDROID_APP_READ_PERMISSION, ANDROID_APP_TITLE } from './copy.js';

/**
 * The Android app page as a packaged settings page: the app appends
 * `{ ...androidAppSettingsPage.card, Icon: androidAppSettingsPage.Icon }` to
 * its admin registry and routes `card.path` behind its permission gate for
 * `card.permission` (`system_settings:read`, the exact string
 * `GET /api/admin/android-app` enforces). No `feature`.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx (General, appended)
 * { ...androidAppSettingsPage.card, Icon: androidAppSettingsPage.Icon },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const androidAppSettingsPage: PlatformSettingsPage<never> = {
  id: 'android-app',
  card: {
    title: ANDROID_APP_TITLE,
    description: ANDROID_APP_DESCRIPTION,
    path: ANDROID_APP_PATH,
    permission: ANDROID_APP_READ_PERMISSION,
  },
  Icon: PhoneAndroidOutlinedIcon,
  Page: AndroidAppPage,
};

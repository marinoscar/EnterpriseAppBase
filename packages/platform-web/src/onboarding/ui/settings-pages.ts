import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { GettingStartedPage } from './GettingStartedPage.js';
import {
  GETTING_STARTED_DESCRIPTION,
  GETTING_STARTED_PATH,
  GETTING_STARTED_TITLE,
  SETUP_GUIDE_DESCRIPTION,
  SETUP_GUIDE_PATH,
  SETUP_GUIDE_TITLE,
} from './copy.js';
import { SetupGuidePage } from './SetupGuidePage.js';

/**
 * The Setup guide as a packaged settings page: the app appends
 * `{ ...setupGuideSettingsPage.card, Icon: setupGuideSettingsPage.Icon }` to
 * its admin registry and routes `card.path` behind its permission gate for
 * `card.permission` (`system_settings:read`, the exact string
 * `@marinoscar/platform-api/onboarding` adds the admin block for by default).
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx (General, last card)
 * { ...setupGuideSettingsPage.card, Icon: setupGuideSettingsPage.Icon },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const setupGuideSettingsPage: PlatformSettingsPage<never> = {
  id: 'setup-guide',
  card: {
    title: SETUP_GUIDE_TITLE,
    description: SETUP_GUIDE_DESCRIPTION,
    path: SETUP_GUIDE_PATH,
    permission: 'system_settings:read',
  },
  Icon: ChecklistOutlinedIcon,
  Page: SetupGuidePage,
};

/**
 * Getting started as a packaged user settings page: no permission (every
 * role holds `user_settings:read`, which `GET /api/onboarding` requires).
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx (Account, last card)
 * { ...gettingStartedSettingsPage.card, Icon: gettingStartedSettingsPage.Icon },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const gettingStartedSettingsPage: PlatformSettingsPage<never> = {
  id: 'getting-started',
  card: {
    title: GETTING_STARTED_TITLE,
    description: GETTING_STARTED_DESCRIPTION,
    path: GETTING_STARTED_PATH,
  },
  Icon: RocketLaunchOutlinedIcon,
  Page: GettingStartedPage,
};

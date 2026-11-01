// The user-data pages as packaged settings pages (issue #743).

import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import { FACTORY_RESET_PERMISSION } from '@marinoscar/platform-contract/user-data';

import type { PlatformSettingsPage } from '../../core/index.js';
import { DANGER_ZONE_PAGE_DESCRIPTION, DANGER_ZONE_PAGE_TITLE, FACTORY_RESET_PAGE_DESCRIPTION, FACTORY_RESET_PAGE_TITLE } from './copy.js';
import { FactoryResetPage } from './FactoryResetPage.js';
import { UserDangerZonePage } from './UserDangerZonePage.js';

/**
 * The user Danger Zone as a packaged per-user settings page: the app puts
 * `{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }` in a
 * `Danger Zone` group pinned LAST of its user registry, and routes
 * `card.path`. No `permission` (every role holds `user_settings:write`) and
 * no `feature`: it stays reachable while AI is off, since the deletion also
 * removes AI keys and runs.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * { label: 'Danger Zone', cards: [{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }] },
 * ```
 */
export const dangerZoneSettingsPage: PlatformSettingsPage<never> = {
  id: 'danger-zone',
  card: { title: DANGER_ZONE_PAGE_TITLE, description: DANGER_ZONE_PAGE_DESCRIPTION, path: '/settings/danger-zone' },
  Icon: DeleteForeverOutlinedIcon,
  Page: UserDangerZonePage,
};

/**
 * The factory reset as a packaged admin settings page: a `Danger Zone` group
 * pinned LAST of the admin registry, `permission: 'system:factory_reset'`
 * (the exact string the API enforces; Admin only), no `feature`.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * { label: 'Danger Zone', cards: [{ ...factoryResetSettingsPage.card, Icon: factoryResetSettingsPage.Icon }] },
 * ```
 */
export const factoryResetSettingsPage: PlatformSettingsPage<never> = {
  id: 'factory-reset',
  card: {
    title: FACTORY_RESET_PAGE_TITLE,
    description: FACTORY_RESET_PAGE_DESCRIPTION,
    path: '/admin/settings/factory-reset',
    permission: FACTORY_RESET_PERMISSION,
  },
  Icon: RestartAltOutlinedIcon,
  Page: FactoryResetPage,
};

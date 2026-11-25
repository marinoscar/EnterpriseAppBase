import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { GROUPS_PAGE_DESCRIPTION, GROUPS_PAGE_TITLE } from './copy.js';
import { GroupsPage } from './GroupsPage.js';

/**
 * The groups page as a packaged per-user settings page: the app appends
 * `{ ...groupsSettingsPage.card, Icon: groupsSettingsPage.Icon }` to its user
 * registry (a `Sharing` section, last) and routes `card.path` to `Page` (and
 * `${card.path}/:id` to `GroupDetailPage`) behind its permission gate for
 * `card.permission`: `groups:read`, the exact string the `/api/groups`
 * controller of `@marinoscar/platform-api/sharing` enforces. No `feature`.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx
 * { label: 'Sharing', cards: [{ ...groupsSettingsPage.card, Icon: groupsSettingsPage.Icon }] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const groupsSettingsPage: PlatformSettingsPage<never> = {
  id: 'groups',
  card: {
    title: GROUPS_PAGE_TITLE,
    description: GROUPS_PAGE_DESCRIPTION,
    path: '/settings/groups',
    permission: 'groups:read',
  },
  Icon: GroupsOutlinedIcon,
  Page: GroupsPage,
};

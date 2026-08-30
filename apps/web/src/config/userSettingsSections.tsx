/**
 * The per-user settings information architecture — the same registry shape as
 * `adminSections.tsx`, for the `/settings` surface.
 *
 * Issue #91, epic #90. `/settings` is today one page stacking three cards
 * (Theme, Profile, Personal Access Tokens). Epic #90 splits it into routed
 * destinations behind the same searchable hub the admin console gets (#96), so
 * it needs the same thing the console needs: ONE declaration read by the hub,
 * the AppBar's title resolver, and anything else that later wants to draw the
 * surface.
 *
 * This file deliberately declares only DATA. The `SettingsCardDef` /
 * `SettingsSectionDef` types and both helpers
 * (`visibleSettingsSections`, `settingsPageTitle`) are imported from
 * `adminSections.tsx` and re-used verbatim — which is precisely why those
 * helpers take `sections`, `hubPath` and `hubTitle` as parameters instead of
 * closing over the admin constants. Two copies of the permission gate is the
 * drift the registry exists to prevent, and copying it here to serve a second
 * surface would reintroduce it on day one.
 */

import PersonIcon from '@mui/icons-material/Person';
import PaletteIcon from '@mui/icons-material/Palette';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import type { SettingsSectionDef } from './adminSections';

/**
 * The user settings sections, in hub order.
 *
 * NO CARD DECLARES A `permission`, and that is the correct model rather than
 * an omission: every authenticated user owns their own settings, and the API
 * grants `user_settings:read` / `user_settings:write` to all three roles
 * (Admin, Contributor, Viewer). Adding a gate here would be inventing an
 * authorization rule the API does not enforce — the opposite of what this
 * registry is for. `visibleSettingsSections` is still the function the hub
 * calls, so search filtering and empty-section collapsing behave identically
 * to the admin surface; the permission half of the gate simply passes
 * everything through.
 *
 * Access Tokens sits under its own `Security` group rather than under
 * `Account` because a PAT is a long-lived credential: grouping it with display
 * name and theme would put "create a bearer token that outlives your session"
 * one row below "pick a colour scheme".
 */
export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Account',
    cards: [
      {
        title: 'Profile',
        description: 'Your display name and profile image, and the email you signed in with.',
        Icon: PersonIcon,
        path: '/settings/profile',
      },
      {
        title: 'Appearance',
        description: 'Choose a light, dark, or system-matched theme for this account.',
        Icon: PaletteIcon,
        path: '/settings/appearance',
      },
    ],
  },
  {
    label: 'Security',
    cards: [
      {
        title: 'Access Tokens',
        description: 'Create and revoke personal access tokens for API and CLI access.',
        Icon: VpnKeyIcon,
        path: '/settings/tokens',
      },
    ],
  },
];

/**
 * The user settings hub — the one `/settings` route that owns no card.
 *
 * `USER_HUB_TITLE` is intentionally the same string as `ADMIN_HUB_TITLE`
 * ('Settings'): the two surfaces are never on screen at once, the path
 * disambiguates them for the title resolver, and calling this one "My
 * Settings" in the AppBar would be the only place in the app that names it
 * that way.
 */
export const USER_HUB_PATH = '/settings';
export const USER_HUB_TITLE = 'Settings';

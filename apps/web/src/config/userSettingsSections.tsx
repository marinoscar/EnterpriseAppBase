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
import NotificationsIcon from '@mui/icons-material/Notifications';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import { identityUserSettingsSections } from '@marinoscar/platform-web/identity/ui';
import { groupsSettingsPage } from '@marinoscar/platform-web/sharing/ui';
// Getting started (#745; a packaged page: card and icon from its descriptor).
import { gettingStartedSettingsPage } from '@marinoscar/platform-web/onboarding/ui';
import { dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { DANGER_ZONE_GROUP_LABEL } from '@marinoscar/platform-web/user-data/headless';
import { dangerZoneSettingsPage } from '@marinoscar/platform-web/user-data/ui';

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
      {
        // Issue #126, epic #109. NO `permission`, like every card here: the
        // page edits the caller's OWN preferences through
        // `PATCH /api/user-settings`, which the API grants to all three roles,
        // and the registry it renders (`GET /api/notifications/events`) is
        // `@Auth()` with no permissions for exactly that reason — gating this
        // card would leave a Viewer unable to say how they are contacted.
        //
        // Under `Account` rather than `Security`, even though one of the events
        // it lists is a security alert: the card is about how this account is
        // contacted, not about credentials. `Security` holds long-lived
        // credentials (see the group's own note below).
        title: 'Notifications',
        description:
          'Choose which events notify you, and whether they arrive by email or in your browser.',
        Icon: NotificationsIcon,
        path: '/settings/notifications',
      },
      // Issue #745, appended: the caller's own derived checklist. No
      // permission, like its siblings (`GET /api/onboarding` requires
      // `user_settings:read`, which every role holds).
      { ...gettingStartedSettingsPage.card, Icon: gettingStartedSettingsPage.Icon },
    ],
  },
  {
    label: 'Security',
    cards: [
      // The identity slice's card (#727), as data: `Access Tokens`, `/settings/tokens`.
      ...identityUserSettingsSections.security,
      {
        // Issue #425, epic #419. THE FIRST USER CARD WITH A PERMISSION, and
        // deliberately so. Every other card here edits something the API grants
        // all three roles; `ai:use` is a real grant a deployment can withhold
        // from a role (AI costs money per call), and the `/api/ai/keys`
        // controller enforces exactly this string (`PERMISSIONS.AI_USE`). A card
        // without it would show a Viewer a page whose every call 403s.
        //
        // `feature: 'ai'` hides it while AI is switched off. Security, not
        // Account: a provider API key is a credential, like an access token.
        title: 'AI Keys',
        description:
          'Add your own API key for each AI provider, check it works, and see which models it can reach.',
        Icon: KeyOutlinedIcon,
        path: '/settings/ai',
        permission: 'ai:use',
        feature: 'ai',
      },
    ],
  },
  {
    // Issue #731 (PP-7.4). APPENDED as the last section. The packaged groups
    // page (`@marinoscar/platform-web/sharing/ui`), built from its descriptor
    // like the Doctor card is. The second gated user card: `groups:read` is
    // the exact string the `/api/groups` controller of
    // `@marinoscar/platform-api/sharing` enforces, an ORG permission every
    // org role holds by default (a deployment can withhold it). ONE
    // destination: a `groups:admin` holder gets an in-page "All groups"
    // switch, never a second admin card (reachability versus content). The
    // detail route `/settings/groups/:id` sits under this card's path, so the
    // AppBar's longest-prefix title rule names it "Groups" too.
    label: 'Sharing',
    cards: [{ ...groupsSettingsPage.card, Icon: groupsSettingsPage.Icon }],
  },
  // #744: "Download your data". No permission: the API grants the `user-data`
  // source to every role through `user_settings:read`. The Danger Zone group
  // (#743), when present, stays last: this group goes immediately before it.
  {
    label: 'Your data',
    cards: [{ ...dataExportSettingsPage.card, Icon: dataExportSettingsPage.Icon }],
  },
  {
    // Issue #743 (PP-9.1). `Danger Zone`, PINNED LAST: the one documented
    // exception to append-only (docs/specs/settings-ui.md); a group added
    // later goes BEFORE it. The packaged user Danger Zone page
    // (`@marinoscar/platform-web/user-data/ui`). No `permission` (the routes
    // require `user_settings:write`, held by every role) and no `feature`: it
    // stays reachable while AI is off, since the deletion also removes AI keys
    // and runs.
    label: DANGER_ZONE_GROUP_LABEL,
    cards: [{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }],
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

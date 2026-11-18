// The identity slice's settings registry entries (issue #727). DATA, not a
// new registry: the reference app keeps declaring every card in its own
// `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS` (apps/web/src/config/*.tsx) and
// spreads these entries where its literal cards were, in the same order and
// position, so the hub, the Console rail and the AppBar title resolver see
// exactly what they saw before. No component is referenced here, so importing
// the cards never pulls a page into the app's main chunk.
//
// Every `permission` is the exact string the identity controller enforces
// (`@marinoscar/platform-api/identity`):
//   - `users:read`         -> users.controller.ts (the Allowlist tab gates
//                             `allowlist:read` inside the page)
//   - `org_members:read`   -> org-members.controller.ts (an ORG permission;
//                             the Invites tab gates `org_invites:read`)
//   - `organizations:read` -> organizations-admin.controller.ts (SYSTEM)
//   - `oauth_clients:read` -> oauth-server/clients/oauth-clients-admin.controller.ts
//                             (SYSTEM; writes gate `oauth_clients:write` inside
//                             the page). No `feature`: this card is where the
//                             OAuth server is switched on, like the admin `AI` card.
// The Access Tokens and Connected apps cards have none: every signed-in user
// manages their own tokens and grants (the `/api/pat` and `/api/oauth/grants`
// routes are `@Auth()` only). Connected apps carries `feature: 'oauthServer'`:
// it exists only while the OAuth server is on.

import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PeopleIcon from '@mui/icons-material/People';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

import type { PlatformSettingsPage } from '../../core/index.js';

/**
 * One identity registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app.
 *
 * @stability experimental
 */
export type IdentitySettingsCard = PlatformSettingsPage<'orgs' | 'oauthServer'>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The identity admin cards, by the admin section they belong to:
 *
 * - `access`: `Users & Allowlist` (`/admin/settings/users`, `users:read`).
 * - `organizations`: `Organization` (`/admin/settings/organization`,
 *   `org_members:read`) and `Organizations` (`/admin/settings/organizations`,
 *   `organizations:read`), both `feature: 'orgs'` (multi-org deployments only).
 * - `oauthClients`: `OAuth clients` (`/admin/settings/oauth-clients`,
 *   `oauth_clients:read`, no `feature`: it is where the OAuth server is
 *   switched on). Its own key, so an app opts in by spreading it AND routing
 *   the page (a card in an existing key would reach every app without its
 *   route), appended after its existing Access cards.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Access', cards: [...identityAdminSections.access, ...identityAdminSections.oauthClients] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const identityAdminSections: {
  /** The Access section's cards. */
  readonly access: readonly IdentitySettingsCard[];
  /** The Organizations section's cards. */
  readonly organizations: readonly IdentitySettingsCard[];
  /** The `OAuth clients` card (PP-15.7), appended to the app's Access section. */
  readonly oauthClients: readonly IdentitySettingsCard[];
} = Object.freeze({
  access: Object.freeze([
    {
      title: 'Users & Allowlist',
      description: 'Manage user accounts and roles, and control who may sign in at all.',
      Icon: PeopleIcon,
      path: '/admin/settings/users',
      permission: 'users:read',
    },
  ]),
  organizations: Object.freeze([
    {
      title: 'Organization',
      description:
        'See who belongs to your current organization, change their roles, suspend or remove them, and invite new members.',
      Icon: GroupsOutlinedIcon,
      path: '/admin/settings/organization',
      permission: 'org_members:read',
      feature: 'orgs' as const,
    },
    {
      title: 'Organizations',
      description:
        'List every organization in this deployment, create one with its first administrator, and rename them.',
      Icon: BusinessOutlinedIcon,
      path: '/admin/settings/organizations',
      permission: 'organizations:read',
      feature: 'orgs' as const,
    },
  ]),
  oauthClients: Object.freeze([
    {
      title: 'OAuth clients',
      description:
        'Let other apps connect with OAuth: switch the server on, choose which client hosts may connect, and manage clients and token lifetimes.',
      Icon: HubOutlinedIcon,
      path: '/admin/settings/oauth-clients',
      permission: 'oauth_clients:read',
    },
  ]),
});

/**
 * The identity per-user settings cards, by section:
 *
 * - `security`: `Access Tokens` (`/settings/tokens`, no permission).
 * - `connectedApps`: `Connected apps` (`/settings/connected-apps`, no
 *   permission: any signed-in user manages their own grants;
 *   `feature: 'oauthServer'`, hidden while the OAuth server is off). Its own
 *   key so an app opts in (spreads it AND routes the page) and APPENDS it after
 *   its existing Security cards instead of the package inserting it between them.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx
 * { label: 'Security', cards: [...identityUserSettingsSections.security, aiKeysCard, ...identityUserSettingsSections.connectedApps] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const identityUserSettingsSections: {
  /** The Security section's cards. */
  readonly security: readonly IdentitySettingsCard[];
  /** The `Connected apps` card (PP-15.7), appended to the app's Security section. */
  readonly connectedApps: readonly IdentitySettingsCard[];
} = Object.freeze({
  security: Object.freeze([
    {
      title: 'Access Tokens',
      description: 'Create and revoke personal access tokens for API and CLI access.',
      Icon: VpnKeyIcon,
      path: '/settings/tokens',
    },
  ]),
  connectedApps: Object.freeze([
    {
      title: 'Connected apps',
      description: 'See the apps you connected to your account with OAuth, what each may do, and disconnect them.',
      Icon: AppsOutlinedIcon,
      path: '/settings/connected-apps',
      feature: 'oauthServer' as const,
    },
  ]),
});

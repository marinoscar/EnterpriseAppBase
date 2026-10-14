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
// The Access Tokens card has none: every signed-in user manages their own.

import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
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
export type IdentitySettingsCard = PlatformSettingsPage<'orgs'>['card'] & {
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
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Access', cards: [...identityAdminSections.access] },
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
});

/**
 * The identity per-user settings cards, by section:
 *
 * - `security`: `Access Tokens` (`/settings/tokens`, no permission).
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx
 * { label: 'Security', cards: [...identityUserSettingsSections.security, aiKeysCard] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const identityUserSettingsSections: {
  /** The Security section's cards. */
  readonly security: readonly IdentitySettingsCard[];
} = Object.freeze({
  security: Object.freeze([
    {
      title: 'Access Tokens',
      description: 'Create and revoke personal access tokens for API and CLI access.',
      Icon: VpnKeyIcon,
      path: '/settings/tokens',
    },
  ]),
});

// The webhooks slice's settings registry entries (issue #1046). DATA, not a
// new registry: the app keeps declaring every card in its own
// `ADMIN_SECTIONS` / `USER_SETTINGS_SECTIONS` and spreads these where they
// belong. No page component is referenced here, so importing the cards never
// pulls the page into the app's main chunk.
//
// Every `permission` is the exact string the webhooks controllers enforce
// (`WEBHOOK_PERMISSIONS` of `@marinoscar/platform-contract/webhooks`):
//   - `webhooks:read`         -> GET /api/webhooks (ORG scope, every org role;
//                                a member sees only their own endpoints)
//   - `org_webhooks:read`     -> GET /api/org/webhooks (ORG scope, org_admin)
//   - `system_webhooks:read`  -> GET /api/admin/webhooks (SYSTEM scope, admin)
// The `:write` strings are gated inside the page, never by a second card.

import WebhookOutlinedIcon from '@mui/icons-material/WebhookOutlined';
import { WEBHOOK_PERMISSIONS } from '@marinoscar/platform-contract/webhooks';

import type { PlatformSettingsPage } from '../../core/index.js';
import { WEBHOOKS_PAGE_COPY } from './copy.js';

/**
 * One webhooks registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app.
 *
 * @stability experimental
 */
export type WebhooksSettingsCard = PlatformSettingsPage<'orgs'>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The per-user webhooks card, by section:
 *
 * - `integrations`: `Webhooks` (`/settings/webhooks`, `webhooks:read`).
 *
 * Route it to `<WebhooksPage scope="user" />`.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/userSettingsSections.tsx
 * { label: 'Integrations', cards: [...webhooksUserSettingsSections.integrations] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const webhooksUserSettingsSections: {
  /** The Integrations section's cards. */
  readonly integrations: readonly WebhooksSettingsCard[];
} = Object.freeze({
  integrations: Object.freeze([
    {
      ...WEBHOOKS_PAGE_COPY.user,
      Icon: WebhookOutlinedIcon,
      permission: WEBHOOK_PERMISSIONS.READ,
    },
  ]),
});

/**
 * The admin webhooks cards, by the admin section they belong to:
 *
 * - `operations`: `Webhooks` (`/admin/settings/webhooks`,
 *   `system_webhooks:read`), the deployment's endpoints; route it to
 *   `<WebhooksPage scope="system" />`.
 * - `organizations`: `Organization webhooks`
 *   (`/admin/settings/organization-webhooks`, `org_webhooks:read`,
 *   `feature: 'orgs'` like the other organization cards); route it to
 *   `<WebhooksPage scope="org" />`.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Operations', cards: [...jobsAdminSections.operations, ...webhooksAdminSections.operations] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const webhooksAdminSections: {
  /** The Operations section's cards. */
  readonly operations: readonly WebhooksSettingsCard[];
  /** The Organizations section's cards. */
  readonly organizations: readonly WebhooksSettingsCard[];
} = Object.freeze({
  operations: Object.freeze([
    {
      ...WEBHOOKS_PAGE_COPY.system,
      Icon: WebhookOutlinedIcon,
      permission: WEBHOOK_PERMISSIONS.SYSTEM_READ,
    },
  ]),
  organizations: Object.freeze([
    {
      ...WEBHOOKS_PAGE_COPY.org,
      Icon: WebhookOutlinedIcon,
      permission: WEBHOOK_PERMISSIONS.ORG_READ,
      feature: 'orgs' as const,
    },
  ]),
});

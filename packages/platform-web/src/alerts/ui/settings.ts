// The alerts slice's admin registry card (issue #1047). DATA, not a new
// registry: the app declares every card in its own `ADMIN_SECTIONS` and
// spreads this one where it belongs (the Observability section). No page
// component is referenced here, so importing the card never pulls the page
// into the app's main chunk.
//
// `alerts:read` is the exact string every read route of the packaged
// `/api/admin/alerts` controller enforces (`ALERT_PERMISSIONS.READ` of
// `@marinoscar/platform-contract/alerts`); writes (`alerts:write`) are gated
// inside the page. NO `feature`: node rules work with telemetry switched off.

import NotificationImportantOutlinedIcon from '@mui/icons-material/NotificationImportantOutlined';
import { ALERT_PERMISSIONS } from '@marinoscar/platform-contract/alerts';

import type { PlatformSettingsPage } from '../../core/index.js';
import { ALERTS_PAGE_COPY } from './copy.js';

/**
 * One alerts registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app.
 *
 * @stability experimental
 */
export type AlertsAdminCard = PlatformSettingsPage<never>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The Observability card of the alerts slice: `Alerts`
 * (`/admin/settings/alerts`, `alerts:read`, no `feature`). Route it to
 * `<AlertsPage />`.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx, the Observability section
 * cards: [...telemetryAdminCards, doctorCard, ...alertsAdminCards],
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const alertsAdminCards: readonly AlertsAdminCard[] = Object.freeze([
  {
    title: ALERTS_PAGE_COPY.title,
    description: ALERTS_PAGE_COPY.description,
    path: ALERTS_PAGE_COPY.path,
    Icon: NotificationImportantOutlinedIcon,
    permission: ALERT_PERMISSIONS.READ,
  },
]);

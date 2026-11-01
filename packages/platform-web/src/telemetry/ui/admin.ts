// The telemetry slice's admin registry cards (issue #704). Data only: the
// app places them in its own registry (`apps/web/src/config/adminSections.tsx`,
// the Observability section) where its three literal cards were, so the hub,
// the Console rail and the AppBar title resolver show them in the same order
// with the same permissions and features. No component is referenced here,
// so importing the cards never pulls a page into the app's main chunk.

import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { TELEMETRY_DASHBOARD_PATH, TELEMETRY_EXPLORER_PATH, TELEMETRY_SETTINGS_PATH } from '../headless/lib/explorerHandoff.js';

/**
 * One telemetry admin card: the `PlatformSettingsPage` card shape (#696) plus
 * its icon, structurally a `SettingsCardDef` of the reference app.
 *
 * @stability experimental
 */
export type TelemetryAdminCard = PlatformSettingsPage<'telemetry'>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The three Observability cards of the telemetry slice, in registry order:
 *
 * - `Telemetry` (`/admin/settings/telemetry`, `telemetry:read`): NO `feature`,
 *   deliberately; it is where telemetry is switched on. Saving needs
 *   `telemetry:write`, which the page gates.
 * - `Telemetry Explorer` (`…/explorer`, `telemetry:query`, `feature: 'telemetry'`).
 * - `Telemetry Dashboard` (`…/dashboard`, `telemetry:query`, `feature: 'telemetry'`).
 *
 * The permissions are the exact strings the telemetry controllers enforce.
 * Both nested pages sit under the Telemetry route, so a longest-prefix title
 * resolver names them correctly.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx, the Observability section
 * cards: [...telemetryAdminCards, { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }],
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const telemetryAdminCards: readonly TelemetryAdminCard[] = Object.freeze([
  {
    title: 'Telemetry',
    description:
      'Turn telemetry collection on, choose how long it is kept, set query limits and configure the AI assistant.',
    Icon: InsightsOutlinedIcon,
    path: TELEMETRY_SETTINGS_PATH,
    permission: 'telemetry:read',
  },
  {
    title: 'Telemetry Explorer',
    description: 'Query traces, logs and metrics with SQL, export the results, and ask the AI assistant for help.',
    Icon: TerminalOutlinedIcon,
    path: TELEMETRY_EXPLORER_PATH,
    permission: 'telemetry:query',
    feature: 'telemetry',
  },
  {
    title: 'Telemetry Dashboard',
    description:
      'See at a glance whether anything is wrong: error rate, latency, error logs and the top failing routes.',
    Icon: MonitorHeartOutlinedIcon,
    path: TELEMETRY_DASHBOARD_PATH,
    permission: 'telemetry:query',
    feature: 'telemetry',
  },
]);

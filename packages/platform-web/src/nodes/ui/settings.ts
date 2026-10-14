// The nodes slice's settings registry entry (issue #881). DATA, not a new
// registry: the reference app keeps declaring every card in its own
// `ADMIN_SECTIONS` (apps/web/src/config/adminSections.tsx). The jobs slice's
// `jobsAdminSections.operations` spreads this card after its own two, so the
// hub, the Console rail and the AppBar title resolver see the same order as
// before (Jobs, Job Insights, Worker Nodes). No component is referenced here,
// so importing the card never pulls the page into the app's main chunk.
//
// The `permission` is the exact string the packaged controller enforces
// (`@marinoscar/platform-api/nodes`): `nodes:read` ->
// nodes/nodes-admin.controller.ts (`PERMISSIONS.NODES_READ`): the fleet, the
// node detail and the credential list. DELIBERATELY NOT `jobs:read`: the two
// are split. Deleting a node and creating or revoking a credential need
// `nodes:write`, gated inside the page.

import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import { WORKER_NODES_PAGE_DESCRIPTION, WORKER_NODES_PAGE_TITLE } from './copy.js';

/**
 * One nodes registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app. Never
 * feature-gated, so it is assignable to any app's card type.
 *
 * @stability experimental
 */
export type NodesSettingsCard = PlatformSettingsPage<never>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The nodes admin cards, by the admin section they belong to:
 *
 * - `operations`: `Worker Nodes` (`/admin/settings/workers`, `nodes:read`).
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Operations', cards: [...nodesAdminSections.operations, dbBackupCard] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const nodesAdminSections: {
  /** The Operations section's cards. */
  readonly operations: readonly NodesSettingsCard[];
} = Object.freeze({
  operations: Object.freeze([
    {
      title: WORKER_NODES_PAGE_TITLE,
      description: WORKER_NODES_PAGE_DESCRIPTION,
      Icon: DnsOutlinedIcon,
      path: '/admin/settings/workers',
      permission: 'nodes:read',
    },
  ]),
});

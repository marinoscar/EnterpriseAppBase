// The jobs slice's settings registry entries (issue #854). DATA, not a new
// registry: the reference app keeps declaring every card in its own
// `ADMIN_SECTIONS` (apps/web/src/config/adminSections.tsx) and spreads these
// entries where its literal cards were, in the same order and position, so the
// hub, the Console rail and the AppBar title resolver see exactly what they saw
// before. No component is referenced here, so importing the cards never pulls a
// page into the app's main chunk.
//
// Every `permission` is the exact string the packaged controller enforces
// (`@marinoscar/platform-api/jobs` and `/nodes`):
//   - `jobs:read`  -> jobs/job-admin.controller.ts (`PERMISSIONS.JOBS_READ`),
//                     both Jobs cards: the list, the stats and the insights.
//                     The writes need `jobs:write`, gated inside the pages.
//   - `nodes:read` -> nodes/nodes-admin.controller.ts (`PERMISSIONS.NODES_READ`):
//                     the fleet, the node detail and the credential list.
//                     DELIBERATELY NOT `jobs:read`: the two are split, so a
//                     Workers card on `jobs:read` would advertise a permission
//                     that controller never checks. Deleting a node and
//                     creating or revoking a credential need `nodes:write`,
//                     gated inside the page.
//
// `Job Insights` nests UNDER the Jobs path; the app's `settingsPageTitle`
// longest-prefix rule keeps the compact AppBar titling it "Job Insights".

import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import WorkHistoryOutlinedIcon from '@mui/icons-material/WorkHistoryOutlined';

import type { PlatformSettingsPage } from '../../core/index.js';
import {
  JOB_INSIGHTS_PAGE_DESCRIPTION,
  JOB_INSIGHTS_PAGE_TITLE,
  JOBS_PAGE_DESCRIPTION,
  JOBS_PAGE_TITLE,
  WORKER_NODES_PAGE_DESCRIPTION,
  WORKER_NODES_PAGE_TITLE,
} from './copy.js';

/**
 * One jobs registry card: the `PlatformSettingsPage` card shape plus its
 * icon, structurally a `SettingsCardDef` of the reference app. Never
 * feature-gated, so it is assignable to any app's card type.
 *
 * @stability experimental
 */
export type JobsSettingsCard = PlatformSettingsPage<never>['card'] & {
  /** The card and rail icon (an MUI SvgIcon). */
  Icon: PlatformSettingsPage['Icon'];
};

/**
 * The jobs admin cards, by the admin section they belong to:
 *
 * - `operations`: `Jobs` (`/admin/settings/jobs`, `jobs:read`), `Job Insights`
 *   (`/admin/settings/jobs/insights`, `jobs:read`) and `Worker Nodes`
 *   (`/admin/settings/workers`, `nodes:read`), in that order.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { label: 'Operations', cards: [...jobsAdminSections.operations, dbBackupCard, broadcastsCard] },
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export const jobsAdminSections: {
  /** The Operations section's cards. */
  readonly operations: readonly JobsSettingsCard[];
} = Object.freeze({
  operations: Object.freeze([
    {
      title: JOBS_PAGE_TITLE,
      description: JOBS_PAGE_DESCRIPTION,
      Icon: WorkHistoryOutlinedIcon,
      path: '/admin/settings/jobs',
      permission: 'jobs:read',
    },
    {
      title: JOB_INSIGHTS_PAGE_TITLE,
      description: JOB_INSIGHTS_PAGE_DESCRIPTION,
      Icon: QueryStatsIcon,
      path: '/admin/settings/jobs/insights',
      permission: 'jobs:read',
    },
    {
      title: WORKER_NODES_PAGE_TITLE,
      description: WORKER_NODES_PAGE_DESCRIPTION,
      Icon: DnsOutlinedIcon,
      path: '/admin/settings/workers',
      permission: 'nodes:read',
    },
  ]),
});

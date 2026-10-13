// `@marinoscar/platform-web/jobs/ui`: the jobs slice's pages (issue #854): the
// Jobs, Job Insights and Worker Nodes admin pages with their header slot, and
// the admin registry entries as data. Built on `/jobs/headless`. Documented in
// ../README.md. Explicit named exports only.

export { JobsPage } from './JobsPage.js';
export type { JobsExtraFilters, JobsFiltersSlotProps, JobsPageProps, JobsPageSlots } from './JobsPage.js';
export { JobInsightsPage } from './JobInsightsPage.js';
export type {
  JobInsightsFiltersSlotProps,
  JobInsightsPageProps,
  JobInsightsPageSlots,
  JobTypeInsightRow,
} from './JobInsightsPage.js';
// The Worker Nodes page moved to `@marinoscar/platform-web/nodes/ui` (#881);
// re-exported here for compatibility.
export { WorkersPage } from '../../nodes/index.js';
export type { WorkersPageProps, WorkersPageSlots } from '../../nodes/index.js';
export type { JobsPageHeaderProps } from './PageHeader.js';
export { jobsAdminSections } from './settings.js';
export type { JobsSettingsCard } from './settings.js';

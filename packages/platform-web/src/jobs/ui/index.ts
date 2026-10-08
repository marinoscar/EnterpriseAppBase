// `@marinoscar/platform-web/jobs/ui`: the jobs slice's pages (issue #854): the
// Jobs, Job Insights and Worker Nodes admin pages with their header slot, and
// the admin registry entries as data. Built on `/jobs/headless`. Documented in
// ../README.md. Explicit named exports only.

export { JobsPage } from './JobsPage.js';
export type { JobsPageProps } from './JobsPage.js';
export { JobInsightsPage } from './JobInsightsPage.js';
export type { JobInsightsPageProps } from './JobInsightsPage.js';
export { WorkersPage } from './WorkersPage.js';
export type { WorkersPageProps } from './WorkersPage.js';
export type { JobsPageHeaderProps } from './PageHeader.js';
export { jobsAdminSections } from './settings.js';
export type { JobsSettingsCard } from './settings.js';

---
"@marinoscar/platform-web": minor
---

Add `@marinoscar/platform-web/jobs` (#854): `/jobs/headless` (`createJobsApi` over the host transport with the `orgId` list filter, the wire types from `@marinoscar/platform-contract/jobs` and `/nodes`, `useJobs`, `useJobStats`, `useJobActions`, `useJobInsights`, `useWorkerNodes`, `useWorkerNode`, `useNodeCredentials`, `useNodeActions`, `useVisiblePolling`, `JobsWebAdaptersProvider`, the formatters) and `/jobs/ui` (`JobsPage`, `JobInsightsPage`, `WorkersPage` with a `slots.Header`, and `jobsAdminSections`), moved from the reference app with the same DOM, styles, routes and permissions.

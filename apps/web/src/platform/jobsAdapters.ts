/**
 * The app's jobs adapters (issue #854): what the packaged Jobs, Job Insights
 * and Worker Nodes pages (`@marinoscar/platform-web/jobs`) take from this app,
 * handed in through `JobsWebAdaptersProvider` in `App.tsx`:
 *
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *   - `DataTable`: the app's responsive `DataTable` (`components/datatable`),
 *     which the job list, the per-type insights, the fleet and the credential
 *     list render through, so they keep the app's table on every breakpoint
 *     (the package's fallback is a plain MUI table).
 *   - `api`: the package's own jobs client (`createJobsApi`) over the app's
 *     transport (`appPlatformApi`, `platform/platformHost.tsx`), so every call
 *     carries the app's bearer token, refresh and maintenance handling.
 *
 * A module constant, like `appIdentityAdapters`.
 */

import { createJobsApi } from '@marinoscar/platform-web/jobs/headless';
import type { JobsWebAdapters } from '@marinoscar/platform-web/jobs/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import { appPlatformApi } from './platformHost';

/** The adapters `App.tsx` hands the jobs pages. */
export const appJobsAdapters: JobsWebAdapters = Object.freeze<JobsWebAdapters>({
  Spinner: LoadingSpinner,
  DataTable,
  api: createJobsApi(appPlatformApi),
});

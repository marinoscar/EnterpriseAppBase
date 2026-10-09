/**
 * The app's nodes adapters (issue #881): what the packaged Worker Nodes page
 * (`@marinoscar/platform-web/nodes`) takes from this app, handed in through
 * `NodesWebAdaptersProvider` in `platform/shellProviders.tsx`:
 *
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *   - `DataTable`: the app's responsive `DataTable` (`components/datatable`),
 *     which the fleet and the credential list render through.
 *   - `api`: the package's own nodes client (`createNodesApi`) over the app's
 *     transport (`appPlatformApi`, `platform/platformHost.tsx`).
 *
 * Same members as `appJobsAdapters` (`platform/jobsAdapters.ts`); the jobs
 * provider would hand them to the page anyway (the compatibility bridge), and
 * mounting this one makes the dependency explicit. A module constant.
 */

import { createNodesApi } from '@marinoscar/platform-web/nodes/headless';
import type { NodesWebAdapters } from '@marinoscar/platform-web/nodes/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import { appPlatformApi } from './platformHost';

/** The adapters the shell hands the Worker Nodes page. */
export const appNodesAdapters: NodesWebAdapters = Object.freeze<NodesWebAdapters>({
  Spinner: LoadingSpinner,
  DataTable,
  api: createNodesApi(appPlatformApi),
});

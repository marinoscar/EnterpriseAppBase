/**
 * The app's db-backup adapters (issue #740): what the packaged Database Backup
 * page (`@marinoscar/platform-web/db-backup`) takes from this app, handed in
 * through `DbBackupWebAdaptersProvider` in `App.tsx`:
 *
 *   - `DataTable`: the app's responsive `DataTable` (`components/datatable`),
 *     so the run list keeps the app's table on every breakpoint (the
 *     package's fallback is a plain MUI table).
 *
 * The client is the package's default, `createDbBackupApi` over the platform
 * host's transport (`AppPlatformHostProvider`). A module constant, like
 * `appJobsAdapters`.
 */

import type { DbBackupWebAdapters } from '@marinoscar/platform-web/db-backup/headless';

import { DataTable } from '@marinoscar/platform-web/datatable/ui';

/** The adapters `App.tsx` hands the db-backup page. */
export const appDbBackupAdapters: DbBackupWebAdapters = Object.freeze<DbBackupWebAdapters>({
  DataTable,
});

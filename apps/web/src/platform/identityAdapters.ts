/**
 * The app's identity adapters (issue #727, PP-6.6): what the packaged identity
 * pages and hooks (`@marinoscar/platform-web/identity`) take from this app,
 * handed in through `IdentityWebAdaptersProvider` in `App.tsx`:
 *
 *   - `appName`: the product name the sign-in error copy names.
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *   - `DataTable`: the responsive `DataTable` of `@marinoscar/platform-web/datatable/ui`,
 *     which the users, allowlist and token lists render through, so they keep
 *     the app's table on every breakpoint (the package's fallback is a plain
 *     MUI table).
 *   - `api`: the package's own identity client (`createIdentityApi`) over the
 *     app's transport (`appPlatformApi`, `platform/platformHost.tsx`), so every
 *     identity call carries the app's bearer token, refresh and maintenance
 *     handling. Bound here rather than read from the platform host because
 *     two identity pages render outside it: the login page (signed out) and
 *     `/activate` (full screen, outside the shell).
 *
 * A module constant, like `appTelemetryAdapters`.
 */

import { APP_NAME } from '@app/shared';
import { createIdentityApi } from '@marinoscar/platform-web/identity/headless';
import type { IdentityWebAdapters } from '@marinoscar/platform-web/identity/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import { appPlatformApi } from './platformHost';

/** The adapters `App.tsx` hands the identity pages. */
export const appIdentityAdapters: IdentityWebAdapters = Object.freeze<IdentityWebAdapters>({
  appName: APP_NAME,
  Spinner: LoadingSpinner,
  DataTable,
  api: createIdentityApi(appPlatformApi),
});

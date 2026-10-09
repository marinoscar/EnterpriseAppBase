/**
 * The app's AI adapters (issue #890): what the packaged AI pages
 * (`@marinoscar/platform-web/ai`) take from this app, handed in through
 * `AiWebAdaptersProvider` in `shellProviders.tsx`:
 *
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *   - `DataTable`: the app's responsive `DataTable` (`components/datatable`),
 *     which the model catalogue and the usage breakdowns render through, so
 *     they keep the app's table on every breakpoint (the package's fallback is
 *     a plain MUI table).
 *
 * A module constant, like `appJobsAdapters`.
 */

import type { AiWebAdapters } from '@marinoscar/platform-web/ai/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { DataTable } from '../components/datatable';

/** The adapters `shellProviders.tsx` hands the AI pages. */
export const appAiAdapters: AiWebAdapters = Object.freeze<AiWebAdapters>({
  Spinner: LoadingSpinner,
  DataTable,
});

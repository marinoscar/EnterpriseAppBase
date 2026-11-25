/**
 * The app's AI adapters (issue #890): what the packaged AI pages
 * (`@marinoscar/platform-web/ai`) take from this app, handed in through
 * `AiWebAdaptersProvider` in `shellProviders.tsx`:
 *
 *   - `Spinner`: `LoadingSpinner`, so loading states look like the rest of the app.
 *
 * The model catalogue and the usage breakdowns render through the datatable
 * slice's `DataTable` directly (#899); no table adapter is needed.
 *
 * A module constant, like `appJobsAdapters`.
 */

import type { AiWebAdapters } from '@marinoscar/platform-web/ai/headless';

import { LoadingSpinner } from '../components/common/LoadingSpinner';

/** The adapters `shellProviders.tsx` hands the AI pages. */
export const appAiAdapters: AiWebAdapters = Object.freeze<AiWebAdapters>({
  Spinner: LoadingSpinner,
});

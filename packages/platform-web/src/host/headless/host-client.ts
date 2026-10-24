// =============================================================================
// The host slice's API calls (issues #258, #401; packaged by #891)
// =============================================================================
//
// Three routes over the platform host's transport, so a call inherits the
// app's token refresh, its 401 retry and its maintenance interception like
// every other call in the app:
//
//   - `GET /admin/maintenance`: the effective state plus every layer;
//   - `PUT /admin/maintenance`: open or close a window;
//   - `GET /admin/about`: what is deployed here.
//
// ⚠ `getAbout` NEVER REJECTS FOR A MISSING OR BROKEN DEPLOY DOCUMENT. The API
// answers 200 for every authorized caller: `deployInfoStatus` carries `absent`
// or `invalid`, and a database that did not answer arrives as `database: null`
// with a `databaseError` string. A rejection means the request itself failed (a
// 401, a 403, a network error or a maintenance window) and nothing else. The
// API reads the document from disk on every request, so a rewritten document
// needs no restart and this call always reports the current file.
// =============================================================================

import type { PlatformApiClient } from '../../core/index.js';
import type { AboutResponse, MaintenanceStatus, UpdateMaintenanceInput } from './contract.js';

/**
 * The host slice's calls.
 *
 * @stability experimental
 */
export interface HostApi {
  /** The effective maintenance state, plus each contributing layer. */
  getMaintenanceStatus(): Promise<MaintenanceStatus>;
  /** Open or close a window. See {@link UpdateMaintenanceInput} for what is not settable. */
  updateMaintenance(input: UpdateMaintenanceInput): Promise<MaintenanceStatus>;
  /** What is deployed here: API version, deploy document, database liveness. */
  getAbout(): Promise<AboutResponse>;
}

/**
 * The host slice's calls over the platform host's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @returns the {@link HostApi}.
 *
 * @example
 * ```ts
 * const hostApi = createHostApi(usePlatformApi());
 * const about = await hostApi.getAbout();
 * ```
 *
 * @stability experimental
 */
export function createHostApi(api: PlatformApiClient): HostApi {
  return {
    getMaintenanceStatus: () => api.get<MaintenanceStatus>('/admin/maintenance'),
    updateMaintenance: (input) => api.put<MaintenanceStatus>('/admin/maintenance', input),
    getAbout: () => api.get<AboutResponse>('/admin/about'),
  };
}

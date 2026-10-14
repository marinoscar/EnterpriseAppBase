import type { DoctorReport, DoctorReportQueryInput } from '@marinoscar/platform-contract/doctor';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The Doctor's API calls.
 *
 * @stability stable
 */
export interface DoctorClient {
  /**
   * `GET /admin/doctor`. Rejects only when the CALL fails (403, 500, the
   * connection dropped); a failing check is a resolved report.
   */
  getReport(query?: DoctorReportQueryInput): Promise<DoctorReport>;
}

/**
 * The Doctor client over the app's transport.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @param path - the route, relative to the API base. Default `'/admin/doctor'`;
 *   pass the app's own when `DoctorModule.forRoot({ path })` moved it.
 * @returns the client.
 *
 * @example
 * ```ts
 * const client = createDoctorClient(usePlatformApi());
 * const report = await client.getReport({ refresh: true });
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function createDoctorClient(api: PlatformApiClient, path = '/admin/doctor'): DoctorClient {
  return {
    getReport(query: DoctorReportQueryInput = {}) {
      const params = new URLSearchParams();
      if (query.category) params.set('category', query.category);
      if (query.refresh) params.set('refresh', 'true');
      const qs = params.toString();
      return api.get<DoctorReport>(qs ? `${path}?${qs}` : path);
    },
  };
}

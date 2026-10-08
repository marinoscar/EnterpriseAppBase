// The user-data API calls over the app's transport (issue #743, PP-9.1).
// Routes: `@marinoscar/platform-contract/user-data` (`USER_DATA_PATHS`).

import { USER_DATA_PATHS } from '@marinoscar/platform-contract/user-data';
import type {
  FactoryResetStatus,
  FactoryResetSummary,
  OrgOffboardingRequest,
  OrgOffboardingStatus,
  OrgOffboardingSummary,
  UserDataDeletionStatus,
  UserDataJobStarted,
  UserDataSummary,
} from '@marinoscar/platform-contract/user-data';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * The per-user deletion routes.
 *
 * @stability experimental
 */
export interface UserDataClient {
  /** `GET /user-data/summary`. */
  summary(): Promise<UserDataSummary>;
  /** `POST /user-data/deletions`. */
  requestDeletion(scope: string, confirmation: string): Promise<UserDataJobStarted>;
  /** `GET /user-data/deletions/:jobId`. */
  deletionStatus(jobId: string): Promise<UserDataDeletionStatus>;
}

/**
 * The factory reset routes.
 *
 * @stability experimental
 */
export interface FactoryResetClient {
  /** `GET /admin/factory-reset/summary`. */
  summary(): Promise<FactoryResetSummary>;
  /** `POST /admin/factory-reset`. */
  request(confirmation: string): Promise<UserDataJobStarted>;
  /** `GET /admin/factory-reset/:jobId`. */
  status(jobId: string): Promise<FactoryResetStatus>;
}

/**
 * The organization offboarding routes.
 *
 * @stability experimental
 */
export interface OrgOffboardingClient {
  /** `GET /admin/orgs/:orgId/offboarding/summary`. */
  summary(orgId: string): Promise<OrgOffboardingSummary>;
  /** `POST /admin/orgs/:orgId/offboarding`. */
  request(orgId: string, body: OrgOffboardingRequest): Promise<UserDataJobStarted>;
  /** `GET /admin/orgs/:orgId/offboarding/:jobId`. */
  status(orgId: string, jobId: string): Promise<OrgOffboardingStatus>;
}

/**
 * The per-user deletion client.
 *
 * @param api - the app's transport (`usePlatformApi()`).
 * @stability experimental
 */
export function createUserDataClient(api: PlatformApiClient): UserDataClient {
  return {
    summary: () => api.get<UserDataSummary>(USER_DATA_PATHS.summary),
    requestDeletion: (scope, confirmation) => api.post<UserDataJobStarted>(USER_DATA_PATHS.deletions, { scope, confirmation }),
    deletionStatus: (jobId) => api.get<UserDataDeletionStatus>(`${USER_DATA_PATHS.deletions}/${encodeURIComponent(jobId)}`),
  };
}

/**
 * The factory reset client.
 *
 * @param api - the app's transport.
 * @stability experimental
 */
export function createFactoryResetClient(api: PlatformApiClient): FactoryResetClient {
  const base = USER_DATA_PATHS.factoryReset;
  return {
    summary: () => api.get<FactoryResetSummary>(`${base}/summary`),
    request: (confirmation) => api.post<UserDataJobStarted>(base, { confirmation }),
    status: (jobId) => api.get<FactoryResetStatus>(`${base}/${encodeURIComponent(jobId)}`),
  };
}

/**
 * The organization offboarding client.
 *
 * @param api - the app's transport.
 * @stability experimental
 */
export function createOrgOffboardingClient(api: PlatformApiClient): OrgOffboardingClient {
  return {
    summary: (orgId) => api.get<OrgOffboardingSummary>(`${USER_DATA_PATHS.offboarding(orgId)}/summary`),
    request: (orgId, body) => api.post<UserDataJobStarted>(USER_DATA_PATHS.offboarding(orgId), body),
    status: (orgId, jobId) => api.get<OrgOffboardingStatus>(`${USER_DATA_PATHS.offboarding(orgId)}/${encodeURIComponent(jobId)}`),
  };
}

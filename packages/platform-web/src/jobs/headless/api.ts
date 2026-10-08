// =============================================================================
// The jobs slice's API client (issue #854)
// =============================================================================
//
// Every admin route of the job queue and the worker fleet the packaged pages
// call, over the app's transport (`PlatformApiClient` of
// `@marinoscar/platform-web/core`), so the auth header, the token refresh and
// the app's error handling stay the app's. Moved from the reference app's
// `services/jobs.ts` (#266) and `services/nodes.ts` (#271); the paths and
// query strings are byte-identical.
//
// THE FLEET ROUTES ARE ON TWO PREFIXES, AND THAT IS NOT AN ACCIDENT. Five are
// under `/admin/nodes`; minting a credential is `POST /node-credentials`.
// `JwtAuthGuard` admits a `nod_` worker credential on `/api/nodes` and nothing
// else (#267): `admin/nodes` publishes other operators' email addresses and
// deletes other people's nodes, and a worker token that could reach its own
// minting endpoint could grow a replacement for the one just revoked. A path
// "corrected" here to look consistent either 404s or moves an admin action
// inside the worker-token blast radius.
//
// THERE IS NO `sortBy`. `GET /admin/jobs` orders by `createdAt DESC` and
// offers nothing else (a sortable column set needs an index per column at the
// sizes a queue reaches), and `GET /admin/nodes` returns the whole fleet
// ordered by name, unpaginated.
// =============================================================================

import type { PlatformApiClient } from '../../core/index.js';
import type {
  CreateNodeCredentialInput,
  Job,
  JobInsights,
  JobListParams,
  JobListResponse,
  JobStats,
  NodeCredential,
  NodeCredentialCreated,
  ResetHistoryResult,
  ResetStuckResult,
  RetryFailedResult,
  WorkerNode,
} from './types.js';

/**
 * Every call the jobs pages and hooks make. `createJobsApi` builds one over
 * the app's transport; a test or an app with its own client implements it.
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface JobsApi {
  /** `GET /admin/jobs` with the filters, the activity window and the page. */
  getJobs(params?: JobListParams): Promise<JobListResponse>;
  /** `GET /admin/jobs/stats`: the queue summary (cached about 2 s by the API). */
  getJobStats(): Promise<JobStats>;
  /** `POST /admin/jobs/:id/retry`. The API refuses a `running` job (400). */
  retryJob(id: string): Promise<Job>;
  /** `DELETE /admin/jobs/:id`. 400 for a `running` job; 409 when the owning feature vetoes it (show its message). */
  deleteJob(id: string): Promise<void>;
  /** `POST /admin/jobs/retry-failed`: queue-wide, up to 500 per call, optionally one type. */
  retryFailedJobs(type?: string): Promise<RetryFailedResult>;
  /** `POST /admin/jobs/reset-stuck`: the lease reaper on demand; omitted, the `jobs.stuckThresholdMinutes` setting applies. */
  resetStuckJobs(olderThanMinutes?: number): Promise<ResetStuckResult>;
  /** `GET /admin/jobs/insights`; omitted, the API's default window (7 days). */
  getJobInsights(windowDays?: number): Promise<JobInsights>;
  /** `POST /admin/jobs/insights/reset-history`: clears the lifetime rollup, no job. */
  resetJobInsightsHistory(): Promise<ResetHistoryResult>;
  /** `GET /admin/nodes`: the whole fleet with derived health and job counts. */
  getWorkerNodes(): Promise<WorkerNode[]>;
  /** `GET /admin/nodes/:id`: one node, in the list's shape. */
  getWorkerNode(id: string): Promise<WorkerNode>;
  /** `DELETE /admin/nodes/:id`: forgets the node; its jobs are released, its credential is not revoked. */
  deleteWorkerNode(id: string): Promise<void>;
  /** `GET /admin/nodes/credentials`: every credential, newest first, revoked ones included. */
  getNodeCredentials(): Promise<NodeCredential[]>;
  /** `POST /node-credentials`: mints one and returns the raw token EXACTLY ONCE. */
  createNodeCredential(input: CreateNodeCredentialInput): Promise<NodeCredentialCreated>;
  /** `DELETE /admin/nodes/credentials/:id`: effective on the node's next request; one-way. */
  revokeNodeCredential(id: string): Promise<void>;
}

/** `GET /admin/jobs`'s query string, in the app's order and omissions. */
function jobListQuery(params: JobListParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.status) query.set('status', params.status);
  if (params.type) query.set('type', params.type);
  if (params.subjectType) query.set('subjectType', params.subjectType);
  if (params.subjectId) query.set('subjectId', params.subjectId);
  // #734: one organization's jobs. Omitted, every job, system jobs included.
  if (params.orgId) query.set('orgId', params.orgId);
  // Sent as the literal string the schema's `z.enum(['true','false'])` expects,
  // and ONLY when true: `scheduled=false` means the same as omitting it.
  if (params.scheduled) query.set('scheduled', 'true');
  // `all` is the schema default, so it is omitted rather than sent.
  if (params.processedWithin && params.processedWithin !== 'all') {
    query.set('processedWithin', params.processedWithin);
  }
  return query;
}

/**
 * The jobs client over the app's transport.
 *
 * @param client - the app's {@link PlatformApiClient} (`usePlatformApi()`, or the app's own adapter).
 * @returns a {@link JobsApi} whose calls go through `client`.
 *
 * @example
 * ```ts
 * // apps/web/src/platform/jobsAdapters.ts
 * export const appJobsAdapters: JobsWebAdapters = { DataTable, Spinner: LoadingSpinner, api: createJobsApi(appPlatformApi) };
 * ```
 *
 * @stability experimental
 */
export function createJobsApi(client: PlatformApiClient): JobsApi {
  return {
    getJobs: (params = {}) => client.get<JobListResponse>(`/admin/jobs?${jobListQuery(params)}`),
    getJobStats: () => client.get<JobStats>('/admin/jobs/stats'),
    retryJob: (id) => client.post<Job>(`/admin/jobs/${id}/retry`),
    deleteJob: async (id) => {
      await client.delete<void>(`/admin/jobs/${id}`);
    },
    retryFailedJobs: (type) => client.post<RetryFailedResult>('/admin/jobs/retry-failed', type ? { type } : {}),
    // `olderThanMinutes` is OMITTED unless the caller means it, so the API
    // falls through to the `jobs.stuckThresholdMinutes` system setting: a
    // default invented here would be a second place the threshold is decided.
    resetStuckJobs: (olderThanMinutes) =>
      client.post<ResetStuckResult>(
        '/admin/jobs/reset-stuck',
        olderThanMinutes === undefined ? {} : { olderThanMinutes },
      ),
    getJobInsights: (windowDays) => {
      const query = new URLSearchParams();
      if (windowDays !== undefined) query.set('windowDays', String(windowDays));
      const suffix = query.toString();
      return client.get<JobInsights>(`/admin/jobs/insights${suffix ? `?${suffix}` : ''}`);
    },
    resetJobInsightsHistory: () => client.post<ResetHistoryResult>('/admin/jobs/insights/reset-history'),
    getWorkerNodes: () => client.get<WorkerNode[]>('/admin/nodes'),
    getWorkerNode: (id) => client.get<WorkerNode>(`/admin/nodes/${id}`),
    deleteWorkerNode: async (id) => {
      await client.delete<void>(`/admin/nodes/${id}`);
    },
    getNodeCredentials: () => client.get<NodeCredential[]>('/admin/nodes/credentials'),
    // `expiresInDays` is omitted when absent rather than sent as `undefined`
    // or `null`: its ABSENCE is what the server reads as "no expiry".
    createNodeCredential: (input) => {
      const body: CreateNodeCredentialInput = { name: input.name };
      if (input.expiresInDays !== undefined) body.expiresInDays = input.expiresInDays;
      return client.post<NodeCredentialCreated>('/node-credentials', body);
    },
    revokeNodeCredential: async (id) => {
      await client.delete<void>(`/admin/nodes/credentials/${id}`);
    },
  };
}

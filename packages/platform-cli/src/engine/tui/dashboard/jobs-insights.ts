import { ApiError } from '../../errors.js';
import type { DashboardReducer } from './source.js';

// =============================================================================
// The jobs-queue dashboard's data  (RETRO-G1.3)
// =============================================================================
//
// A generic reducer over the platform's admin jobs API
// (`GET /api/admin/jobs/stats` and `/insights`, permission `jobs:read`),
// polled with `pollFeed`. No React, no ink.
//
// The wire shapes are declared here as the structural subset a dashboard
// reads, rather than imported from the contract package, so the CLI carries no
// dependency on the jobs slice's schemas: an extra server field is ignored and
// a missing optional one renders as a dash.
// =============================================================================

/** Per-status job counts. */
export interface JobsStatusCounts {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
}

/** One job type's row of the queue summary. */
export interface JobsTypeStats {
  type: string;
  label: string;
  total: number;
  byStatus: JobsStatusCounts;
}

/**
 * `GET /api/admin/jobs/stats`.
 *
 * @stability experimental
 */
export interface JobsStats {
  total: number;
  byStatus: JobsStatusCounts;
  byType: JobsTypeStats[];
  scheduled: number;
  stuckRunning: number;
  stuckThresholdMinutes: number;
  generatedAt: string;
}

/** Duration percentiles over succeeded jobs. */
export interface JobsDurationStats {
  samples: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  throughputPerMin: number;
}

/** One type's completion estimate. */
export interface JobsEta {
  type: string;
  label: string;
  pending: number;
  running: number;
  remaining: number;
  avgMs: number;
  basis: string;
  estimatedMs: number;
}

/**
 * `GET /api/admin/jobs/insights`.
 *
 * @stability experimental
 */
export interface JobsInsights {
  windowDays: number;
  generatedAt: string;
  concurrency: number;
  live: { total: number; byStatus: JobsStatusCounts; scheduled: number; rateLimited: number; retried: number };
  history: { overall: JobsDurationStats };
  eta: JobsEta[];
}

/**
 * What one poll returns. A refusal is a result, not an exception.
 *
 * @stability experimental
 */
export type JobsPollResult =
  | { kind: 'ok'; at: string; stats: JobsStats; insights: JobsInsights }
  | { kind: 'forbidden'; at: string; message: string };

/**
 * The jobs dashboard's data.
 *
 * @stability experimental
 */
export interface JobsDashboardData {
  stats: JobsStats | undefined;
  insights: JobsInsights | undefined;
  /** When the last successful poll finished. */
  updatedAt: string | undefined;
  /** Set when the server answered 403: the caller lacks `jobs:read`. */
  forbidden: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The jobs dashboard's reducer. `hydrate` and `log` are not used by a poll;
 * a poll result replaces the previous one.
 *
 * @stability experimental
 */
export const jobsInsightsReducer: DashboardReducer<JobsDashboardData, JobsPollResult> = {
  initial: () => ({ stats: undefined, insights: undefined, updatedAt: undefined, forbidden: undefined }),
  hydrate: (state) => state,
  reduce: (state, result) =>
    result.kind === 'ok'
      ? { stats: result.stats, insights: result.insights, updatedAt: result.at, forbidden: undefined }
      : { ...state, forbidden: result.message },
  parseEvent: (frame) => {
    if (!isRecord(frame)) return undefined;
    if (frame.kind === 'ok' && isRecord(frame.stats) && isRecord(frame.insights) && typeof frame.at === 'string') {
      return frame as unknown as JobsPollResult;
    }
    if (frame.kind === 'forbidden' && typeof frame.message === 'string' && typeof frame.at === 'string') {
      return frame as unknown as JobsPollResult;
    }
    return undefined;
  },
};

/**
 * The slice of the CLI's API client the poll needs.
 *
 * @stability experimental
 */
export interface JobsApi {
  get<T>(path: string, options?: { signal?: AbortSignal | undefined; query?: Record<string, string | number | undefined> }): Promise<T>;
}

/**
 * One poll of the admin jobs API: `stats` and `insights` together.
 *
 * A 403 becomes `{ kind: 'forbidden' }` so the screen can say that the caller
 * lacks `jobs:read` and keep polling (a grant takes effect without a
 * restart); every other failure throws and the feed reports it.
 *
 * @param api - The CLI's API client (`ApiClient`).
 * @param options - `windowDays` for the percentile window; `now` for tests.
 * @returns A function suitable for `pollFeed`.
 * @stability experimental
 */
export function fetchJobsInsights(
  api: JobsApi,
  options: { windowDays?: number | undefined; now?: (() => Date) | undefined } = {},
): (signal: AbortSignal) => Promise<JobsPollResult> {
  const now = options.now ?? (() => new Date());
  return async (signal) => {
    try {
      const [stats, insights] = await Promise.all([
        api.get<JobsStats>('/admin/jobs/stats', { signal }),
        api.get<JobsInsights>('/admin/jobs/insights', { signal, query: { windowDays: options.windowDays } }),
      ]);
      return { kind: 'ok', at: now().toISOString(), stats, insights };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return {
          kind: 'forbidden',
          at: now().toISOString(),
          message: 'Your account does not have the jobs:read permission, so the queue cannot be shown.',
        };
      }
      throw error;
    }
  };
}

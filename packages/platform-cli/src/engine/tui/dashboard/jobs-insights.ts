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

/**
 * Per-status job counts.
 *
 * @stability experimental
 */
export interface JobsStatusCounts {
  /** Waiting to run. */
  pending: number;
  /** Running now. */
  running: number;
  /** Finished successfully. */
  succeeded: number;
  /** Failed for good. */
  failed: number;
}

/**
 * The part of `GET /api/admin/jobs/stats` the dashboard reads. The server
 * sends more; the rest is ignored.
 *
 * @stability experimental
 */
export interface JobsStats {
  /** Counts per status. */
  byStatus: JobsStatusCounts;
  /** Pending jobs waiting out a backoff. */
  scheduled: number;
  /** Running jobs the lease reaper would reclaim now. */
  stuckRunning: number;
  /** The age, in minutes, past which a running job counts as stuck. */
  stuckThresholdMinutes: number;
}

/**
 * One job type's completion estimate.
 *
 * @stability experimental
 */
export interface JobsEta {
  /** The type's display label. */
  label: string;
  /** Jobs waiting. */
  pending: number;
  /** Jobs running. */
  running: number;
  /** Jobs still to finish. */
  remaining: number;
  /** Estimated time to finish them, in milliseconds. */
  estimatedMs: number;
}

/**
 * The part of `GET /api/admin/jobs/insights` the dashboard reads.
 *
 * @stability experimental
 */
export interface JobsInsights {
  /** Days of history the percentiles cover. */
  windowDays: number;
  /** Duration and throughput over succeeded jobs in the window. */
  history: {
    /** All types together. */
    overall: {
      /** Jobs finished per minute. */
      throughputPerMin: number;
      /** Median duration in milliseconds; null with no samples. */
      p50Ms: number | null;
      /** 95th-percentile duration in milliseconds; null with no samples. */
      p95Ms: number | null;
    };
  };
  /** Completion estimate per type. */
  eta: JobsEta[];
}

/**
 * What one poll returns. A refusal is a result, not an exception.
 *
 * @stability experimental
 */
export type JobsPollResult =
  | {
      /** The server answered. */
      kind: 'ok';
      /** When the poll finished (ISO 8601). */
      at: string;
      /** The queue summary. */
      stats: JobsStats;
      /** Throughput and estimates. */
      insights: JobsInsights;
    }
  | {
      /** The server refused (403: no `jobs:read`). */
      kind: 'forbidden';
      /** When the poll finished (ISO 8601). */
      at: string;
      /** What to tell the user. */
      message: string;
    };

/**
 * The jobs dashboard's data.
 *
 * @stability experimental
 */
export interface JobsDashboardData {
  /** The last queue summary. */
  stats: JobsStats | undefined;
  /** The last throughput report. */
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
  /** A GET returning the unwrapped payload. */
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

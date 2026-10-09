// =============================================================================
// The jobs slice's wire types, as the browser sees them (issue #854)
// =============================================================================
//
// Moved from the reference app's `services/jobs.ts` (#266) and
// `services/nodes.ts` (#271). The job shapes are no longer hand-written
// mirrors: they are the OUTPUT types of the `@marinoscar/platform-contract/jobs`
// schemas the API's DTOs wrap (#734), so a field the API adds or makes
// nullable reaches this slice as a compile error, not as a silent `undefined`
// (`orgId` is the first field that arrived that way).
//
// The worker-fleet shapes (`WorkerNode`, `NodeCredential`, ...) moved to the
// nodes slice (`@marinoscar/platform-web/nodes/headless`, #881) and are
// re-exported from this entry for compatibility.
//
// The nullable numbers are the ones worth being careful about. `avgMs`,
// `p50Ms` and `p95Ms` are `number | null` because a type with no succeeded
// jobs in the window has no average, and a UI that renders "0 ms" states a
// measurement that was never taken. `samples` says whether the other three
// mean anything.
// =============================================================================

import type { z } from 'zod';
import type {
  JOB_REASONS,
  JobDurationStats,
  JobEtaBasis,
  JobListQuery,
  JobStatusCounts,
  JobStatusName,
  ProcessedWithin,
  jobEtaSchema,
  jobInsightsSchema,
  jobLifetimeStatsSchema,
  jobSchema,
  jobStatsSchema,
  jobTypeDurationStatsSchema,
  jobTypeStatsSchema,
  resetHistoryResultSchema,
  resetStuckResultSchema,
  retryFailedResultSchema,
} from '@marinoscar/platform-contract/jobs';

export type { JobDurationStats, JobEtaBasis, JobStatusCounts, JobStatusName, ProcessedWithin };

// ---- Jobs --------------------------------------------------------------------

/**
 * Why a job was queued: `upload`, `rerun` or `backfill`.
 *
 * @stability experimental
 */
export type JobReasonName = (typeof JOB_REASONS)[number];

/**
 * One row of `GET /api/admin/jobs` (`jobSchema`). Payloads are never included.
 * `orgId` is the organization the work belongs to, or `null` for a
 * deployment-wide (system) job such as housekeeping.
 *
 * @stability experimental
 */
export type Job = z.output<typeof jobSchema>;

/**
 * A page of the job list (`docs/API.md` flat pagination).
 *
 * @stability experimental
 */
export interface JobListResponse {
  /** This page's rows, newest first. */
  items: Job[];
  /** Rows across all pages. */
  total: number;
  /** This page, one-based. */
  page: number;
  /** The page size. */
  pageSize: number;
  /** The number of pages. */
  totalPages: number;
}

/**
 * The query `GET /api/admin/jobs` accepts (`jobListQuerySchema`), every field
 * optional. `orgId` narrows to one organization's jobs; omitted, every job is
 * listed, system jobs included.
 *
 * `scheduled: true` OVERRIDES `status` on the server (a row in backoff is
 * `pending` by definition), which is why the Jobs page never sends both.
 *
 * @stability experimental
 */
export type JobListParams = Partial<JobListQuery>;

/**
 * One row of the by-type breakdown (`jobTypeStatsSchema`).
 *
 * @stability experimental
 */
export type JobTypeStats = z.output<typeof jobTypeStatsSchema>;

/**
 * The queue summary, `GET /api/admin/jobs/stats` (`jobStatsSchema`).
 * `stuckThresholdMinutes` is the threshold `stuckRunning` was counted against,
 * so a UI never guesses it.
 *
 * @stability experimental
 */
export type JobStats = z.output<typeof jobStatsSchema>;

/**
 * One job type's duration distribution over the window.
 *
 * @stability experimental
 */
export type JobTypeDurationStats = z.output<typeof jobTypeDurationStatsSchema>;

/**
 * One job type's estimate of the outstanding work (`jobEtaSchema`); read
 * `basis` before trusting `avgMs`.
 *
 * @stability experimental
 */
export type JobEta = z.output<typeof jobEtaSchema>;

/**
 * One job type's all-time totals (`jobLifetimeStatsSchema`).
 *
 * @stability experimental
 */
export type JobLifetimeStats = z.output<typeof jobLifetimeStatsSchema>;

/**
 * Queue analytics, `GET /api/admin/jobs/insights` (`jobInsightsSchema`).
 * `windowDays` is the window actually used, after the API clamped it.
 *
 * @stability experimental
 */
export type JobInsights = z.output<typeof jobInsightsSchema>;

/**
 * The answer of `POST /api/admin/jobs/retry-failed`.
 *
 * @stability experimental
 */
export type RetryFailedResult = z.output<typeof retryFailedResultSchema>;

/**
 * The answer of `POST /api/admin/jobs/reset-stuck`.
 *
 * @stability experimental
 */
export type ResetStuckResult = z.output<typeof resetStuckResultSchema>;

/**
 * The answer of `POST /api/admin/jobs/insights/reset-history`: rollup rows
 * deleted, one per job type.
 *
 * @stability experimental
 */
export type ResetHistoryResult = z.output<typeof resetHistoryResultSchema>;

/**
 * Whether a job may be retried or deleted at all: `false` for a `running` job.
 *
 * A MIRROR of the API's refusal (`job-admin.service.ts` answers 400 for both),
 * not an independent policy: a retry would reset a row an executor is still
 * writing to, and a delete would not stop that executor.
 *
 * @param job - the row (only its `status` is read).
 * @returns `true` when the API accepts a retry or a delete.
 *
 * @stability experimental
 */
export function isJobActionable(job: Pick<Job, 'status'>): boolean {
  return job.status !== 'running';
}

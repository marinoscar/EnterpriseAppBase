// `@marinoscar/platform-contract/jobs`: the admin job routes' wire shapes,
// shared by `@marinoscar/platform-api/jobs` (its DTOs wrap these schemas) and
// the web app (types) (issue #734, PP-8.2). Documented in ./README.md.
// Explicit named exports only. constants.ts is zod-free.

export {
  DEFAULT_INSIGHTS_WINDOW_DAYS,
  JOB_ETA_BASES,
  JOB_REASONS,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  PROCESSED_WITHIN_MS,
  PROCESSED_WITHIN_VALUES,
  THROUGHPUT_WINDOW_MS,
} from './constants.js';
export type {
  JobEtaBasis,
  JobStatusName,
  ProcessedWithin,
} from './constants.js';
export {
  jobDurationStatsSchema,
  jobEtaSchema,
  jobInsightsQuerySchema,
  jobInsightsSchema,
  jobLifetimeStatsSchema,
  jobListQuerySchema,
  jobSchema,
  jobStatsSchema,
  jobStatusCountsSchema,
  jobTypeDurationStatsSchema,
  jobTypeStatsSchema,
  resetHistoryResultSchema,
  resetStuckResultSchema,
  resetStuckSchema,
  retryFailedResultSchema,
  retryFailedSchema,
} from './schemas.js';
export type {
  JobBooleanFlagEnum,
  JobDurationStats,
  JobEtaBasisEnum,
  JobInsightsQuery,
  JobListQuery,
  JobReasonEnum,
  JobStatusCounts,
  JobStatusEnum,
  ProcessedWithinEnum,
} from './schemas.js';

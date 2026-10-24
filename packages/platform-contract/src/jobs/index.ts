// `@marinoscar/platform-contract/jobs`: the admin job routes' wire shapes,
// shared by `@marinoscar/platform-api/jobs` (its DTOs wrap these schemas) and
// the web app (types) (issue #734, PP-8.2). Documented in ./README.md.
// Explicit named exports only. constants.ts is zod-free.

export {
  BUILTIN_JOB_REASONS,
  DEFAULT_INSIGHTS_WINDOW_DAYS,
  JOB_ETA_BASES,
  JOB_REASONS,
  JOB_REASON_PATTERN,
  JOB_STATUSES,
  MAX_INSIGHTS_WINDOW_DAYS,
  PROCESSED_WITHIN_MS,
  PROCESSED_WITHIN_VALUES,
  THROUGHPUT_WINDOW_MS,
} from './constants.js';
export type {
  BuiltinJobReasonName,
  JobEtaBasis,
  JobReasonName,
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
  jobReasonSchema,
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

// ---- ./settings-schemas.ts: the `jobs` system-settings namespace (#865)
export {
  jobsResponseSchema,
  jobsSettingsPatchSchema,
  jobsSettingsSchema,
  systemJobsPatchSchema,
  systemJobsSchema,
} from './settings-schemas.js';
export type { JobsSettingsPatchInput, SystemJobsValue } from './settings-schemas.js';

// ---- ./retention-schemas.ts: the `retention` system-settings namespace (#898)
export {
  BUILTIN_RETENTION_POLICY_KEYS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  RETENTION_POLICY_KEYS,
  RETENTION_POLICY_KEY_PATTERN,
  buildRetentionSchemas,
  retentionPolicyKeySchema,
  retentionPolicySchema,
  retentionResponseSchema,
  retentionSettingsPatchSchema,
  retentionSettingsSchema,
  systemRetentionPatchSchema,
  systemRetentionSchema,
} from './retention-schemas.js';
export type {
  BuiltinRetentionPolicyKey,
  RetentionPolicyKey,
  RetentionSchemaPolicy,
  RetentionSchemas,
  RetentionPolicyValue,
  RetentionSettingsPatchInput,
  SystemRetentionValue,
} from './retention-schemas.js';

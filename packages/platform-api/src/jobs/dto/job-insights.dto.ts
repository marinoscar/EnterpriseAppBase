// =============================================================================
// The queue's insights response (issue #265, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/jobs` since #734 (`schemas.ts`, section
// "From job-insights.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import type { z } from 'zod';
import {
  DEFAULT_INSIGHTS_WINDOW_DAYS,
  JOB_ETA_BASES,
  MAX_INSIGHTS_WINDOW_DAYS,
  THROUGHPUT_WINDOW_MS,
  jobDurationStatsSchema,
  jobEtaSchema,
  jobInsightsQuerySchema,
  jobInsightsSchema,
  jobLifetimeStatsSchema,
  jobTypeDurationStatsSchema,
  resetHistoryResultSchema,
} from '@marinoscar/platform-contract/jobs';
import type {
  JobDurationStats,
  JobEtaBasis,
  JobInsightsQuery,
} from '@marinoscar/platform-contract/jobs';

// The wire schemas live in @marinoscar/platform-contract/jobs since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  DEFAULT_INSIGHTS_WINDOW_DAYS,
  MAX_INSIGHTS_WINDOW_DAYS,
  THROUGHPUT_WINDOW_MS,
  jobInsightsQuerySchema,
  jobDurationStatsSchema,
  jobTypeDurationStatsSchema,
  JOB_ETA_BASES,
  jobEtaSchema,
  jobLifetimeStatsSchema,
  jobInsightsSchema,
  resetHistoryResultSchema,
};
export type {
  JobInsightsQuery,
  JobDurationStats,
  JobEtaBasis,
};

/**
 * The service's own return type: identical, but with `Date`s where the wire has strings.
 *
 * @stability experimental
 */
export type JobInsightsResult = Omit<
  z.output<typeof jobInsightsSchema>,
  'generatedAt' | 'history'
> & {
  /** When every number was taken. */
  generatedAt: Date;
  /** The windowed history, its two instants as `Date`s. */
  history: Omit<
    z.output<typeof jobInsightsSchema>['history'],
    'windowStart' | 'throughputSince'
  > & {
    /** Where the window starts. */
    windowStart: Date;
    /** Where the throughput sub-window starts. */
    throughputSince: Date;
  };
};

export class JobInsightsQueryDto extends createZodDto(jobInsightsQuerySchema) {}
export class JobInsightsDto extends createZodDto(jobInsightsSchema) {}
export class ResetHistoryResultDto extends createZodDto(resetHistoryResultSchema) {}

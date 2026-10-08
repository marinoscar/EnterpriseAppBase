// =============================================================================
// The queue's summary (issue #264, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/jobs` since #734 (`schemas.ts`, section
// "From job-stats.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import type { z } from 'zod';
import {
  jobStatsSchema,
  jobStatusCountsSchema,
  jobTypeStatsSchema,
} from '@marinoscar/platform-contract/jobs';
import type {
  JobStatusCounts,
} from '@marinoscar/platform-contract/jobs';

// The wire schemas live in @marinoscar/platform-contract/jobs since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  jobStatusCountsSchema,
  jobTypeStatsSchema,
  jobStatsSchema,
};
export type {
  JobStatusCounts,
};

/** The service's own return type: identical, but with `generatedAt` as a `Date`. */
export type JobStatsResult = Omit<z.output<typeof jobStatsSchema>, 'generatedAt'> & {
  generatedAt: Date;
};

export class JobStatsDto extends createZodDto(jobStatsSchema) {}

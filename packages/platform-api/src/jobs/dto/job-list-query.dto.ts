// =============================================================================
// The job list's filters (issue #264, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/jobs` since #734 (`schemas.ts`, section
// "From job-list-query.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import {
  PROCESSED_WITHIN_MS,
  PROCESSED_WITHIN_VALUES,
  jobListQuerySchema,
} from '@marinoscar/platform-contract/jobs';
import type {
  JobListQuery,
  ProcessedWithin,
} from '@marinoscar/platform-contract/jobs';

// The wire schemas live in @marinoscar/platform-contract/jobs since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  PROCESSED_WITHIN_VALUES,
  PROCESSED_WITHIN_MS,
  jobListQuerySchema,
};
export type {
  ProcessedWithin,
  JobListQuery,
};

export class JobListQueryDto extends createZodDto(jobListQuerySchema) {}

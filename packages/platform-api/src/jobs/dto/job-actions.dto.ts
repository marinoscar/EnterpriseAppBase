// =============================================================================
// The bodies and results of the four job actions (issue #264, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/jobs` since #734 (`schemas.ts`, section
// "From job-actions.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import {
  resetStuckResultSchema,
  resetStuckSchema,
  retryFailedResultSchema,
  retryFailedSchema,
} from '@marinoscar/platform-contract/jobs';

// The wire schemas live in @marinoscar/platform-contract/jobs since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  retryFailedSchema,
  resetStuckSchema,
  retryFailedResultSchema,
  resetStuckResultSchema,
};

export class RetryFailedDto extends createZodDto(retryFailedSchema) {}
export class ResetStuckDto extends createZodDto(resetStuckSchema) {}
export class RetryFailedResultDto extends createZodDto(retryFailedResultSchema) {}
export class ResetStuckResultDto extends createZodDto(resetStuckResultSchema) {}

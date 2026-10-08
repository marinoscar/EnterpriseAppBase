// =============================================================================
// One `jobs` row, as the admin API publishes it (issue #264, epic #254)
//
// The wire schemas, and the design notes that used to sit here, live in
// `@marinoscar/platform-contract/jobs` since #734 (`schemas.ts`, section
// "From job-response.dto.ts"). This file wraps them with `createZodDto`, which is how
// they reach the OpenAPI document and the global `ZodValidationPipe`.
// =============================================================================

import { JobReason, JobStatus } from '../data/jobs-db';
import { createZodDto } from 'nestjs-zod';
import {
  JOB_REASONS,
  JOB_STATUSES,
  jobSchema,
} from '@marinoscar/platform-contract/jobs';
import type {
  JobStatusName,
} from '@marinoscar/platform-contract/jobs';

// The wire schemas live in @marinoscar/platform-contract/jobs since #734; re-exported under
// their old names so every import inside the slice is unchanged.
export {
  JOB_STATUSES,
  JOB_REASONS,
  jobSchema,
};
export type {
  JobStatusName,
};

/**
 * `never` unless every member of `Enum` appears in `Listed`.
 *
 * Used only as the constraint on the two assertions below; it has no runtime
 * form on purpose, so the check costs nothing at import time.
 */
type Exhaustive<Enum extends string, Listed extends string> = [
  Exclude<Enum, Listed>,
] extends [never]
  ? true
  : never;

// Fails to compile if `schema.prisma` gains a status or a reason that the
// tuples above do not list.
export type JobStatusesAreExhaustive = Exhaustive<JobStatus, JobStatusName>;

export type JobReasonsAreExhaustive = Exhaustive<
  JobReason,
  (typeof JOB_REASONS)[number]
>;

// And the other direction, which `satisfies readonly JobStatus[]` checked
// while the tuples lived here: the contract lists nothing the schema lacks.
export type JobStatusesAreKnown = Exhaustive<JobStatusName, JobStatus>;
export type JobReasonsAreKnown = Exhaustive<(typeof JOB_REASONS)[number], JobReason>;

/** Fails to compile when any of the four checks above resolves to `never` (#734). */
export const JOB_ENUMS_MATCH_SCHEMA = true satisfies JobStatusesAreExhaustive &
  JobReasonsAreExhaustive &
  JobStatusesAreKnown &
  JobReasonsAreKnown;

export class JobDto extends createZodDto(jobSchema) {}

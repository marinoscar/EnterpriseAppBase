// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { STORAGE_BUCKET_OUTCOMES, STORAGE_BUCKET_STEP_IDS, STORAGE_BUCKET_STEP_STATUSES, guidedBucketInstructionsSchema, provisionStorageBucketSchema, storageBucketProvisionResultSchema, storageBucketStepSchema } from '@marinoscar/platform-contract/storage';

export { STORAGE_BUCKET_OUTCOMES, STORAGE_BUCKET_STEP_IDS, STORAGE_BUCKET_STEP_STATUSES, guidedBucketInstructionsSchema, provisionStorageBucketSchema, storageBucketProvisionResultSchema, storageBucketStepSchema };
export type { ProvisionStorageBucketInput, StorageBucketOutcome, StorageBucketProvisionResult, StorageBucketStep, StorageBucketStepId } from '@marinoscar/platform-contract/storage';

/**
 * `provisionStorageBucketSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body or response.
 *
 * @stability experimental
 */
export class ProvisionStorageBucketDto extends createZodDto(provisionStorageBucketSchema) {}

/**
 * `storageBucketProvisionResultSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body or response.
 *
 * @stability experimental
 */
export class StorageBucketProvisionResultDto extends createZodDto(storageBucketProvisionResultSchema) {}

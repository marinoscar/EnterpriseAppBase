// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { completeUploadSchema } from '@marinoscar/platform-contract/storage';

export { completeUploadSchema };
export type { CompleteUploadDto } from '@marinoscar/platform-contract/storage';

/**
 * `completeUploadSchema` as a Nest DTO.
 *
 * @internal
 *
 * @stability experimental
 */
export class CompleteUploadBodyDto extends createZodDto(completeUploadSchema) {}

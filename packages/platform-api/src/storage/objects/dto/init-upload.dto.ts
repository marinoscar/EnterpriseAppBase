// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { initUploadResponseSchema, initUploadSchema } from '@marinoscar/platform-contract/storage';

export { initUploadResponseSchema, initUploadSchema };
export type { InitUploadDto } from '@marinoscar/platform-contract/storage';

/**
 * `initUploadSchema` as a Nest DTO.
 *
 * @internal
 *
 * @stability experimental
 */
export class InitUploadBodyDto extends createZodDto(initUploadSchema) {}

/**
 * `initUploadResponseSchema` as a Nest DTO.
 *
 * @internal
 *
 * @stability experimental
 */
export class InitUploadResponseDto extends createZodDto(initUploadResponseSchema) {}

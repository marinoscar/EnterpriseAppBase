// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { storageConfigResponseSchema, storageSecretStatusSchema } from '@marinoscar/platform-contract/storage';

export { storageConfigResponseSchema, storageSecretStatusSchema };
export type { StorageConfigResponse } from '@marinoscar/platform-contract/storage';

/**
 * `storageConfigResponseSchema` as a Nest DTO.
 *
 * @internal
 *
 * @stability experimental
 */
export class StorageConfigResponseDto extends createZodDto(storageConfigResponseSchema) {}

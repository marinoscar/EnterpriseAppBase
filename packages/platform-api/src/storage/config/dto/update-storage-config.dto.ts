// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { STORAGE_SWITCH_CONFIRMATION, updateStorageConfigSchema } from '@marinoscar/platform-contract/storage';

export { STORAGE_SWITCH_CONFIRMATION, updateStorageConfigSchema };
export type { UpdateStorageConfigInput } from '@marinoscar/platform-contract/storage';

/**
 * `updateStorageConfigSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body or response.
 *
 * @stability experimental
 */
export class UpdateStorageConfigDto extends createZodDto(updateStorageConfigSchema) {}

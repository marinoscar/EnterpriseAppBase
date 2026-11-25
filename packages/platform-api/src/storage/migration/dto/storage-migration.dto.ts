import { createZodDto } from 'nestjs-zod';
import {
  startStorageMigrationSchema,
  storageMigrationListQuerySchema,
  storageMigrationRunListSchema,
  storageMigrationRunSchema,
} from '@marinoscar/platform-contract/storage';

export { startStorageMigrationSchema, storageMigrationListQuerySchema, storageMigrationRunListSchema, storageMigrationRunSchema };
export type {
  StartStorageMigrationInput,
  StorageMigrationListQuery,
  StorageMigrationRun,
  StorageMigrationRunList,
} from '@marinoscar/platform-contract/storage';

/**
 * `startStorageMigrationSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body.
 *
 * @stability experimental
 */
export class StartStorageMigrationDto extends createZodDto(startStorageMigrationSchema) {}

/**
 * `storageMigrationRunSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component of one run.
 *
 * @stability experimental
 */
export class StorageMigrationRunDto extends createZodDto(storageMigrationRunSchema) {}

/**
 * `storageMigrationRunListSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component of one page of runs.
 *
 * @stability experimental
 */
export class StorageMigrationRunListDto extends createZodDto(storageMigrationRunListSchema) {}

// The wire schemas live in `@marinoscar/platform-contract/storage` (#736),
// with their design notes; this file wraps them as Nest DTOs (the OpenAPI
// component names are these class names) and re-exports them under their
// old names, so no import in the slice changed.

import { createZodDto } from 'nestjs-zod';
import { STORAGE_TEST_CHECK_CODES, STORAGE_TEST_CHECK_IDS, STORAGE_TEST_CHECK_STATUSES, storageConnectionCheckSchema, storageConnectionTestResultSchema, testStorageConfigSchema } from '@marinoscar/platform-contract/storage';

export { STORAGE_TEST_CHECK_CODES, STORAGE_TEST_CHECK_IDS, STORAGE_TEST_CHECK_STATUSES, storageConnectionCheckSchema, storageConnectionTestResultSchema, testStorageConfigSchema };
export type { StorageConnectionCheck, StorageConnectionTestResult, StorageTestCheckId, TestStorageConfigInput } from '@marinoscar/platform-contract/storage';

/**
 * `testStorageConfigSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body or response.
 *
 * @stability experimental
 */
export class TestStorageConfigDto extends createZodDto(testStorageConfigSchema) {}

/**
 * `storageConnectionTestResultSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body or response.
 *
 * @stability experimental
 */
export class StorageConnectionTestResultDto extends createZodDto(storageConnectionTestResultSchema) {}

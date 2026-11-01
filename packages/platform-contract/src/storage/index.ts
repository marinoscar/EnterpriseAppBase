// `@marinoscar/platform-contract/storage`: the storage slice's wire shapes,
// shared by `@marinoscar/platform-api/storage` (its DTOs wrap these schemas)
// and `@marinoscar/platform-web/storage` (types) (issue #736, PP-8.3): the
// objects API, the storage-config admin routes, `GET /api/storage/status` and
// the `storage` system-settings namespace. Documented in ./README.md.
// Explicit named exports only. constants.ts is zod-free.

export {
  BUILTIN_STORAGE_PROVIDER_KINDS,
  LEGACY_STORAGE_FLAT_FIELDS,
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_DRIVER_ID_PATTERN,
  STORAGE_OBJECT_STATUSES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SECRET_FIELD_NAMES,
} from './constants.js';
export type { BuiltinStorageProviderKind, StorageEnum, StorageObjectStatusName, StorageProviderKind } from './constants.js';

// ---- the `storage` system-settings namespace --------------------------------------------
export {
  STORAGE_SETTINGS_CARRIES_NO_SECRET,
  storageDriverIdSchema,
  storageDriverSettingsSchema,
  storageDriversPatchSchema,
  storageDriversSchema,
  storageResponseSchema,
  storageSettingsPatchSchema,
  storageSettingsSchema,
  systemStoragePatchSchema,
  systemStorageSchema,
} from './schemas.js';
export type {
  StorageSettingsCarriesNoSecret,
  StorageSettingsInput,
  StorageSettingsPatchInput,
  StorageSettingsResponse,
  SystemStoragePatchValue,
  SystemStorageValue,
} from './schemas.js';

// ---- the objects API (`/api/storage/objects`) and `/api/storage/status` ------------------
export { completeUploadSchema } from './schemas.js';
export type { CompleteUploadDto } from './schemas.js';
export { downloadUrlResponseSchema } from './schemas.js';
export type { DownloadUrlResponse } from './schemas.js';
export { initUploadResponseSchema, initUploadSchema } from './schemas.js';
export type { InitUploadDto, InitUploadResponse } from './schemas.js';
export { objectListQuerySchema } from './schemas.js';
export type { ObjectListQueryDto, ObjectListResponse } from './schemas.js';
export { objectResponseSchema, uploadStatusResponseSchema } from './schemas.js';
export type { ObjectResponse, UploadStatusResponse } from './schemas.js';
export { updateMetadataSchema } from './schemas.js';
export type { UpdateMetadataDto } from './schemas.js';
export { storageStatusResponseSchema } from './schemas.js';
export type { StorageStatusResponse } from './schemas.js';

// ---- the storage-config admin routes (`/api/admin/storage-config`) -----------------------
export { STORAGE_SWITCH_CONFIRMATION, updateStorageConfigSchema } from './schemas.js';
export type { UpdateStorageConfigInput } from './schemas.js';
export { storageConfigResponseSchema, storageSecretStatusSchema } from './schemas.js';
export type { StorageConfigResponse } from './schemas.js';
export {
  STORAGE_TEST_CHECK_CODES,
  STORAGE_TEST_CHECK_IDS,
  STORAGE_TEST_CHECK_STATUSES,
  storageConnectionCheckSchema,
  storageConnectionTestResultSchema,
  testStorageConfigSchema,
} from './schemas.js';
export type {
  StorageConnectionCheck,
  StorageConnectionTestResult,
  StorageTestCheckId,
  TestStorageConfigInput,
} from './schemas.js';
export {
  STORAGE_BUCKET_OUTCOMES,
  STORAGE_BUCKET_STEP_IDS,
  STORAGE_BUCKET_STEP_STATUSES,
  guidedBucketInstructionsSchema,
  provisionStorageBucketSchema,
  storageBucketProvisionResultSchema,
  storageBucketStepSchema,
} from './schemas.js';
export type {
  ProvisionStorageBucketInput,
  StorageBucketOutcome,
  StorageBucketProvisionResult,
  StorageBucketStep,
  StorageBucketStepId,
} from './schemas.js';

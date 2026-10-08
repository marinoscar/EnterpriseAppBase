// `@marinoscar/platform-contract/storage`: the storage slice's wire shapes,
// shared by `@marinoscar/platform-api/storage` (its DTOs wrap these schemas)
// and `@marinoscar/platform-web/storage` (types) (issue #736, PP-8.3): the
// objects API, the storage-config admin routes, `GET /api/storage/status` and
// the `storage` system-settings namespace. Documented in ./README.md.
// Explicit named exports only. constants.ts is zod-free.

export {
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_OBJECT_STATUSES,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SECRET_FIELD_NAMES,
} from './constants.js';
export type { StorageObjectStatusName, StorageProviderKind } from './constants.js';

// ---- the `storage` system-settings namespace --------------------------------------------
export {
  STORAGE_SETTINGS_CARRIES_NO_SECRET,
  storageResponseSchema,
  storageSettingsPatchSchema,
  storageSettingsSchema,
  systemStoragePatchSchema,
  systemStorageSchema,
} from './settings-schemas.js';
export type {
  StorageSettingsCarriesNoSecret,
  StorageSettingsInput,
  StorageSettingsPatchInput,
  StorageSettingsResponse,
  SystemStoragePatchValue,
  SystemStorageValue,
} from './settings-schemas.js';

// ---- the objects API (`/api/storage/objects`) and `/api/storage/status` ------------------
export { completeUploadSchema } from './objects-complete-upload.js';
export type { CompleteUploadDto } from './objects-complete-upload.js';
export { downloadUrlResponseSchema } from './objects-download-url.js';
export type { DownloadUrlResponse } from './objects-download-url.js';
export { initUploadResponseSchema, initUploadSchema } from './objects-init-upload.js';
export type { InitUploadDto, InitUploadResponse } from './objects-init-upload.js';
export { objectListQuerySchema } from './objects-list-query.js';
export type { ObjectListQueryDto, ObjectListResponse } from './objects-list-query.js';
export { objectResponseSchema, uploadStatusResponseSchema } from './objects-object-response.js';
export type { ObjectResponse, UploadStatusResponse } from './objects-object-response.js';
export { updateMetadataSchema } from './objects-update-metadata.js';
export type { UpdateMetadataDto } from './objects-update-metadata.js';
export { storageStatusResponseSchema } from './storage-status.js';
export type { StorageStatusResponse } from './storage-status.js';

// ---- the storage-config admin routes (`/api/admin/storage-config`) -----------------------
export { STORAGE_SWITCH_CONFIRMATION, updateStorageConfigSchema } from './storage-config-update.js';
export type { UpdateStorageConfigInput } from './storage-config-update.js';
export { storageConfigResponseSchema, storageSecretStatusSchema } from './storage-config-response.js';
export type { StorageConfigResponse } from './storage-config-response.js';
export {
  STORAGE_TEST_CHECK_CODES,
  STORAGE_TEST_CHECK_IDS,
  STORAGE_TEST_CHECK_STATUSES,
  storageConnectionCheckSchema,
  storageConnectionTestResultSchema,
  testStorageConfigSchema,
} from './storage-connection-test.js';
export type {
  StorageConnectionCheck,
  StorageConnectionTestResult,
  StorageTestCheckId,
  TestStorageConfigInput,
} from './storage-connection-test.js';
export {
  STORAGE_BUCKET_OUTCOMES,
  STORAGE_BUCKET_STEP_IDS,
  STORAGE_BUCKET_STEP_STATUSES,
  guidedBucketInstructionsSchema,
  provisionStorageBucketSchema,
  storageBucketProvisionResultSchema,
  storageBucketStepSchema,
} from './storage-bucket-provision.js';
export type {
  ProvisionStorageBucketInput,
  StorageBucketOutcome,
  StorageBucketProvisionResult,
  StorageBucketStep,
  StorageBucketStepId,
} from './storage-bucket-provision.js';

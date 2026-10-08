// `@marinoscar/platform-web/storage/headless`: the storage slice's hook and
// clients, with no component (issue #736, PP-8.3): `useStorageConfig` (the
// admin configuration), the storage-config client and the objects client
// (simple and resumable upload, download URL, status). Documented in
// ../README.md.

export { useStorageConfig } from './use-storage-config.js';
export type { StorageSwitchRequired, UseStorageConfigOptions, UseStorageConfigReturn } from './use-storage-config.js';
export {
  MISSING_STORAGE_CONFIG_FIELDS,
  STORAGE_BUCKET_OUTCOMES,
  STORAGE_BUCKET_STEP_IDS,
  STORAGE_BUCKET_STEP_STATUSES,
  STORAGE_LOCATION_IN_USE_CODE,
  STORAGE_PROVIDER_KINDS,
  STORAGE_SWITCH_CONFIRMATION,
  STORAGE_TEST_CHECK_CODES,
  STORAGE_TEST_CHECK_IDS,
  STORAGE_TEST_CHECK_STATUSES,
  createStorageConfigClient,
  reportsBucketMissing,
} from './storage-config.js';
export type {
  GuidedBucketInstructions,
  MissingStorageConfigField,
  StorageBucketOutcome,
  StorageBucketProvisionResult,
  StorageBucketStep,
  StorageBucketStepId,
  StorageBucketStepStatus,
  StorageConfigClient,
  StorageConfigInput,
  StorageConfigView,
  StorageConnectionCheck,
  StorageConnectionTestResult,
  StorageLocation,
  StorageLocationInUseDetails,
  StorageProviderKind,
  StorageSecretStatus,
  StorageTestCheckCode,
  StorageTestCheckId,
  StorageTestCheckStatus,
} from './storage-config.js';
export { StorageObjectNotReadyError, createStorageObjectsClient } from './objects-client.js';
export type {
  StorageDownloadUrl,
  StorageObject,
  StorageObjectStatus,
  StorageObjectsClient,
  StorageObjectsTransport,
  WaitForReadyOptions,
} from './objects-client.js';

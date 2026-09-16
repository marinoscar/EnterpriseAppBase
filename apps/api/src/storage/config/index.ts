/**
 * Storage configuration barrel (#373, epic #372).
 *
 * The runtime storage configuration: the pure rules that decide whether a
 * deployment has usable object storage, the service that gathers the two halves
 * behind them, and the 503 raised when it does not.
 */

export {
  R2_ENDPOINT_HOST_SUFFIX,
  R2_DEFAULT_REGION,
  S3_COMPATIBLE_DEFAULT_REGION,
  deriveR2Endpoint,
  describeStorageConfig,
  fingerprintStorageConfig,
  resolveStorageConfig,
} from './storage-config';
export type {
  MissingStorageConfigField,
  ResolvedStorageConfig,
  StorageConfigResolution,
} from './storage-config';
export {
  StorageConfigService,
  STORAGE_POLICY_CACHE_MS,
} from './storage-config.service';
export {
  StorageNotConfiguredError,
  STORAGE_SETTINGS_PATH,
} from './storage-not-configured.error';
export type { StorageNotConfiguredReason } from './storage-not-configured.error';

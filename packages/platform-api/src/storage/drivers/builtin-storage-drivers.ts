// =============================================================================
// The built-in storage drivers, registered (PP-14.7, #925)
// =============================================================================
//
// `s3`, `r2` and `s3compatible` register through `registerStorageDriver`, the
// same function an app uses, at import time and in the order the admin page
// lists them. Anything that reads the registry (the `storage` settings
// namespace, the config services) imports this file first, so the built-ins are
// always there regardless of which entry point loaded the slice.
//
// IDEMPOTENT ACROSS DUPLICATE MODULE INSTANCES: a driver already registered is
// skipped, so two copies of this file (a bundler, a test double) cannot make
// the second registration throw `DUPLICATE_ID`. The registry is frozen once the
// application bootstraps, and nothing registers after that.
// =============================================================================

import { r2StorageDriver, s3CompatibleStorageDriver, s3StorageDriver } from './s3/s3-family';
import { registerStorageDriver, storageDriverKind, type StorageDriverDefinition } from './storage-driver';

/**
 * The built-in drivers, in registration (and admin page) order.
 *
 * @stability experimental
 */
export const BUILTIN_STORAGE_DRIVERS: readonly StorageDriverDefinition<any>[] = Object.freeze([
  s3StorageDriver,
  r2StorageDriver,
  s3CompatibleStorageDriver,
]);

for (const driver of BUILTIN_STORAGE_DRIVERS) {
  if (!storageDriverKind.has(driver.id)) registerStorageDriver(driver);
}

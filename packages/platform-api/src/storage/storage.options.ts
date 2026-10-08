// =============================================================================
// StorageModule.forRoot() options (issue #736, PP-8.3)
// =============================================================================
//
// DEPLOYMENT TUNING ONLY. Which provider, bucket, region, endpoint and
// credential are the `storage` system-settings namespace plus the credential
// store, edited at `/admin/settings/storage` with no restart; none of them is
// an option here and none ever may be (CLAUDE.md: never `STORAGE_PROVIDER`,
// `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`). The defaults are today's values.
// =============================================================================

import type { ModuleMetadata } from '@nestjs/common';

/**
 * Injection token of the resolved {@link StorageModuleOptions}. Optional to
 * every consumer: without it the shipped defaults apply.
 *
 * @stability experimental
 */
export const STORAGE_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/storage/OPTIONS');

/**
 * The simple-upload ceiling (`POST /api/storage/objects`): 100 MiB. The app's
 * multipart plugin caps the route at `min(this, storage.maxFileSize)`.
 *
 * @stability stable
 */
export const DEFAULT_MAX_SIMPLE_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * The multipart part size used when neither the option nor the deployment's
 * `storage.partSize` (`STORAGE_PART_SIZE`) says otherwise: 10 MiB.
 *
 * @stability stable
 */
export const DEFAULT_STORAGE_PART_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * How long an unfinished upload is left alone before the stale-upload sweep
 * reclaims it: 24 hours.
 *
 * @stability stable
 */
export const DEFAULT_STALE_UPLOAD_HOURS = 24;

/**
 * Options of `StorageModule.forRoot()`. Every field is optional.
 *
 * @stability experimental
 */
export interface StorageModuleOptions {
  /** Max simple-upload size in bytes. Default {@link DEFAULT_MAX_SIMPLE_UPLOAD_BYTES}. */
  maxSimpleUploadBytes?: number;
  /**
   * Multipart part size in bytes (at least 5 MiB, the S3 minimum). Default:
   * the deployment's `storage.partSize` (`STORAGE_PART_SIZE`), else
   * {@link DEFAULT_STORAGE_PART_SIZE_BYTES}.
   */
  partSizeBytes?: number;
  /** Stale-upload cleanup threshold in hours. Default {@link DEFAULT_STALE_UPLOAD_HOURS}. */
  staleUploadHours?: number;
  /**
   * Modules to import next to the slice: typically the app's `@Global()` host
   * module binding `STORAGE_SYSTEM_DATA`.
   */
  imports?: ModuleMetadata['imports'];
}

/**
 * {@link StorageModuleOptions} with every default applied (`partSizeBytes`
 * stays optional: absent means "the deployment's `storage.partSize`").
 *
 * @stability experimental
 */
export interface ResolvedStorageModuleOptions {
  /** The simple-upload ceiling in bytes. */
  readonly maxSimpleUploadBytes: number;
  /** The part size override, when set. */
  readonly partSizeBytes?: number;
  /** The stale-upload threshold in hours. */
  readonly staleUploadHours: number;
  /** The modules imported next to the slice. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
}

function positive(name: string, value: number | undefined, min = 1): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`StorageModule.forRoot(): ${name} must be a finite number >= ${min} (got ${String(value)})`);
  }
}

/**
 * Validates `options` and applies the defaults.
 *
 * @param options - what the app passed.
 * @returns the resolved options (frozen).
 * @throws Error when a value is not a positive finite number, or `partSizeBytes` is below 5 MiB.
 *
 * @stability experimental
 */
export function resolveStorageModuleOptions(options: StorageModuleOptions = {}): ResolvedStorageModuleOptions {
  positive('maxSimpleUploadBytes', options.maxSimpleUploadBytes);
  positive('partSizeBytes', options.partSizeBytes, 5 * 1024 * 1024);
  positive('staleUploadHours', options.staleUploadHours);
  return Object.freeze({
    maxSimpleUploadBytes: options.maxSimpleUploadBytes ?? DEFAULT_MAX_SIMPLE_UPLOAD_BYTES,
    ...(options.partSizeBytes !== undefined ? { partSizeBytes: options.partSizeBytes } : {}),
    staleUploadHours: options.staleUploadHours ?? DEFAULT_STALE_UPLOAD_HOURS,
    imports: [...(options.imports ?? [])],
  });
}

/**
 * The `fileSize` limit the app's multipart plugin registers for the simple
 * upload route: `min(maxSimpleUploadBytes, maxFileSize)`, or the ceiling
 * alone when the deployment's `storage.maxFileSize` is unusable.
 *
 * @param maxFileSize - the deployment's `storage.maxFileSize`.
 * @param ceiling - `maxSimpleUploadBytes`.
 * @returns the byte limit.
 *
 * @stability experimental
 */
export function simpleUploadFileSizeLimit(maxFileSize: unknown, ceiling: number = DEFAULT_MAX_SIMPLE_UPLOAD_BYTES): number {
  return typeof maxFileSize === 'number' && Number.isFinite(maxFileSize) && maxFileSize > 0
    ? Math.min(ceiling, maxFileSize)
    : ceiling;
}

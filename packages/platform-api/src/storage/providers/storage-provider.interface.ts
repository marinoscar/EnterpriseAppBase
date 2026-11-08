import { Readable } from 'node:stream';
import {
  StorageSizeUnsupportedError,
  StorageDeleteManyResult,
  StorageUploadOptions,
  StorageUploadResult,
  MultipartUploadInit,
  UploadPart,
  SignedUrlOptions,
  SignedPutUrlOptions,
  StoragePartUploadMode,
  StoredPart,
  UploadedPart,
} from './storage-provider.types';

/**
 * Injection token of the object store every storage consumer injects.
 *
 * By default `StorageProvidersModule` binds it to `ResolvingStorageProvider`:
 * the S3 driver, configured per call from the `storage` settings namespace
 * and the credential store (`s3`, `r2`, `s3compatible`). RUNG 3: an app with
 * a non-S3 backend (Azure Blob, a local disk) hands its own
 * {@link StorageProvider} to `StorageModule.forRoot({ provider })`, and every
 * package consumer receives it. There is deliberately no driver registry
 * until a consumer needs one.
 *
 * ⚠ Do NOT provide this token in an app module: every package module imports
 * `StorageProvidersModule`, and Nest resolves a token from the consuming
 * module's own imports first, so an app-level provider is never seen by them.
 *
 * A `Symbol.for(...)` key, so two copies of the package agree.
 *
 * @example
 * ```ts
 * export const StorageModule = PlatformStorageModule.forRoot({
 *   imports: [StorageHostModule],
 *   provider: { useClass: AzureBlobStorageProvider },
 * });
 * ```
 *
 * @extensionPoint token
 * @stability stable
 */
export const STORAGE_PROVIDER: unique symbol = Symbol.for('@marinoscar/platform/storage/STORAGE_PROVIDER');

/**
 * Abstract interface for file storage providers
 * Supports both simple uploads and multipart resumable uploads
 *
 * @stability stable
 */
export interface StorageProvider {
  /**
   * The id of the backend this provider talks to: what the platform writes to
   * `storage_objects.storage_provider` and to `database_backup_runs.storage_provider`
   * for every object this provider takes. The built-ins answer `'s3'`, `'r2'` or
   * `'s3compatible'` (the configured kind); an app backend picks a stable
   * lowercase id of its own (`'azure-blob'`, `'local-disk'`).
   *
   * Synchronous by interface, like {@link StorageProvider.getBucket}: a
   * provider whose answer depends on configuration read asynchronously
   * answers from its last known configuration.
   */
  readonly kind: string;

  /**
   * Simple upload for small to medium files
   * Stream is uploaded directly to storage
   *
   * @param key - Unique identifier for the file in storage
   * @param stream - Readable stream of file content
   * @param options - Upload configuration (MIME type, metadata, etc.)
   * @returns Upload result with location and metadata
   */
  upload(
    key: string,
    stream: Readable,
    options: StorageUploadOptions,
  ): Promise<StorageUploadResult>;

  /**
   * Initialize a multipart upload for large files or resumable uploads
   *
   * @param key - Unique identifier for the file in storage
   * @param options - Upload configuration (MIME type, metadata, etc.)
   * @returns Upload ID and key for subsequent operations
   */
  initMultipartUpload(
    key: string,
    options: StorageUploadOptions,
  ): Promise<MultipartUploadInit>;

  /**
   * Generate a signed URL for uploading a specific part
   * Client can use this URL to upload parts directly to storage
   *
   * @param key - Unique identifier for the file in storage
   * @param uploadId - Upload ID from initMultipartUpload
   * @param partNumber - Part number (1-based index)
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @returns Pre-signed URL for part upload
   */
  getSignedUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<string>;

  /**
   * Complete a multipart upload after all parts are uploaded
   *
   * @param key - Unique identifier for the file in storage
   * @param uploadId - Upload ID from initMultipartUpload
   * @param parts - Array of uploaded parts with part numbers and ETags
   * @returns Upload result with final location
   */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadPart[],
  ): Promise<StorageUploadResult>;

  /**
   * Abort a multipart upload and clean up parts
   *
   * @param key - Unique identifier for the file in storage
   * @param uploadId - Upload ID from initMultipartUpload
   */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  /**
   * Download a file as a readable stream
   *
   * @param key - Unique identifier for the file in storage
   * @returns Readable stream of file content
   */
  download(key: string): Promise<Readable>;

  /**
   * Generate a signed URL for downloading a file
   * Allows temporary access without authentication
   *
   * @param key - Unique identifier for the file in storage
   * @param options - URL generation options (expiration, content disposition)
   * @returns Pre-signed URL for file download
   */
  getSignedDownloadUrl(
    key: string,
    options?: SignedUrlOptions,
  ): Promise<string>;

  // ===========================================================================
  // Single-shot signed PUT (issue #269, epic #254)
  // ===========================================================================
  //
  // WHY A NEW METHOD EXISTS RATHER THAN A REUSE OF `getSignedUploadUrl`
  // ---------------------------------------------------------------------------
  //
  // The node data plane needs one thing this interface could not express: a
  // URL a machine with NO storage credentials can PUT a complete object to,
  // once. Everything above it is either credential-holding (`upload`) or
  // multipart (`getSignedUploadUrl`, which signs `UploadPart` and is
  // meaningless without an `uploadId` from `initMultipartUpload`).
  //
  // REJECTED: driving a ONE-PART MULTIPART UPLOAD through the existing
  // methods. It is genuinely possible — `initMultipartUpload`, sign part 1,
  // let the node PUT it, then `completeMultipartUpload` — and it is worse in
  // four specific ways, each of which shows up as an operational problem
  // rather than as ugly code:
  //
  //   1. IT NEEDS A SECOND ROUND TRIP FROM THE NODE, and it needs the node to
  //      report the part's ETag back. That ETag is required by
  //      `CompleteMultipartUploadCommand`, so it would have to become a field
  //      in the node result contract — meaning every node-eligible job type
  //      that writes bytes carries a storage-protocol detail in its own
  //      result schema, forever, for no reason a handler author could guess.
  //   2. AN ABANDONED UPLOAD LEAKS BILLABLE STORAGE. A node that dies between
  //      `init` and `complete` leaves an in-progress multipart upload holding
  //      its parts, invisible to `ListObjects` and chargeable until a bucket
  //      lifecycle rule (which this template does not require an operator to
  //      configure) expires it. A signed PUT that is never used leaves
  //      nothing at all — the failure mode is "no object", which is exactly
  //      what a failed job should leave behind.
  //   3. IT MAKES THE SERVER HOLD PER-JOB STATE. The `uploadId` has to
  //      survive from the mint call to the completion call, so it needs a
  //      column, a cache, or a round trip through the node — three ways for a
  //      node's crash to strand a row. The whole node plane is designed so
  //      the server holds only what is already in `jobs`.
  //   4. S3 ENFORCES A 5 MiB MINIMUM ON EVERY PART BUT THE LAST. A one-part
  //      upload happens to be exempt, but the rule is a trap sitting next to
  //      a path somebody will later "optimise" into two parts.
  //
  // The cost of the chosen option is honest and small: one method on this
  // interface, which every implementation must provide. That is the trade —
  // an interface that says what it means, against a protocol dance encoded in
  // application code and leaking into a public result schema.
  //
  // A NOTE FOR A NEW IMPLEMENTATION: this must sign a PLAIN `PUT` of the whole
  // body to `key`. It must not require multipart headers, and it must not
  // embed credentials anywhere but the signature — the URL is handed to a
  // machine this deployment does not own.

  /**
   * Generate a signed URL for uploading a complete object in ONE `PUT`.
   *
   * Used by the worker-node data plane: a node holds no storage credentials,
   * so the server mints a short-lived, single-object write capability and the
   * bytes go straight from the node to the provider — never through the API.
   *
   * ⚠ THE CALLER CHOOSES `key`, AND IT MUST NEVER BE A REMOTE PARTY'S STRING.
   * A signed PUT is an unconditional overwrite of exactly that key: a caller
   * that forwarded a key it received over the wire would be handing out a
   * write primitive over its whole bucket. See
   * `NodeDataPlaneService.createUploadTarget`.
   *
   * @param key - Server-chosen identifier for the file in storage
   * @param options - Expiry, and the `Content-Type` the uploader will send
   * @returns Pre-signed URL accepting a single `PUT` of the whole body
   */
  getSignedPutUrl(key: string, options?: SignedPutUrlOptions): Promise<string>;

  /**
   * Delete a file from storage
   *
   * @param key - Unique identifier for the file in storage
   */
  delete(key: string): Promise<void>;

  /**
   * Get file metadata
   *
   * @param key - Unique identifier for the file in storage
   * @returns Metadata key-value pairs, or null if file doesn't exist
   */
  getMetadata(key: string): Promise<Record<string, string> | null>;

  /**
   * Set or update file metadata
   *
   * @param key - Unique identifier for the file in storage
   * @param metadata - Metadata key-value pairs to set
   */
  setMetadata(key: string, metadata: Record<string, string>): Promise<void>;

  /**
   * Check if a file exists in storage
   *
   * @param key - Unique identifier for the file in storage
   * @returns True if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get the bucket name being used by this provider
   *
   * @returns Bucket name
   */
  getBucket(): string;
  // ===========================================================================
  // Optional multipart extensions (all absent on a plain presigned driver)
  // ===========================================================================
  //
  // Additive: a provider that implements none of these behaves exactly as
  // before (presigned part URLs; upload status from the chunk rows). A driver
  // WITHOUT presigned URLs (a local disk, an in-process store) sets
  // `partUploadMode: 'proxied'` and implements `uploadPart`, and the objects
  // API serves its parts through `PUT /api/storage/objects/:id/upload/parts/:n`.
  // They are read from the provider that holds the object's row (see
  // `StorageProviderRouter`), never from the `ResolvingStorageProvider` wrapper
  // (whose own members cannot answer synchronously for an async configuration).

  /**
   * How a client uploads part N. Absent or `'presigned'` means
   * {@link StorageProvider.getSignedUploadUrl} (today's behaviour);
   * `'proxied'` means the API's own part route and {@link StorageProvider.uploadPart}.
   */
  readonly partUploadMode?: StoragePartUploadMode;

  /**
   * The parts the BACKEND holds for an in-flight upload, so `GET :id/upload/status`
   * reflects what really arrived: a client that uploads parts straight to S3
   * never reports each one to the API, and a crashed client would otherwise see
   * an empty list and re-send everything. Absent means status falls back to the
   * recorded chunk rows.
   *
   * @throws MultipartSessionNotFoundError when the backend does not know the upload.
   */
  listUploadedParts?(key: string, uploadId: string): Promise<UploadedPart[]>;

  /**
   * Stores one part streamed through the API; required when `partUploadMode` is
   * `'proxied'`. MUST NOT BUFFER `body`: write it to the backend as it arrives
   * (the platform already bounds it to `size` bytes and errors the stream when
   * the body is short or long, so a failed write must discard the part and
   * keep none of it). Re-sending a part replaces it.
   *
   * @param key - the object key.
   * @param uploadId - the id `initMultipartUpload` returned.
   * @param partNumber - 1-based part number.
   * @param body - the part's bytes, as a stream.
   * @param size - the exact byte length the part must have.
   * @returns the part's ETag (an MD5 digest, quoted or not).
   * @throws PartSizeMismatchError when the stream does not carry `size` bytes.
   * @throws MultipartSessionNotFoundError when the backend does not know the upload.
   */
  uploadPart?(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    size: number,
  ): Promise<StoredPart>;

  // ===========================================================================
  // Optional bulk delete and size probe (#1124)
  // ===========================================================================
  //
  // Additive: a provider without them is served by `deleteStorageKeys` (one
  // `delete` per key) and has no size probe. Call through the helpers, not
  // directly, so an app provider that implements neither keeps working.

  /**
   * Deletes many keys in as few backend calls as the backend allows (S3
   * `DeleteObjects`: up to 1,000 keys per call). A key that does not exist is
   * deleted, as with {@link StorageProvider.delete}. NEVER THROWS FOR A
   * PER-KEY FAILURE: the key is reported in `failed`; it throws only when the
   * request itself fails. Prefer {@link deleteStorageKeys}, which falls back to
   * `delete` per key on a provider without this method.
   *
   * @param keys - the keys to delete.
   * @returns which keys were deleted and which failed.
   */
  deleteMany?(keys: readonly string[]): Promise<StorageDeleteManyResult>;

  /**
   * The object's size in bytes from a metadata request (S3 `HeadObject`), so a
   * caller can verify an object without downloading it. `null` when the object
   * does not exist.
   *
   * @param key - the object key.
   * @returns the byte length, or `null` when absent.
   */
  size?(key: string): Promise<number | null>;
}

/**
 * Deletes `keys` through `provider` (#1124): its `deleteMany` when it has one,
 * else one `delete` per key (a per-key failure is reported, never thrown, and
 * the rest still run). An empty list makes no call.
 *
 * @param provider - the provider holding the keys.
 * @param keys - the keys to delete (duplicates are removed).
 * @returns which keys were deleted and which failed.
 *
 * @example
 * ```ts
 * const { failed } = await deleteStorageKeys(storage, rows.map((row) => row.storageKey));
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function deleteStorageKeys(provider: StorageProvider, keys: readonly string[]): Promise<StorageDeleteManyResult> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return { deleted: [], failed: [] };
  if (typeof provider.deleteMany === 'function') return provider.deleteMany(unique);

  const result: StorageDeleteManyResult = { deleted: [], failed: [] };
  for (const key of unique) {
    try {
      await provider.delete(key);
      result.deleted.push(key);
    } catch (error) {
      result.failed.push({ key, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/**
 * The size of `key` in bytes through `provider`'s `size` probe (#1124), `null`
 * when the object is absent, or `undefined` when the provider has no probe
 * (the caller then decides whether to download).
 *
 * @param provider - the provider holding the key.
 * @param key - the object key.
 * @returns the byte length, `null` when absent, `undefined` when unsupported.
 *
 * @stability experimental
 */
export async function storageObjectSize(provider: StorageProvider, key: string): Promise<number | null | undefined> {
  if (typeof provider.size !== 'function') return undefined;
  try {
    return await provider.size(key);
  } catch (error) {
    if (error instanceof StorageSizeUnsupportedError) return undefined;
    throw error;
  }
}

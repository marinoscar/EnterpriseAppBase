import { Readable } from 'node:stream';

/**
 * Options for uploading a file to storage
 *
 * @stability experimental
 */
export interface StorageUploadOptions {
  /** The media type. */
  mimeType: string;
  /** Object metadata to store with it. */
  metadata?: Record<string, string>;
  /** The byte length, when known. */
  contentLength?: number;
}

/**
 * Result of a successful upload operation
 *
 * @stability experimental
 */
export interface StorageUploadResult {
  /** The object key. */
  key: string;
  /** The bucket. */
  bucket: string;
  /** Where the provider says it is. */
  location: string;
  /** The provider's ETag. */
  eTag?: string;
}

/**
 * Represents a completed part of a multipart upload
 *
 * @stability experimental
 */
export interface UploadPart {
  /** The part number (1-10000). */
  partNumber: number;
  /** The provider's ETag. */
  eTag: string;
}

/**
 * Options for generating signed URLs
 *
 * @stability experimental
 */
export interface SignedUrlOptions {
  /** Seconds until the URL stops working. */
  expiresIn?: number; // Seconds, default 3600
  /** The `Content-Disposition` the download should carry. */
  responseContentDisposition?: string;
}

/**
 * Options for generating a single-shot signed PUT URL (issue #269, epic #254).
 *
 * Separate from `SignedUrlOptions` above rather than an extension of it: the
 * two describe opposite directions and share only `expiresIn`. A download URL
 * carries `responseContentDisposition` (how a browser should present bytes it
 * receives) which means nothing on an upload, and an upload URL carries
 * `contentType` (what the caller promises to send) which means nothing on a
 * download. One merged bag would publish two fields that are silently ignored
 * half the time — and a silently ignored option on a SIGNED url is the worst
 * kind, because the signature was computed without it and the resulting 403
 * names nothing.
 *
 * @stability experimental
 */
export interface SignedPutUrlOptions {
  /** Seconds until the URL stops working. Provider default 3600 when omitted. */
  expiresIn?: number;

  /**
   * The `Content-Type` the uploader will send.
   *
   * ⚠ IT IS PART OF THE SIGNATURE. If this is set, the PUT must send exactly
   * this header or the provider rejects the request — so a caller that does
   * not KNOW the content type should omit it rather than guess, and let the
   * uploader send whatever it likes.
   */
  contentType?: string;
}

/**
 * Result of initiating a multipart upload
 *
 * @stability experimental
 */
export interface MultipartUploadInit {
  /** The provider's multipart upload id. */
  uploadId: string;
  /** The object key. */
  key: string;
}

/**
 * One part of an in-flight multipart upload as the storage backend holds it.
 *
 * @stability experimental
 */
export interface UploadedPart {
  /** The part number (1-10000). */
  partNumber: number;
  /** The part's size in bytes, as the backend stores it. */
  size: number;
  /** The part's ETag, quoted or not exactly as the backend reports it; compare with {@link normalizeEtag}. */
  eTag: string;
}

/**
 * The result of storing one part through the API.
 *
 * @stability experimental
 */
export interface StoredPart {
  /** The part's ETag (an MD5 digest, quoted or not). */
  eTag: string;
}

/**
 * How a client gets a part to the backend (see `StorageProvider.partUploadMode`).
 *
 *  - `presigned`: the provider signs a URL the client PUTs to directly.
 *  - `proxied`: the provider has no signed URLs; the bytes go through the API's
 *    part route into `StorageProvider.uploadPart`.
 *
 * @stability experimental
 */
export type StoragePartUploadMode = 'presigned' | 'proxied';

/**
 * A part body did not have the size the upload requires. Throw it from
 * `StorageProvider.uploadPart` when the stream ends short or runs long; the
 * objects API answers 400 `PART_SIZE_MISMATCH`.
 *
 * @stability experimental
 */
export class PartSizeMismatchError extends Error {
  /**
   * @param partNumber - the part.
   * @param expectedSize - the exact byte count the part must have.
   * @param receivedSize - the bytes seen before the mismatch was detected.
   * @param exceeded - true when the body was cut off for running past `expectedSize`.
   */
  constructor(
    readonly partNumber: number,
    readonly expectedSize: number,
    readonly receivedSize: number,
    readonly exceeded: boolean,
  ) {
    super(
      exceeded
        ? `Part ${partNumber} is larger than the expected ${expectedSize} bytes`
        : `Part ${partNumber} has ${receivedSize} bytes, expected ${expectedSize}`,
    );
    this.name = 'PartSizeMismatchError';
  }
}

/**
 * The backend no longer knows the multipart session (completed, aborted or
 * garbage-collected). Throw it from `listUploadedParts` / `uploadPart` /
 * `completeMultipartUpload`; the objects API answers 409 `UPLOAD_SESSION_INVALID`.
 *
 * @stability experimental
 */
export class MultipartSessionNotFoundError extends Error {
  /** @param uploadId - the unknown session. */
  constructor(readonly uploadId: string) {
    super(`Multipart upload ${uploadId} does not exist`);
    this.name = 'MultipartSessionNotFoundError';
  }
}

/**
 * `completeMultipartUpload` found parts missing or whose bytes do not match the
 * ETag the client sent. Nothing is written; the objects API answers 409
 * `UPLOAD_PARTS_MISSING` with the numbers so the client re-sends only those.
 *
 * @stability experimental
 */
export class MultipartPartsMissingError extends Error {
  /** @param partNumbers - the missing or mismatching parts. */
  constructor(readonly partNumbers: number[]) {
    super(`Multipart upload is missing or has corrupt part(s): ${partNumbers.join(', ')}`);
    this.name = 'MultipartPartsMissingError';
  }
}

/**
 * An ETag without its surrounding quotes, so a client's `"abc"` and a backend's
 * `abc` compare equal.
 *
 * @param eTag - an ETag, quoted or not.
 * @returns the bare value.
 *
 * @stability experimental
 */
export function normalizeEtag(eTag: string): string {
  return eTag.replace(/^"+|"+$/g, '');
}

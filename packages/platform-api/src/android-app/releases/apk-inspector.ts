import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ANDROID_RELEASE_REASONS, MAX_APK_BYTES } from '@marinoscar/platform-contract/android-app';

// =============================================================================
// ApkInspector (#746; MemoriaHub's and EvoPath's, identical in substance)
// =============================================================================
//
// A pass-through Transform between the multipart file stream and the storage
// upload, so the APK is NEVER buffered (the spirit of the backup invariant):
// it checks the ZIP signature on the first four bytes, enforces the size
// ceiling as bytes flow, and hashes them (SHA-256) for `fileSha256`. A
// failure destroys the stream with a typed 400 / 413, which aborts the upload.
//
// What it does NOT do: parse the manifest or the signing block. The package
// name, version and signing fingerprint arrive as form fields (the CLI reads
// them with `aapt2`/`apksigner` at build time) and are checked against the
// trusted list by the service.
// =============================================================================

/**
 * The ZIP local-file-header signature every APK starts with.
 *
 * @stability experimental
 */
export const ZIP_MAGIC: Buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Streams an APK through: signature check, size ceiling, SHA-256.
 *
 * @stability experimental
 */
export class ApkInspector extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private header: Buffer = Buffer.alloc(0);
  private checkedMagic = false;
  private bytes = 0;
  /** The first failure, kept so the caller can rethrow it after the upload rejects. */
  failure: BadRequestException | PayloadTooLargeException | null = null;

  /**
   * @param maxBytes - the size ceiling (default `MAX_APK_BYTES`).
   */
  constructor(private readonly maxBytes: number = MAX_APK_BYTES) {
    super();
  }

  /** Bytes seen so far. */
  get sizeBytes(): number {
    return this.bytes;
  }

  /**
   * The SHA-256 of every byte seen, lower-case hex. Call once, after the end.
   *
   * @returns 64 hex digits.
   */
  digest(): string {
    return this.hash.digest('hex');
  }

  /** Fails the stream as too large (the multipart limit fired first). */
  rejectTooLarge(): void {
    this.destroy(this.remember(tooLarge(this.maxBytes)));
  }

  /**
   * Counts, checks the ZIP magic of, and hashes the next chunk.
   *
   * @param chunk - the next bytes.
   * @param _encoding - unused.
   * @param callback - the stream callback.
   */
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.failure) return callback(this.failure);
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) return callback(this.remember(tooLarge(this.maxBytes)));
    if (!this.checkedMagic) {
      this.header = Buffer.concat([this.header, chunk.subarray(0, ZIP_MAGIC.length - this.header.length)]);
      if (this.header.length >= ZIP_MAGIC.length) {
        if (!this.header.equals(ZIP_MAGIC)) return callback(this.remember(notAnApk()));
        this.checkedMagic = true;
      }
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  /**
   * Refuses an upload that ended before its ZIP magic.
   *
   * @param callback - the stream callback.
   */
  override _flush(callback: TransformCallback): void {
    if (this.failure) return callback(this.failure);
    if (!this.checkedMagic) return callback(this.remember(notAnApk()));
    callback();
  }

  private remember(error: BadRequestException | PayloadTooLargeException): BadRequestException | PayloadTooLargeException {
    this.failure ??= error;
    return this.failure;
  }
}

function notAnApk(): BadRequestException {
  return new BadRequestException({
    message: 'The uploaded file is not an APK (it does not start with the ZIP signature PK\\x03\\x04).',
    details: { reason: ANDROID_RELEASE_REASONS.NOT_AN_APK },
  });
}

function tooLarge(maxBytes: number): PayloadTooLargeException {
  return new PayloadTooLargeException({
    message: `The APK exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
    details: { reason: ANDROID_RELEASE_REASONS.TOO_LARGE, maxBytes },
  });
}

import { Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  NotFound,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { StorageProvider } from '../storage-provider.interface';
import {
  StorageUploadOptions,
  StorageUploadResult,
  MultipartUploadInit,
  UploadPart,
  SignedUrlOptions,
  SignedPutUrlOptions,
} from '../storage-provider.types';

/**
 * The multipart part size used when nothing else says otherwise: 10 MiB.
 *
 * Was `configService.get('storage.partSize', 10485760)` inline; it moved out
 * here when the constructor stopped injecting `ConfigService` (#373 part 2) so
 * the default is stated once rather than re-typed at whichever call site
 * happens to need it. The value is unchanged.
 */
export const DEFAULT_S3_PART_SIZE = 10_485_760;

/**
 * Everything this provider needs to talk to an object store.
 *
 * ── WHY A CONFIG OBJECT AND NOT `ConfigService` (#373 part 2) ───────────────
 *
 * Because there is no longer ONE configuration for the life of the process.
 * Storage is administrator-editable at runtime now, so the provider that
 * actually talks to S3 must be constructible more than once — once per distinct
 * configuration — and a class that reads its settings out of the environment in
 * its constructor cannot be. Taking a plain object turns "which bucket am I?"
 * from something this class decides into something its caller decides, which is
 * what lets `ResolvingStorageProvider` build one of these per configuration and
 * throw it away when the configuration changes.
 *
 * It also makes this class trivially testable and, notably, FREE OF NEST: it is
 * no longer `@Injectable()` and is never constructed by the container.
 *
 * ⚠ `secretAccessKey` is plaintext, necessarily — an S3 client cannot sign
 * without it. Nothing in this class logs it, and nothing should.
 */
export interface S3StorageProviderConfig {
  /** Bucket every operation addresses. */
  bucket: string;
  /** Signing region. */
  region: string;
  /** Explicit origin, or absent for the SDK's own AWS host. Never `''`. */
  endpoint?: string;
  /** Identifier half of the credential. */
  accessKeyId: string;
  /** ⚠ Plaintext secret half. */
  secretAccessKey: string;
  /** `https://host/bucket/key` (true) over `https://bucket.host/key` (false). */
  forcePathStyle: boolean;
  /** Multipart part size in bytes. Defaults to {@link DEFAULT_S3_PART_SIZE}. */
  partSize?: number;
}

/**
 * S3-compatible storage provider implementation
 * Supports AWS S3, MinIO, LocalStack, and other S3-compatible storage services
 *
 * Constructed from a {@link S3StorageProviderConfig} rather than resolved by
 * Nest — see that type. One instance is bound to one configuration for its
 * whole life; a configuration change produces a new instance and
 * {@link S3StorageProvider.destroy}s the old one.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly partSize: number;

  constructor(config: S3StorageProviderConfig) {
    const { region, endpoint, accessKeyId, secretAccessKey } = config;

    this.bucket = config.bucket;
    this.partSize = config.partSize ?? DEFAULT_S3_PART_SIZE;

    // There is deliberately no "bucket not configured" warning here any more.
    // Completeness is decided in exactly one place — `resolveStorageConfig` in
    // `../../config/storage-config.ts` — which refuses to produce a config
    // without a bucket at all, so this branch became unreachable. A second,
    // weaker copy of the check is how a half-configured client comes to be
    // built anyway, with only a log line to show for it.
    this.s3Client = new S3Client({
      region,
      endpoint,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
            }
          : undefined,
      // Path-style URLs for MinIO/LocalStack and anything else behind a
      // certificate that does not cover wildcard subdomains. Was inferred from
      // `!!endpoint`; it is now an explicit setting, because the split does not
      // follow the endpoint — R2 has one and does not want path style.
      forcePathStyle: config.forcePathStyle,
    });

    this.logger.log(
      `S3StorageProvider initialized - Bucket: ${this.bucket}, Region: ${region}${endpoint ? `, Endpoint: ${endpoint}` : ''}`,
    );
  }

  /**
   * Release this client's sockets.
   *
   * Called by `ResolvingStorageProvider` when a configuration change makes this
   * instance obsolete. Without it, every settings edit and every credential
   * rotation would leak an `S3Client`'s connection pool for the life of the
   * process — the same leak `SmtpEmailProvider` closes by calling
   * `transport.close()` on the transporter it replaces.
   */
  destroy(): void {
    this.s3Client.destroy();
  }

  /**
   * Simple upload using AWS SDK Upload helper
   * Automatically handles multipart uploads for large files
   */
  async upload(
    key: string,
    stream: Readable,
    options: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    this.logger.debug(`Starting upload for key: ${key}`);

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: stream,
          ContentType: options.mimeType,
          Metadata: options.metadata || {},
          ContentLength: options.contentLength,
        },
        // Use configured part size for automatic multipart uploads
        partSize: this.partSize,
      });

      const result = await upload.done();

      this.logger.log(`Upload completed for key: ${key}`);

      return {
        key,
        bucket: this.bucket,
        location: result.Location || `${this.bucket}/${key}`,
        eTag: result.ETag,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Upload failed for key ${key}: ${message}`, stack);
      throw error;
    }
  }

  /**
   * Initialize multipart upload
   */
  async initMultipartUpload(
    key: string,
    options: StorageUploadOptions,
  ): Promise<MultipartUploadInit> {
    this.logger.debug(`Initiating multipart upload for key: ${key}`);

    try {
      const command = new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options.mimeType,
        Metadata: options.metadata || {},
      });

      const result = await this.s3Client.send(command);

      if (!result.UploadId) {
        throw new Error('Failed to initiate multipart upload - no UploadId returned');
      }

      this.logger.log(`Multipart upload initiated for key: ${key}, UploadId: ${result.UploadId}`);

      return {
        uploadId: result.UploadId,
        key,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to initiate multipart upload for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Generate signed URL for uploading a specific part
   */
  async getSignedUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = 3600,
  ): Promise<string> {
    this.logger.debug(
      `Generating signed upload URL for key: ${key}, part: ${partNumber}`,
    );

    try {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });

      return signedUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to generate signed upload URL for key ${key}, part ${partNumber}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Complete multipart upload
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadPart[],
  ): Promise<StorageUploadResult> {
    this.logger.debug(
      `Completing multipart upload for key: ${key}, ${parts.length} parts`,
    );

    try {
      const command = new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag,
          })),
        },
      });

      const result = await this.s3Client.send(command);

      this.logger.log(`Multipart upload completed for key: ${key}`);

      return {
        key,
        bucket: this.bucket,
        location: result.Location || `${this.bucket}/${key}`,
        eTag: result.ETag,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to complete multipart upload for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Abort multipart upload
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    this.logger.debug(`Aborting multipart upload for key: ${key}`);

    try {
      const command = new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      });

      await this.s3Client.send(command);

      this.logger.log(`Multipart upload aborted for key: ${key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to abort multipart upload for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Download file as stream
   */
  async download(key: string): Promise<Readable> {
    this.logger.debug(`Downloading file for key: ${key}`);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const result = await this.s3Client.send(command);

      if (!result.Body) {
        throw new Error('No body returned from S3');
      }

      // S3 returns a readable stream
      return result.Body as Readable;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to download file for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Generate signed download URL
   */
  async getSignedDownloadUrl(
    key: string,
    options?: SignedUrlOptions,
  ): Promise<string> {
    this.logger.debug(`Generating signed download URL for key: ${key}`);

    try {
      const expiresIn = options?.expiresIn || 3600;

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options?.responseContentDisposition,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });

      return signedUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to generate signed download URL for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Generate a signed URL for a single-shot `PUT` of a whole object.
   *
   * `PutObjectCommand`, deliberately — not `UploadPartCommand`. See the block
   * comment on `getSignedPutUrl` in `../storage-provider.interface.ts` for why
   * a one-part multipart upload was rejected for this.
   *
   * ⚠ `ContentType` IS ONLY SET WHEN THE CALLER SUPPLIED ONE. S3 signs the
   * headers it is given: presigning with a `Content-Type` the uploader then
   * does not send exactly produces a `SignatureDoesNotMatch` on a machine
   * nobody is watching, and the error names the signature rather than the
   * header that caused it. Omitting it leaves the uploader free, which is the
   * right default for a caller that is guessing.
   *
   * The URL itself is NEVER logged, here or anywhere else — it is a bearer
   * write capability for `key` until it expires. The debug line below names
   * the key only, matching `getSignedDownloadUrl` beside it.
   */
  async getSignedPutUrl(
    key: string,
    options?: SignedPutUrlOptions,
  ): Promise<string> {
    this.logger.debug(`Generating signed PUT URL for key: ${key}`);

    try {
      const expiresIn = options?.expiresIn || 3600;

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options?.contentType ? { ContentType: options.contentType } : {}),
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to generate signed PUT URL for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Delete file
   */
  async delete(key: string): Promise<void> {
    this.logger.debug(`Deleting file for key: ${key}`);

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);

      this.logger.log(`File deleted for key: ${key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to delete file for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Get file metadata
   */
  async getMetadata(key: string): Promise<Record<string, string> | null> {
    this.logger.debug(`Getting metadata for key: ${key}`);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const result = await this.s3Client.send(command);

      return result.Metadata || {};
    } catch (error) {
      if (error instanceof NotFound || (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound')) {
        return null;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to get metadata for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Set file metadata
   * Uses CopyObject with REPLACE metadata directive
   */
  async setMetadata(
    key: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    this.logger.debug(`Setting metadata for key: ${key}`);

    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucket,
        Key: key,
        CopySource: `${this.bucket}/${key}`,
        Metadata: metadata,
        MetadataDirective: 'REPLACE',
      });

      await this.s3Client.send(command);

      this.logger.log(`Metadata updated for key: ${key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to set metadata for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error instanceof NotFound || (error && typeof error === 'object' && 'name' in error && error.name === 'NotFound')) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error checking existence for key ${key}: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Get bucket name
   */
  getBucket(): string {
    return this.bucket;
  }
}

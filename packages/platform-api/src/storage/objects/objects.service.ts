import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { Inject } from '@nestjs/common';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { AVATARS_KEY_PREFIX, ensureStorageSliceKeyPrefixes } from '../storage-key-prefixes';
import { buildObjectKey } from '../storage-key-prefix.registry';
import { AVATAR_PURPOSE } from '../profile-image/profile-image';
import { mimeTypeMatches, normaliseMimeType } from '../mime-type-match';
import { STORAGE_PROVIDER } from '../providers/storage-provider.interface';
import type { StorageProvider } from '../providers/storage-provider.interface';
import {
  InitUploadDto,
  InitUploadResponseDto,
} from './dto/init-upload.dto';
import {
  CompleteUploadDto,
} from './dto/complete-upload.dto';
import {
  ObjectResponseDto,
  UploadStatusResponseDto,
} from './dto/object-response.dto';
import {
  ObjectListQueryDto,
  ObjectListResponseDto,
} from './dto/object-list-query.dto';
import {
  UpdateMetadataDto,
} from './dto/update-metadata.dto';
import {
  DownloadUrlResponseDto,
} from './dto/download-url-response.dto';
import { isActiveDedupConflict, JobsService } from '../../jobs/index';
import { ObjectProcessingService } from '../processing/object-processing.service';
import { buildProcessedMetadata } from '../processing/processing-metadata';
import { STORAGE_OBJECT_PROCESS_TYPE } from '../handlers/storage-object-process.handler';
import { STORAGE_OBJECT_SUBJECT_TYPE } from '../storage-job-input';
import { PLATFORM_PRISMA } from '../../core/index';
import type {
  StorageInputJsonValue,
  StorageJsonValue,
  StorageObject,
  StorageObjectChunk,
  StoragePrisma,
  StorageTx,
} from '../data/storage-db';
import { storageForOrg, storageRunInOrg } from '../data/storage-db';
import { DEFAULT_STORAGE_PART_SIZE_BYTES, STORAGE_OPTIONS, type ResolvedStorageModuleOptions } from '../storage.options';

/**
 * One file part of the simple upload, as the controller hands it to the service.
 *
 * @stability experimental
 */
export interface MultipartFile {
  /** The client's filename. */
  filename: string;
  /** The declared media type. */
  mimetype: string;
  /** The bytes, as a stream. */
  file: Readable;
}

/**
 * Longest transaction recording the parts of a completed multipart upload
 * (Prisma's default is 5 s; an upload can have 10 000 parts).
 */
const CHUNK_RECORD_TIMEOUT_MS = 60_000;

/**
 * Records the organization on the active span (`org.id`, #736) for object
 * create, download and delete. A span attribute only, never a metric label
 * (cardinality; spec, "Tenancy and access model").
 */
function tagSpanWithOrg(orgId: string): void {
  trace.getActiveSpan()?.setAttribute('org.id', orgId);
}

/** Default for `storage.maxFileSize` when the config carries no usable value (10 GiB). */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

/**
 * The objects API's logic, in the caller's organization: simple and resumable uploads (org-aware keys), list, metadata, download URL, delete, each audited.
 *
 * @stability experimental
 */
@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: StoragePrisma,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
    private readonly config: ConfigService,
    // #520: post-upload processing is a queue job. These two decide, at
    // upload time, whether one is needed and queue it — see `settleUpload`.
    private readonly processing: ObjectProcessingService,
    private readonly jobs: JobsService,
    // #736: `StorageModule.forRoot({ partSizeBytes })`; absent in a spec that
    // builds the service alone.
    @Optional()
    @Inject(STORAGE_OPTIONS)
    private readonly options?: ResolvedStorageModuleOptions,
  ) {
    // The `uploads` key prefix this service builds keys under (#736); a no-op
    // when `StorageModule.forRoot()` or the app's manifest registered it.
    ensureStorageSliceKeyPrefixes();
  }

  /** The multipart part size: the forRoot option, else the deployment's `storage.partSize`. */
  private partSize(): number {
    return this.options?.partSizeBytes ?? this.config.get<number>('storage.partSize', DEFAULT_STORAGE_PART_SIZE_BYTES);
  }

  /**
   * The database client scoped to the caller's organization (row-level
   * security, issue #725): every statement runs with `app.org_id` set, so
   * another organization's objects are neither visible nor writable.
   */
  private db(orgId: string, userId: string) {
    return storageForOrg(this.prisma, orgId, { userId });
  }

  /**
   * A new upload's key, uploads/<orgId>/<timestamp>/<uuid><ext>, through the
   * key builder of the prefix registry (#736).
   */
  private newUploadKey(orgId: string, filename: string): string {
    tagSpanWithOrg(orgId);
    return buildObjectKey('uploads', { orgId }, String(Date.now()), `${randomUUID()}${extname(filename)}`);
  }

  /**
   * Initialize a resumable multipart upload
   */
  async initUpload(
    dto: InitUploadDto,
    userId: string,
    orgId: string,
  ): Promise<InitUploadResponseDto> {
    const { name, size, mimeType } = dto;

    // Deployment upload limits (#519), before anything touches the provider.
    this.assertUploadAllowed(mimeType, size);

    // Get configuration
    const partSize = this.partSize(); // 10MB default
    const minPartSize = 5 * 1024 * 1024; // 5MB S3 minimum

    // Validate part size
    if (partSize < minPartSize) {
      throw new BadRequestException(
        `Part size must be at least ${minPartSize} bytes`,
      );
    }

    // Calculate total parts
    const totalParts = Math.ceil(size / partSize);

    if (totalParts > 10000) {
      throw new BadRequestException(
        'File too large for multipart upload (exceeds 10,000 parts)',
      );
    }

    // Generate storage key: org-aware since #736 (uploads/<orgId>/<timestamp>/
    // <uuid><ext>`). Rows written before keep their stored key; nothing here
    // or anywhere rebuilds a key for an existing row.
    const storageKey = this.newUploadKey(orgId, name);

    this.logger.log(`Initializing upload for ${name}, ${totalParts} parts`);

    // Initialize multipart upload with storage provider
    const { uploadId } = await this.storageProvider.initMultipartUpload(
      storageKey,
      { mimeType },
    );

    // Create StorageObject record
    const storageObject = await this.db(orgId, userId).storageObject.create({
      data: {
        name,
        size: BigInt(size),
        mimeType,
        storageKey,
        // The LIVE provider kind, not a literal: an operator who selected R2
        // (or an app backend bound through `StorageModule.forRoot({ provider })`)
        // must not leave a trail of rows claiming their objects are in S3. It
        // comes from the same snapshot `getBucket()` answers from, so this pair
        // names one configuration.
        storageProvider: this.storageProvider.kind,
        bucket: this.storageProvider.getBucket(),
        status: 'pending',
        s3UploadId: uploadId,
        uploadedById: userId,
        orgId,
      },
    });

    // Generate presigned URLs for first batch (up to 10 parts)
    const urlBatchSize = Math.min(10, totalParts);
    const presignedUrls = await Promise.all(
      Array.from({ length: urlBatchSize }, (_, i) => i + 1).map(
        async (partNumber) => ({
          partNumber,
          url: await this.storageProvider.getSignedUploadUrl(
            storageKey,
            uploadId,
            partNumber,
          ),
        }),
      ),
    );

    this.logger.log(
      `Upload initialized: ${storageObject.id}, uploadId: ${uploadId}`,
    );

    return {
      objectId: storageObject.id,
      uploadId,
      partSize,
      totalParts,
      presignedUrls,
    };
  }

  /**
   * Get upload status and progress
   */
  async getUploadStatus(
    objectId: string,
    userId: string,
    orgId: string,
  ): Promise<UploadStatusResponseDto> {
    const storageObject = (await this.db(orgId, userId).storageObject.findUnique({
      where: { id: objectId },
      include: { chunks: true },
    })) as (StorageObject & { chunks: StorageObjectChunk[] }) | null;

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    const uploadedParts = storageObject.chunks
      .map((chunk) => chunk.partNumber)
      .sort((a, b) => a - b);

    const uploadedBytes = storageObject.chunks.reduce(
      (sum, chunk) => sum + chunk.size,
      BigInt(0),
    );

    const partSize = this.partSize();
    const totalParts = Math.ceil(Number(storageObject.size) / partSize);

    return {
      objectId: storageObject.id,
      status: storageObject.status,
      uploadedParts,
      totalParts,
      uploadedBytes: uploadedBytes.toString(),
      totalBytes: storageObject.size.toString(),
    };
  }

  /**
   * Complete multipart upload
   */
  async completeUpload(
    objectId: string,
    dto: CompleteUploadDto,
    userId: string,
    orgId: string,
  ): Promise<ObjectResponseDto> {
    const storageObject = await this.db(orgId, userId).storageObject.findUnique({
      where: { id: objectId },
      include: { chunks: true },
    });

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    if (!storageObject.s3UploadId) {
      throw new BadRequestException('Upload ID not found');
    }

    const { parts } = dto;

    this.logger.log(`Completing upload ${objectId} with ${parts.length} parts`);

    // Record chunks in database: one scoped transaction for all parts (a
    // scoped client would open one transaction per upsert, and a large upload
    // has thousands of parts). Each chunk carries its object's org_id, which
    // the composite foreign key (object_id, org_id) checks.
    await storageRunInOrg(
      this.prisma,
      orgId,
      async (tx) => {
        for (const part of parts) {
          await tx.storageObjectChunk.upsert({
            where: {
              objectId_partNumber: {
                objectId,
                partNumber: part.partNumber,
              },
            },
            create: {
              objectId,
              orgId,
              partNumber: part.partNumber,
              eTag: part.eTag,
              size: BigInt(0), // We don't know exact part size from client
            },
            update: {
              eTag: part.eTag,
            },
          });
        }
      },
      { userId, timeout: CHUNK_RECORD_TIMEOUT_MS },
    );

    // Complete upload with storage provider
    await this.storageProvider.completeMultipartUpload(
      storageObject.storageKey,
      storageObject.s3UploadId,
      parts,
    );

    // `processing`, then either `ready` (no processor applies) or a queued
    // processing job — in ONE transaction, so the row never reads
    // `processing` without a job that will settle it.
    let updated: StorageObject;

    try {
      updated = await storageRunInOrg(
        this.prisma,
        orgId,
        async (tx) => {
          const row = await tx.storageObject.update({
            where: { id: objectId },
            data: { status: 'processing' },
          });

          return this.settleUpload(tx, row);
        },
        { userId },
      );
    } catch (error) {
      // `enqueueWithin` propagates the dedup conflict rather than collapsing
      // onto the job in flight (an aborted transaction can run no re-read).
      // A conflict means a processing job for this object is ALREADY pending
      // or running — a repeated completion — and that job will settle the
      // row, so the transaction rolling back is the right result: report the
      // row as it stands. Anything else stays loud.
      if (!isActiveDedupConflict(error)) throw error;

      this.logger.log(
        `Upload ${objectId} already has a processing job in flight; not queueing another`,
      );
      updated = await this.db(orgId, userId).storageObject.findUniqueOrThrow({
        where: { id: objectId },
      });
    }

    // Create audit event
    await this.createAuditEvent(userId, orgId, 'storage:upload:complete', objectId, {
      name: updated.name,
      size: updated.size.toString(),
      mimeType: updated.mimeType,
      partsCount: parts.length,
    });

    this.logger.log(`Upload completed: ${objectId}`);

    return this.mapToResponseDto(updated);
  }

  /**
   * Abort multipart upload
   */
  async abortUpload(objectId: string, userId: string, orgId: string): Promise<void> {
    const storageObject = await this.db(orgId, userId).storageObject.findUnique({
      where: { id: objectId },
    });

    if (!storageObject) {
      throw new NotFoundException('Upload not found');
    }

    // Check ownership
    if (storageObject.uploadedById !== userId) {
      throw new ForbiddenException('You do not own this upload');
    }

    if (!storageObject.s3UploadId) {
      throw new BadRequestException('Upload ID not found');
    }

    this.logger.log(`Aborting upload ${objectId}`);

    // Abort with storage provider
    await this.storageProvider.abortMultipartUpload(
      storageObject.storageKey,
      storageObject.s3UploadId,
    );

    // Delete database records
    await this.db(orgId, userId).storageObject.delete({
      where: { id: objectId },
    });

    // Create audit event
    await this.createAuditEvent(userId, orgId, 'storage:upload:abort', objectId, {
      name: storageObject.name,
      status: storageObject.status,
    });

    this.logger.log(`Upload aborted: ${objectId}`);
  }

  /**
   * Simple upload for smaller files
   */
  async simpleUpload(
    file: MultipartFile,
    userId: string,
    orgId: string,
  ): Promise<ObjectResponseDto> {
    const { filename, mimetype, file: stream } = file;

    // Deployment upload limits (#519). The byte count of a streamed multipart
    // body is unknown until it has been consumed; its size is bounded by the
    // multipart `fileSize` limit `main.ts` registers (min(100MB, maxFileSize)).
    try {
      this.assertUploadAllowed(mimetype);
    } catch (error) {
      // Drain the unread file part so the request completes and the 415
      // reaches the client instead of a stalled connection.
      stream.resume();
      throw error;
    }

    // Generate storage key (org-aware since #736; see `initUpload`).
    const storageKey = this.newUploadKey(orgId, filename);

    this.logger.log(`Simple upload starting: ${filename}`);

    // Upload to storage
    const result = await this.storageProvider.upload(storageKey, stream, {
      mimeType: mimetype,
    });

    const storageProvider = this.storageProvider.kind;

    // We don't know the size until after upload for streams
    // Use a default size of 0, should be updated in post-processing.
    // Created and settled (`ready`, or a queued processing job) in ONE
    // transaction — see `completeUpload`. The object id is new, so no
    // processing job can already hold its dedup key.
    const storageObject = await storageRunInOrg(
      this.prisma,
      orgId,
      async (tx) => {
        const created = await tx.storageObject.create({
          data: {
            name: filename,
            size: BigInt(0), // Will be updated by post-processing
            mimeType: mimetype,
            storageKey,
            // See `initUpload` — the live provider, never a literal.
            storageProvider,
            bucket: result.bucket,
            status: 'processing',
            uploadedById: userId,
            orgId,
          },
        });

        return this.settleUpload(tx, created);
      },
      { userId },
    );

    // Create audit event
    await this.createAuditEvent(userId, orgId, 'storage:upload:complete', storageObject.id, {
      name: storageObject.name,
      mimeType: storageObject.mimeType,
      uploadType: 'simple',
    });

    this.logger.log(`Simple upload completed: ${storageObject.id}`);

    return this.mapToResponseDto(storageObject);
  }

  /**
   * List user's objects with pagination and filtering
   */
  async list(
    query: ObjectListQueryDto,
    userId: string,
    orgId: string,
  ): Promise<ObjectListResponseDto> {
    const { page, pageSize, status, sortBy, sortOrder } = query;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = {
      uploadedById: userId,
      ...(status && { status }),
    };

    // Build orderBy clause
    const orderBy: any = {};
    if (sortBy === 'createdAt') {
      orderBy.createdAt = sortOrder;
    } else if (sortBy === 'name') {
      orderBy.name = sortOrder;
    } else if (sortBy === 'size') {
      orderBy.size = sortOrder;
    }

    const db = this.db(orgId, userId);
    const [items, totalItems] = await Promise.all([
      db.storageObject.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
      db.storageObject.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      items: items.map((item) => this.mapToResponseDto(item)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Get object by ID with ownership check
   */
  async getById(id: string, userId: string, orgId: string): Promise<ObjectResponseDto> {
    const object = await this.getObjectWithAuthCheck(id, userId, orgId);
    return this.mapToResponseDto(object);
  }

  /**
   * Get signed download URL for an object
   */
  async getDownloadUrl(
    id: string,
    userId: string,
    orgId: string,
    expiresIn?: number,
  ): Promise<DownloadUrlResponseDto> {
    tagSpanWithOrg(orgId);
    const object = await this.getObjectWithAuthCheck(id, userId, orgId);

    // Verify status is ready
    if (object.status !== 'ready') {
      throw new BadRequestException(
        `Object is not ready for download. Current status: ${object.status}`,
      );
    }

    const defaultExpiry = this.config.get<number>(
      'storage.signedUrlExpiry',
      3600,
    );
    const expiry = expiresIn || defaultExpiry;

    const url = await this.storageProvider.getSignedDownloadUrl(
      object.storageKey,
      { expiresIn: expiry },
    );

    this.logger.log(`Generated download URL for object ${id}, expires in ${expiry}s`);

    return {
      url,
      expiresIn: expiry,
    };
  }

  /**
   * Delete object from storage and database.
   *
   * By default only the owner may delete (the same ownership check every other
   * method applies). A caller holding `storage:delete_any` passes
   * `canDeleteAny: true`, which lifts the ownership check for every object
   * EXCEPT another user's profile image: an avatar row is referenced by that
   * user's `profile.imageObjectId`, and deleting it here would leave the
   * setting pointing at nothing. Avatars are removed through
   * `DELETE /api/user-settings/profile-image` by their owner, which clears the
   * reference in the same operation.
   *
   * When the actor is not the owner, the audit event records the owner's id
   * (`ownerUserId`) so the trail says whose object was removed.
   */
  async delete(
    id: string,
    userId: string,
    orgId: string,
    options: { canDeleteAny?: boolean } = {},
  ): Promise<void> {
    tagSpanWithOrg(orgId);
    const object = options.canDeleteAny
      ? await this.getObjectForDeleteAny(id, userId, orgId)
      : await this.getObjectWithAuthCheck(id, userId, orgId);

    this.logger.log(`Deleting object ${id} from storage and database`);

    // Delete from storage provider
    await this.storageProvider.delete(object.storageKey);

    // Delete from database (cascade deletes chunks)
    await this.db(orgId, userId).storageObject.delete({
      where: { id },
    });

    // Create audit event
    await this.createAuditEvent(userId, orgId, 'storage:object:delete', id, {
      name: object.name,
      size: object.size.toString(),
      mimeType: object.mimeType,
      ...(object.uploadedById !== userId
        ? { ownerUserId: object.uploadedById }
        : {}),
    });

    this.logger.log(`Object deleted: ${id}`);
  }

  /**
   * Update object metadata
   */
  async updateMetadata(
    id: string,
    dto: UpdateMetadataDto,
    userId: string,
    orgId: string,
  ): Promise<ObjectResponseDto> {
    const object = await this.getObjectWithAuthCheck(id, userId, orgId);

    // Merge new metadata with existing
    const existingMetadata = (object.metadata as Record<string, unknown>) || {};
    const mergedMetadata = {
      ...existingMetadata,
      ...dto.metadata,
    };

    // Update in database
    const updated = await this.db(orgId, userId).storageObject.update({
      where: { id },
      data: { metadata: mergedMetadata as StorageInputJsonValue },
    });

    // Create audit event
    await this.createAuditEvent(userId, orgId, 'storage:object:metadata:update', id, {
      name: object.name,
      metadataChanges: dto.metadata,
    });

    this.logger.log(`Updated metadata for object ${id}`);

    return this.mapToResponseDto(updated);
  }

  /**
   * Enforces the deployment's upload limits (#519) for both upload routes.
   *
   * - `size` (when known) above `storage.maxFileSize` → 413.
   * - `mimeType` not matching `storage.allowedMimeTypes` → 415. An empty list
   *   allows every type; entries are exact types or `type/*` wildcards,
   *   compared case-insensitively and ignoring parameters.
   */
  private assertUploadAllowed(mimeType: string, size?: number): void {
    const configuredMax = this.config.get<number>('storage.maxFileSize');
    const maxFileSize =
      typeof configuredMax === 'number' && Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : DEFAULT_MAX_FILE_SIZE;

    if (size !== undefined && size > maxFileSize) {
      throw new PayloadTooLargeException(
        `File size ${size} bytes exceeds the maximum upload size of ${maxFileSize} bytes`,
      );
    }

    const configuredTypes = this.config.get<string[]>('storage.allowedMimeTypes');
    const allowedMimeTypes = Array.isArray(configuredTypes) ? configuredTypes : [];

    if (
      allowedMimeTypes.length > 0 &&
      !mimeTypeMatches(normaliseMimeType(mimeType), allowedMimeTypes)
    ) {
      throw new UnsupportedMediaTypeException(
        `File type '${mimeType}' is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
      );
    }
  }

  /**
   * Helper method to get object with ownership check
   * @private
   */
  private async getObjectWithAuthCheck(
    id: string,
    userId: string,
    orgId: string,
  ): Promise<any> {
    // Another organization's object is invisible to this client (row-level
    // security), so it is a 404 here exactly like an id that does not exist.
    const object = await this.db(orgId, userId).storageObject.findUnique({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    // Check ownership
    if (object.uploadedById !== userId) {
      throw new ForbiddenException('You do not have access to this object');
    }

    return object;
  }

  /**
   * Decides, synchronously, what happens to an object whose bytes have just
   * landed (issue #520). Runs inside the caller's transaction.
   *
   *   * No registered processor wants it: mark it `ready` right here, with the
   *     same processed-metadata stamp a processing run writes. One bounded row
   *     — readiness stays instant, and does not depend on a worker running
   *     (`JOBS_WORKER_MODE=off`).
   *   * Otherwise: queue a `storage.object.process` job for it and leave it
   *     `processing`. Dedup is by subject, which is right: one object needs
   *     one processing job in flight, never two.
   *
   * Never downloads and never runs a processor — that is the job's work.
   */
  private async settleUpload(
    tx: StorageTx,
    object: StorageObject,
  ): Promise<StorageObject> {
    if (!this.processing.appliesTo(object)) {
      return tx.storageObject.update({
        where: { id: object.id },
        data: {
          status: 'ready',
          metadata: buildProcessedMetadata(object.metadata, {}),
        },
      });
    }

    const job = await this.jobs.enqueueWithin(tx as unknown as Parameters<JobsService['enqueueWithin']>[0], {
      type: STORAGE_OBJECT_PROCESS_TYPE,
      reason: 'upload',
      subjectType: STORAGE_OBJECT_SUBJECT_TYPE,
      subjectId: object.id,
      // `orgId` rides in the payload: the handler scopes its database client
      // with it (a payload without one is a pre-#725 job; see `resolveJobOrgId`).
      payload: { objectId: object.id, orgId: object.orgId },
    });

    this.logger.log(`Queued processing job ${job.id} for object ${object.id}`);

    return object;
  }

  /**
   * Load an object for a `storage:delete_any` delete: no ownership check,
   * except that another user's profile image is refused. An object counts as
   * an avatar when EITHER marker is present (key under `avatars/` or
   * `metadata.purpose === 'avatar'`), so a row carrying only one of them is
   * still protected.
   * @private
   */
  private async getObjectForDeleteAny(id: string, userId: string, orgId: string) {
    const object = await this.db(orgId, userId).storageObject.findUnique({
      where: { id },
    });

    if (!object) {
      throw new NotFoundException('Object not found');
    }

    if (object.uploadedById !== userId && this.isAvatarObject(object)) {
      throw new ForbiddenException(
        "This object is another user's profile image and cannot be deleted " +
          'through the storage API; it is removed by its owner via ' +
          'DELETE /api/user-settings/profile-image',
      );
    }

    return object;
  }

  private isAvatarObject(object: {
    storageKey: string;
    metadata: StorageJsonValue | null;
  }): boolean {
    const metadata = object.metadata;
    const purpose =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).purpose
        : undefined;
    return (
      object.storageKey.startsWith(AVATARS_KEY_PREFIX) ||
      purpose === AVATAR_PURPOSE
    );
  }

  /**
   * Map Prisma model to response DTO
   */
  private mapToResponseDto(obj: any): ObjectResponseDto {
    return {
      id: obj.id,
      name: obj.name,
      size: obj.size.toString(),
      mimeType: obj.mimeType,
      status: obj.status,
      metadata: obj.metadata as Record<string, unknown> | null,
      createdAt: obj.createdAt.toISOString(),
      updatedAt: obj.updatedAt.toISOString(),
    };
  }

  /**
   * Create audit event for storage operations
   */
  private async createAuditEvent(
    userId: string,
    orgId: string,
    action: string,
    objectId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        orgId,
        action,
        targetType: 'storage_object',
        targetId: objectId,
        meta: (meta ?? undefined) as StorageInputJsonValue | undefined,
      },
    });
  }
}

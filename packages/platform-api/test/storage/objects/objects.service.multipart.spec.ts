import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';

import { ObjectsService } from '../../../src/storage/objects/objects.service';
import { PrismaService } from '../support/app-doubles';
import { STORAGE_PROVIDER } from '../../../src/storage/providers/storage-provider.interface';
import { StorageProviderRouter } from '../../../src/storage/providers/storage-provider-router';
import {
  MultipartPartsMissingError,
  MultipartSessionNotFoundError,
  PartSizeMismatchError,
} from '../../../src/storage/providers/storage-provider.types';
import { createMockPrismaService, MockPrismaService } from '../support/prisma.mock';
import { createMockStorageProvider } from '../support/storage-provider.mock';
import { ObjectProcessingService } from '../../../src/storage/processing/object-processing.service';
import { JobsService } from '../../../src/jobs/index';

// =============================================================================
// Multipart: part-URL batching, API-proxied parts, backend-reported status,
// complete's missing-part report, and per-row provider routing
// =============================================================================

const MIB = 1024 * 1024;
const PART = 10 * MIB;

describe('ObjectsService multipart (provider extensions and routing)', () => {
  let service: ObjectsService;
  let mockPrisma: MockPrismaService;
  let active: ReturnType<typeof createMockStorageProvider>;
  let recorded: ReturnType<typeof createMockStorageProvider>;
  let router: { forObject: jest.Mock; forLocation: jest.Mock };

  const userId = 'user-1';
  const orgId = 'org-1';

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: 'obj-1',
      name: 'big.bin',
      size: BigInt(25 * MIB), // 3 parts at 10 MiB: 10, 10, 5
      mimeType: 'application/octet-stream',
      storageKey: 'uploads/org-1/1/abc.bin',
      storageProvider: 'local',
      bucket: 'root',
      status: 'pending',
      s3UploadId: 'up-1',
      uploadedById: userId,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      chunks: [],
      ...over,
    }) as any;

  const proxied = (over: Record<string, unknown> = {}) =>
    ({
      ...createMockStorageProvider(),
      kind: 'local',
      partUploadMode: 'proxied',
      uploadPart: jest.fn().mockImplementation(async (_k: string, _u: string, _n: number, body: Readable) => {
        for await (const _chunk of body) void _chunk;
        return { eTag: 'abc123' };
      }),
      listUploadedParts: jest.fn().mockResolvedValue([]),
      ...over,
    }) as any;

  const build = async (withRouter: boolean) => {
    mockPrisma = createMockPrismaService();
    mockPrisma.$transaction.mockImplementation(((fn: any) => fn(mockPrisma)) as any);
    active = createMockStorageProvider();
    recorded = createMockStorageProvider();
    router = { forObject: jest.fn().mockResolvedValue(recorded), forLocation: jest.fn().mockResolvedValue(active) };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => (key === 'storage.partSize' ? PART : key === 'appUrl' ? 'https://app.example.test/' : fallback)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STORAGE_PROVIDER, useValue: active },
        { provide: ConfigService, useValue: config },
        { provide: ObjectProcessingService, useValue: { appliesTo: jest.fn().mockReturnValue(true) } },
        { provide: JobsService, useValue: { enqueueWithin: jest.fn().mockResolvedValue({ id: 'job-1' }) } },
        ...(withRouter ? [{ provide: StorageProviderRouter, useValue: router }] : []),
      ],
    }).compile();

    service = module.get(ObjectsService);
  };

  beforeEach(() => build(true));

  describe('init and part-urls', () => {
    it('answers partUploadAuth "none" with at most 10 presigned URLs, from the ACTIVE provider', async () => {
      mockPrisma.storageObject.create.mockResolvedValue(row({ id: 'new' }));
      active.initMultipartUpload.mockResolvedValue({ uploadId: 'up-9', key: 'k' });

      const result = await service.initUpload({ name: 'a.bin', size: 200 * MIB, mimeType: 'application/octet-stream' }, userId, orgId);

      expect(router.forLocation).toHaveBeenCalledWith(null);
      expect(result.totalParts).toBe(20);
      expect(result.presignedUrls).toHaveLength(10);
      expect(result.partUploadAuth).toBe('none');
      expect(active.getSignedUploadUrl).toHaveBeenCalledTimes(10);
    });

    it('answers partUploadAuth "bearer" with the API part route for a proxied driver (no signing)', async () => {
      const local = proxied();
      router.forLocation.mockResolvedValue(local);
      local.initMultipartUpload.mockResolvedValue({ uploadId: 'up-9', key: 'k' });
      mockPrisma.storageObject.create.mockResolvedValue(row({ id: 'new' }));

      const result = await service.initUpload({ name: 'a.bin', size: 25 * MIB, mimeType: 'application/octet-stream' }, userId, orgId);

      expect(result.partUploadAuth).toBe('bearer');
      expect(result.presignedUrls.map((p) => p.url)).toEqual([
        'https://app.example.test/api/storage/objects/new/upload/parts/1',
        'https://app.example.test/api/storage/objects/new/upload/parts/2',
        'https://app.example.test/api/storage/objects/new/upload/parts/3',
      ]);
      expect(local.getSignedUploadUrl).not.toHaveBeenCalled();
      const created = mockPrisma.storageObject.create.mock.calls[0][0] as any;
      expect(created.data.storageProvider).toBe('local');
    });

    it('mints more part URLs from the provider recorded on the row', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ storageProvider: 'r2' }));

      const result = await service.getPartUrls('obj-1', { partNumbers: [2, 3] }, userId, orgId);

      expect(router.forObject).toHaveBeenCalledWith(expect.objectContaining({ storageProvider: 'r2' }));
      expect(recorded.getSignedUploadUrl).toHaveBeenCalledTimes(2);
      expect(result.partUploadAuth).toBe('none');
      expect(result.presignedUrls.map((p) => p.partNumber)).toEqual([2, 3]);
    });

    it('is a 404 for another user\'s upload and a 400 PART_OUT_OF_RANGE past the last part', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ uploadedById: 'someone-else' }));
      await expect(service.getPartUrls('obj-1', { partNumbers: [1] }, userId, orgId)).rejects.toBeInstanceOf(NotFoundException);

      mockPrisma.storageObject.findUnique.mockResolvedValue(row());
      await expect(service.getPartUrls('obj-1', { partNumbers: [4] }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'PART_OUT_OF_RANGE', totalParts: 3 } },
      });
    });

    it('is a 400 UPLOAD_NOT_ACTIVE once the upload is no longer open', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ status: 'ready' }));
      await expect(service.getPartUrls('obj-1', { partNumbers: [1] }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_NOT_ACTIVE' } },
      });
    });
  });

  describe('uploadPart (proxied)', () => {
    const partBody = (bytes: number, chunk = 1 * MIB) =>
      Readable.from(
        (function* () {
          let left = bytes;
          while (left > 0) {
            const size = Math.min(chunk, left);
            left -= size;
            yield Buffer.alloc(size, 1);
          }
        })(),
      );

    beforeEach(() => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());
      router.forObject.mockResolvedValue(proxied());
    });

    it('streams the exact bytes to the driver and answers a quoted ETag, recording the part with its real size', async () => {
      const driver = proxied();
      router.forObject.mockResolvedValue(driver);

      const result = await service.uploadPart('obj-1', 1, userId, orgId, partBody(PART), PART);

      expect(result).toEqual({ eTag: '"abc123"' });
      expect(driver.uploadPart).toHaveBeenCalledWith('uploads/org-1/1/abc.bin', 'up-1', 1, expect.anything(), PART);
      expect(mockPrisma.storageObjectChunk.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ partNumber: 1, size: BigInt(PART), eTag: '"abc123"' }) }),
      );
    });

    it('expects the remainder for the last part', async () => {
      const result = await service.uploadPart('obj-1', 3, userId, orgId, partBody(5 * MIB), 5 * MIB);
      expect(result.eTag).toBe('"abc123"');
    });

    it('is a 404 for another user\'s upload', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ uploadedById: 'someone-else' }));
      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(1), 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 400 PRESIGNED_PARTS_REQUIRED on a presigned driver', async () => {
      router.forObject.mockResolvedValue(createMockStorageProvider());
      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(PART), PART)).rejects.toMatchObject({
        response: { details: { reason: 'PRESIGNED_PARTS_REQUIRED' } },
      });
    });

    it('is a 400 UPLOAD_NOT_ACTIVE for a completed upload', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ status: 'processing' }));
      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(PART), PART)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_NOT_ACTIVE', status: 'processing' } },
      });
    });

    it('is a 400 PART_OUT_OF_RANGE outside 1..totalParts', async () => {
      for (const n of [0, 4]) {
        await expect(service.uploadPart('obj-1', n, userId, orgId, partBody(1), 1)).rejects.toMatchObject({
          response: { details: { reason: 'PART_OUT_OF_RANGE', totalParts: 3 } },
        });
      }
    });

    it('is a 400 PART_SIZE_MISMATCH for a wrong Content-Length, before any byte is read', async () => {
      const driver = proxied();
      router.forObject.mockResolvedValue(driver);

      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(PART - 1), PART - 1)).rejects.toMatchObject({
        response: { details: { reason: 'PART_SIZE_MISMATCH', partNumber: 1, expectedSize: PART, receivedSize: PART - 1 } },
      });
      expect(driver.uploadPart).not.toHaveBeenCalled();
    });

    it('is a 400 PART_SIZE_MISMATCH when the streamed body is short or long, and keeps nothing', async () => {
      for (const actual of [PART - 4096, PART + 4096]) {
        await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(actual), undefined)).rejects.toMatchObject({
          response: { details: { reason: 'PART_SIZE_MISMATCH', expectedSize: PART } },
        });
      }
      expect(mockPrisma.storageObjectChunk.upsert).not.toHaveBeenCalled();
    });

    it('maps a driver-raised size mismatch and a dead session', async () => {
      const driver = proxied({ uploadPart: jest.fn().mockRejectedValue(new PartSizeMismatchError(1, PART, 5, false)) });
      router.forObject.mockResolvedValue(driver);
      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(PART), PART)).rejects.toBeInstanceOf(BadRequestException);

      driver.uploadPart.mockRejectedValue(new MultipartSessionNotFoundError('up-1'));
      await expect(service.uploadPart('obj-1', 1, userId, orgId, partBody(PART), PART)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_SESSION_INVALID' } },
      });
    });

    it('never holds more than a chunk of the body at once (the streamed part is bounded, not buffered)', async () => {
      let largestChunk = 0;
      let total = 0;
      const driver = proxied({
        uploadPart: jest.fn().mockImplementation(async (_k: string, _u: string, _n: number, body: Readable) => {
          for await (const chunk of body) {
            largestChunk = Math.max(largestChunk, (chunk as Buffer).length);
            total += (chunk as Buffer).length;
          }
          return { eTag: 'x' };
        }),
      });
      router.forObject.mockResolvedValue(driver);

      await service.uploadPart('obj-1', 1, userId, orgId, partBody(PART, 64 * 1024), PART);

      expect(total).toBe(PART);
      expect(largestChunk).toBeLessThanOrEqual(64 * 1024);
    });
  });

  describe('getUploadStatus', () => {
    it('reports the parts the BACKEND holds, not the chunk rows', async () => {
      const listing = proxied({
        listUploadedParts: jest.fn().mockResolvedValue([
          { partNumber: 3, size: 5 * MIB, eTag: 'c' },
          { partNumber: 1, size: PART, eTag: 'a' },
        ]),
      });
      router.forObject.mockResolvedValue(listing);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ chunks: [] }));

      const status = await service.getUploadStatus('obj-1', userId, orgId);

      expect(status.uploadedParts).toEqual([1, 3]);
      expect(status.uploadedBytes).toBe(String(PART + 5 * MIB));
      expect(status.totalParts).toBe(3);
      expect(listing.listUploadedParts).toHaveBeenCalledWith('uploads/org-1/1/abc.bin', 'up-1');
    });

    it('falls back to the chunk rows for a provider that cannot list', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ chunks: [{ partNumber: 2, size: BigInt(PART), eTag: 'b' }] }));
      const status = await service.getUploadStatus('obj-1', userId, orgId);
      expect(status.uploadedParts).toEqual([2]);
    });

    it('does not list a finished upload', async () => {
      const listing = proxied();
      router.forObject.mockResolvedValue(listing);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ status: 'ready', s3UploadId: null }));
      await service.getUploadStatus('obj-1', userId, orgId);
      expect(listing.listUploadedParts).not.toHaveBeenCalled();
    });

    it('is a 409 UPLOAD_SESSION_INVALID when the backend lost the session', async () => {
      router.forObject.mockResolvedValue(proxied({ listUploadedParts: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NoSuchUpload' })) }));
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());
      await expect(service.getUploadStatus('obj-1', userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_SESSION_INVALID' } },
      });
    });
  });

  describe('completeUpload', () => {
    const parts = (numbers: number[]) => numbers.map((partNumber) => ({ partNumber, eTag: `"e${partNumber}"` }));
    const held = (numbers: number[]) => numbers.map((partNumber) => ({ partNumber, size: PART, eTag: `e${partNumber}` }));

    it('reports the parts the backend does not hold, naming them, and completes nothing', async () => {
      const driver = createMockStorageProvider();
      Object.assign(driver, { listUploadedParts: jest.fn().mockResolvedValue(held([1, 3])) });
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());

      const error = await service.completeUpload('obj-1', { parts: parts([1, 2, 3]) }, userId, orgId).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.response.details).toEqual({ reason: 'UPLOAD_PARTS_MISSING', partNumbers: [2] });
      expect(driver.completeMultipartUpload).not.toHaveBeenCalled();
      expect(mockPrisma.storageObjectChunk.upsert).not.toHaveBeenCalled();
    });

    it('reports a part whose ETag differs from the backend\'s', async () => {
      const driver = createMockStorageProvider();
      Object.assign(driver, { listUploadedParts: jest.fn().mockResolvedValue([...held([1, 3]), { partNumber: 2, size: PART, eTag: 'other' }]) });
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());

      await expect(service.completeUpload('obj-1', { parts: parts([1, 2, 3]) }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_PARTS_MISSING', partNumbers: [2] } },
      });
    });

    it('requires every part of the object to be listed', async () => {
      const driver = createMockStorageProvider();
      Object.assign(driver, { listUploadedParts: jest.fn().mockResolvedValue(held([1, 2, 3])) });
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());

      await expect(service.completeUpload('obj-1', { parts: parts([1, 3]) }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_PARTS_MISSING', partNumbers: [2] } },
      });
    });

    it('is a 409 UPLOAD_SESSION_INVALID when the session is gone', async () => {
      const driver = createMockStorageProvider();
      Object.assign(driver, { listUploadedParts: jest.fn().mockRejectedValue(new MultipartSessionNotFoundError('up-1')) });
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());

      await expect(service.completeUpload('obj-1', { parts: parts([1, 2, 3]) }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_SESSION_INVALID' } },
      });
    });

    it('maps a driver\'s missing-parts error and forgets those chunks', async () => {
      const driver = createMockStorageProvider();
      driver.completeMultipartUpload.mockRejectedValue(new MultipartPartsMissingError([2]));
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());

      await expect(service.completeUpload('obj-1', { parts: parts([1, 2, 3]) }, userId, orgId)).rejects.toMatchObject({
        response: { details: { reason: 'UPLOAD_PARTS_MISSING', partNumbers: [2] } },
      });
      expect(mockPrisma.storageObjectChunk.deleteMany).toHaveBeenCalledWith({ where: { objectId: 'obj-1', partNumber: { in: [2] } } });
    });

    it('completes on the provider recorded on the row when every part is held', async () => {
      const driver = createMockStorageProvider();
      Object.assign(driver, { listUploadedParts: jest.fn().mockResolvedValue(held([1, 2, 3])) });
      router.forObject.mockResolvedValue(driver);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row());
      mockPrisma.storageObject.update.mockResolvedValue(row({ status: 'processing' }));

      await service.completeUpload('obj-1', { parts: parts([1, 2, 3]) }, userId, orgId);

      expect(driver.completeMultipartUpload).toHaveBeenCalledWith('uploads/org-1/1/abc.bin', 'up-1', parts([1, 2, 3]));
      expect(active.completeMultipartUpload).not.toHaveBeenCalled();
    });
  });

  describe('per-row routing of reads, deletes and aborts', () => {
    const stored = () => row({ status: 'ready', storageProvider: 'r2', bucket: 'old-bucket', s3UploadId: null });

    it('signs the download URL with the provider recorded on the row, not the active one', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(stored());
      recorded.getSignedDownloadUrl.mockResolvedValue('https://old-bucket.example.test/x');

      const result = await service.getDownloadUrl('obj-1', userId, orgId);

      expect(router.forObject).toHaveBeenCalledWith(expect.objectContaining({ storageProvider: 'r2', bucket: 'old-bucket' }));
      expect(result.url).toBe('https://old-bucket.example.test/x');
      expect(active.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('deletes the bytes on the provider recorded on the row', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(stored());
      await service.delete('obj-1', userId, orgId);
      expect(recorded.delete).toHaveBeenCalledWith('uploads/org-1/1/abc.bin');
      expect(active.delete).not.toHaveBeenCalled();
    });

    it('aborts on the provider recorded on the row', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ storageProvider: 'r2' }));
      await service.abortUpload('obj-1', userId, orgId);
      expect(recorded.abortMultipartUpload).toHaveBeenCalledWith('uploads/org-1/1/abc.bin', 'up-1');
      expect(active.abortMultipartUpload).not.toHaveBeenCalled();
    });
  });

  describe('without a router (a spec that builds the service alone)', () => {
    it('uses the injected provider for every row', async () => {
      await build(false);
      mockPrisma.storageObject.findUnique.mockResolvedValue(row({ status: 'ready', s3UploadId: null }));
      await service.getDownloadUrl('obj-1', userId, orgId);
      expect(active.getSignedDownloadUrl).toHaveBeenCalled();
    });
  });
});

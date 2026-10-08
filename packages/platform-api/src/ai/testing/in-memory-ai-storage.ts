// =============================================================================
// In-memory object storage for AI tests (issue #437). TEST-ONLY.
// =============================================================================
//
// Just enough of two collaborators for the REAL `AiStorageInputResolver`
// and `AiOutputWriter` to run against:
//
//   - `prisma`: `storageObject.findUnique/findMany/create/delete` over an
//     array of rows. Ownership (`uploadedById === userId`) is the only access
//     check the resolver makes (#516 removed the unseeded `storage:read_any`
//     bypass), so there is no permission table to fake here any more;
//   - `store` (also `provider`): an `AiObjectStore` (the `AI_OBJECT_STORE`
//     port) whose `upload`/`download`/`delete` move bytes in and out of a
//     `Map`, whose `getSignedDownloadUrl` (#441) mints a fake presigned URL
//     carrying `IN_MEMORY_PRESIGNED_SIGNATURE` (a sentinel the secret-egress
//     suite hunts for), and whose `assertWritable` is switchable to the
//     unconfigured state with `setConfigured(false)` — which also makes every
//     call throw `InMemoryStorageNotConfiguredError`, the shape of the
//     reference app's `StorageNotConfiguredError`.
// =============================================================================

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { ServiceUnavailableException } from '@nestjs/common';

import type { AiObjectStore } from '../ports';

/**
 * The in-memory store's "storage not configured" error: the shape the
 * reference app's `StorageNotConfiguredError` has (a 503 whose body carries
 * `details.reason` and `details.remedy`).
 */
export class InMemoryStorageNotConfiguredError extends ServiceUnavailableException {
  constructor() {
    super({
      message: 'Object storage is not configured',
      details: { reason: 'storage_not_configured', remedy: 'Configure storage at /admin/settings/storage', missing: ['bucket', 'secretAccessKey'] },
    });
  }
}

export interface InMemoryStorageObject {
  id: string;
  name: string;
  size: bigint;
  mimeType: string;
  storageKey: string;
  storageProvider: string;
  bucket: string | null;
  status: string;
  metadata: unknown;
  uploadedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const BUCKET = 'in-memory-bucket';

/**
 * Every presigned URL this storage mints carries this signature — a sentinel
 * that must never appear in a response, log line or persisted row (#441).
 */
export const IN_MEMORY_PRESIGNED_SIGNATURE = 'presigned-sentinel-5f3a9c';

/** The origin of every presigned URL this storage mints. */
export const IN_MEMORY_PRESIGNED_ORIGIN = 'https://in-memory-storage.test';

function pick(row: object, select?: Record<string, boolean>): Record<string, unknown> {
  const source = row as Record<string, unknown>;

  if (!select) return { ...source };

  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, source[k]]));
}

export function createInMemoryAiStorage() {
  const objects: InMemoryStorageObject[] = [];
  const blobs = new Map<string, Buffer>();
  let configured = true;

  const assertConfigured = () => {
    if (!configured) throw new InMemoryStorageNotConfiguredError();
  };

  const provider = {
    upload: jest.fn(async (key: string, stream: Readable) => {
      assertConfigured();

      const chunks: Buffer[] = [];

      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));

      blobs.set(key, Buffer.concat(chunks));

      return { key, bucket: BUCKET, location: `memory://${BUCKET}/${key}` };
    }),
    download: jest.fn(async (key: string) => {
      assertConfigured();

      const bytes = blobs.get(key);

      if (!bytes) throw new Error(`in-memory storage: no object at ${key}`);

      return Readable.from([bytes]);
    }),
    delete: jest.fn(async (key: string) => {
      assertConfigured();
      blobs.delete(key);
    }),
    getSignedDownloadUrl: jest.fn(async (key: string, options?: { expiresIn?: number }) => {
      assertConfigured();

      if (!blobs.has(key)) throw new Error(`in-memory storage: no object at ${key}`);

      return (
        `${IN_MEMORY_PRESIGNED_ORIGIN}/${BUCKET}/${key}?X-Amz-Expires=${options?.expiresIn ?? 3600}` +
        `&X-Amz-Signature=${IN_MEMORY_PRESIGNED_SIGNATURE}-${randomUUID()}`
      );
    }),
    assertWritable: jest.fn(async () => {
      assertConfigured();
    }),
    activeProvider: jest.fn(async () => 's3'),
    notConfiguredReason: (err: unknown): string | null =>
      err instanceof InMemoryStorageNotConfiguredError ? 'storage_not_configured' : null,
    settingsPath: '/admin/settings/storage',
  } satisfies AiObjectStore;

  const prisma: any = {
    // Organization scope (#725): no row-level security in memory, so a scoped client is the client.
    forOrg: jest.fn(() => prisma),
    organization: { findFirst: jest.fn(async () => ({ id: '33333333-3333-4333-8333-333333333333' })) },
    storageObject: {
      findUnique: jest.fn(async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = objects.find((o) => o.id === args.where.id);
        return row ? pick(row, args.select) : null;
      }),
      findMany: jest.fn(async (args: { where: { id: { in: string[] } }; select?: Record<string, boolean> }) =>
        objects.filter((o) => args.where.id.in.includes(o.id)).map((o) => pick(o, args.select)),
      ),
      create: jest.fn(async (args: { data: Partial<InMemoryStorageObject>; select?: Record<string, boolean> }) => {
        const now = new Date();
        const row: InMemoryStorageObject = {
          id: randomUUID(),
          name: '',
          size: 0n,
          mimeType: 'application/octet-stream',
          storageKey: '',
          storageProvider: 's3',
          bucket: null,
          status: 'pending',
          metadata: null,
          uploadedById: null,
          createdAt: now,
          updatedAt: now,
          ...args.data,
        };
        objects.push(row);
        return pick(row, args.select);
      }),
      delete: jest.fn(async (args: { where: { id: string } }) => {
        const index = objects.findIndex((o) => o.id === args.where.id);
        if (index === -1) throw new Error('storageObject.delete: not found');
        return objects.splice(index, 1)[0];
      }),
    },
  };

  return {
    objects,
    blobs,
    /** The `AI_OBJECT_STORE` binding. */
    store: provider as AiObjectStore,
    /** The same object, with its jest mocks typed (`provider.upload.mock.calls`). */
    provider,
    prisma,
    /** Adds a `ready` object (with bytes) owned by `uploadedById`; returns its row. */
    addObject(input: {
      uploadedById: string;
      bytes?: Buffer;
      mimeType?: string;
      name?: string;
      status?: string;
      /** The row's recorded size; defaults to the byte count. */
      size?: number;
    }): InMemoryStorageObject {
      const bytes = input.bytes ?? Buffer.from('fake-image-bytes');
      const now = new Date();
      const row: InMemoryStorageObject = {
        id: randomUUID(),
        name: input.name ?? 'upload.png',
        size: BigInt(input.size ?? bytes.length),
        mimeType: input.mimeType ?? 'image/png',
        storageKey: `uploads/${now.getTime()}/${randomUUID()}.png`,
        storageProvider: 's3',
        bucket: BUCKET,
        status: input.status ?? 'ready',
        metadata: null,
        uploadedById: input.uploadedById,
        createdAt: now,
        updatedAt: now,
      };

      objects.push(row);
      blobs.set(row.storageKey, bytes);

      return row;
    },
    /** Switch the deployment between configured and unconfigured storage. */
    setConfigured(value: boolean) {
      configured = value;
    },
    /** Forget every object and blob; configured again. */
    reset() {
      objects.length = 0;
      blobs.clear();
      configured = true;
    },
  };
}

export type InMemoryAiStorage = ReturnType<typeof createInMemoryAiStorage>;

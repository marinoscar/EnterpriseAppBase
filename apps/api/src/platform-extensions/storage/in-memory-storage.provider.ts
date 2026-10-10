import { Readable } from 'node:stream';

import type {
  MultipartUploadInit,
  SignedPutUrlOptions,
  SignedUrlOptions,
  StorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
  UploadPart,
} from '@marinoscar/platform-api/storage';

// =============================================================================
// EXAMPLE, NOT WIRED: an app storage backend (PP-14.1)
// =============================================================================
//
// Rung 3 of the extension ladder: `STORAGE_PROVIDER` is the object store every
// package consumer injects (objects API, profile images, data exports, database
// backups, the AI output writer, the nodes data plane). The platform's default
// is `ResolvingStorageProvider` (S3, R2 or an S3-compatible service, configured
// at `/admin/settings/storage`).
//
// An app with a different backend (Azure Blob, a local disk, this in-memory
// store) hands its provider to `StorageModule.forRoot({ provider })`:
//
//   export const StorageModule = PlatformStorageModule.forRoot({
//     imports: [StorageHostModule],
//     provider: { useClass: InMemoryStorageProvider },
//   });
//
// and EVERY package consumer receives it. Providing `STORAGE_PROVIDER` in an
// app module does not work: Nest resolves a token from the consuming module's
// own imports first, and every package module imports `StorageProvidersModule`.
//
// `kind` is what the platform writes to `storage_objects.storage_provider` and
// to the backup rows, so pick a stable lowercase id.
//
// WHY IT IS NOT WIRED. Binding it would replace the S3 driver for every fork.
// It is compiled with the app and exercised by
// `test/examples/storage/storage-provider-override.spec.ts`.
// =============================================================================

/** The id this example records on the rows it stores. */
export const IN_MEMORY_STORAGE_KIND = 'in-memory';

function notSupported(method: string): never {
  throw new Error(`InMemoryStorageProvider.${method}() is not implemented by this example.`);
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/** A `StorageProvider` that keeps every object in a `Map` (single process, not durable). */
export class InMemoryStorageProvider implements StorageProvider {
  readonly kind: string = IN_MEMORY_STORAGE_KIND;

  /** The stored objects, by key. */
  readonly objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();

  constructor(private readonly bucket: string = 'in-memory-bucket') {}

  async upload(key: string, stream: Readable, options: StorageUploadOptions): Promise<StorageUploadResult> {
    this.objects.set(key, { body: await collect(stream), metadata: { ...(options.metadata ?? {}) } });
    return { key, bucket: this.bucket, location: `memory://${this.bucket}/${key}` };
  }

  async download(key: string): Promise<Readable> {
    const entry = this.objects.get(key);
    if (!entry) throw new Error(`No such object: ${key}`);
    return Readable.from([entry.body]);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getMetadata(key: string): Promise<Record<string, string> | null> {
    return this.objects.get(key)?.metadata ?? null;
  }

  async setMetadata(key: string, metadata: Record<string, string>): Promise<void> {
    const entry = this.objects.get(key);
    if (entry) entry.metadata = { ...metadata };
  }

  getBucket(): string {
    return this.bucket;
  }

  initMultipartUpload(_key: string, _options: StorageUploadOptions): Promise<MultipartUploadInit> {
    return notSupported('initMultipartUpload');
  }

  getSignedUploadUrl(_key: string, _uploadId: string, _partNumber: number, _expiresIn?: number): Promise<string> {
    return notSupported('getSignedUploadUrl');
  }

  completeMultipartUpload(_key: string, _uploadId: string, _parts: UploadPart[]): Promise<StorageUploadResult> {
    return notSupported('completeMultipartUpload');
  }

  abortMultipartUpload(_key: string, _uploadId: string): Promise<void> {
    return notSupported('abortMultipartUpload');
  }

  getSignedDownloadUrl(_key: string, _options?: SignedUrlOptions): Promise<string> {
    return notSupported('getSignedDownloadUrl');
  }

  getSignedPutUrl(_key: string, _options?: SignedPutUrlOptions): Promise<string> {
    return notSupported('getSignedPutUrl');
  }
}

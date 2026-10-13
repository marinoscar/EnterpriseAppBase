// =============================================================================
// A write-failing object storage double for read-only proofs (PP-14.26)
// =============================================================================
//
// The storage half of the read-only rule. The five side-effecting "test"
// services a Doctor check must never call (`StorageConnectionTestService`
// first among them) write a probe object; a check that uploaded, deleted,
// re-tagged or presigned an upload URL would leave a trace in the customer's
// bucket. This double has the shape of the storage provider
// (`@marinoscar/platform-api/storage`, token `STORAGE_PROVIDER`), answers reads
// with benign values, and records and REJECTS every write.
//
// It is typed structurally, not as `StorageProvider`: the doctor slice does not
// depend on the storage slice (storage depends on doctor), so a cast at the
// binding site (`{ provide: STORAGE_PROVIDER, useValue: storage.provider }`) is
// the whole integration.
// =============================================================================

import { Readable } from 'node:stream';

import { ReadOnlyViolationError } from './recording-prisma';

/**
 * One call the storage double saw.
 *
 * @stability experimental
 */
export interface RecordedStorageOperation {
  /** The provider method: `upload`, `exists`, `getBucket`. */
  readonly method: string;
  /** The object key, when the call carried one. */
  readonly key?: string;
  /** Whether the method writes (or mints a credential to write). */
  readonly write: boolean;
}

/**
 * What {@link createWriteFailingStorage} accepts.
 *
 * @stability experimental
 */
export interface WriteFailingStorageOptions {
  /** Whether a write rejects with `ReadOnlyViolationError` (default true); off, it is recorded and resolves to `undefined`. See `RecordingPrismaOptions.refuseWrites`. */
  readonly refuseWrites?: boolean;
  /** The provider `kind` it reports (default `fake`). */
  readonly kind?: string;
  /** The bucket name `getBucket()` answers (default `doctor-read-only-bucket`). */
  readonly bucket?: string;
  /** Keys `exists()` answers `true` for (default none). */
  readonly existingKeys?: readonly string[];
}

/**
 * A recording, write-refusing stand-in for the storage provider.
 *
 * @stability experimental
 */
export interface WriteFailingStorage {
  /** The provider to bind under `STORAGE_PROVIDER` or hand to a check. Typed `any`: it stands in for the provider interface. */
  readonly provider: any;
  /** Every call seen so far, in order. */
  operations(): readonly RecordedStorageOperation[];
  /** The calls that write; empty means the check never wrote to storage. */
  violations(): readonly RecordedStorageOperation[];
  /** Turns the rejection of writes on or off (they are recorded either way). */
  refuseWrites(on: boolean): void;
  /** Forgets every recorded call. */
  reset(): void;
}

/** The provider methods that write, or hand out a credential to write. */
const WRITE_METHODS: readonly string[] = [
  'upload',
  'initMultipartUpload',
  'getSignedUploadUrl',
  'completeMultipartUpload',
  'abortMultipartUpload',
  'getSignedPutUrl',
  'delete',
  'setMetadata',
];

/**
 * Builds a storage provider double: reads answer, writes are recorded and reject.
 *
 * @param options - the reported kind and bucket, and which keys exist.
 * @returns the provider and its recorder.
 *
 * @example
 * ```ts
 * const storage = createWriteFailingStorage({ existingKeys: ['health/probe'] });
 * await runDoctorCheck(new BucketDoctorCheck(registry, storage.provider));
 * expect(storage.violations()).toEqual([]);
 * ```
 *
 * @stability experimental
 */
export function createWriteFailingStorage(options: WriteFailingStorageOptions = {}): WriteFailingStorage {
  const operations: RecordedStorageOperation[] = [];
  const existing = new Set(options.existingKeys ?? []);
  let refusing = options.refuseWrites !== false;

  const record = (method: string, key: unknown, write: boolean): void => {
    operations.push(typeof key === 'string' ? { method, key, write } : { method, write });
  };

  const provider: Record<string, unknown> = {
    kind: options.kind ?? 'fake',
    getBucket: () => {
      record('getBucket', undefined, false);
      return options.bucket ?? 'doctor-read-only-bucket';
    },
    exists: async (key: string) => {
      record('exists', key, false);
      return existing.has(key);
    },
    getMetadata: async (key: string) => {
      record('getMetadata', key, false);
      return existing.has(key) ? {} : null;
    },
    download: async (key: string) => {
      record('download', key, false);
      return Readable.from([]);
    },
    getSignedDownloadUrl: async (key: string) => {
      record('getSignedDownloadUrl', key, false);
      return `https://storage.invalid/${encodeURIComponent(key)}`;
    },
  };

  for (const method of WRITE_METHODS) {
    provider[method] = async (key?: unknown) => {
      record(method, key, true);
      if (refusing) throw new ReadOnlyViolationError('storage', method);
      return undefined;
    };
  }

  return {
    provider,
    operations: () => [...operations],
    violations: () => operations.filter((operation) => operation.write),
    refuseWrites: (on) => {
      refusing = on;
    },
    reset: () => {
      operations.length = 0;
    },
  };
}

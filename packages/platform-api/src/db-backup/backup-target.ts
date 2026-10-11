// =============================================================================
// The backup target port (PP-14.12)
// =============================================================================
//
// WHERE AN ARCHIVE LIVES is one port, `DB_BACKUP_TARGET`, so an app can put its
// backups somewhere the platform's object-storage drivers do not reach (a
// filesystem, a vault, a tape gateway) and can keep a second copy elsewhere
// (`mirrorTargets`), without editing the slice. The default is an adapter over
// the active `STORAGE_PROVIDER` ({@link StorageProviderBackupTarget}), which is
// exactly what the engine did before the port existed.
//
//   const DbBackupModule = PlatformDbBackupModule.forRoot({
//     target: { useClass: VaultBackupTarget },          // optional: the primary
//     mirrorTargets: [{ useClass: LocalDirBackupTarget }], // optional: copies
//   });
//
// -----------------------------------------------------------------------------
// THE RULES A TARGET HONOURS (the conformance kit asserts each)
// -----------------------------------------------------------------------------
//
//   1. THE KEY IS THE SERVER'S. A target receives a key the engine built
//      (`database-backups/<slug>/<yyyy>/<mm>/<file>.dump`, see
//      `buildBackupStorageKey`) and stores the archive under it. It never
//      chooses, rewrites or derives a key from anything else, and it refuses a
//      key that would escape its own root (`..`, an absolute path).
//   2. AN ARCHIVE IS NEVER BUFFERED. `openWrite` returns a streaming sink: the
//      engine pipes `pg_dump`'s standard output into `stream` and awaits
//      `done`. A target that collects the bytes and writes them at the end
//      defeats the point (a database dump is gigabytes); the kit streams 20 MiB
//      through every target and fails one whose memory grows with the object.
//      `openRead` is a stream for the same reason.
//   3. BOTH HALVES ARE AWAITED. A write succeeded when `done` resolved AND the
//      dump exited 0 (the runner awaits both, and reads the object back through
//      `openRead` to prove it is a readable archive before it marks the run
//      `completed`).
//   4. `delete` OF A MISSING KEY IS NOT AN ERROR (retention and the failure
//      path both delete keys that may never have been written).
//   5. A TARGET HOLDS NO SECRET IN A LOG OR AN ERROR. Its credentials come from
//      the encrypted credential store, never an environment variable.
//
// A MIRROR IS A COPY, NOT A SECOND PRIMARY. It is written only after the
// primary's archive was written, read back and verified, by streaming the
// primary's bytes through `openRead` into the mirror's `openWrite` (the dump is
// never run twice), inside the same `db.backup.run` job. A mirror that fails
// is recorded (an `audit_events` row, a log line, the `backup.mirrors` Doctor
// check) and never fails the run: the primary is already restorable.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { Readable, Writable } from 'node:stream';
import { PassThrough } from 'node:stream';

import type { StorageConfigService, StorageProvider } from '../storage/index';

/**
 * Injection token of the primary {@link BackupTarget}: where every archive is
 * written, read back, downloaded from and deleted. Bound through
 * `DbBackupModule.forRoot({ target })`; the default is an adapter over
 * `STORAGE_PROVIDER`.
 *
 * @example
 * ```ts
 * constructor(@Inject(DB_BACKUP_TARGET) private readonly target: BackupTarget) {}
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_TARGET: unique symbol = Symbol.for('@marinoscar/platform/db-backup/TARGET');

/**
 * Injection token of the mirror targets, as one array (empty when the app
 * configured none). Bound through `DbBackupModule.forRoot({ mirrorTargets })`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const DB_BACKUP_MIRROR_TARGETS: unique symbol = Symbol.for('@marinoscar/platform/db-backup/MIRROR_TARGETS');

/**
 * What the engine tells a target about the object it is about to receive.
 *
 * @stability experimental
 */
export interface BackupWriteMeta {
  /** The object's media type (`application/octet-stream`: a custom-format archive has none of its own). */
  readonly contentType: string;
  /** Provenance to store on the object when the backend can (`runId`, `trigger`). Plain strings. */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * A streaming write: the engine pipes the archive into `stream` and awaits
 * `done`.
 *
 * `done` resolves once every byte is durably stored and rejects when the write
 * failed. When `stream` is destroyed with an error (the dump died, the run was
 * cancelled) `done` must reject, and the target must not leave a half-written
 * object it can avoid (the engine also calls `delete(key)` on failure).
 *
 * @stability experimental
 */
export interface BackupSink {
  /** The writable side. Honour backpressure: `write` returns `false` when the target is behind. */
  readonly stream: Writable;
  /** Settles when the object is fully stored (or the write failed). */
  readonly done: Promise<void>;
}

/**
 * One object a {@link BackupTarget} lists.
 *
 * @stability experimental
 */
export interface BackupTargetObject {
  /** The full key, including the prefix. */
  readonly key: string;
  /** The object's size in bytes, when the backend reports it. */
  readonly sizeBytes?: number;
  /** When it was last written, when the backend reports it. */
  readonly lastModified?: Date;
}

/**
 * Options of {@link BackupTarget.signedDownloadUrl}.
 *
 * @stability experimental
 */
export interface BackupSignedUrlOptions {
  /** How long the URL stays valid, in seconds. */
  readonly expiresInSeconds: number;
  /** The file name the browser should save the archive under. */
  readonly filename: string;
}

/**
 * Where database backup archives live: a streaming object store with a key.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class LocalDirBackupTarget implements BackupTarget {
 *   readonly id = 'local-dir';
 *   openWrite(key: string): BackupSink { const stream = createWriteStream(this.path(key)); return { stream, done: finished(stream) }; }
 *   openRead(key: string): Promise<Readable> { return Promise.resolve(createReadStream(this.path(key))); }
 *   delete(key: string): Promise<void> { return rm(this.path(key), { force: true }); }
 *   async *list(prefix: string) { /* ... *\/ }
 * }
 * ```
 *
 * @extensionPoint port
 * @stability experimental
 */
export interface BackupTarget {
  /**
   * The id recorded on every run (`database_backup_runs.storage_provider`) and
   * compared with `databaseBackup.storageProvider`: a stable lowercase id
   * (`'s3'`, `'local-dir'`). May change over time for a target that follows a
   * setting (see {@link BackupTarget.refresh}).
   */
  readonly id: string;
  /**
   * Where the target points, recorded on every run as `database_backup_runs.bucket`
   * (a bucket, a directory). Default: the {@link BackupTarget.id}.
   */
  readonly location?: string;
  /**
   * Re-reads the settings `id` and `location` depend on. Called before they are
   * read for a new run; a target with a fixed identity omits it.
   */
  refresh?(): Promise<void>;
  /**
   * Opens a streaming write of the object `key`. See the file header.
   *
   * @param key - the server-chosen key.
   * @param meta - the object's content type and provenance.
   * @returns the sink.
   */
  openWrite(key: string, meta: BackupWriteMeta): BackupSink;
  /**
   * Opens a streaming read of the object `key`.
   *
   * @param key - the key.
   * @returns the readable stream.
   * @throws when the object does not exist.
   */
  openRead(key: string): Promise<Readable>;
  /**
   * Deletes the object `key`. A missing key is not an error.
   *
   * @param key - the key.
   */
  delete(key: string): Promise<void>;
  /**
   * Lists the objects under `prefix`, in no particular order.
   *
   * @param prefix - a key prefix (`database-backups/`).
   * @returns the objects, lazily.
   */
  list(prefix: string): AsyncIterable<BackupTargetObject>;
  /**
   * A short-lived URL a browser can download the archive from, when the backend
   * can sign one. Without it `GET /api/admin/db-backup/runs/:id/download-url`
   * answers 400 for runs on this target; the archive is still restorable.
   *
   * @param key - the key.
   * @param options - the expiry and the file name.
   * @returns the URL.
   */
  signedDownloadUrl?(key: string, options: BackupSignedUrlOptions): Promise<string>;
}

/**
 * The default {@link BackupTarget}: an adapter over the active
 * `STORAGE_PROVIDER`, so the engine behaves exactly as it did before targets
 * existed. `id` is the provider's `kind`, `location` its bucket, `refresh`
 * re-reads the `storage` settings the default provider answers `kind` from, and
 * `signedDownloadUrl` is the provider's signed GET.
 *
 * The storage provider interface has no listing; `list` uses the provider's
 * `list` when it has one and otherwise throws a clear error (nothing in the
 * engine calls it). Bind a target with a real `list` when the kit's listing
 * scenario matters to you.
 *
 * @stability experimental
 */
@Injectable()
export class StorageProviderBackupTarget implements BackupTarget {
  /**
   * @param storage - the active storage provider.
   * @param storageConfig - when present, refreshed before `id` is read (the default provider's `kind` follows the `storage` settings).
   */
  constructor(
    private readonly storage: StorageProvider,
    private readonly storageConfig?: Pick<StorageConfigService, 'activeProvider'>,
  ) {}

  /** The provider's kind (`s3`, `r2`, `s3compatible` or an app driver's id). */
  get id(): string {
    return this.storage.kind;
  }

  /** The provider's bucket. */
  get location(): string {
    return this.storage.getBucket();
  }

  /** Refreshes the settings snapshot the default provider answers `kind` from. */
  async refresh(): Promise<void> {
    await this.storageConfig?.activeProvider();
  }

  openWrite(key: string, meta: BackupWriteMeta): BackupSink {
    const stream = new PassThrough();
    const done = this.storage
      .upload(key, stream, {
        mimeType: meta.contentType,
        // Deliberately no `contentLength`: a streamed dump's size is unknown
        // until the last byte, which is exactly why it is streamed.
        metadata: { ...meta.metadata },
      })
      .then(() => undefined);
    // A failed upload must tear the writer down, or the dump keeps filling a
    // stream nobody reads. `done` itself still rejects to its awaiter.
    done.catch((error: unknown) => stream.destroy(error instanceof Error ? error : new Error(String(error))));

    return { stream, done };
  }

  openRead(key: string): Promise<Readable> {
    return this.storage.download(key);
  }

  delete(key: string): Promise<void> {
    return this.storage.delete(key);
  }

  async *list(prefix: string): AsyncIterable<BackupTargetObject> {
    const lister = (this.storage as unknown as { list?: (prefix: string) => AsyncIterable<BackupTargetObject | string> }).list;
    if (typeof lister !== 'function') {
      throw new Error(
        `The storage provider "${this.storage.kind}" cannot list objects, so the default backup target cannot list "${prefix}". ` +
          'Bind a BackupTarget with a list() through DbBackupModule.forRoot({ target }) if you need one.',
      );
    }
    for await (const entry of lister.call(this.storage, prefix)) {
      yield typeof entry === 'string' ? { key: entry } : entry;
    }
  }

  signedDownloadUrl(key: string, options: BackupSignedUrlOptions): Promise<string> {
    return this.storage.getSignedDownloadUrl(key, {
      expiresIn: options.expiresInSeconds,
      responseContentDisposition: `attachment; filename="${options.filename}"`,
    });
  }
}

/**
 * Whether `target` is the default adapter over `STORAGE_PROVIDER`. The node
 * data plane (a worker node's presigned PUT of the archive) writes through the
 * storage provider, so it can take a backup only for this target.
 *
 * @param target - a backup target.
 * @returns `true` for a {@link StorageProviderBackupTarget}.
 *
 * @stability experimental
 */
export function isStorageBackedTarget(target: BackupTarget): boolean {
  return target instanceof StorageProviderBackupTarget;
}

/**
 * Validates a target at `forRoot` time and at bind time: every member the
 * engine calls is present and the id is well formed.
 *
 * @param target - the candidate.
 * @param where - what to call it in the error.
 * @throws Error naming the missing member.
 *
 * @stability experimental
 */
export function assertBackupTarget(target: unknown, where: string): asserts target is BackupTarget {
  if (typeof target !== 'object' || target === null) throw new Error(`${where}: a BackupTarget must be an object.`);
  const t = target as Record<string, unknown>;
  if (typeof t.id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(t.id)) {
    throw new Error(`${where}: a BackupTarget needs a lowercase id such as "local-dir" (got ${JSON.stringify(t.id)}).`);
  }
  for (const member of ['openWrite', 'openRead', 'delete', 'list'] as const) {
    if (typeof t[member] !== 'function') throw new Error(`${where}: a BackupTarget needs ${member}() (target "${t.id}").`);
  }
}

// The backup target port (PP-14.12): the default adapter over STORAGE_PROVIDER,
// the kit run on a good target and on targets that break each rule it states,
// and the module-level binding of a target and its mirrors.
import { mkdtemp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  DB_BACKUP_MIRROR_TARGETS,
  DB_BACKUP_TARGET,
  StorageProviderBackupTarget,
  assertBackupTarget,
  isStorageBackedTarget,
  type BackupSink,
  type BackupTarget,
  type BackupTargetObject,
} from '../../src/db-backup/backup-target';
import { resolveDbBackupModuleOptions } from '../../src/db-backup/options';
import { describeBackupTargetConformance } from '../../src/db-backup/testing/backup-target-conformance';
import type { StorageProvider } from '../../src/storage/index';
import { runKit } from './support/kit-runner';

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** A directory target: the shape of the reference app's mirror example. */
class DirTarget implements BackupTarget {
  readonly id = 'dir-test';
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error(`key "${key}" escapes the target root`);
    return full;
  }

  openWrite(key: string): BackupSink {
    const target = this.path(key);
    const stream = new PassThrough();
    // `pipeline` settles when the file is closed OR when the stream is destroyed
    // (even before the directory exists), and a failed write removes its partial file.
    const done = mkdir(dirname(target), { recursive: true })
      .then(() => pipeline(stream, createWriteStream(target)))
      .catch(async (error: unknown) => {
        await rm(target, { force: true });
        throw error;
      });
    done.catch(() => undefined);
    return { stream, done };
  }

  async openRead(key: string): Promise<Readable> {
    const target = this.path(key);
    await stat(target);
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async *list(prefix: string): AsyncIterable<BackupTargetObject> {
    const base = this.path(prefix);
    const walk = async function* (directory: string): AsyncIterable<string> {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
      }
    };
    for await (const file of walk(base)) {
      yield { key: file.slice(resolve(this.root).length + 1).split(sep).join('/'), sizeBytes: (await stat(file)).size };
    }
  }
}

/** Collects the whole object before storing it: exactly what a backup target must NOT do. */
class BufferingTarget implements BackupTarget {
  readonly id = 'buffering';
  private readonly objects = new Map<string, Buffer>();

  openWrite(key: string): BackupSink {
    const chunks: Buffer[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolveDone) => {
      finish = resolveDone;
    });
    const stream = new Writable({
      // Never calls back until the end: no backpressure, the whole object queues.
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        setImmediate(callback);
      },
      final: (callback) => {
        this.objects.set(key, Buffer.concat(chunks));
        finish();
        callback();
      },
    });
    return { stream, done };
  }

  async openRead(key: string): Promise<Readable> {
    const body = this.objects.get(key);
    if (body === undefined) throw new Error('no such object');
    // One 20 MiB chunk: a read side that is not chunked.
    return Readable.from([body]);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async *list(prefix: string): AsyncIterable<BackupTargetObject> {
    for (const [key, body] of this.objects) if (key.startsWith(prefix)) yield { key, sizeBytes: body.length };
  }
}

/**
 * A StorageProvider backed by a directory (or, without one, by memory), enough
 * for the default adapter. The kit's streaming scenario needs a backend that
 * does not hold the object in memory, so the kit runs against the directory.
 */
class FakeStorageProvider {
  kind = 's3';
  readonly objects = new Map<string, Buffer>();
  readonly uploads: Array<{ key: string; options: unknown }> = [];
  failUploadWith: Error | null = null;

  constructor(private readonly root?: string) {}

  getBucket(): string {
    return 'fake-bucket';
  }

  private file(key: string): string {
    return join(this.root as string, encodeURIComponent(key));
  }

  async upload(key: string, stream: Readable, options: unknown) {
    this.uploads.push({ key, options });
    if (this.root !== undefined) {
      await pipeline(stream, createWriteStream(this.file(key)));
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      this.objects.set(key, Buffer.concat(chunks));
    }
    if (this.failUploadWith) throw this.failUploadWith;
    return { key, bucket: 'fake-bucket', location: `fake://${key}`, size: 0 };
  }

  async download(key: string): Promise<Readable> {
    if (this.root !== undefined) {
      await stat(this.file(key));
      return createReadStream(this.file(key));
    }
    const body = this.objects.get(key);
    if (!body) throw new Error('NoSuchKey');
    return Readable.from(chunked(body));
  }

  async delete(key: string): Promise<void> {
    if (this.root !== undefined) await rm(this.file(key), { force: true });
    this.objects.delete(key);
  }

  async getSignedDownloadUrl(key: string, options: { expiresIn: number; responseContentDisposition?: string }) {
    return `https://fake.example/${key}?exp=${options.expiresIn}&cd=${encodeURIComponent(options.responseContentDisposition ?? '')}`;
  }

  async *list(prefix: string): AsyncIterable<BackupTargetObject> {
    if (this.root !== undefined) {
      for (const name of await readdir(this.root)) {
        const key = decodeURIComponent(name);
        if (key.startsWith(prefix)) yield { key, sizeBytes: (await stat(join(this.root, name))).size };
      }
      return;
    }
    for (const [key, body] of this.objects) if (key.startsWith(prefix)) yield { key, sizeBytes: body.length };
  }
}

function* chunked(body: Buffer): Generator<Buffer> {
  for (let offset = 0; offset < body.length; offset += 64 * 1024) yield body.subarray(offset, offset + 64 * 1024);
}

// ---------------------------------------------------------------------------
// The kit, run for real on good targets
// ---------------------------------------------------------------------------

describe('describeBackupTargetConformance on a directory target', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-target-kit-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describeBackupTargetConformance(() => new DirTarget(dir), { describe, it, expect, rejectsEscapingKeys: true });
});

describe('describeBackupTargetConformance on the default adapter over a storage provider', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-adapter-kit-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describeBackupTargetConformance(() => new StorageProviderBackupTarget(new FakeStorageProvider(dir) as unknown as StorageProvider), {
    describe,
    it,
    expect,
    // The adapter lists through the provider's optional `list`, which this fake has.
    readSignedUrl: async () => Buffer.from('signed download'),
  });
});

// ---------------------------------------------------------------------------
// The kit must be able to FAIL
// ---------------------------------------------------------------------------

describe('the kit fails a target that breaks its rules', () => {
  it('a target that buffers the whole object fails the streaming scenario', async () => {
    const result = await runKit(
      (harness) => describeBackupTargetConformance(() => new BufferingTarget(), { ...harness, skip: ['signedUrl'] }),
      expect,
    );

    expect(result.failed().some((name) => name.includes('[streamed]'))).toBe(true);
    // ...while the rules it does keep still pass.
    expect(result.passed().some((name) => name.includes('[roundTrip]'))).toBe(true);
    expect(result.passed().some((name) => name.includes('[list]'))).toBe(true);
  }, 60_000);

  it('a target that reports a destroyed write as done fails the failedWrite scenario', async () => {
    class SwallowsFailures extends BufferingTarget {
      override openWrite(key: string): BackupSink {
        const sink = super.openWrite(key);
        // `done` settles on close, whatever the reason: a failed dump looks stored.
        const done = new Promise<void>((resolveDone) => sink.stream.once('close', () => resolveDone()));
        sink.stream.on('error', () => undefined);
        return { stream: sink.stream, done };
      }
    }
    const result = await runKit(
      (harness) =>
        describeBackupTargetConformance(() => new SwallowsFailures(), {
          ...harness,
          skip: ['streamed', 'roundTrip', 'list', 'signedUrl'],
        }),
      expect,
    );

    expect(result.failed().some((name) => name.includes('[failedWrite]'))).toBe(true);
  }, 30_000);

  it('a target whose done never settles after a destroyed write fails instead of hanging the suite', async () => {
    const result = await runKit(
      (harness) =>
        describeBackupTargetConformance(() => new BufferingTarget(), {
          ...harness,
          skip: ['streamed', 'roundTrip', 'list', 'signedUrl'],
        }),
      expect,
    );

    expect(result.failed().some((name) => name.includes('[failedWrite]'))).toBe(true);
    expect(result.results.get([...result.results.keys()].find((name) => name.includes('[failedWrite]')) as string)).toContain('did not settle');
  }, 30_000);

  it('a directory target that follows ../ fails the escaping-keys scenario', async () => {
    const root = await mkdtemp(join(tmpdir(), 'backup-target-escape-'));
    try {
      class Unsafe extends DirTarget {
        // The same target with the root check removed: `join` follows `..`.
        override openWrite(key: string): BackupSink {
          const stream = new PassThrough();
          const target = join(root, key);
          const done = mkdir(dirname(target), { recursive: true }).then(() => pipeline(stream, createWriteStream(target)));
          done.catch(() => undefined);
          return { stream, done };
        }
        override async openRead(key: string): Promise<Readable> {
          await stat(join(root, key));
          return createReadStream(join(root, key));
        }
      }
      const result = await runKit(
        (harness) => describeBackupTargetConformance(() => new Unsafe(root), { ...harness, rejectsEscapingKeys: true, skip: ['streamed', 'roundTrip', 'failedWrite', 'list', 'signedUrl'] }),
        expect,
      );

      expect(result.failed().some((name) => name.includes('[escapingKeys]'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(join(root, '..', 'escape.dump'), { force: true });
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The default adapter
// ---------------------------------------------------------------------------

describe('StorageProviderBackupTarget', () => {
  it('answers the provider\'s kind and bucket, live', () => {
    const provider = new FakeStorageProvider();
    const target = new StorageProviderBackupTarget(provider as unknown as StorageProvider);

    expect(target.id).toBe('s3');
    expect(target.location).toBe('fake-bucket');
    provider.kind = 'r2';
    expect(target.id).toBe('r2');
  });

  it('refreshes the storage settings snapshot the default provider answers from', async () => {
    const activeProvider = jest.fn(async () => 's3');
    const target = new StorageProviderBackupTarget(new FakeStorageProvider() as unknown as StorageProvider, { activeProvider });

    await target.refresh();

    expect(activeProvider).toHaveBeenCalledTimes(1);
  });

  it('hands the provider a stream and the content type and provenance, with no length', async () => {
    const provider = new FakeStorageProvider();
    const target = new StorageProviderBackupTarget(provider as unknown as StorageProvider);

    const sink = target.openWrite('database-backups/a.dump', {
      contentType: 'application/octet-stream',
      metadata: { runId: 'r1', trigger: 'manual' },
    });
    sink.stream.end(Buffer.from('abc'));
    await sink.done;

    expect(provider.uploads[0].key).toBe('database-backups/a.dump');
    expect(provider.uploads[0].options).toEqual({
      mimeType: 'application/octet-stream',
      metadata: { runId: 'r1', trigger: 'manual' },
    });
    expect(provider.objects.get('database-backups/a.dump')?.toString()).toBe('abc');
  });

  it('a failed upload rejects done and destroys the writer', async () => {
    const provider = new FakeStorageProvider();
    provider.failUploadWith = new Error('bucket unreachable');
    const target = new StorageProviderBackupTarget(provider as unknown as StorageProvider);

    const sink = target.openWrite('database-backups/a.dump', { contentType: 'application/octet-stream', metadata: {} });
    sink.stream.on('error', () => undefined);
    sink.stream.end(Buffer.from('abc'));

    await expect(sink.done).rejects.toThrow('bucket unreachable');
    expect(sink.stream.destroyed).toBe(true);
  });

  it('signs through the provider with the expiry and a download file name', async () => {
    const target = new StorageProviderBackupTarget(new FakeStorageProvider() as unknown as StorageProvider);

    const url = await target.signedDownloadUrl('database-backups/a.dump', { expiresInSeconds: 300, filename: 'a.dump' });

    expect(url).toContain('exp=300');
    expect(decodeURIComponent(url)).toContain('attachment; filename="a.dump"');
  });

  it('says plainly that it cannot list when the provider has no listing', async () => {
    const provider = new FakeStorageProvider() as unknown as Record<string, unknown>;
    delete (FakeStorageProvider.prototype as unknown as Record<string, unknown>).list;
    try {
      const target = new StorageProviderBackupTarget(provider as unknown as StorageProvider);
      await expect(target.list('database-backups/').next()).rejects.toThrow(/cannot list objects/);
    } finally {
      FakeStorageProvider.prototype.list = async function* () {
        /* restored for later specs in this file */
      };
    }
  });

  it('is the one target a worker node can write for', () => {
    expect(isStorageBackedTarget(new StorageProviderBackupTarget(new FakeStorageProvider() as unknown as StorageProvider))).toBe(true);
    expect(isStorageBackedTarget(new DirTarget('/tmp'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Options and the module binding
// ---------------------------------------------------------------------------

describe('target options', () => {
  it('default to the storage adapter and no mirrors', () => {
    const resolved = resolveDbBackupModuleOptions();

    expect(resolved.target).toBeUndefined();
    expect(resolved.mirrorTargets).toEqual([]);
  });

  it('accept a binding for the target and for each mirror', () => {
    const resolved = resolveDbBackupModuleOptions({
      target: { useClass: DirTarget as never },
      mirrorTargets: [{ useExisting: 'MIRROR' }, { useFactory: () => new DirTarget('/tmp') }],
    });

    expect(resolved.target).toEqual({ useClass: DirTarget });
    expect(resolved.mirrorTargets).toHaveLength(2);
  });

  it('refuse a binding that names none, or more than one, provider shape', () => {
    expect(() => resolveDbBackupModuleOptions({ target: {} as never })).toThrow(/`target` needs exactly one of/);
    expect(() =>
      resolveDbBackupModuleOptions({ mirrorTargets: [{ useClass: DirTarget as never, useExisting: 'X' } as never] }),
    ).toThrow(/mirrorTargets\[0\]/);
    expect(() => resolveDbBackupModuleOptions({ mirrorTargets: 'nope' as never })).toThrow(/array/);
  });

  it('assertBackupTarget names the missing member', () => {
    expect(() => assertBackupTarget({ id: 'x' }, 'test')).toThrow(/openWrite/);
    expect(() => assertBackupTarget({ id: 'Bad Id', openWrite() {}, openRead() {}, delete() {}, list() {} }, 'test')).toThrow(/lowercase id/);
    expect(() => assertBackupTarget(new DirTarget('/tmp'), 'test')).not.toThrow();
  });
});

describe('binding a target through a Nest provider shape', () => {
  @Injectable()
  class NeedsNothingTarget extends DirTarget {
    constructor() {
      super('/tmp');
    }
  }

  @Module({ providers: [{ provide: 'TARGET_SOURCE', useValue: new DirTarget('/var') }], exports: ['TARGET_SOURCE'] })
  class SourceModule {}

  it('resolves useClass, useExisting and useFactory bindings the way forRoot provides them', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SourceModule],
      providers: [
        { provide: DB_BACKUP_TARGET, useClass: NeedsNothingTarget },
        { provide: 'MIRROR_0', useExisting: 'TARGET_SOURCE' },
        { provide: 'MIRROR_1', useFactory: () => new DirTarget('/opt') },
        { provide: DB_BACKUP_MIRROR_TARGETS, useFactory: (...mirrors: BackupTarget[]) => mirrors, inject: ['MIRROR_0', 'MIRROR_1'] },
      ],
    }).compile();

    expect(moduleRef.get<BackupTarget>(DB_BACKUP_TARGET)).toBeInstanceOf(NeedsNothingTarget);
    expect(moduleRef.get<BackupTarget[]>(DB_BACKUP_MIRROR_TARGETS)).toHaveLength(2);
  });
});

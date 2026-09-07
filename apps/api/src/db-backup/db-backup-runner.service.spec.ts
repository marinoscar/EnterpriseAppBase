import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { SystemSettingsService } from '../settings/system-settings/system-settings.service';
import type { StorageProvider } from '../storage/providers/storage-provider.interface';
import type { SystemDatabaseBackupValue } from '../common/schemas/settings.schema';
import {
  ACTIVE_RUN_INDEX_NAME,
  BACKUP_HEARTBEAT_INTERVAL_MS,
  DatabaseBackupRunnerService,
  isActiveRunConflict,
  systemBackupTimers,
  type BackupTimers,
  type DatabaseBackupEngine,
} from './db-backup-runner.service';
import { BACKUP_KEY_PREFIX } from './db-backup-storage';
import {
  DatabaseBackupAlreadyRunningError,
  DatabaseBackupStorageProviderError,
} from './db-backup.errors';
import type { PgProcess } from './pg-dump.util';
import type { PgVersionCheck } from './pg-version.util';

// =============================================================================
// The backup engine's acceptance criteria, one describe block each (#281)
// =============================================================================
//
// Everything here runs with NO PostgreSQL binaries, NO database and NO bucket:
// the `DatabaseBackupEngine` seam stands in for `pg_dump`/`pg_restore`, a fake
// `StorageProvider` stands in for S3, and a small in-memory Prisma double
// stands in for the table. That is the point — a suite that needed any of the
// three is a suite CI skips, and a skipped test guards nothing.
//
// The one thing NOT faked is the streaming itself: every test below drives real
// `Readable`/`Transform` plumbing, because the properties under test (the
// archive is never materialised; a truncated stream still fails the run) are
// properties OF that plumbing.
// =============================================================================

// -----------------------------------------------------------------------------
// Doubles
// -----------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/** Yields to the event loop so stream machinery can make progress. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Polls `condition` until it holds, so a test never asserts on a half-flushed pipeline. */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    if (condition()) return;
    await tick();
  }

  throw new Error(`timed out waiting for: ${label}`);
}

/**
 * A `pg_dump` this test drives by hand: push bytes, then finish or die.
 *
 * `done` carries its own idle `.catch()` exactly as `spawnPgProcess` does, so
 * rejecting it before the service attaches its handler is not an unhandled
 * rejection.
 */
class ManualDump implements PgProcess {
  readonly stdout: Readable;
  readonly kill = jest.fn<void, [NodeJS.Signals?]>();

  private readonly settle = deferred();
  readonly done = this.settle.promise;
  private readonly ownsStdout: boolean;

  /**
   * @param stdout an externally driven source, for the large-fixture test —
   * which needs a stream that HONOURS BACK-PRESSURE. The default push-driven
   * stream deliberately does not, so that a test can queue bytes freely.
   */
  constructor(stdout?: Readable) {
    this.ownsStdout = stdout === undefined;
    this.stdout = stdout ?? new Readable({ read: () => undefined });
    void this.done.catch(() => undefined);
  }

  push(chunk: Buffer): void {
    this.stdout.push(chunk);
  }

  /** A clean exit: stdout ends, exit code 0. */
  finish(): void {
    if (this.ownsStdout) this.stdout.push(null);
    this.settle.resolve();
  }

  /**
   * A dump that dies mid-flight. Note it ENDS its stdout — that is what makes
   * a truncated archive look like a complete one to a naive consumer.
   */
  die(error: Error): void {
    if (this.ownsStdout) this.stdout.push(null);
    this.settle.reject(error);
  }
}

const OK_VERSION: PgVersionCheck = {
  status: 'ok',
  clientMajor: 17,
  serverMajor: 17,
  message: 'ok',
};

const POLICY: SystemDatabaseBackupValue = {
  enabled: true,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  storageProvider: 's3',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
};

interface HarnessOptions {
  policy?: Partial<SystemDatabaseBackupValue>;
  /** Errors the first N `create` calls throw, in order. */
  createFailures?: unknown[];
  /** What `findFirst` reports as the active run. */
  activeRunId?: string | null;
  version?: PgVersionCheck;
  /** Table-of-contents entries the verification step reads back. */
  tocEntries?: number;
  uploadImpl?: StorageProvider['upload'];
  downloadImpl?: StorageProvider['download'];
  deleteImpl?: StorageProvider['delete'];
  timers?: BackupTimers;
  /** A back-pressure-honouring stdout for the dump, instead of the push-driven default. */
  dumpStdout?: Readable;
}

function makeHarness(options: HarnessOptions = {}) {
  /** Every side effect in the order it happened, for the ordering assertions. */
  const order: string[] = [];

  const rows = new Map<string, Record<string, unknown>>();
  const settled = deferred<Record<string, unknown>>();
  const createFailures = [...(options.createFailures ?? [])];

  const dumps: ManualDump[] = [];
  const uploads: Array<{ key: string; stream: unknown; options: unknown }> = [];
  /** Bytes the fake provider has actually pulled through the metering stream. */
  const progress = { uploaded: 0 };

  const prisma = {
    databaseBackupRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        order.push('create');

        const failure = createFailures.shift();
        if (failure !== undefined) throw failure;

        rows.set(data.id as string, { ...data });
        return { ...data };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const status = (data.status as string | undefined) ?? 'heartbeat';
          order.push(`update:${status}`);

          const row = { ...(rows.get(where.id) ?? {}), ...data };
          rows.set(where.id, row);

          // ONE TICK LATER, so `executeRun`'s `finally` (clear the heartbeat,
          // release the cancel handle) has run by the time a test asserts on it.
          if (status === 'completed' || status === 'failed') {
            setImmediate(() => settled.resolve(row));
          }

          return row;
        }
      ),
      findFirst: jest.fn(async () => {
        order.push('findFirst');
        return options.activeRunId === undefined || options.activeRunId === null
          ? null
          : { id: options.activeRunId };
      }),
    },
    // Tagged-template double: the audit reads are best-effort, so answering
    // both with a plausible row proves they land on the row rather than that
    // the SQL is right (which only a real Postgres can say).
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('server_version')) return [{ server_version: '17.4' }];
      if (sql.includes('_prisma_migrations')) {
        return [{ migration_name: '20260907120000_add_database_backup_runs' }];
      }
      return [];
    }),
  };

  const settings = {
    getDatabaseBackupPolicy: jest.fn(async () => ({ ...POLICY, ...options.policy })),
  };

  const storage = {
    getBucket: jest.fn(() => 'test-bucket'),
    upload:
      options.uploadImpl ??
      (jest.fn(async (key: string, stream: Readable, uploadOptions: unknown) => {
        order.push('upload');
        uploads.push({ key, stream, options: uploadOptions });

        // Real consumption, with real back-pressure — `for await` pulls.
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += (chunk as Buffer).length;
          progress.uploaded = bytes;
        }

        return { key, bucket: 'test-bucket', location: `s3://test-bucket/${key}`, size: bytes };
      }) as unknown as StorageProvider['upload']),
    download:
      options.downloadImpl ??
      (jest.fn(async (key: string) => {
        order.push('download');
        return Readable.from([Buffer.from(`archive-of-${key}`)]);
      }) as unknown as StorageProvider['download']),
    delete:
      options.deleteImpl ??
      (jest.fn(async () => {
        order.push('delete');
      }) as unknown as StorageProvider['delete']),
  };

  const engine: DatabaseBackupEngine = {
    startDump: jest.fn(() => {
      order.push('startDump');
      const dump = new ManualDump(options.dumpStdout);
      dumps.push(dump);
      return dump;
    }),
    readTocEntryCount: jest.fn(async (source: Readable) => {
      order.push('readTocEntryCount');
      // Drain it: the real reader consumes the stream, and a test that did not
      // would leave a paused stream holding the fake provider open.
      for await (const _chunk of source) void _chunk;
      return options.tocEntries ?? 42;
    }),
    checkClientVersion: jest.fn(async () => {
      order.push('checkClientVersion');
      return options.version ?? OK_VERSION;
    }),
  };

  /** Fires the heartbeat on demand instead of on a clock. */
  const heartbeats: Array<() => void> = [];
  const cleared: NodeJS.Timeout[] = [];
  const timers: BackupTimers =
    options.timers ??
    ({
      setInterval: (handler: () => void) => {
        heartbeats.push(handler);
        return { id: heartbeats.length } as unknown as NodeJS.Timeout;
      },
      clearInterval: (handle: NodeJS.Timeout) => {
        cleared.push(handle);
      },
    } as BackupTimers);

  const service = new DatabaseBackupRunnerService(
    prisma as unknown as PrismaService,
    settings as unknown as SystemSettingsService,
    storage as unknown as StorageProvider,
    engine,
    timers
  );

  return {
    service,
    prisma,
    settings,
    storage,
    engine,
    order,
    rows,
    dumps,
    uploads,
    heartbeats,
    cleared,
    progress,
    /** Resolves with the terminal row once the detached run has settled. */
    settled: settled.promise,
    /** Waits until the detached run has spawned its dump. */
    async firstDump(): Promise<ManualDump> {
      await waitFor(() => dumps.length > 0, 'the dump to be spawned');
      return dumps[0];
    },
  };
}

/** A P2002 shaped the way `@prisma/adapter-pg` reports it. */
function adapterConflict(indexName = ACTIVE_RUN_INDEX_NAME): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: {
      modelName: 'DatabaseBackupRun',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          originalMessage: `duplicate key value violates unique constraint "${indexName}"`,
          kind: 'UniqueConstraintViolation',
          constraint: { index: indexName },
        },
      },
    },
  });
}

beforeAll(() => {
  // The failure paths log at error/warn by design; keeping that out of the
  // suite's output is not the same as suppressing it in production.
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// -----------------------------------------------------------------------------

describe('the claim', () => {
  it('is awaited: the caller gets a real run id and a running row', async () => {
    const h = makeHarness();

    const run = await h.service.startBackup({ trigger: 'manual', createdById: 'admin-1' });

    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.status).toBe('running');
    expect(run.trigger).toBe('manual');
    expect(run.createdById).toBe('admin-1');
    expect(run.bucket).toBe('test-bucket');
    expect(run.storageKey.startsWith(BACKUP_KEY_PREFIX)).toBe(true);
    // The key contains the run's own id — the collision guarantee.
    expect(run.storageKey).toContain(run.id);
    // Seeded so the stale sweep has a baseline from the first moment.
    expect(run.lastHeartbeatAt).toBeInstanceOf(Date);

    (await h.firstDump()).finish();
    await h.settled;
  });

  it('detaches the dump, so the response does not wait on it', async () => {
    const h = makeHarness();

    await h.service.startBackup({ trigger: 'scheduled' });

    // `startBackup` has returned; the dump has not finished, and there is no
    // terminal update yet. This is the property a reverse proxy timeout makes
    // non-negotiable.
    const dump = await h.firstDump();
    expect(h.order).not.toContain('update:completed');

    dump.push(Buffer.from('bytes'));
    dump.finish();
    await h.settled;

    expect(h.order).toContain('update:completed');
  });

  it('lets the DATABASE decide the race: a P2002 becomes a typed already-running error', async () => {
    const h = makeHarness({
      createFailures: [adapterConflict()],
      activeRunId: 'winner-run-id',
    });

    await expect(h.service.startBackup({ trigger: 'manual' })).rejects.toBeInstanceOf(
      DatabaseBackupAlreadyRunningError
    );

    // ⚠ The lookup happens only AFTER the insert failed. A `findFirst` before
    // the `create` would be a check-then-act race, which is the entire reason
    // the index exists.
    expect(h.order).toEqual(['create', 'findFirst']);
  });

  it('carries the active run id, so the caller can name what is already running', async () => {
    const h = makeHarness({ createFailures: [adapterConflict()], activeRunId: 'winner-run-id' });

    await h.service.startBackup({ trigger: 'manual' }).then(
      () => {
        throw new Error('expected a rejection');
      },
      (error: unknown) => {
        expect((error as DatabaseBackupAlreadyRunningError).activeRunId).toBe('winner-run-id');
        expect((error as Error).message).toContain('winner-run-id');
      }
    );
  });

  it('retries when the winning run settled between the conflict and the lookup', async () => {
    // The slot is free again by the time we look, so "already running" would be
    // a false statement. Insert again instead.
    const h = makeHarness({ createFailures: [adapterConflict()], activeRunId: null });

    const run = await h.service.startBackup({ trigger: 'scheduled' });

    expect(run.status).toBe('running');
    expect(h.order.slice(0, 3)).toEqual(['create', 'findFirst', 'create']);

    (await h.firstDump()).finish();
    await h.settled;
  });

  it('lets an unrelated unique violation stay loud', async () => {
    const unrelated = adapterConflict('some_other_uniq_idx');
    const h = makeHarness({ createFailures: [unrelated] });

    await expect(h.service.startBackup({ trigger: 'manual' })).rejects.toBe(unrelated);
    expect(h.prisma.databaseBackupRun.findFirst).not.toHaveBeenCalled();
  });

  it('recognises the conflict through the classic query engine shape too', () => {
    const classic = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['status'] },
    });

    expect(isActiveRunConflict(classic)).toBe(true);
    expect(isActiveRunConflict(new Error('nope'))).toBe(false);
  });
});

describe('the streaming contract', () => {
  it('hands the storage provider a STREAM, never a buffer or a string', async () => {
    const h = makeHarness();

    await h.service.startBackup({ trigger: 'manual' });
    const dump = await h.firstDump();
    dump.push(Buffer.from('one'));
    dump.push(Buffer.from('two'));
    dump.finish();
    await h.settled;

    expect(h.uploads).toHaveLength(1);
    const sent = h.uploads[0].stream;
    expect(sent).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(sent)).toBe(false);
    expect(typeof sent).not.toBe('string');
    expect(Array.isArray(sent)).toBe(false);
    // No `contentLength`: a streamed dump's size is unknown until the last byte.
    expect((h.uploads[0].options as Record<string, unknown>).contentLength).toBeUndefined();
  });

  it('never materialises the archive: in-flight bytes stay bounded while a large fixture streams', async () => {
    // THE PROOF THAT NOTHING IS BUFFERED. A 64 MiB fixture is produced by a
    // source that honours back-pressure and consumed by a deliberately slow
    // reader; `maxInFlight` is the largest gap that ever opened between the
    // two. Streaming keeps it to a couple of pipeline high-water marks. An
    // implementation that collected the archive first — "just to hash it" —
    // would let the producer run to completion, and the gap would reach the
    // whole 64 MiB.
    const CHUNK = 256 * 1024;
    const CHUNKS = 256;
    const TOTAL = CHUNK * CHUNKS;

    let produced = 0;
    let consumed = 0;
    let maxInFlight = 0;

    const source = new Readable({
      highWaterMark: 64 * 1024,
      read() {
        if (produced >= TOTAL) {
          this.push(null);
          return;
        }
        produced += CHUNK;
        this.push(Buffer.alloc(CHUNK, 7));
      },
    });

    const upload = jest.fn(async (key: string, stream: Readable) => {
      for await (const chunk of stream) {
        consumed += (chunk as Buffer).length;
        maxInFlight = Math.max(maxInFlight, produced - consumed);
        if (consumed % (CHUNK * 16) === 0) await tick();
      }

      return { key, bucket: 'test-bucket', location: 'x' };
    }) as unknown as StorageProvider['upload'];

    const before = process.memoryUsage();
    const h = makeHarness({ uploadImpl: upload, dumpStdout: source });

    await h.service.startBackup({ trigger: 'scheduled' });
    const dump = await h.firstDump();
    source.on('end', () => dump.finish());

    const row = await h.settled;
    const after = process.memoryUsage();

    expect(consumed).toBe(TOTAL);
    expect(row.status).toBe('completed');
    expect(row.sizeBytes).toBe(BigInt(TOTAL));
    // A few high-water marks, not the archive.
    expect(maxInFlight).toBeLessThan(8 * 1024 * 1024);
    // And the process did not grow by anything like the archive's size. Heap
    // AND external, because chunk buffers live outside the JS heap — measuring
    // `heapUsed` alone would pass even for a fully buffered implementation.
    const grew = after.heapUsed + after.external - (before.heapUsed + before.external);
    expect(grew).toBeLessThan(TOTAL);
  });

  it('computes the checksum and the byte count in ONE pass, matching an independent hash', async () => {
    const chunks = [Buffer.from('alpha'), Buffer.from('bravo'), Buffer.alloc(4096, 3)];
    const expectedHash = createHash('sha256');
    let expectedBytes = 0;
    for (const chunk of chunks) {
      expectedHash.update(chunk);
      expectedBytes += chunk.length;
    }

    const h = makeHarness();
    await h.service.startBackup({ trigger: 'manual' });
    const dump = await h.firstDump();
    for (const chunk of chunks) dump.push(chunk);
    dump.finish();

    const row = await h.settled;

    expect(row.checksumSha256).toBe(expectedHash.digest('hex'));
    expect(row.sizeBytes).toBe(BigInt(expectedBytes));
    expect(row.bytesWritten).toBe(BigInt(expectedBytes));
    // One pass: the dump's stdout was read once, and the only OTHER read is the
    // verification, which reads the STORED object.
    expect(h.storage.download).toHaveBeenCalledTimes(1);
  });
});

describe('both halves of the transfer are awaited', () => {
  it('fails the run when the dump dies mid-stream EVEN THOUGH the upload resolved', async () => {
    // The upload sees a clean EOF on a truncated archive and reports success.
    // Only the exit code knows better.
    const upload = jest.fn(async (key: string) => ({
      key,
      bucket: 'test-bucket',
      location: 'x',
    })) as unknown as StorageProvider['upload'];

    const h = makeHarness({ uploadImpl: upload });
    await h.service.startBackup({ trigger: 'scheduled' });

    const dump = await h.firstDump();
    dump.push(Buffer.from('half an archive'));
    dump.die(new Error('pg_dump exited with code 1: connection lost'));

    const row = await h.settled;

    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('connection lost');
    expect(row.verifiedAt).toBeUndefined();
  });

  it('fails the run when the upload dies EVEN THOUGH the dump exits 0, and kills the dump', async () => {
    const upload = jest.fn(async () => {
      throw new Error('bucket refused the write');
    }) as unknown as StorageProvider['upload'];

    const h = makeHarness({ uploadImpl: upload });
    await h.service.startBackup({ trigger: 'manual' });

    const dump = await h.firstDump();
    dump.push(Buffer.from('bytes'));

    const row = await h.settled;

    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('bucket refused the write');
    // Otherwise pg_dump keeps reading a whole database for an archive nobody
    // is storing.
    expect(dump.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('verification', () => {
  it('reads the UPLOADED OBJECT back before marking the run completed', async () => {
    const h = makeHarness({ tocEntries: 128 });

    const run = await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).finish();
    const row = await h.settled;

    expect(h.storage.download).toHaveBeenCalledWith(run.storageKey);
    // The order is the assertion: verify, THEN complete.
    expect(h.order.indexOf('download')).toBeLessThan(h.order.indexOf('update:completed'));
    expect(h.order.indexOf('readTocEntryCount')).toBeLessThan(h.order.indexOf('update:completed'));
    expect(row.status).toBe('completed');
    expect(row.verifiedAt).toBeInstanceOf(Date);
  });

  it('fails the run on an EMPTY table of contents, and deletes the object', async () => {
    // A zero-byte object, a truncated upload, or a dump of the wrong (empty)
    // database — none of which an exit code or a byte count can see.
    const h = makeHarness({ tocEntries: 0 });

    const run = await h.service.startBackup({ trigger: 'scheduled' });
    (await h.firstDump()).finish();
    const row = await h.settled;

    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('not a readable archive');
    expect(h.storage.delete).toHaveBeenCalledWith(run.storageKey);
    expect(row.verifiedAt).toBeUndefined();
  });
});

describe('the heartbeat', () => {
  it('advances bytesWritten while the dump is still streaming', async () => {
    const h = makeHarness();
    const run = await h.service.startBackup({ trigger: 'manual' });

    const dump = await h.firstDump();
    dump.push(Buffer.alloc(1000, 1));

    await waitFor(() => h.heartbeats.length > 0, 'the heartbeat to be scheduled');
    // The bytes have to reach the metering transform before a beat can report
    // them; the fake provider tells us when it has pulled them through.
    await waitFor(() => h.progress.uploaded === 1000, 'the chunk to stream through the meter');

    h.heartbeats[0]();
    await waitFor(
      () => h.rows.get(run.id)?.bytesWritten === 1000n,
      'the heartbeat to record live progress'
    );

    // Liveness AND progress in one indexed UPDATE — this is what #282's stale
    // sweep reads, and what an operator watches move.
    expect(h.rows.get(run.id)?.lastHeartbeatAt).toBeInstanceOf(Date);
    // The run is still going: this is LIVE progress, not a terminal size.
    expect(h.rows.get(run.id)?.status).toBe('running');
    expect(h.rows.get(run.id)?.sizeBytes).toBeUndefined();

    dump.finish();
    await h.settled;
  });

  it('survives a transient write failure: a blip must not abort a progressing backup', async () => {
    const h = makeHarness();
    const run = await h.service.startBackup({ trigger: 'manual' });
    const dump = await h.firstDump();

    await waitFor(() => h.heartbeats.length > 0, 'the heartbeat to be scheduled');

    h.prisma.databaseBackupRun.update.mockRejectedValueOnce(
      new Error('connection terminated unexpectedly')
    );
    h.heartbeats[0]();
    await tick();

    dump.push(Buffer.from('still going'));
    dump.finish();

    const row = await h.settled;

    // The backup completed anyway — the blip cost one progress update.
    expect(row.status).toBe('completed');
  });

  it('is always cleared, so it cannot keep writing to a settled row', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).finish();
    await h.settled;

    expect(h.cleared).toHaveLength(1);
  });

  it('is cleared on the FAILURE path too', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).die(new Error('boom'));
    await h.settled;

    expect(h.cleared).toHaveLength(1);
  });

  it('runs on an unref’d real interval when nothing overrides the seam', () => {
    // The default seam, driven by Jest’s fake timers rather than by a real
    // twenty-second wait. Unref’d so a pending beat cannot hold a
    // shutting-down process open for the length of a dump.
    jest.useFakeTimers();
    try {
      const beats: number[] = [];
      const handle = systemBackupTimers.setInterval(() => beats.push(Date.now()), 20_000);

      expect(BACKUP_HEARTBEAT_INTERVAL_MS).toBe(20_000);
      jest.advanceTimersByTime(60_000);
      expect(beats).toHaveLength(3);

      systemBackupTimers.clearInterval(handle);
      jest.advanceTimersByTime(60_000);
      expect(beats).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the failure path', () => {
  it('deletes the partial object BEFORE marking the row failed', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'scheduled' });
    (await h.firstDump()).die(new Error('pg_dump exited with code 1'));
    await h.settled;

    // The row is the only index of what is in the bucket: marking first would
    // orphan the object, billed forever with nothing pointing at it.
    expect(h.order.indexOf('delete')).toBeGreaterThan(-1);
    expect(h.order.indexOf('delete')).toBeLessThan(h.order.indexOf('update:failed'));
  });

  it('does not let a failed delete mask the original error', async () => {
    const deleteImpl = jest.fn(async () => {
      throw new Error('bucket unreachable');
    }) as unknown as StorageProvider['delete'];

    const h = makeHarness({ deleteImpl });
    await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).die(new Error('the real reason: server closed the connection'));

    const row = await h.settled;

    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('the real reason');
    expect(row.lastError).not.toContain('bucket unreachable');
  });

  it('records how far a failed dump got, rather than resetting it to zero', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'manual' });

    const dump = await h.firstDump();
    dump.push(Buffer.alloc(4096, 9));
    await tick();
    dump.die(new Error('died at 4 KiB'));

    const row = await h.settled;

    expect(row.bytesWritten).toBe(4096n);
    expect(row.sizeBytes).toBeUndefined();
  });

  it('never retries automatically: one run, one dump', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'scheduled' });
    (await h.firstDump()).die(new Error('nope'));
    await h.settled;
    await tick();

    expect(h.engine.startDump).toHaveBeenCalledTimes(1);
    expect(h.prisma.databaseBackupRun.create).toHaveBeenCalledTimes(1);
  });
});

describe('the client/server version guard', () => {
  it('blocks BEFORE a single byte is dumped, with the runbook message on the row', async () => {
    const h = makeHarness({
      version: {
        status: 'blocked',
        clientMajor: 16,
        serverMajor: 18,
        message: 'pg_dump refuses ... rebuild the image with postgresql18-client',
      },
    });

    await h.service.startBackup({ trigger: 'scheduled' });
    const row = await h.settled;

    expect(h.engine.startDump).not.toHaveBeenCalled();
    expect(h.storage.upload).not.toHaveBeenCalled();
    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('rebuild the image');
  });

  it('proceeds on an UNREADABLE version pair — a guard rail, not a gate', async () => {
    const h = makeHarness({
      version: { status: 'unknown', clientMajor: null, serverMajor: null, message: 'could not read' },
    });

    await h.service.startBackup({ trigger: 'scheduled' });
    (await h.firstDump()).finish();
    const row = await h.settled;

    expect(row.status).toBe('completed');
  });
});

describe('cancellation', () => {
  it('routes through the ORDINARY failure path: object deleted, row failed', async () => {
    const h = makeHarness();
    const run = await h.service.startBackup({ trigger: 'manual' });
    const dump = await h.firstDump();
    dump.push(Buffer.from('partial'));
    await tick();

    expect(h.service.cancel(run.id)).toEqual({ outcome: 'signalled', runId: run.id });

    const row = await h.settled;

    expect(dump.kill).toHaveBeenCalledWith('SIGKILL');
    expect(h.storage.delete).toHaveBeenCalledWith(run.storageKey);
    expect(row.status).toBe('failed');
    expect(row.lastError).toContain('cancelled');
    // Not a second teardown mechanism — the same delete-then-mark ordering.
    expect(h.order.indexOf('delete')).toBeLessThan(h.order.indexOf('update:failed'));
  });

  it('reports honestly when the run is not this process’s to cancel', async () => {
    const h = makeHarness();

    // A run started on another replica, or one that already settled: this
    // process holds no child-process handle for it, and saying "cancelled"
    // would tell an operator a dump had stopped while it is still streaming.
    expect(h.service.cancel('a-run-on-another-replica')).toEqual({
      outcome: 'not_running_here',
      runId: 'a-run-on-another-replica',
    });

    const run = await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).finish();
    await h.settled;

    // ...and the handle is released once the run settles.
    expect(h.service.cancel(run.id)).toEqual({ outcome: 'not_running_here', runId: run.id });
  });
});

describe('the storage-provider constraint', () => {
  it('refuses to start when the setting names a provider this deployment does not have', async () => {
    const h = makeHarness({ policy: { storageProvider: 'gcs' } });

    await expect(h.service.startBackup({ trigger: 'manual' })).rejects.toBeInstanceOf(
      DatabaseBackupStorageProviderError
    );

    // No row, no dump: there is nothing to record about a backup that was never
    // allowed to start.
    expect(h.prisma.databaseBackupRun.create).not.toHaveBeenCalled();
    expect(h.engine.startDump).not.toHaveBeenCalled();
  });

  it('accepts an empty setting as "whatever provider is active"', async () => {
    const h = makeHarness({ policy: { storageProvider: '' } });

    const run = await h.service.startBackup({ trigger: 'scheduled' });
    expect(run.storageProvider).toBe('s3');

    (await h.firstDump()).finish();
    await h.settled;
  });

  it('exposes the same rule to #283’s config write path', () => {
    const h = makeHarness();

    expect(() => h.service.assertStorageProviderUsable('gcs')).toThrow(
      DatabaseBackupStorageProviderError
    );
    expect(() => h.service.assertStorageProviderUsable('s3')).not.toThrow();
    expect(() => h.service.assertStorageProviderUsable(null)).not.toThrow();
  });
});

describe('the audit trio', () => {
  it('records the server version, the app version and the newest migration', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).finish();
    const row = await h.settled;

    expect(row.dbVersion).toBe('17.4');
    expect(row.migrationName).toBe('20260907120000_add_database_backup_runs');
    expect(typeof row.appVersion).toBe('string');
    expect((row.appVersion as string).length).toBeGreaterThan(0);
  });

  it('records it on a FAILED run too — the 3am reader needs it most there', async () => {
    const h = makeHarness();
    await h.service.startBackup({ trigger: 'scheduled' });
    (await h.firstDump()).die(new Error('boom'));
    const row = await h.settled;

    expect(row.status).toBe('failed');
    expect(row.dbVersion).toBe('17.4');
    expect(row.migrationName).toBe('20260907120000_add_database_backup_runs');
  });

  it('never fails a backup because an audit read failed', async () => {
    const h = makeHarness();
    h.prisma.$queryRaw.mockRejectedValue(new Error('permission denied for _prisma_migrations'));

    await h.service.startBackup({ trigger: 'manual' });
    (await h.firstDump()).finish();
    const row = await h.settled;

    expect(row.status).toBe('completed');
    expect(row.dbVersion).toBeNull();
    expect(row.migrationName).toBeNull();
  });
});

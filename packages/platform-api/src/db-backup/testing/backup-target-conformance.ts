// =============================================================================
// Backup target conformance kit (PP-14.12)
// =============================================================================
//
// ONE suite every backup target runs, so "implements the backup target
// contract" means the same thing for the platform's storage adapter and for an
// app's own (a filesystem, a vault, a mirror):
//
//   import { describeBackupTargetConformance } from '@marinoscar/platform-api/db-backup/testing';
//
//   describeBackupTargetConformance(() => new LocalDirBackupTarget(dir), {
//     describe, it, expect,
//   });
//
// It is runner-agnostic like `describeStorageDriverConformance`: it receives
// `describe`, `it` and `expect`, so Jest and Vitest both work and the package
// imports no test framework. Nothing here needs a network: point the target at
// a temp directory, an in-memory fake or a local emulator.
//
// WHAT IT CHECKS
//
//   - the definition: a valid id, the four required members, a string
//     `location` when present;
//   - bytes: write through the sink, read back, byte for byte; a missing key
//     fails to read; deleting is idempotent (twice is not an error);
//   - STREAMING, which is the invariant an archive depends on ("a backup
//     archive is never buffered"). It streams `streamedBytes` (default 20 MiB)
//     from a lazily generated source that honours backpressure, and asserts
//       * the sink never queued more than `maxQueuedBytes` (default 4 MiB) of the
//         object at once (a sink that acknowledges nothing until the end would
//         hold the whole thing),
//       * the heap plus external memory grew by less than half the object while
//         it was written and while it was read back (a sink that concatenates
//         the bytes would grow by all of it),
//       * the read side delivers the object in chunks, none larger than
//         `maxReadChunkBytes` (default 4 MiB), and more than one;
//     and that the bytes read back match, by SHA-256 and size;
//   - a failed write: destroying the sink's stream with an error rejects `done`
//     and leaves no object readable after `delete`;
//   - listing: exactly the keys under a prefix, none outside it (skippable for a
//     target that cannot list);
//   - a signed download URL, when the target defines `signedDownloadUrl`;
//   - key safety, opt-in (`rejectsEscapingKeys: true`): a key that would climb
//     out of the target's root is refused.
//
// Every key a case writes lives under its own `database-backups/conformance-<uuid>/`
// prefix and is deleted again.
// =============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';

import type { BackupTarget, BackupTargetObject } from '../backup-target';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface BackupTargetConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`. Every case body the kit passes is an asynchronous function. */
  it: (name: string, fn: () => Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type BackupTargetConformanceScenario =
  | 'definition'
  | 'roundTrip'
  | 'streamed'
  | 'failedWrite'
  | 'list'
  | 'signedUrl'
  | 'escapingKeys';

/**
 * Options of {@link describeBackupTargetConformance}.
 *
 * @stability experimental
 */
export interface BackupTargetConformanceOptions extends BackupTargetConformanceHarness {
  /** Scenarios to skip, each for a stated reason of the caller's (`list` for a target that cannot list). */
  skip?: readonly BackupTargetConformanceScenario[];
  /** Size of the streamed object in bytes. Default 20 MiB. */
  streamedBytes?: number;
  /** The most the sink may have queued at once, in bytes. Default 4 MiB. */
  maxQueuedBytes?: number;
  /** The largest chunk the read side may deliver, in bytes. Default 4 MiB. */
  maxReadChunkBytes?: number;
  /** Declare `true` for a target with a root it must not be escaped from (a directory): the `escapingKeys` scenario then asserts `../` keys are refused. */
  rejectsEscapingKeys?: boolean;
  /** Fetches a signed URL and returns the bytes it serves; without it the kit checks only that a non-empty string comes back. */
  readSignedUrl?: (url: string) => Promise<Buffer | string>;
}

const MIB = 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
/** Distinct chunks the generator cycles through: 1 MiB, so the kit's own footprint is constant. */
const CHUNK_POOL = 16;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/** Whether opening `key` for reading fails. A synchronous throw counts: both mean "no such object". */
async function readFails(target: BackupTarget, key: string): Promise<boolean> {
  try {
    await target.openRead(key);
    return false;
  } catch {
    return true;
  }
}

/** Writes `body` through a sink and waits for it to be stored. */
async function put(target: BackupTarget, key: string, body: Buffer): Promise<void> {
  const sink = target.openWrite(key, { contentType: 'application/octet-stream', metadata: { origin: 'conformance' } });
  sink.stream.end(body);
  await sink.done;
}

function memoryInUse(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

/**
 * Registers the backup target conformance suite.
 *
 * @param target - the target, or a factory that builds a fresh one (called once per case).
 * @param options - the runner and what to skip.
 *
 * @example
 * ```ts
 * import { describeBackupTargetConformance } from '@marinoscar/platform-api/db-backup/testing';
 *
 * describeBackupTargetConformance(() => new LocalDirBackupTarget(tmpDir), { describe, it, expect, rejectsEscapingKeys: true });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeBackupTargetConformance(
  target: BackupTarget | (() => BackupTarget | Promise<BackupTarget>),
  options: BackupTargetConformanceOptions,
): void {
  const { describe, it, expect } = options;
  const skip = new Set(options.skip ?? []);
  const streamedBytes = options.streamedBytes ?? 20 * MIB;
  const maxQueuedBytes = options.maxQueuedBytes ?? 4 * MIB;
  const maxReadChunkBytes = options.maxReadChunkBytes ?? 4 * MIB;

  const build = async (): Promise<BackupTarget> => (typeof target === 'function' ? await target() : target);

  describe('backup target conformance', () => {
    const scenario = (id: BackupTargetConformanceScenario, title: string, fn: (target: BackupTarget) => Promise<void>) => {
      if (skip.has(id)) return;
      it(`[${id}] ${title}`, async () => {
        const built = await build();
        await fn(built);
      });
    };

    const keyPrefix = () => `database-backups/conformance-${randomUUID()}/`;

    scenario('definition', 'declares a valid id and the four members', async (t) => {
      expect(t.id).toMatch(/^[a-z][a-z0-9_-]{0,47}$/);
      for (const member of ['openWrite', 'openRead', 'delete', 'list'] as const) {
        expect(typeof t[member]).toBe('function');
      }
      if (t.location !== undefined) expect(typeof t.location).toBe('string');
      if (t.refresh !== undefined) {
        await t.refresh();
        expect(t.id).toMatch(/^[a-z][a-z0-9_-]{0,47}$/);
      }
      if (t.signedDownloadUrl !== undefined) expect(typeof t.signedDownloadUrl).toBe('function');
    });

    scenario('roundTrip', 'writes, reads back, fails to read a missing key and deletes idempotently', async (t) => {
      const key = `${keyPrefix()}hello.dump`;
      const body = Buffer.from('hello from the backup target conformance kit');

      expect(await readFails(t, key)).toBe(true);

      try {
        await put(t, key, body);
        expect((await collect(await t.openRead(key))).equals(body)).toBe(true);
        // Writing the same key again replaces the object (a retried write).
        const replacement = Buffer.from('replacement');
        await put(t, key, replacement);
        expect((await collect(await t.openRead(key))).equals(replacement)).toBe(true);
      } finally {
        await t.delete(key);
      }

      expect(await readFails(t, key)).toBe(true);
      // Deleting a key that is gone is not an error: retention and the failure path both do it.
      await t.delete(key);
      await t.delete(key);
    });

    scenario('streamed', `streams a ${Math.round(streamedBytes / MIB)} MiB object without buffering it, and reads it back in chunks`, async (t) => {
      const key = `${keyPrefix()}streamed.dump`;

      // 16 distinct 64 KiB chunks, cycled: the kit's own footprint is constant,
      // so a growth in memory during the write is the TARGET's.
      const pool = Array.from({ length: CHUNK_POOL }, (_unused, index) => Buffer.alloc(CHUNK_BYTES, index + 1));
      const expected = createHash('sha256');
      const baseline = memoryInUse();
      let peakGrowth = 0;
      let peakQueued = 0;
      const sample = (queued: number) => {
        peakQueued = Math.max(peakQueued, queued);
        peakGrowth = Math.max(peakGrowth, memoryInUse() - baseline);
      };

      try {
        const sink = t.openWrite(key, { contentType: 'application/octet-stream', metadata: { origin: 'conformance' } });
        // `done` may reject before it is awaited below, and the stream may emit
        // an error: hold handlers so neither is ever unhandled. The failure
        // itself surfaces at `await stored`.
        const stored = sink.done;
        stored.catch(() => undefined);
        sink.stream.on('error', () => undefined);

        let written = 0;
        let index = 0;
        while (written < streamedBytes) {
          const size = Math.min(CHUNK_BYTES, streamedBytes - written);
          const chunk = size === CHUNK_BYTES ? pool[index % CHUNK_POOL] : pool[index % CHUNK_POOL].subarray(0, size);
          expected.update(chunk);
          written += size;
          index += 1;
          const accepted = sink.stream.write(chunk);
          sample(sink.stream.writableLength);
          // Honour backpressure exactly as the engine does: a target that
          // streams drains; one that buffers never signals.
          if (!accepted) await Promise.race([once(sink.stream, 'drain'), stored.then(() => undefined)]);
        }
        sink.stream.end();
        await stored;
        sample(sink.stream.writableLength);

        expect(peakQueued).toBeLessThanOrEqual(maxQueuedBytes);
        expect(peakGrowth).toBeLessThan(streamedBytes / 2);

        // Read it back: chunked, bounded, byte for byte.
        const readBaseline = memoryInUse();
        const actual = createHash('sha256');
        let bytes = 0;
        let chunks = 0;
        let largest = 0;
        let readPeak = 0;
        for await (const piece of await t.openRead(key)) {
          const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
          actual.update(buffer);
          bytes += buffer.length;
          chunks += 1;
          largest = Math.max(largest, buffer.length);
          readPeak = Math.max(readPeak, memoryInUse() - readBaseline);
        }

        expect(bytes).toBe(streamedBytes);
        expect(actual.digest('hex')).toBe(expected.digest('hex'));
        expect(chunks).toBeGreaterThan(1);
        expect(largest).toBeLessThanOrEqual(maxReadChunkBytes);
        expect(readPeak).toBeLessThan(streamedBytes / 2);
      } finally {
        await t.delete(key);
      }
    });

    scenario('failedWrite', 'rejects done when the stream is destroyed with an error, and leaves nothing readable', async (t) => {
      const key = `${keyPrefix()}failed.dump`;

      try {
        const sink = t.openWrite(key, { contentType: 'application/octet-stream', metadata: {} });
        const outcome = sink.done.then(
          () => 'resolved',
          () => 'rejected',
        );
        sink.stream.on('error', () => undefined);
        sink.stream.write(Buffer.alloc(CHUNK_BYTES, 7));
        sink.stream.destroy(new Error('the dump died'));

        expect(await outcome).toBe('rejected');
      } finally {
        // The engine deletes the partial object after a failed write.
        await t.delete(key);
      }

      expect(await readFails(t, key)).toBe(true);
    });

    scenario('list', 'lists exactly the keys under a prefix', async (t) => {
      const prefix = keyPrefix();
      const other = keyPrefix();
      const inside = [`${prefix}2026/10/a.dump`, `${prefix}2026/10/b.dump`];
      const outside = `${other}c.dump`;

      try {
        for (const key of [...inside, outside]) await put(t, key, Buffer.from(key));

        const listed: BackupTargetObject[] = [];
        for await (const object of t.list(prefix)) listed.push(object);

        expect(listed.map((object) => object.key).sort()).toEqual([...inside].sort());
        for (const object of listed) {
          if (object.sizeBytes !== undefined) expect(object.sizeBytes).toBeGreaterThan(0);
        }
      } finally {
        for (const key of [...inside, outside]) await t.delete(key);
      }
    });

    scenario('signedUrl', 'signs a download URL when it can', async (t) => {
      if (t.signedDownloadUrl === undefined) return;
      const key = `${keyPrefix()}signed.dump`;
      const body = Buffer.from('signed download');

      try {
        await put(t, key, body);
        const url = await t.signedDownloadUrl(key, { expiresInSeconds: 300, filename: 'signed.dump' });
        expect(typeof url).toBe('string');
        expect(url.length).toBeGreaterThan(0);
        if (options.readSignedUrl !== undefined) {
          expect(Buffer.from(await options.readSignedUrl(url)).equals(body)).toBe(true);
        }
      } finally {
        await t.delete(key);
      }
    });

    if (options.rejectsEscapingKeys === true) {
      scenario('escapingKeys', 'refuses a key that would climb out of the target root', async (t) => {
        const attempts = ['../escape.dump', 'database-backups/../../escape.dump', '/etc/escape.dump'];
        for (const key of attempts) {
          let refused = false;
          try {
            const sink = t.openWrite(key, { contentType: 'application/octet-stream', metadata: {} });
            sink.stream.on('error', () => undefined);
            sink.stream.end(Buffer.from('x'));
            await sink.done;
          } catch {
            refused = true;
          }
          expect(refused).toBe(true);
          expect(await readFails(t, key)).toBe(true);
        }
      });
    }
  });
}

// =============================================================================
// Storage driver conformance kit (PP-14.7, issue #925)
// =============================================================================
//
// ONE suite every storage driver runs, so "implements the storage driver
// contract" means the same thing for the platform's S3 drivers and for an app's
// own. It exercises the driver the way the slice does: build a provider from
// settings and secrets, then put, read, head, list and delete real bytes
// through it, and ask it to test its own connection.
//
//   import { describeStorageDriverConformance } from '@marinoscar/platform-api/storage/testing';
//
//   describeStorageDriverConformance(localFsDriver, {
//     describe, it, expect,
//     settings: { directory: tmpDir },
//     secrets: {},
//     supportsSignedUrls: true,
//   });
//
// It is runner-agnostic like `describePluggableKindConformance`: it receives
// `describe`, `it` and `expect`, so Jest and Vitest both work and the package
// imports no test framework. Nothing here needs a network: point the driver at
// a fake (an in-memory S3, a temp directory, a local emulator) and pass its
// settings.
//
// WHAT IT CHECKS
//
//   - the definition: a valid id and label, defaults that parse with the
//     driver's own schema, the `build` and `testConnection` operations;
//   - the provider: the full `StorageProvider` surface, a `kind` equal to the
//     driver id and a `getBucket()` that names the configured location;
//   - bytes: put, exists, head (`getMetadata`), get, delete (twice: deleting a
//     missing object is not an error) and `exists` after the delete;
//   - a 6 MiB STREAMED upload from a lazily generated source, read back through
//     a running hash, so the kit itself never holds the object whole. (A driver
//     that buffers the stream cannot be told from one that pipes it from outside;
//     what the kit proves is that a multi-part stream round-trips byte for byte.
//     Pipe it: S3 uses the multipart `Upload`, the filesystem example `pipeline`.)
//   - a signed GET URL, unless the driver declares `supportsSignedUrls: false`;
//     when `readSignedUrl` is given the kit fetches the URL and compares bytes;
//   - key prefix listing, when the driver defines `listKeys`: exactly the keys
//     under the prefix, none outside it;
//   - `testConnection` NEVER THROWS and NEVER returns secret material: with
//     valid settings, with the driver's defaults and no secrets, and with a
//     sentinel secret the driver must not echo into its message, details or checks;
//   - `provision`, when defined, can be repeated;
//   - `location` and `missing`, when defined, are pure and well formed.
// =============================================================================

import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { STORAGE_DRIVER_ID_PATTERN } from '@marinoscar/platform-contract/storage';

import type { StorageProvider } from '../providers/storage-provider.interface';
import {
  getStorageDriver,
  type StorageDriverContext,
  type StorageDriverDefinition,
} from '../drivers/storage-driver';

/**
 * The test runner's own globals, passed in.
 *
 * @stability experimental
 */
export interface StorageDriverConformanceHarness {
  /** The runner's `describe`. */
  describe: (name: string, fn: () => void) => unknown;
  /** The runner's `it`; the kit passes asynchronous case bodies. */
  it: (name: string, fn: () => void | Promise<void>) => unknown;
  /** The runner's `expect`. */
  expect: (actual: unknown) => any;
}

/**
 * One scenario of the kit; each is skippable by name.
 *
 * @stability experimental
 */
export type StorageDriverConformanceScenario =
  | 'definition'
  | 'provider'
  | 'roundTrip'
  | 'streamedUpload'
  | 'signedUrl'
  | 'listKeys'
  | 'testConnection'
  | 'provision'
  | 'pure';

/**
 * Options of {@link describeStorageDriverConformance}.
 *
 * @stability experimental
 */
export interface StorageDriverConformanceOptions extends StorageDriverConformanceHarness {
  /** VALID settings for the driver (parsed with its `settingsSchema`, defaults filled): a configuration a connection test would pass. */
  settings: Record<string, unknown>;
  /** A value for each secret the driver declares, by name. `{}` for a driver with none. */
  secrets: Record<string, string>;
  /**
   * Whether the driver can sign a GET URL. Default `true`. Declare `false` for
   * a backend that cannot (the kit then asserts nothing about
   * `getSignedDownloadUrl`).
   */
  supportsSignedUrls?: boolean;
  /**
   * Fetches a signed URL and returns the bytes it serves, so the kit can prove
   * the URL works. Optional: without it the kit checks only that a non-empty
   * string comes back.
   */
  readSignedUrl?: (url: string) => Promise<Buffer | string>;
  /** Scenarios to skip, each for a stated reason of the caller's. */
  skip?: readonly StorageDriverConformanceScenario[];
  /** Size of the streamed upload in bytes. Default 6 MiB. */
  streamedBytes?: number;
}

/** A value no driver may ever echo back from `testConnection`. */
const SENTINEL_SECRET = 'conformance-secret-9f3a7c1e5b24';

const PROVIDER_METHODS = [
  'upload',
  'initMultipartUpload',
  'getSignedUploadUrl',
  'completeMultipartUpload',
  'abortMultipartUpload',
  'download',
  'getSignedDownloadUrl',
  'getSignedPutUrl',
  'delete',
  'getMetadata',
  'setMetadata',
  'exists',
  'getBucket',
] as const;

const DEFAULT_STREAMED_BYTES = 6 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/**
 * A stream of `total` deterministic bytes generated one chunk at a time, plus
 * the running hash of what it produced. The kit never holds the whole object.
 */
function generatedStream(total: number): { stream: Readable; sha256(): string; produced(): number } {
  const hash = createHash('sha256');
  let produced = 0;

  const stream = Readable.from(
    (function* () {
      let counter = 0;
      while (produced < total) {
        const size = Math.min(STREAM_CHUNK_BYTES, total - produced);
        const chunk = Buffer.alloc(size, counter++ % 251);
        hash.update(chunk);
        produced += size;
        yield chunk;
      }
    })(),
    { objectMode: false, highWaterMark: STREAM_CHUNK_BYTES },
  );

  return { stream, sha256: () => hash.copy().digest('hex'), produced: () => produced };
}

async function sha256Of(stream: Readable): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Registers the storage driver conformance suite.
 *
 * @param driver - a driver definition, or the id of a registered one.
 * @param options - the runner, valid settings and secrets, and what the driver supports.
 *
 * @example
 * ```ts
 * import '../../../src/app-registrations/storage';
 * import { describeStorageDriverConformance } from '@marinoscar/platform-api/storage/testing';
 *
 * describeStorageDriverConformance('local-fs', { describe, it, expect, settings: { directory }, secrets: {} });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function describeStorageDriverConformance(
  driver: StorageDriverDefinition<any> | string,
  options: StorageDriverConformanceOptions,
): void {
  const { describe, it, expect } = options;
  const skip = new Set(options.skip ?? []);
  const supportsSignedUrls = options.supportsSignedUrls !== false;
  const streamedBytes = options.streamedBytes ?? DEFAULT_STREAMED_BYTES;

  const resolved = typeof driver === 'string' ? getStorageDriver(driver) : driver;
  const label = typeof driver === 'string' ? driver : driver.id;

  describe(`storage driver conformance: ${label}`, () => {
    if (resolved === undefined) {
      it('is registered', () => {
        expect(`storage driver "${label}" is registered`).toBe(
          `storage driver "${label}" is not registered: call registerStorageDriver before describeStorageDriverConformance`,
        );
      });
      return;
    }

    const def: StorageDriverDefinition<any> = resolved;

    const scenario = (id: StorageDriverConformanceScenario, title: string, fn: () => void | Promise<void>) => {
      if (skip.has(id)) return;
      it(`[${id}] ${title}`, fn);
    };

    const contextFor = (settings: Record<string, unknown>, secrets: Record<string, string>): StorageDriverContext => ({
      settings: def.settingsSchema.parse({ ...def.defaults, ...settings }),
      secret: async (name) => secrets[name] ?? null,
      logger: new Logger(`conformance:${def.id}`),
      partSize: 5 * 1024 * 1024,
      appOrigin: 'https://app.example.test',
    });

    const validContext = () => contextFor(options.settings, options.secrets);

    // Builds a provider, hands it to the case and releases it afterwards.
    const withProvider = async (fn: (provider: StorageProvider, ctx: StorageDriverContext) => Promise<void>) => {
      const ctx = validContext();
      const provider = await def.build(ctx);
      try {
        await fn(provider, ctx);
      } finally {
        (provider as { destroy?: () => void }).destroy?.();
      }
    };

    // Every key a case writes lives under its own prefix, and is deleted again.
    const keyPrefix = () => `conformance/${randomUUID()}/`;

    scenario('definition', 'declares a valid id, label, defaults and operations', () => {
      expect(def.id).toMatch(STORAGE_DRIVER_ID_PATTERN);
      expect(typeof def.label).toBe('string');
      expect(def.label.trim().length).toBeGreaterThan(0);
      expect(def.settingsSchema.safeParse(def.defaults).success).toBe(true);
      expect(def.settingsSchema.safeParse({ ...def.defaults, ...options.settings }).success).toBe(true);
      expect(typeof def.build).toBe('function');
      expect(typeof def.testConnection).toBe('function');

      const declared = (def.secrets ?? []).map((secret) => secret.name);
      for (const name of declared) {
        expect(typeof options.secrets[name]).toBe('string');
      }
      expect(Object.keys(options.secrets).filter((name) => !declared.includes(name))).toEqual([]);
    });

    scenario('provider', 'builds a StorageProvider with the full surface, kind and location', async () => {
      await withProvider(async (provider) => {
        for (const method of PROVIDER_METHODS) {
          expect(typeof (provider as unknown as Record<string, unknown>)[method]).toBe('function');
        }
        expect(provider.kind).toBe(def.id);
        expect(typeof provider.getBucket()).toBe('string');
        expect(provider.getBucket().length).toBeGreaterThan(0);
      });
    });

    scenario('roundTrip', 'puts, heads, reads and deletes an object (and deleting twice is not an error)', async () => {
      await withProvider(async (provider) => {
        const key = `${keyPrefix()}hello.txt`;
        const body = Buffer.from('hello from the storage driver conformance kit');

        expect(await provider.exists(key)).toBe(false);
        expect(await provider.getMetadata(key)).toBeNull();

        try {
          const result = await provider.upload(key, Readable.from([body]), { mimeType: 'text/plain', metadata: { origin: 'conformance' } });
          expect(result.key).toBe(key);
          expect(typeof result.bucket).toBe('string');
          expect(typeof result.location).toBe('string');

          expect(await provider.exists(key)).toBe(true);
          const metadata = await provider.getMetadata(key);
          expect(metadata).not.toBeNull();
          expect((await collect(await provider.download(key))).equals(body)).toBe(true);
        } finally {
          await provider.delete(key);
        }

        expect(await provider.exists(key)).toBe(false);
        await provider.delete(key);
        await provider.delete(key);
      });
    });

    scenario('streamedUpload', 'round-trips a 6 MiB stream generated lazily, without the kit buffering it', async () => {
      await withProvider(async (provider) => {
        const key = `${keyPrefix()}streamed.bin`;
        const source = generatedStream(streamedBytes);

        try {
          await provider.upload(key, source.stream, { mimeType: 'application/octet-stream' });

          expect(source.produced()).toBe(streamedBytes);
          const stored = await sha256Of(await provider.download(key));
          expect(stored.bytes).toBe(streamedBytes);
          expect(stored.sha256).toBe(source.sha256());
        } finally {
          await provider.delete(key);
        }
      });
    });

    if (supportsSignedUrls) {
      scenario('signedUrl', 'signs a GET URL for a stored object', async () => {
        await withProvider(async (provider) => {
          const key = `${keyPrefix()}signed.txt`;
          const body = Buffer.from('served through a signed url');

          try {
            await provider.upload(key, Readable.from([body]), { mimeType: 'text/plain' });
            const url = await provider.getSignedDownloadUrl(key, { expiresIn: 60 });

            expect(typeof url).toBe('string');
            expect(url.length).toBeGreaterThan(0);
            expect(url).toMatch(/^[a-z][a-z0-9+.-]*:/i);

            if (options.readSignedUrl) {
              const served = await options.readSignedUrl(url);
              expect(Buffer.from(served).equals(body)).toBe(true);
            }
          } finally {
            await provider.delete(key);
          }
        });
      });
    }

    if (def.listKeys !== undefined) {
      const listKeys = def.listKeys.bind(def);

      scenario('listKeys', 'lists exactly the keys under a prefix', async () => {
        await withProvider(async (provider, ctx) => {
          const prefix = keyPrefix();
          const inside = [`${prefix}a.txt`, `${prefix}nested/b.txt`, `${prefix}c.txt`];
          const outside = `${keyPrefix()}d.txt`;

          try {
            for (const key of [...inside, outside]) {
              await provider.upload(key, Readable.from([Buffer.from(key)]), { mimeType: 'text/plain' });
            }

            const listed: string[] = [];
            for await (const key of listKeys(ctx, prefix)) listed.push(key);

            expect([...listed].sort()).toEqual([...inside].sort());

            const none: string[] = [];
            for await (const key of listKeys(ctx, `${keyPrefix()}nothing-here/`)) none.push(key);
            expect(none).toEqual([]);
          } finally {
            for (const key of [...inside, outside]) await provider.delete(key);
          }
        });
      });
    }

    scenario('testConnection', 'never throws and never returns secret material', async () => {
      const secretValues = Object.values(options.secrets).filter((value) => value.length >= 4);
      const assertWellFormed = (result: Awaited<ReturnType<typeof def.testConnection>>, forbidden: readonly string[]) => {
        expect(typeof result.ok).toBe('boolean');
        expect(typeof result.message).toBe('string');
        expect(result.message.length).toBeGreaterThan(0);
        const serialised = JSON.stringify(result);
        for (const value of forbidden) expect(serialised.includes(value)).toBe(false);
      };

      // 1. Valid settings and secrets: an answer, and no secret in it.
      assertWellFormed(await def.testConnection(validContext()), secretValues);

      // 2. Nothing configured at all (the driver's defaults, no secrets): an
      //    `ok: false` answer, not an exception.
      assertWellFormed(await def.testConnection(contextFor({}, {})), []);

      // 3. A sentinel secret the driver cannot know: whatever it does with it,
      //    it must not echo it back in a message, a detail or a check.
      const sentinels = Object.fromEntries((def.secrets ?? []).map((secret) => [secret.name, SENTINEL_SECRET]));
      assertWellFormed(await def.testConnection(contextFor(options.settings, sentinels)), [SENTINEL_SECRET]);
    });

    if (def.provision !== undefined) {
      const provision = def.provision.bind(def);

      scenario('provision', 'can be repeated, and answers with created and a message', async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await provision(validContext());

          expect(typeof result.created).toBe('boolean');
          expect(typeof result.message).toBe('string');
          expect(JSON.stringify(result).includes(SENTINEL_SECRET)).toBe(false);
        }
      });
    }

    scenario('pure', 'location and missing are pure and well formed', () => {
      const settings = def.settingsSchema.parse({ ...def.defaults, ...options.settings });
      const present = Object.fromEntries((def.secrets ?? []).map((secret) => [secret.name, true]));

      if (def.location !== undefined) {
        const location = def.location(settings);
        expect(typeof location.bucket).toBe('string');
        expect(def.location(settings)).toEqual(location);
      }

      if (def.missing !== undefined) {
        expect(def.missing(settings, present)).toEqual([]);
        const unconfigured = def.missing(def.settingsSchema.parse(def.defaults), {});
        expect(Array.isArray(unconfigured)).toBe(true);
        for (const name of unconfigured) expect(typeof name).toBe('string');
      }
    });
  });
}

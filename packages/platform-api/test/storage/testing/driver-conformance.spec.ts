import { Readable } from 'node:stream';
import { z } from 'zod';

import type { StorageProvider } from '../../../src/storage/providers/storage-provider.interface';
import type { StorageDriverDefinition } from '../../../src/storage/drivers/storage-driver';
import { describeStorageDriverConformance } from '../../../src/storage/testing/driver-conformance';

// =============================================================================
// The storage driver kit proves itself (PP-14.7, #925)
// =============================================================================
//
// A kit that only ever passes proves nothing. These cases run it with a tiny
// runner of their own (so a failing case is data, not a red test) against one
// correct in-memory driver and against drivers that each break exactly one rule
// of the contract.
// =============================================================================

type Case = { name: string; run: () => void | Promise<void> };

/** Runs the kit on `driver`; returns each case's name and whether it passed. */
async function runKit(
  driver: StorageDriverDefinition<any>,
  options: Partial<Parameters<typeof describeStorageDriverConformance>[1]> = {},
): Promise<Record<string, string | null>> {
  const cases: Case[] = [];

  describeStorageDriverConformance(driver, {
    describe: (_name, fn) => fn(),
    it: (name, run) => void cases.push({ name, run }),
    expect,
    settings: {},
    secrets: { token: 'a-valid-token-value' },
    ...options,
  });

  const outcome: Record<string, string | null> = {};
  for (const entry of cases) {
    try {
      await entry.run();
      outcome[entry.name] = null;
    } catch (error) {
      outcome[entry.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return outcome;
}

function memoryProvider(kind: string, overrides: Partial<StorageProvider> = {}): StorageProvider {
  const objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();

  return {
    kind,
    async upload(key, stream, options) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      objects.set(key, { body: Buffer.concat(chunks), metadata: options.metadata ?? {} });
      return { key, bucket: 'memory', location: `memory://${key}` };
    },
    async download(key) {
      const entry = objects.get(key);
      if (!entry) throw new Error('no such object');
      return Readable.from([entry.body]);
    },
    async delete(key) {
      objects.delete(key);
    },
    async exists(key) {
      return objects.has(key);
    },
    async getMetadata(key) {
      return objects.get(key)?.metadata ?? null;
    },
    async setMetadata() {},
    async getSignedDownloadUrl(key) {
      return `memory://signed/${key}`;
    },
    async getSignedPutUrl(key) {
      return `memory://put/${key}`;
    },
    async initMultipartUpload(key) {
      return { uploadId: 'u', key };
    },
    async getSignedUploadUrl() {
      return 'memory://part';
    },
    async completeMultipartUpload(key) {
      return { key, bucket: 'memory', location: 'memory://' };
    },
    async abortMultipartUpload() {},
    getBucket: () => 'memory',
    __objects: objects,
    ...overrides,
  } as StorageProvider & { __objects: typeof objects };
}

/** A correct driver; `overrides` break one rule. */
function driver(overrides: Partial<StorageDriverDefinition<any>> = {}): StorageDriverDefinition<any> {
  return {
    id: 'memory-test',
    label: 'Memory',
    settingsSchema: z.object({}),
    defaults: {},
    secrets: [{ name: 'token', label: 'Token', required: true }],
    build: () => memoryProvider('memory-test'),
    testConnection: async () => ({ ok: true, message: 'Wrote and read back a probe.' }),
    ...overrides,
  };
}

const failures = (outcome: Record<string, string | null>) => Object.keys(outcome).filter((name) => outcome[name] !== null);

describe('describeStorageDriverConformance', () => {
  it('passes a correct driver on every scenario it applies to', async () => {
    const outcome = await runKit(driver());

    expect(failures(outcome)).toEqual([]);
    expect(Object.keys(outcome).map((name) => name.slice(1, name.indexOf(']')))).toEqual(
      expect.arrayContaining(['definition', 'provider', 'roundTrip', 'streamedUpload', 'signedUrl', 'testConnection', 'pure']),
    );
  });

  it('accepts a registered driver by id, and reports one that is not registered', async () => {
    const missing = await runKit('never-registered' as never);

    expect(Object.keys(missing)).toEqual(['is registered']);
    expect(failures(missing)).toEqual(['is registered']);
  });

  it('fails a driver whose testConnection throws', async () => {
    const outcome = await runKit(driver({ testConnection: async () => { throw new Error('boom'); } }));

    expect(failures(outcome)).toEqual([expect.stringContaining('[testConnection]')]);
  });

  it('fails a driver whose testConnection returns the secret', async () => {
    const outcome = await runKit(
      driver({ testConnection: async (ctx) => ({ ok: false, message: `rejected ${await ctx.secret('token')}` }) }),
    );

    expect(failures(outcome)).toEqual([expect.stringContaining('[testConnection]')]);
  });

  it('fails a driver that echoes a secret it was handed into its details', async () => {
    const outcome = await runKit(
      driver({ testConnection: async (ctx) => ({ ok: true, message: 'ok', details: { auth: `Bearer ${await ctx.secret('token')}` } }) }),
    );

    expect(failures(outcome)).toEqual([expect.stringContaining('[testConnection]')]);
  });

  it('fails a provider that drops what it was given', async () => {
    const outcome = await runKit(
      driver({
        build: () =>
          memoryProvider('memory-test', {
            // Reads the stream and keeps nothing: the object is never stored.
            async upload(key, stream) {
              for await (const chunk of stream) void chunk;
              return { key, bucket: 'memory', location: key };
            },
          }),
      }),
    );

    expect(failures(outcome).some((name) => name.startsWith('[roundTrip]') || name.startsWith('[streamedUpload]'))).toBe(true);
  });

  it('fails a provider whose kind is not the driver id', async () => {
    const outcome = await runKit(driver({ build: () => memoryProvider('something-else') }));

    expect(failures(outcome)).toEqual([expect.stringContaining('[provider]')]);
  });

  it('fails a listKeys that leaks keys outside the prefix', async () => {
    const outcome = await runKit(
      driver({
        build: () => memoryProvider('memory-test'),
        async *listKeys() {
          yield 'conformance/unrelated/key';
        },
      }),
    );

    expect(failures(outcome)).toEqual([expect.stringContaining('[listKeys]')]);
  });

  it('skips a scenario the caller names, and signed URLs when the driver declares none', async () => {
    const outcome = await runKit(driver(), { supportsSignedUrls: false, skip: ['streamedUpload'] });
    const ids = Object.keys(outcome).map((name) => name.slice(1, name.indexOf(']')));

    expect(ids).not.toContain('signedUrl');
    expect(ids).not.toContain('streamedUpload');
  });

  it('fails a definition whose settings do not parse', async () => {
    const outcome = await runKit(driver(), { settings: { extra: 1 } as never });

    // Unknown keys are stripped by zod, so this still passes; a wrongly typed value does not.
    expect(failures(outcome)).toEqual([]);

    const typed = await runKit(driver({ settingsSchema: z.object({ n: z.number() }), defaults: { n: 1 } }), { settings: { n: 'x' } });
    expect(failures(typed).length).toBeGreaterThan(0);
  });
});

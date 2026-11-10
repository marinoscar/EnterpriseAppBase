// =============================================================================
// Unit tests for copyAndVerify (issue #1093): stream, then prove by reading back
// =============================================================================

import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

import { StorageCopyVerificationError, copyAndVerify } from '../../../src/storage/migration/copy-and-verify';
import type { StorageProvider } from '../../../src/storage/providers/storage-provider.interface';

/** A Map-backed provider that consumes uploads as streams, chunk by chunk. */
function memoryProvider(store = new Map<string, Buffer>(), tamper?: (bytes: Buffer) => Buffer) {
  const uploads: Array<{ key: string; wasStream: boolean; contentLength?: number }> = [];
  const provider = {
    kind: 'memory',
    async download(key: string): Promise<Readable> {
      const bytes = store.get(key);
      if (!bytes) throw new Error(`no such key ${key}`);
      // Emit in small chunks, as a real network stream would.
      const chunks: Buffer[] = [];
      for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.subarray(i, i + 7));
      return Readable.from(chunks);
    },
    async upload(key: string, stream: Readable, options: { contentLength?: number }) {
      uploads.push({ key, wasStream: typeof stream.pipe === 'function', contentLength: options.contentLength });
      const parts: Buffer[] = [];
      for await (const chunk of stream) parts.push(chunk as Buffer);
      const bytes = Buffer.concat(parts);
      store.set(key, tamper ? tamper(bytes) : bytes);
      return { key, bucket: 'b', location: key };
    },
    getBucket: () => 'b',
  } as unknown as StorageProvider;
  return { provider, store, uploads };
}

const KEY = 'uploads/org/obj.bin';
const BYTES = Buffer.from('a'.repeat(100) + 'b'.repeat(57));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('copyAndVerify', () => {
  it('streams the bytes to the target under the same key and returns their size and sha256', async () => {
    const source = memoryProvider(new Map([[KEY, BYTES]]));
    const target = memoryProvider();

    const result = await copyAndVerify(source.provider, target.provider, { storageKey: KEY, mimeType: 'application/octet-stream', size: BigInt(BYTES.length) });

    expect(result).toEqual({ bytes: BigInt(BYTES.length), sha256: sha(BYTES) });
    expect(target.store.get(KEY)).toEqual(BYTES);
    expect(target.uploads).toEqual([{ key: KEY, wasStream: true, contentLength: BYTES.length }]);
    // The source is never touched.
    expect(source.store.get(KEY)).toEqual(BYTES);
  });

  it('refuses a copy whose byte count disagrees with the row', async () => {
    const source = memoryProvider(new Map([[KEY, BYTES]]));
    await expect(
      copyAndVerify(source.provider, memoryProvider().provider, { storageKey: KEY, mimeType: 'x/y', size: BigInt(BYTES.length + 1) }),
    ).rejects.toBeInstanceOf(StorageCopyVerificationError);
  });

  it('refuses a target that kept fewer bytes than it was sent', async () => {
    const source = memoryProvider(new Map([[KEY, BYTES]]));
    const target = memoryProvider(new Map(), (b) => b.subarray(0, b.length - 1));
    await expect(
      copyAndVerify(source.provider, target.provider, { storageKey: KEY, mimeType: 'x/y', size: BigInt(BYTES.length) }),
    ).rejects.toThrow(/the target holds/);
  });

  it('refuses a target whose bytes read back with a different checksum', async () => {
    const source = memoryProvider(new Map([[KEY, BYTES]]));
    const target = memoryProvider(new Map(), (b) => Buffer.from(b.toString().replace('b', 'c')));
    await expect(
      copyAndVerify(source.provider, target.provider, { storageKey: KEY, mimeType: 'x/y', size: BigInt(BYTES.length) }),
    ).rejects.toThrow(/checksum/);
  });

  it('aborts the upload when the source stream fails', async () => {
    const source = {
      download: async () =>
        new Readable({
          read() {
            this.destroy(new Error('source reset'));
          },
        }),
    } as unknown as StorageProvider;
    await expect(
      copyAndVerify(source, memoryProvider().provider, { storageKey: KEY, mimeType: 'x/y', size: 10n }),
    ).rejects.toThrow('source reset');
  });
});

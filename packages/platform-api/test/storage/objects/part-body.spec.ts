import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { boundPartBody } from '../../../src/storage/objects/part-body';
import { PartSizeMismatchError } from '../../../src/storage/providers/storage-provider.types';

const lazy = (bytes: number, chunk: number) =>
  Readable.from(
    (function* () {
      let left = bytes;
      while (left > 0) {
        const size = Math.min(chunk, left);
        left -= size;
        yield Buffer.alloc(size, 1);
      }
    })(),
  );

const sink = () => {
  let total = 0;
  let largest = 0;
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      largest = Math.max(largest, chunk.length);
      cb();
    },
  });
  return { stream, total: () => total, largest: () => largest };
};

describe('boundPartBody', () => {
  it('passes exactly expectedSize bytes through, chunk by chunk', async () => {
    const out = sink();
    await pipeline(boundPartBody(lazy(8 * 1024 * 1024, 64 * 1024), 1, 8 * 1024 * 1024), out.stream);
    expect(out.total()).toBe(8 * 1024 * 1024);
    expect(out.largest()).toBeLessThanOrEqual(64 * 1024);
  });

  it('errors with PartSizeMismatchError(exceeded) as soon as the body runs long', async () => {
    const out = sink();
    const error = await pipeline(boundPartBody(lazy(1000, 100), 2, 600), out.stream).catch((e) => e);
    expect(error).toBeInstanceOf(PartSizeMismatchError);
    expect(error).toMatchObject({ partNumber: 2, expectedSize: 600, exceeded: true });
    expect(out.total()).toBeLessThanOrEqual(600);
  });

  it('errors with PartSizeMismatchError when the body ends short', async () => {
    const error = await pipeline(boundPartBody(lazy(500, 100), 3, 600), sink().stream).catch((e) => e);
    expect(error).toBeInstanceOf(PartSizeMismatchError);
    expect(error).toMatchObject({ receivedSize: 500, exceeded: false });
  });

  it('forwards a source error', async () => {
    const broken = new Readable({ read() { this.destroy(new Error('socket reset')); } });
    await expect(pipeline(boundPartBody(broken, 1, 10), sink().stream)).rejects.toThrow('socket reset');
  });
});

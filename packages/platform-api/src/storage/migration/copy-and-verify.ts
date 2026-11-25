// =============================================================================
// Stream one object from a source provider to a target provider, then prove it
// (issue #1093)
// =============================================================================
//
// NEVER BUFFERED. The source download is piped through a metering transform
// (sha256 and byte count, computed on the same pass) straight into the target's
// `upload`, so memory is bounded by the stream's high-water mark whatever the
// object's size.
//
// VERIFIED BEFORE ANY REPOINT. After the upload resolves, the object is read
// BACK from the target, streamed through a second hash, and three facts must
// agree: the bytes read from the source, the bytes read back from the target,
// and the row's recorded size. A target that acknowledged an upload it did not
// keep, truncated it, or a source that changed under the copy, all fail here,
// and the caller leaves the row pointing at the source.
// =============================================================================

import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';

import type { StorageProvider } from '../providers/storage-provider.interface';

/**
 * What a verified copy proved.
 *
 * @stability experimental
 */
export interface VerifiedCopy {
  /** The byte count, identical on both sides and equal to the row's size. */
  bytes: bigint;
  /** The sha256 (hex) of the bytes, identical on both sides. */
  sha256: string;
}

/**
 * A copy that did not verify. Thrown by {@link copyAndVerify}; the job retries it.
 *
 * @stability experimental
 */
export class StorageCopyVerificationError extends Error {
  /** @param message - which fact disagreed. */
  constructor(message: string) {
    super(message);
    this.name = 'StorageCopyVerificationError';
  }
}

interface Meter {
  transform: Transform;
  digest(): VerifiedCopy;
}

function meter(): Meter {
  const hash = createHash('sha256');
  let bytes = 0n;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += BigInt(chunk.length);
      callback(null, chunk);
    },
  });
  return { transform, digest: () => ({ bytes, sha256: hash.digest('hex') }) };
}

async function hashStream(stream: Readable): Promise<VerifiedCopy> {
  const hash = createHash('sha256');
  let bytes = 0n;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    hash.update(buffer);
    bytes += BigInt(buffer.length);
  }
  return { bytes, sha256: hash.digest('hex') };
}

/**
 * Copies `key` from `source` to `target` under the same key, by streaming, and
 * verifies the copy by reading it back.
 *
 * @param source - the provider the row records.
 * @param target - the provider the run copies to.
 * @param object - the row's key, media type and size.
 * @returns the verified byte count and sha256.
 * @throws StorageCopyVerificationError when a size or checksum disagrees; any provider error as thrown.
 *
 * @stability experimental
 */
export async function copyAndVerify(
  source: StorageProvider,
  target: StorageProvider,
  object: { storageKey: string; mimeType: string; size: bigint },
): Promise<VerifiedCopy> {
  const input = await source.download(object.storageKey);
  const metered = meter();
  // A source error must abort the upload, not leave it waiting for more bytes.
  input.once('error', (error) => metered.transform.destroy(error));
  input.pipe(metered.transform);

  await target.upload(object.storageKey, metered.transform, {
    mimeType: object.mimeType,
    contentLength: Number(object.size),
  });

  const sent = metered.digest();
  if (sent.bytes !== object.size) {
    throw new StorageCopyVerificationError(
      `read ${sent.bytes} byte(s) from the source but the row records ${object.size}`,
    );
  }

  const readBack = await hashStream(await target.download(object.storageKey));
  if (readBack.bytes !== sent.bytes) {
    throw new StorageCopyVerificationError(
      `the target holds ${readBack.bytes} byte(s), ${sent.bytes} were sent`,
    );
  }
  if (readBack.sha256 !== sent.sha256) {
    throw new StorageCopyVerificationError('the checksum of the bytes read back from the target differs from the source');
  }

  return sent;
}

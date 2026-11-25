// Shared fixtures of the android-app slice's package tests (#746).
import { Readable } from 'node:stream';

/** A fingerprint in the stored form. */
export const SHA = Array.from({ length: 32 }, (_, i) => ((i * 13 + 7) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');
/** A second, different fingerprint. */
export const OTHER_SHA = Array.from({ length: 32 }, (_, i) => ((i * 5 + 200) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':');

/** A fixture "APK": the ZIP local-file-header signature, then filler bytes. */
export function fixtureApk(size = 4096): Buffer {
  const bytes = Buffer.alloc(size, 0x2a);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
  return bytes;
}

/** A stream emitting `buffer` in small chunks, like a multipart file. */
export function chunked(buffer: Buffer, size = 1000): Readable & { truncated?: boolean } {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buffer.length; i += size) chunks.push(buffer.subarray(i, i + size));
  return Readable.from(chunks) as Readable & { truncated?: boolean };
}

/** Drains a readable into one buffer. */
export async function drain(stream: Readable): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const chunk of stream) out.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(out);
}

/** Sets a throwaway SECRETS_ENCRYPTION_KEY for the signing sub-key. */
export function useTestEncryptionKey(): void {
  process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
}

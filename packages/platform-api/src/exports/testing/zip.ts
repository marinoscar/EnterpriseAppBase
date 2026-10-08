// =============================================================================
// A minimal zip reader for export tests (issue #744)
// =============================================================================
//
// The `csv` and `xlsx` writers produce zips whose entries are deflated, so a
// byte search over the file proves nothing. This reads the central directory
// and inflates every entry with `node:zlib`, so a test can search the
// decompressed text. Stored (0) and deflated (8) entries only; no zip64, no
// encryption: what archiver and exceljs write. Test-only code.
// =============================================================================

import { inflateRawSync } from 'node:zlib';

/**
 * One decompressed zip entry.
 *
 * @stability experimental
 */
export interface ZipEntry {
  /** The entry's name. */
  readonly name: string;
  /** Its decompressed bytes. */
  readonly data: Buffer;
}

/**
 * Whether `bytes` starts like a zip file.
 *
 * @param bytes - a file.
 * @returns `true` for a local file header signature.
 *
 * @stability experimental
 */
export function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

/**
 * Every entry of a zip file, decompressed.
 *
 * @param zip - the file.
 * @returns the entries, in central-directory order.
 * @throws Error for a malformed or unsupported file.
 *
 * @stability experimental
 */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file: no end of central directory');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('malformed central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * A file's searchable text: the file itself, or every entry of a zip
 * concatenated.
 *
 * @param bytes - a file.
 * @returns its text.
 *
 * @stability experimental
 */
export function exportFileText(bytes: Buffer): string {
  if (!isZip(bytes)) return bytes.toString('utf8');
  return readZipEntries(bytes)
    .map((entry) => `\n--- ${entry.name}\n${entry.data.toString('utf8')}`)
    .join('');
}

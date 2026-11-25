import { createHash } from 'node:crypto';

/**
 * Lower-case hex SHA-256 of raw bytes.
 *
 * Migration files are hashed as bytes and never normalised: Prisma checksums
 * the raw file, so a changed comment, a trailing newline or a line ending is a
 * different migration.
 *
 * @param bytes - The file contents, exactly as stored.
 * @returns 64 lower-case hex characters.
 * @stability experimental
 */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

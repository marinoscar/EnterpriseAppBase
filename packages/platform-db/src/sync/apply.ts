import { sha256Hex, type PlatformLock } from '../lock/index.js';
import { SyncError } from './errors.js';
import { lockEntryOf, type SyncPlan } from './plan.js';

/**
 * The file-system side of {@link applySync}, injectable so the logic is testable.
 *
 * @stability experimental
 */
export interface SyncIo {
  /** Reads `<package>/migrations/<packageDir>/migration.sql`. */
  readPackageFile(packageDir: string): Uint8Array;
  /** Creates `prisma/migrations/<localDir>/migration.sql` with exactly these bytes; must throw when the directory already exists. */
  writeLocalMigration(localDir: string, bytes: Uint8Array): void;
}

/**
 * Executes a plan: byte-copies every planned migration into the app and
 * returns the lock to write.
 *
 * Every package file is verified against its manifest hash before the first
 * copy, so a stale or tampered package fails without leaving half an install.
 * Bytes are copied verbatim: never re-encoded, never given a header.
 *
 * @param plan - The result of {@link planSync}.
 * @param io - File access.
 * @returns The new lock (the caller writes it with `serializeLock`).
 * @throws SyncError `PACKAGE_FILE_MISMATCH` before any copy, or `LOCAL_DIR_EXISTS` from the io.
 * @stability experimental
 */
export function applySync(plan: SyncPlan, io: SyncIo): PlatformLock {
  const files = plan.installs.map((install) => {
    const bytes = io.readPackageFile(install.packageDir);
    const actual = sha256Hex(bytes);
    if (actual !== install.sha256) {
      throw new SyncError(
        'PACKAGE_FILE_MISMATCH',
        `${install.originId}: package file hashes to ${actual}, the manifest says ${install.sha256}; the package is corrupt or a released migration was edited`,
      );
    }
    return bytes;
  });
  plan.installs.forEach((install, i) => io.writeLocalMigration(install.localDir, files[i]!));
  return {
    ...plan.baseLock,
    platformVersion: plan.installs.length ? plan.platformVersion : plan.baseLock.platformVersion,
    migrations: [...plan.baseLock.migrations, ...plan.installs.map(lockEntryOf)],
  };
}

import { originIdOf, type LockEntry, type ManifestEntry, type PlatformLock } from '../lock/index.js';
import { SyncError } from './errors.js';
import { nextTimestamps } from './timestamps.js';

/**
 * One package migration `sync` is about to install.
 *
 * @stability experimental
 */
export interface PlannedInstall {
  /** `platform:NNNN_slug`. */
  originId: string;
  /** The directory under the package's `migrations/` folder. */
  packageDir: string;
  /** The app-local directory to create under `prisma/migrations`. */
  localDir: string;
  /** SHA-256 the package file must have (from the manifest). */
  sha256: string;
  /** The version recorded as `since` in the lock entry. */
  since: string;
}

/**
 * What `sync` would do; produced by {@link planSync}, consumed by {@link applySync}.
 *
 * @stability experimental
 */
export interface SyncPlan {
  /** The migrations to install, in install order (empty when the app is up to date). */
  installs: PlannedInstall[];
  /** The version the lock will record after the sync. */
  platformVersion: string;
  /** The lock the plan was derived from. */
  baseLock: PlatformLock;
}

/** The directory slug of a package migration id: the id without its numeric prefix, kebab to snake. */
function slugOf(id: string): string {
  return id.replace(/^\d{4}_/, '').replace(/-/g, '_');
}

/**
 * Checks the manifest's internal order: every `requires` slice must be
 * provided by an earlier entry.
 *
 * @param manifest - The package history, in order.
 * @throws SyncError `REQUIRES_VIOLATION` naming the entry and the missing slice.
 * @stability experimental
 */
export function assertRequiresSatisfied(manifest: readonly ManifestEntry[]): void {
  const provided = new Set<string>();
  for (const entry of manifest) {
    for (const slice of entry.requires) {
      if (!provided.has(slice)) {
        throw new SyncError(
          'REQUIRES_VIOLATION',
          `${entry.id} requires slice "${slice}", which no earlier migration provides; reorder the manifest or fix "requires"`,
        );
      }
    }
    provided.add(entry.slice);
  }
}

/**
 * Plans an install. Pure: no file system, no clock beyond `now`.
 *
 * Every package migration missing from the lock is installed, in manifest
 * order, under an app-local timestamp that sorts after everything already in
 * the history (see {@link nextTimestamps}). Nothing existing is renamed or
 * rewritten.
 *
 * @param manifest - The package history, in order.
 * @param lock - The app's current `platform.lock`.
 * @param localDirs - Every directory name under the app's `prisma/migrations`.
 * @param now - The clock; the `--timestamp` override of the command.
 * @param platformVersion - The version to record in the lock (default: the lock's current one).
 * @returns The plan; `installs` is empty when nothing is missing.
 * @throws SyncError `REQUIRES_VIOLATION`, `NOT_IN_PACKAGE` or `LOCK_GAP`.
 * @stability experimental
 */
export function planSync(
  manifest: readonly ManifestEntry[],
  lock: PlatformLock,
  localDirs: readonly string[],
  now: Date,
  platformVersion: string = lock.platformVersion,
): SyncPlan {
  assertRequiresSatisfied(manifest);

  const byOrigin = new Map(manifest.map((entry, index) => [originIdOf(entry), index]));
  for (const locked of lock.migrations) {
    if (!byOrigin.has(locked.originId)) {
      throw new SyncError(
        'NOT_IN_PACKAGE',
        `${locked.originId} is in platform.lock but not in the package manifest; the package must never drop a released migration`,
      );
    }
  }
  // The lock must hold an in-order prefix of the package history.
  lock.migrations.forEach((locked, i) => {
    const expected = manifest[i];
    if (!expected || originIdOf(expected) !== locked.originId) {
      throw new SyncError(
        'LOCK_GAP',
        `platform.lock entry ${i + 1} is ${locked.originId} but the package history has ${expected ? originIdOf(expected) : 'nothing'} there; the package history has a gap relative to the lock`,
      );
    }
  });

  const pending = manifest.slice(lock.migrations.length);
  const stamps = nextTimestamps(localDirs, pending.length, now);
  const installs = pending.map(
    (entry, i): PlannedInstall => ({
      originId: originIdOf(entry),
      packageDir: entry.dir,
      localDir: `${stamps[i]}_${slugOf(entry.id)}`,
      sha256: entry.sha256,
      since: entry.since,
    }),
  );
  return { installs, platformVersion, baseLock: lock };
}

/** The lock entry an install records. */
export function lockEntryOf(install: PlannedInstall): LockEntry {
  return { originId: install.originId, localDir: install.localDir, sha256: install.sha256, since: install.since };
}

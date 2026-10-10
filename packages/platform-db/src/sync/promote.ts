import { originIdOf, sha256Hex, type LockEntry, type ManifestEntry, type PlatformLock } from '../lock/index.js';
import { SyncError } from './errors.js';

/**
 * Everything {@link promote} reads and writes, injectable so the logic is testable.
 *
 * @stability experimental
 */
export interface PromoteIo {
  /** The package manifest as it is now. */
  manifest: readonly ManifestEntry[];
  /** The app's lock as it is now. */
  lock: PlatformLock;
  /** Reads `prisma/migrations/<localDir>/migration.sql`; `undefined` when missing. */
  readLocal(localDir: string): Uint8Array | undefined;
  /** Writes `<package>/migrations/<dir>/migration.sql`; only called for a new entry. */
  writePackageFile(dir: string, bytes: Uint8Array): void;
  /** The next platform version: recorded as `since` in the manifest and the lock. */
  since: string;
  /** The slice that owns the migration. */
  slice: string;
  /** Slice ids that must appear in earlier entries. */
  requires: readonly string[];
  /** Other slices whose tables the migration also changes. */
  touches?: readonly string[];
  /** Whether the migration enables row-level security on a table. */
  rls?: boolean;
}

/**
 * The outcome of {@link promote}.
 *
 * @stability experimental
 */
export interface PromoteResult {
  /** The manifest to write. */
  manifest: ManifestEntry[];
  /** The lock to write. */
  lock: PlatformLock;
  /** The manifest entry of the promoted migration. */
  entry: ManifestEntry;
  /** False when the call was a no-op because the migration was already promoted. */
  changed: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_]*$/;
const LOCAL_DIR_RE = /^\d{14}_/;

const slugOf = (id: string): string => id.replace(/^\d{4}_/, '');

/**
 * `platform db promote <localDir> --id <slug>`: the authoring workflow for a
 * platform migration. Takes a migration generated in the app by
 * `prisma migrate dev --create-only`, copies its bytes into the package, adds
 * it to the manifest and records it in the app lock against the **same**
 * `localDir`, so the app keeps the directory Prisma created and never
 * re-applies it.
 *
 * Idempotent: promoting the same directory with the same bytes again changes
 * nothing. A released migration is immutable, so the same slug with different
 * bytes is refused.
 *
 * @param localDir - The app's migration directory name.
 * @param id - The slug of the new package migration (`add_orgs`); the sequence number is assigned.
 * @param io - Reads and writes.
 * @returns The manifest and lock to write, and whether anything changed.
 * @throws SyncError `PROMOTE_INVALID`, `PROMOTE_CONFLICT`, `PROMOTE_NOT_SYNCED` or `PROMOTE_ORDER`.
 * @stability experimental
 */
export function promote(localDir: string, id: string, io: PromoteIo): PromoteResult {
  if (!SLUG_RE.test(id)) throw new SyncError('PROMOTE_INVALID', `--id must be a lower-case slug with underscores (got "${id}")`);
  if (!LOCAL_DIR_RE.test(localDir) || /[\\/]/.test(localDir)) {
    throw new SyncError('PROMOTE_INVALID', `"${localDir}" is not a timestamped migration directory name (YYYYMMDDHHMMSS_name)`);
  }
  const bytes = io.readLocal(localDir);
  if (!bytes || bytes.length === 0) {
    throw new SyncError('PROMOTE_INVALID', `prisma/migrations/${localDir}/migration.sql does not exist or is empty`);
  }
  const hash = sha256Hex(bytes);
  const { manifest, lock } = io;

  const lockedHere = lock.migrations.find((entry) => entry.localDir === localDir);
  const existing = manifest.find((entry) => slugOf(entry.id) === id);

  if (existing) {
    if (existing.sha256 !== hash) {
      throw new SyncError(
        'PROMOTE_CONFLICT',
        `${existing.id} is already in the manifest with different bytes; a released migration is immutable, so write a new migration instead`,
      );
    }
    if (lockedHere) {
      if (lockedHere.originId === originIdOf(existing)) {
        return { manifest: [...manifest], lock, entry: existing, changed: false };
      }
      throw new SyncError('PROMOTE_CONFLICT', `${localDir} is already locked as ${lockedHere.originId}, not ${originIdOf(existing)}`);
    }
    // Same bytes in the package, not yet recorded for this app directory: record it.
    const recorded = appendLockEntry(manifest, lock, existing, localDir, hash, existing.since);
    return { manifest: [...manifest], lock: recorded, entry: existing, changed: true };
  }

  if (lockedHere) {
    throw new SyncError('PROMOTE_CONFLICT', `${localDir} is already locked as ${lockedHere.originId}; it cannot become a second package migration`);
  }
  if (lock.migrations.length !== manifest.length) {
    throw new SyncError('PROMOTE_NOT_SYNCED', 'the app lock does not hold every package migration; run `platform db sync` first');
  }
  const last = lock.migrations[lock.migrations.length - 1];
  if (last && localDir <= last.localDir) {
    throw new SyncError(
      'PROMOTE_ORDER',
      `${localDir} sorts before ${last.localDir}, the last installed platform migration; rebase and re-run \`prisma migrate dev --create-only\` so it gets a newer timestamp`,
    );
  }
  const provided = new Set(manifest.map((entry) => entry.slice));
  for (const slice of io.requires) {
    if (!provided.has(slice)) throw new SyncError('PROMOTE_INVALID', `--requires names slice "${slice}", which no earlier migration provides`);
  }

  const lastSequence = manifest.length ? Number(manifest[manifest.length - 1]!.id.slice(0, 4)) : 0;
  const newId = `${String(lastSequence + 1).padStart(4, '0')}_${id}`;
  const entry: ManifestEntry = {
    id: newId,
    dir: newId,
    sha256: hash,
    since: io.since,
    slice: io.slice,
    requires: [...io.requires],
    ...(io.touches && io.touches.length > 0 ? { touches: [...io.touches] } : {}),
    ...(io.rls ? { rls: true } : {}),
  };
  io.writePackageFile(newId, bytes);
  const next = [...manifest, entry];
  const recorded = appendLockEntry(next, lock, entry, localDir, hash, io.since);
  return { manifest: next, lock: recorded, entry, changed: true };
}

function appendLockEntry(
  manifest: readonly ManifestEntry[],
  lock: PlatformLock,
  entry: ManifestEntry,
  localDir: string,
  hash: string,
  since: string,
): PlatformLock {
  const lockEntry: LockEntry = { originId: originIdOf(entry), localDir, sha256: hash, since };
  // Keep the lock in manifest order.
  const order = new Map(manifest.map((m, i) => [originIdOf(m), i]));
  const migrations = [...lock.migrations, lockEntry].sort((a, b) => (order.get(a.originId) ?? 0) - (order.get(b.originId) ?? 0));
  return { ...lock, platformVersion: since, migrations };
}

import { originIdOf, sha256Hex, type ManifestEntry, type PlatformLock } from '../lock/index.js';

/**
 * The class of a lock failure; each is named in the command's output.
 *
 * - `LOCAL_MODIFIED`: an installed file's bytes differ from the lock (`localSha256 ?? sha256`).
 * - `PACKAGE_MODIFIED`: the lock's hash differs from the manifest's for the same origin id (a released migration was rewritten).
 * - `PACKAGE_FILE_MODIFIED`: the package's `migration.sql` differs from its manifest hash (or is missing).
 * - `NOT_INSTALLED`: a package migration is not in the lock; run `platform db sync`.
 * - `LOCAL_DIR_MISSING`: a locked `localDir` does not exist.
 * - `NOT_IN_PACKAGE`: the lock names a migration the manifest does not have.
 * - `LOCAL_OUT_OF_ORDER`: installed directories do not sort in package order.
 *
 * @stability experimental
 */
export type CheckProblemCode =
  | 'LOCAL_MODIFIED'
  | 'PACKAGE_MODIFIED'
  | 'PACKAGE_FILE_MODIFIED'
  | 'NOT_INSTALLED'
  | 'LOCAL_DIR_MISSING'
  | 'NOT_IN_PACKAGE'
  | 'LOCAL_OUT_OF_ORDER';

/**
 * One offending migration.
 *
 * @stability experimental
 */
export interface CheckProblem {
  /** The class of failure. */
  code: CheckProblemCode;
  /** The origin id of the offending migration. */
  originId: string;
  /** The app-local directory, when there is one. */
  localDir?: string;
  /** A one-line explanation naming the migration and the fix. */
  message: string;
}

/**
 * The outcome of {@link checkLock}.
 *
 * @stability experimental
 */
export interface CheckResult {
  /** True when `problems` is empty. */
  ok: boolean;
  /** Every offending migration, locked ones first (lock order), then uninstalled ones. */
  problems: CheckProblem[];
}

const short = (hash: string): string => hash.slice(0, 12);

/**
 * `platform db check`, offline half. Read-only and pure apart from the two
 * readers. Fails when a locked migration's local bytes differ from the lock,
 * the lock differs from the manifest, a package migration is not installed, or
 * a locked directory is missing.
 *
 * @param manifest - The package history.
 * @param lock - The app's `platform.lock`.
 * @param readLocal - Reads `prisma/migrations/<localDir>/migration.sql`; returns `undefined` when the directory or file does not exist.
 * @param readPackage - Optional: reads the package's actual `migration.sql` so a file edited without its manifest hash is also caught; `undefined` means missing.
 * @returns Every problem found; `ok` when there is none.
 * @stability experimental
 */
export function checkLock(
  manifest: readonly ManifestEntry[],
  lock: PlatformLock,
  readLocal: (localDir: string) => Uint8Array | undefined,
  readPackage?: (packageDir: string) => Uint8Array | undefined,
): CheckResult {
  const problems: CheckProblem[] = [];
  const byOrigin = new Map(manifest.map((entry) => [originIdOf(entry), entry]));
  const locked = new Set(lock.migrations.map((entry) => entry.originId));

  for (const entry of lock.migrations) {
    const origin = byOrigin.get(entry.originId);
    if (!origin) {
      problems.push({
        code: 'NOT_IN_PACKAGE',
        originId: entry.originId,
        localDir: entry.localDir,
        message: `${entry.originId}: locked as ${entry.localDir} but the package manifest no longer has it`,
      });
    } else {
      if (origin.sha256 !== entry.sha256) {
        problems.push({
          code: 'PACKAGE_MODIFIED',
          originId: entry.originId,
          localDir: entry.localDir,
          message: `${entry.originId}: the package hash ${short(origin.sha256)} differs from the lock ${short(entry.sha256)}; a released migration was rewritten (restore the package file)`,
        });
      }
      if (readPackage) {
        const bytes = readPackage(origin.dir);
        if (!bytes) {
          problems.push({
            code: 'PACKAGE_FILE_MODIFIED',
            originId: entry.originId,
            localDir: entry.localDir,
            message: `${entry.originId}: package file migrations/${origin.dir}/migration.sql is missing`,
          });
        } else if (sha256Hex(bytes) !== origin.sha256) {
          problems.push({
            code: 'PACKAGE_FILE_MODIFIED',
            originId: entry.originId,
            localDir: entry.localDir,
            message: `${entry.originId}: package file migrations/${origin.dir}/migration.sql hashes to ${short(sha256Hex(bytes))}, the manifest says ${short(origin.sha256)}`,
          });
        }
      }
    }

    const bytes = readLocal(entry.localDir);
    if (!bytes) {
      problems.push({
        code: 'LOCAL_DIR_MISSING',
        originId: entry.originId,
        localDir: entry.localDir,
        message: `${entry.originId}: prisma/migrations/${entry.localDir}/migration.sql does not exist`,
      });
    } else {
      const want = entry.localSha256 ?? entry.sha256;
      const got = sha256Hex(bytes);
      if (got !== want) {
        problems.push({
          code: 'LOCAL_MODIFIED',
          originId: entry.originId,
          localDir: entry.localDir,
          message: `${entry.originId}: prisma/migrations/${entry.localDir}/migration.sql hashes to ${short(got)}, the lock says ${short(want)}; an installed migration is never edited`,
        });
      }
    }
  }

  // Installed directories must sort in package order, or a fresh database applies them in another order.
  for (let i = 1; i < lock.migrations.length; i += 1) {
    const previous = lock.migrations[i - 1]!;
    const current = lock.migrations[i]!;
    if (current.localDir <= previous.localDir) {
      problems.push({
        code: 'LOCAL_OUT_OF_ORDER',
        originId: current.originId,
        localDir: current.localDir,
        message: `${current.originId}: ${current.localDir} does not sort after ${previous.localDir}, its predecessor in the package`,
      });
    }
  }

  for (const entry of manifest) {
    if (!locked.has(originIdOf(entry))) {
      problems.push({
        code: 'NOT_INSTALLED',
        originId: originIdOf(entry),
        message: `${originIdOf(entry)}: in the package but not installed; run \`platform db sync\``,
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

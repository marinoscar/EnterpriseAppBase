import type { ManifestEntry, PlatformLock } from '../lock/index.js';

/**
 * The class of an app-migration ordering failure.
 *
 * - `APP_MIGRATION_ID_COLLISION`: an app-authored migration directory is named exactly like a package migration (its id or directory), so the history cannot tell the two apart.
 * - `APP_MIGRATION_OUT_OF_ORDER`: an app-authored migration directory sorts before an installed platform migration but was not there when `platform db sync` last wrote the lock, so a fresh database would apply it before platform migrations that were already applied elsewhere (it reorders history).
 *
 * @stability experimental
 */
export type AppMigrationProblemCode = 'APP_MIGRATION_ID_COLLISION' | 'APP_MIGRATION_OUT_OF_ORDER';

/**
 * One app-authored migration that would collide with, or reorder, the installed platform history.
 *
 * @stability experimental
 */
export interface AppMigrationProblem {
  /** The class of failure. */
  code: AppMigrationProblemCode;
  /** The offending app-authored directory. */
  localDir: string;
  /** A one-line explanation naming the directory and the fix. */
  message: string;
}

/**
 * Finds the app-authored migrations that collide with, or would reorder, the
 * installed platform history. An app-authored directory is one under
 * `prisma/migrations` that no `platform.lock` entry names.
 *
 * Two rules, both offline:
 *
 * 1. **Id collision.** An app-authored directory must not be named like a
 *    package migration (`0036_add_app_metadata`): the history would hold two
 *    migrations the tooling cannot tell apart.
 * 2. **Order.** `platform db sync` always installs a platform migration under
 *    a timestamp later than everything in the history, so an app migration that
 *    existed at that moment sorts before it by design (an app's own `add_notes`
 *    between two platform migrations is normal). One that appears *afterwards*
 *    with an older timestamp (a branch started before the sync, merged after)
 *    would run, on a fresh database, before platform migrations other
 *    databases applied first. The lock remembers which app directories existed
 *    at the last sync (`appMigrations`); a directory outside that list that
 *    sorts before the last installed platform directory is the failure. A lock
 *    without the field skips this rule until its next sync.
 *
 * @param manifest - The package history.
 * @param lock - The app's `platform.lock`.
 * @param localDirs - Every directory name under the app's `prisma/migrations`.
 * @returns Every problem found, in directory order; empty when none.
 * @stability experimental
 */
export function checkAppMigrations(
  manifest: readonly Pick<ManifestEntry, 'id' | 'dir'>[],
  lock: Pick<PlatformLock, 'migrations' | 'appMigrations'>,
  localDirs: readonly string[],
): AppMigrationProblem[] {
  const problems: AppMigrationProblem[] = [];
  const locked = new Set(lock.migrations.map((entry) => entry.localDir));
  const packageNames = new Set(manifest.flatMap((entry) => [entry.id, entry.dir]));
  const known = lock.appMigrations ? new Set(lock.appMigrations) : undefined;
  let lastInstalled: string | undefined;
  for (const entry of lock.migrations) {
    if (lastInstalled === undefined || entry.localDir > lastInstalled) lastInstalled = entry.localDir;
  }
  for (const dir of [...localDirs].sort()) {
    if (locked.has(dir)) continue;
    if (packageNames.has(dir)) {
      problems.push({
        code: 'APP_MIGRATION_ID_COLLISION',
        localDir: dir,
        message: `prisma/migrations/${dir} is named like the package migration ${dir}; an app migration keeps Prisma's timestamped name (nothing applied may be renamed: if it was never applied, rename it now)`,
      });
      continue;
    }
    if (known && lastInstalled !== undefined && dir < lastInstalled && !known.has(dir)) {
      problems.push({
        code: 'APP_MIGRATION_OUT_OF_ORDER',
        localDir: dir,
        message: `prisma/migrations/${dir} sorts before the installed platform migration ${lastInstalled} but was added after the last \`platform db sync\`; a fresh database would apply it before platform migrations other databases already ran. If it was never applied, give it a timestamp after ${lastInstalled}; if it was applied, record it by running \`platform db sync\``,
      });
    }
  }
  return problems;
}

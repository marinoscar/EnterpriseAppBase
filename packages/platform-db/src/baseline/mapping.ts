import { originIdOf, sha256Hex, type ManifestEntry } from '../lock/index.js';
import { BaselineError } from './errors.js';
import { normalisedSha256 } from './normalise.js';

/**
 * How a package migration was matched to a local directory.
 *
 * - `sha256`: the bytes are identical (a directory rename is irrelevant).
 * - `normalised`: identical once comments and whitespace are stripped; the lock records `localSha256`.
 * - `operator-map`: named by the operator in `--map`; the lock records `localSha256` when the bytes differ.
 *
 * @stability experimental
 */
export type MatchKind = 'sha256' | 'normalised' | 'operator-map';

/**
 * A package migration matched to an existing local directory.
 *
 * @stability experimental
 */
export interface MatchedMigration {
  /** `platform:NNNN_slug`. */
  originId: string;
  /** The app's directory. */
  localDir: string;
  /** How it was matched; a reviewer checks every match that is not `sha256`. */
  kind: MatchKind;
  /** SHA-256 of the app's file, present when it differs from the package's. */
  localSha256?: string;
}

/**
 * Proposes the mapping from package migrations to the app's directories (step B1).
 *
 * Per package migration, in order: an exact SHA-256 of `migration.sql`, then
 * the same after stripping comments and whitespace, then the operator's
 * `--map`. A directory matches at most one migration. Pure.
 *
 * @param manifest - The package history, in order.
 * @param localDirs - Directory name to `migration.sql` bytes, for every directory of the app's `prisma/migrations`.
 * @param packageFile - Reads the package's `migration.sql` for a manifest entry (the normalised pass compares against it).
 * @param map - Operator overrides, `platform:NNNN_slug` (or `NNNN_slug`) to a local directory name. An override replaces the automatic match of its own entry; a directory that already matches another migration exactly is refused.
 * @returns One entry per matched package migration, in package order.
 * @throws BaselineError `MAP_INVALID` when `map` names an unknown entry or directory, or a directory that another migration already matched.
 * @stability experimental
 */
export function proposeMapping(
  manifest: readonly ManifestEntry[],
  localDirs: ReadonlyMap<string, Uint8Array>,
  packageFile: (entry: ManifestEntry) => Uint8Array,
  map: Readonly<Record<string, string>> = {},
): MatchedMigration[] {
  const operator = new Map<string, string>();
  const known = new Set(manifest.map(originIdOf));
  for (const [key, dir] of Object.entries(map)) {
    const id = key.startsWith('platform:') ? key : `platform:${key}`;
    if (!known.has(id)) throw new BaselineError('MAP_INVALID', `--map names ${key}, which is not in the package manifest`);
    if (!localDirs.has(dir)) throw new BaselineError('MAP_INVALID', `--map maps ${key} to ${dir}, which is not a directory with a migration.sql under prisma/migrations`);
    operator.set(id, dir);
  }

  const localSha = new Map<string, string>();
  const localNormalised = new Map<string, string>();
  for (const [dir, bytes] of localDirs) {
    localSha.set(dir, sha256Hex(bytes));
    localNormalised.set(dir, normalisedSha256(bytes));
  }
  const used = new Set<string>();
  const byEntry = new Map<string, MatchedMigration>();

  const take = (entry: ManifestEntry, dir: string, kind: MatchKind): void => {
    used.add(dir);
    const local = localSha.get(dir)!;
    byEntry.set(originIdOf(entry), {
      originId: originIdOf(entry),
      localDir: dir,
      kind,
      ...(local === entry.sha256 ? {} : { localSha256: local }),
    });
  };

  // Pass 1, exact bytes. Directories are tried in name order so the result is deterministic.
  const sortedDirs = [...localDirs.keys()].sort();
  for (const entry of manifest) {
    const dir = sortedDirs.find((d) => !used.has(d) && localSha.get(d) === entry.sha256 && operator.get(originIdOf(entry)) === undefined);
    if (dir) take(entry, dir, 'sha256');
  }
  // Pass 2, comments and whitespace stripped.
  for (const entry of manifest) {
    if (byEntry.has(originIdOf(entry)) || operator.has(originIdOf(entry))) continue;
    const want = normalisedSha256(packageFile(entry));
    const dir = sortedDirs.find((d) => !used.has(d) && localNormalised.get(d) === want);
    if (dir) take(entry, dir, 'normalised');
  }
  // Pass 3, the operator. An explicit mapping always wins over a guess.
  for (const entry of manifest) {
    const dir = operator.get(originIdOf(entry));
    if (dir === undefined) continue;
    if (used.has(dir)) {
      const holder = [...byEntry.values()].find((m) => m.localDir === dir);
      throw new BaselineError('MAP_INVALID', `--map maps ${originIdOf(entry)} to ${dir}, which already matches ${holder?.originId ?? 'another migration'}`);
    }
    take(entry, dir, 'operator-map');
  }
  return manifest.flatMap((entry) => byEntry.get(originIdOf(entry)) ?? []);
}

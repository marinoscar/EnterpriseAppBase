import { originIdOf, type ManifestEntry } from '../lock/index.js';
import { formatTimestamp, nextTimestamps, parseTimestamp } from '../sync/index.js';
import { BaselineError } from './errors.js';
import type { MatchKind, MatchedMigration } from './mapping.js';

/**
 * What the baseline does with one package migration (step B5).
 *
 * - `mapped`: an existing directory is the migration; the lock points at it.
 * - `install-resolve`: no directory, yet the migration is at or below `--through`, so its effect is already in the database. It is installed and marked applied without running it.
 * - `install`: above `--through`; it is only installed, and `migrate deploy` applies it.
 *
 * @stability experimental
 */
export type PlannedAction = 'mapped' | 'install-resolve' | 'install';

/**
 * One package migration in the baseline plan; the plan holds all of them in package order.
 *
 * @stability experimental
 */
export interface PlannedEntry {
  /** `platform:NNNN_slug`. */
  originId: string;
  /** The directory under the package's `migrations/`. */
  packageDir: string;
  /** The app directory: the existing one, or the name an installed copy will get. */
  localDir: string;
  /** SHA-256 of the package file. */
  sha256: string;
  /** The version recorded as `since`. */
  since: string;
  /** What the baseline does with it. */
  action: PlannedAction;
  /** How a `mapped` entry was matched. */
  kind?: MatchKind;
  /** SHA-256 of the app's file when it differs from the package's. */
  localSha256?: string;
  /** Why the files differ (recorded with `localSha256`). */
  note?: string;
  /** Whether `prisma migrate resolve --applied <localDir>` runs for it. */
  resolve: boolean;
}

/** The directory slug of a package migration id (the rule `platform db sync` uses). */
export function slugOf(id: string): string {
  return id.replace(/^\d{4}_/, '').replace(/-/g, '_');
}

/** The sequence number of a manifest id (`0007_x` is 7). */
export function sequenceOf(id: string): number {
  return Number(id.slice(0, 4));
}

const STAMP = /^(\d{14})_/;

function noteFor(kind: MatchKind): string {
  return kind === 'normalised'
    ? 'differs from the package file only in comments or whitespace (recorded by platform db baseline)'
    : 'mapped by the operator with --map; the baseline diff showed the live schema equals the package history (recorded by platform db baseline)';
}

/**
 * Plans the baseline: one entry per package migration, in order, with the
 * directory name every installed one will get. Pure.
 *
 * Placement (ADR 0002 D4): a migration that is installed **and** resolved goes
 * immediately after its package predecessor (predecessor timestamp plus one
 * second, or the next free second), or before everything when it has no
 * predecessor, so a fresh database built from the adopted history applies it
 * in package order and the app's own equivalent migration then no-ops. A
 * migration above `--through` goes to the end by the sync naming rule.
 *
 * @param manifest - The package history.
 * @param matched - The result of `proposeMapping`.
 * @param localDirs - Every directory name under the app's `prisma/migrations`.
 * @param through - The sequence number of the migration the database claims to equal.
 * @param recorded - Directory names with a finished `_prisma_migrations` row; empty for a database Prisma never managed.
 * @param now - The clock for migrations above `--through`.
 * @returns The plan.
 * @throws BaselineError `PLACEMENT_IMPOSSIBLE` when the directories cannot be made to sort in package order.
 * @stability experimental
 */
export function planBaseline(
  manifest: readonly ManifestEntry[],
  matched: readonly MatchedMigration[],
  localDirs: readonly string[],
  through: number,
  recorded: ReadonlySet<string>,
  now: Date,
): PlannedEntry[] {
  const byOrigin = new Map(matched.map((m) => [m.originId, m]));
  const taken = new Set(localDirs.flatMap((d) => STAMP.exec(d)?.[1] ?? []));
  const earliest = [...taken].sort()[0];
  const plan: PlannedEntry[] = [];

  for (const entry of manifest) {
    const originId = originIdOf(entry);
    const base = { originId, packageDir: entry.dir, sha256: entry.sha256, since: entry.since };
    const hit = byOrigin.get(originId);
    const belowThrough = sequenceOf(entry.id) <= through;
    if (hit) {
      plan.push({
        ...base,
        localDir: hit.localDir,
        action: 'mapped',
        kind: hit.kind,
        ...(hit.localSha256 ? { localSha256: hit.localSha256, note: noteFor(hit.kind) } : {}),
        resolve: belowThrough && !recorded.has(hit.localDir),
      });
      continue;
    }
    if (!belowThrough) {
      plan.push({ ...base, localDir: '', action: 'install', resolve: false });
      continue;
    }
    const previous = plan[plan.length - 1];
    let stamp: string;
    if (previous) {
      const predecessor = STAMP.exec(previous.localDir)?.[1];
      if (!predecessor) {
        throw new BaselineError('PLACEMENT_IMPOSSIBLE', `${previous.localDir} (${previous.originId}) has no 14-digit timestamp, so ${originId} cannot be placed after it`);
      }
      let ms = parseTimestamp(predecessor) + 1000;
      while (taken.has(formatTimestamp(ms))) ms += 1000;
      stamp = formatTimestamp(ms);
    } else {
      let ms = (earliest ? parseTimestamp(earliest) : now.getTime()) - 1000;
      while (taken.has(formatTimestamp(ms))) ms -= 1000;
      stamp = formatTimestamp(ms);
    }
    taken.add(stamp);
    plan.push({ ...base, localDir: `${stamp}_${slugOf(entry.id)}`, action: 'install-resolve', resolve: true });
  }

  // Migrations above --through are named last, after everything already in the history (the sync rule).
  const tail = plan.filter((p) => p.action === 'install');
  if (tail.length > 0) {
    const stamps = nextTimestamps(
      [...localDirs, ...plan.filter((p) => p.localDir).map((p) => p.localDir)],
      tail.length,
      now,
    );
    tail.forEach((p, i) => {
      p.localDir = `${stamps[i]}_${slugOf(p.originId.slice('platform:'.length))}`;
    });
  }

  for (let i = 1; i < plan.length; i += 1) {
    if (plan[i]!.localDir <= plan[i - 1]!.localDir) {
      throw new BaselineError(
        'PLACEMENT_IMPOSSIBLE',
        `${plan[i]!.originId} would be ${plan[i]!.localDir}, which does not sort after ${plan[i - 1]!.localDir} (${plan[i - 1]!.originId}); a fresh database would apply the history in another order. Rename or re-map the directories so they sort in package order`,
      );
    }
  }
  return plan;
}

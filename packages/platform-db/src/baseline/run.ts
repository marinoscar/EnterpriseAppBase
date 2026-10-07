import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { checkRawSqlIndexes, readPackageRawSqlIndexes, type IndexRow } from '../drift/index.js';
import {
  emptyLock,
  originIdOf,
  parseLock,
  parseManifest,
  serializeLock,
  sha256Hex,
  type LockEntry,
  type ManifestEntry,
  type PlatformLock,
} from '../lock/index.js';
import { checkLedger, checkLock, compareVersions, type LedgerRow } from '../sync/index.js';
import { BaselineError } from './errors.js';
import { installMigration, listDirs, readLocalMigrations, removeInstalled } from './fs.js';
import { proposeMapping } from './mapping.js';
import { normaliseStatement, splitStatements } from './normalise.js';
import { planBaseline, sequenceOf, type PlannedEntry } from './plan.js';
import type { BaselineReport } from './report.js';

/**
 * The runbook the refusals point to.
 *
 * @internal
 */
export const BASELINE_RUNBOOK = 'docs/runbooks/database-baseline.md';

/**
 * The result of a Prisma CLI call.
 *
 * @stability experimental
 */
export interface PrismaResult {
  /** The exit status. */
  status: number;
  /** Standard output. */
  stdout: string;
  /** Standard error. */
  stderr: string;
}

/**
 * The effects of the baseline, injected so tests run it without a database or the Prisma CLI.
 *
 * Every database access is a read; the only database write is the
 * `prisma migrate resolve --applied` call, which goes through `prisma`.
 *
 * @stability experimental
 */
export interface BaselineDeps {
  /** Logs one action or finding (every action is logged). */
  log(line: string): void;
  /** The clock for the names of migrations installed above `--through`. */
  now(): Date;
  /** Reads `_prisma_migrations`; `undefined` when the table does not exist (a database Prisma never managed). */
  readLedger(): Promise<LedgerRow[] | undefined>;
  /** Reads `name` and `indexdef` of the `public` indexes. */
  readIndexes(): Promise<IndexRow[]>;
  /** `prisma migrate diff --from-migrations <dir> --to-config-datasource --script`: the SQL that turns the replayed history into the live database; `''` when they are equal. */
  diffReplayToLive(replayMigrationsDir: string): Promise<string>;
  /** Runs a Prisma CLI command (`migrate resolve --applied <dir>`, `migrate status`) through the app's `scripts/prisma-env.js`. */
  prisma(args: readonly string[]): Promise<PrismaResult>;
}

/**
 * Options of {@link runBaseline}.
 *
 * @stability experimental
 */
export interface BaselineOptions {
  /** The app's `prisma/` directory (holds `migrations/` and `platform.lock`). */
  appPrismaDir: string;
  /** The platform-db package directory (holds `migrations/manifest.json`, `raw-sql-indexes.json` and `package.json`). */
  packageDir: string;
  /** A JSON file mapping `platform:NNNN_slug` to a local directory, for migrations the automatic passes cannot match. */
  mapFile?: string;
  /** Write the lock and resolve. Without it nothing is written and nothing is resolved. */
  apply: boolean;
  /** Allow `--apply` when `platform.lock` already has entries (they are replaced; deviations and raw-SQL indexes are kept). */
  forceRemap?: boolean;
  /** The package migration the database claims to equal: `22`, `0022` or `platform:0022_slug`. Default: the newest. Below the newest is partial adoption: the rest is installed and `migrate deploy` applies it. */
  through?: string;
}

const mapSchema = z.record(z.string(), z.string().min(1));

/**
 * Reads an operator `--map` file.
 *
 * @param file - Path of a JSON object mapping `platform:NNNN_slug` to a directory name.
 * @returns The mapping.
 * @throws BaselineError `MAP_INVALID` when the file is not a JSON object of strings.
 * @stability experimental
 */
export function readOperatorMap(file: string): Record<string, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BaselineError('MAP_INVALID', `${file} could not be read as JSON: ${(error as Error).message}`);
  }
  const parsed = mapSchema.safeParse(raw);
  if (!parsed.success) throw new BaselineError('MAP_INVALID', `${file} must be a JSON object of "platform:NNNN_slug": "localDirectory" pairs`);
  return parsed.data;
}

/**
 * Finds the `--through` entry.
 *
 * @param manifest - The package history.
 * @param through - `22`, `0022`, `0022_slug` or `platform:0022_slug`; omitted means the newest.
 * @returns The entry.
 * @throws BaselineError `THROUGH_UNKNOWN`.
 * @stability experimental
 */
export function resolveThrough(manifest: readonly ManifestEntry[], through?: string): ManifestEntry {
  if (manifest.length === 0) throw new BaselineError('THROUGH_UNKNOWN', 'the package has no migrations');
  if (through === undefined) return manifest[manifest.length - 1]!;
  const bare = through.replace(/^platform:/, '');
  const found = /^\d{1,4}$/.test(bare)
    ? manifest.find((entry) => sequenceOf(entry.id) === Number(bare))
    : manifest.find((entry) => entry.id === bare);
  if (!found) {
    throw new BaselineError('THROUGH_UNKNOWN', `--through ${through} is no package migration (the history runs ${manifest[0]!.id} .. ${manifest[manifest.length - 1]!.id})`);
  }
  return found;
}

/** Rows that never completed and were not superseded by a later successful run of the same migration. */
function failedRows(rows: readonly LedgerRow[]): LedgerRow[] {
  const good = new Set(rows.filter((r) => r.finishedAt && !r.rolledBackAt).map((r) => r.migrationName));
  return rows.filter((r) => (!r.finishedAt || r.rolledBackAt) && !good.has(r.migrationName));
}

function emptyReport(through: string): BaselineReport {
  return {
    through,
    matched: [],
    toResolve: [],
    toInstall: [],
    appOnly: [],
    unmatched: [],
    diff: { allowed: [], blocking: [] },
    indexProblems: [],
    ledger: { managed: true, problems: [] },
    refusals: [],
    notes: [],
    actions: [],
    lockUpToDate: false,
    applied: false,
  };
}

function buildLock(plan: readonly PlannedEntry[], previous: PlatformLock | undefined, version: string): PlatformLock {
  const base = emptyLock(version);
  const migrations = plan.map((p): LockEntry => ({
    originId: p.originId,
    localDir: p.localDir,
    sha256: p.sha256,
    since: p.since,
    ...(p.localSha256 ? { localSha256: p.localSha256, note: p.note! } : {}),
  }));
  return {
    ...base,
    migrations,
    ...(previous?.deviations ? { deviations: previous.deviations } : {}),
    ...(previous?.rawSqlIndexes ? { rawSqlIndexes: previous.rawSqlIndexes } : {}),
  };
}

/**
 * `platform db baseline`: adopts the package history in a database that
 * already has its schema, without re-running a migration (ADR 0002 D4).
 *
 * B1 maps the package migrations to the app's directories; B2 checks the
 * `_prisma_migrations` ledger; B3 diffs the package history replayed to
 * `--through` against the live database; B4 asserts the raw-SQL indexes in
 * `pg_indexes`; B5 writes `platform.lock`, installs the migrations that have
 * no directory and marks the ones at or below `--through` applied with
 * `prisma migrate resolve --applied`; B6 verifies.
 *
 * Without `apply` nothing is written and `prisma` is never called. It never
 * creates, drops or alters a database object, and there is no `--force`: any
 * live difference no deviation declares refuses the baseline.
 *
 * @param opts - See {@link BaselineOptions}.
 * @param deps - The injected effects.
 * @returns The report; check `refusals` and `verify` (see `isBaselineClean`).
 * @throws BaselineError for a bad `--through`, a bad `--map`, a failed `migrate resolve` or a corrupt package file; refusals found by the checks are returned in the report instead.
 * @stability experimental
 */
export async function runBaseline(opts: BaselineOptions, deps: BaselineDeps): Promise<BaselineReport> {
  const migrationsDir = join(opts.appPrismaDir, 'migrations');
  const lockFile = join(opts.appPrismaDir, 'platform.lock');
  const manifestFile = join(opts.packageDir, 'migrations', 'manifest.json');
  if (!existsSync(manifestFile)) throw new BaselineError('THROUGH_UNKNOWN', `${manifestFile} does not exist; is --package-dir the @marinoscar/platform-db package?`);
  const manifest = parseManifest(readFileSync(manifestFile, 'utf8'), manifestFile);
  const packageVersion = (JSON.parse(readFileSync(join(opts.packageDir, 'package.json'), 'utf8')) as { version: string }).version;
  // The lock reads x.y.z only, so a prerelease tag is dropped; it never records less than the newest `since` it holds.
  const core = /^\d+\.\d+\.\d+/.exec(packageVersion)?.[0] ?? '0.0.0';
  const version = manifest.reduce((best, e) => (compareVersions(e.since, best) > 0 ? e.since : best), core);
  const throughEntry = resolveThrough(manifest, opts.through);
  const through = sequenceOf(throughEntry.id);
  const report = emptyReport(originIdOf(throughEntry));
  const refuse = (code: BaselineReport['refusals'][number]['code'], message: string): void => {
    report.refusals.push({ code, message });
  };
  const packageBytes = (entry: ManifestEntry): Buffer => readFileSync(join(opts.packageDir, 'migrations', entry.dir, 'migration.sql'));

  // The package must be intact before anything is compared with it.
  for (const entry of manifest) {
    const actual = sha256Hex(packageBytes(entry));
    if (actual !== entry.sha256) {
      throw new BaselineError('PACKAGE_FILE_MISMATCH', `${originIdOf(entry)}: package file hashes to ${actual.slice(0, 12)}, the manifest says ${entry.sha256.slice(0, 12)}; reinstall the package`);
    }
  }

  const existingLock = existsSync(lockFile) ? parseLock(readFileSync(lockFile, 'utf8'), lockFile) : undefined;
  const lockHasEntries = (existingLock?.migrations.length ?? 0) > 0;
  if (lockHasEntries) {
    if (opts.apply && !opts.forceRemap) {
      refuse('LOCK_NOT_EMPTY', `platform.lock already has ${existingLock!.migrations.length} entr${existingLock!.migrations.length === 1 ? 'y' : 'ies'}; pass --force-remap to replace them (the mapping is recomputed from the files)`);
    } else if (!opts.apply) {
      report.notes.push(`platform.lock already has ${existingLock!.migrations.length} entries; --apply needs --force-remap to replace them`);
    }
  }

  // The classic trap first: a failed or rolled-back row makes everything below untrustworthy.
  const ledger = await deps.readLedger();
  report.ledger.managed = ledger !== undefined;
  const bad = ledger ? failedRows(ledger) : [];
  if (bad.length > 0) {
    for (const row of bad) {
      const why = row.rolledBackAt ? 'rolled back' : 'never finished';
      report.ledger.problems.push(`${row.migrationName}: ${why}`);
    }
    refuse(
      'LEDGER_FAILED_ROW',
      `_prisma_migrations has ${bad.length} failed or rolled-back row(s) (${bad.map((r) => r.migrationName).join(', ')}); resolve them with prisma migrate resolve first. See ${BASELINE_RUNBOOK}, "A failed migration row"`,
    );
    return report;
  }

  // B1 map.
  const operatorMap = opts.mapFile ? readOperatorMap(opts.mapFile) : {};
  const local = readLocalMigrations(migrationsDir);
  const matched = proposeMapping(manifest, local, packageBytes, operatorMap);
  const matchedDirs = new Set(matched.map((m) => m.localDir));
  const matchedIds = new Set(matched.map((m) => m.originId));
  report.matched = matched;
  report.unmatched = manifest.filter((e) => !matchedIds.has(originIdOf(e))).map(originIdOf);
  report.appOnly = [...local.keys()].filter((d) => !matchedDirs.has(d)).sort();
  for (const m of matched.filter((x) => x.kind !== 'sha256')) {
    report.notes.push(`${m.originId} matched ${m.localDir} by ${m.kind}, not by identical bytes: review it`);
  }

  // B2 ledger.
  const recorded = new Set<string>();
  if (ledger) {
    const byName = new Map(ledger.filter((r) => r.finishedAt && !r.rolledBackAt).map((r) => [r.migrationName, r]));
    for (const m of matched) {
      if (sequenceOf(m.originId.slice('platform:'.length)) > through) continue; // pending locally; deploy applies it
      const row = byName.get(m.localDir);
      if (!row) {
        report.ledger.problems.push(`${m.originId}: ${m.localDir} is not a finished row of _prisma_migrations`);
        refuse('LEDGER_ROW_MISSING', `${m.originId}: ${m.localDir} has no finished row in _prisma_migrations, so the database never applied it; lower --through or apply it first`);
        continue;
      }
      recorded.add(m.localDir);
      const want = sha256Hex(local.get(m.localDir)!);
      if (row.checksum !== want) {
        report.ledger.problems.push(`${m.originId}: ${m.localDir} differs from what the database applied`);
        refuse('LEDGER_CHECKSUM_MISMATCH', `${m.originId}: the file ${m.localDir} hashes to ${want.slice(0, 12)} but the database recorded ${row.checksum.slice(0, 12)}; the file was edited after it was applied`);
      }
    }
  } else {
    report.notes.push(
      'the database has no _prisma_migrations table (Prisma never managed it): every migration up to --through is recorded with migrate resolve --applied. App-only directories are NOT resolved by the baseline; resolve them yourself before the first migrate deploy',
    );
  }

  // The plan (also names the directories that will be created).
  let plan: PlannedEntry[] = [];
  try {
    plan = planBaseline(manifest, matched, listDirs(migrationsDir), through, recorded, deps.now());
  } catch (error) {
    if (!(error instanceof BaselineError)) throw error;
    refuse(error.code, error.message.replace(/^[A-Z_]+: /, ''));
  }
  report.toResolve = plan
    .filter((p) => p.resolve)
    .map((p) => ({ originId: p.originId, localDir: p.localDir, install: p.action !== 'mapped' }));
  report.toInstall = plan.filter((p) => p.action === 'install').map((p) => ({ originId: p.originId, localDir: p.localDir }));

  if (existingLock && plan.length > 0) {
    report.lockUpToDate = serializeLock(buildLock(plan, existingLock, existingLock.platformVersion)) === serializeLock(existingLock);
  }

  // B3 diff: the package history up to --through, replayed, against the LIVE database.
  const deviations = existingLock?.deviations ?? [];
  const replayRoot = mkdtempSync(join(tmpdir(), 'platform-baseline-replay-'));
  try {
    const replay = join(replayRoot, 'migrations');
    mkdirSync(replay, { recursive: true });
    writeFileSync(join(replay, 'migration_lock.toml'), 'provider = "postgresql"\n');
    for (const entry of manifest.filter((e) => sequenceOf(e.id) <= through)) {
      mkdirSync(join(replay, entry.dir));
      writeFileSync(join(replay, entry.dir, 'migration.sql'), packageBytes(entry));
    }
    const statements = splitStatements(await deps.diffReplayToLive(replay));
    const declared = new Set(deviations.flatMap((d) => d.expectDiff.map(normaliseStatement)));
    const used = new Set<string>();
    for (const statement of statements) {
      const normal = normaliseStatement(statement);
      if (declared.has(normal)) {
        used.add(normal);
        report.diff.allowed.push(normal);
      } else {
        report.diff.blocking.push(normal);
      }
    }
    for (const d of deviations) {
      if (!d.expectDiff.every((s) => used.has(normaliseStatement(s)))) {
        report.notes.push(`deviation ${d.id} declares a statement the diff no longer prints; remove it from platform.lock when it is resolved`);
      }
    }
  } finally {
    rmSync(replayRoot, { recursive: true, force: true });
  }
  if (report.diff.blocking.length > 0) {
    refuse(
      'DIFF_BLOCKING',
      `the live database differs from the package history up to ${report.through} in ${report.diff.blocking.length} statement(s); fix the differences with ordinary forward migrations, declare an intended alteration under "deviations" in platform.lock, or lower --through. See ${BASELINE_RUNBOOK}, "Fixing differences"`,
    );
  }

  // B4 raw-SQL indexes: a positive assertion, because Prisma's diff ignores partial and expression indexes.
  const packageIndexesFile = join(opts.packageDir, 'raw-sql-indexes.json');
  const expected = [
    ...(existsSync(packageIndexesFile) ? readPackageRawSqlIndexes(packageIndexesFile) : []).filter((i) => sequenceOf(i.createdIn) <= through),
    ...(existingLock?.rawSqlIndexes ?? []),
  ];
  report.indexProblems = checkRawSqlIndexes(expected, await deps.readIndexes());
  for (const problem of report.indexProblems) refuse(problem.code, problem.message);

  // Output of the dry run; nothing below runs without --apply or with a refusal.
  if (report.refusals.length > 0 || !opts.apply) return report;

  // B5 act, in package order so a predecessor exists before its successor is placed.
  let current: string | undefined; // the directory created for the step in flight
  try {
    for (const p of plan) {
      if (p.action !== 'mapped') {
        installMigration(migrationsDir, p.localDir, packageBytes(manifest.find((e) => originIdOf(e) === p.originId)!));
        current = p.localDir;
        report.actions.push(`install ${p.localDir}  <- ${p.originId}`);
        deps.log(`install ${p.localDir}`);
      }
      if (p.resolve) {
        deps.log(`prisma migrate resolve --applied ${p.localDir}`);
        const result = await deps.prisma(['migrate', 'resolve', '--applied', p.localDir]);
        if (result.status !== 0) {
          throw new BaselineError(
            'RESOLVE_FAILED',
            `prisma migrate resolve --applied ${p.localDir} failed (exit ${result.status}): ${(result.stderr || result.stdout).trim().split('\n').slice(0, 4).join(' ')}`,
          );
        }
        report.actions.push(`resolve --applied ${p.localDir}`);
      }
      current = undefined;
    }
  } catch (error) {
    // The lock is written last, so a failure leaves none. Take back the directory of the step that failed: it
    // was created here and is not in the ledger; earlier ones are recorded and a re-run maps them by hash.
    if (current) removeInstalled(migrationsDir, current);
    throw error;
  }
  const lock = buildLock(plan, existingLock, version);
  mkdirSync(dirname(lockFile), { recursive: true });
  writeFileSync(lockFile, serializeLock(lock));
  report.actions.push(`write platform.lock (${lock.migrations.length} entries)`);
  deps.log(`wrote ${lockFile}`);
  report.applied = true;

  // B6 verify: Prisma's own status, the offline check and the ledger comparison.
  const problems: string[] = [];
  const status = await deps.prisma(['migrate', 'status']);
  const pendingOnly = report.toInstall.map((i) => i.localDir);
  if (status.status !== 0) {
    const listed = status.stdout.split('\n').map((l) => l.trim()).filter((l) => /^\d{14}_\S+$/.test(l));
    const expectedPending = pendingOnly.length > 0 && listed.length === pendingOnly.length && pendingOnly.every((d) => listed.includes(d));
    if (!expectedPending) problems.push(`prisma migrate status failed: ${(status.stdout + status.stderr).trim().split('\n').slice(-6).join(' | ')}`);
  } else if (pendingOnly.length > 0) {
    problems.push('prisma migrate status reports nothing pending, but migrations above --through were installed');
  }
  const afterLocal = readLocalMigrations(migrationsDir);
  const lockCheck = checkLock(
    manifest,
    lock,
    (dir) => afterLocal.get(dir),
    (dir) => (existsSync(join(opts.packageDir, 'migrations', dir, 'migration.sql')) ? readFileSync(join(opts.packageDir, 'migrations', dir, 'migration.sql')) : undefined),
  );
  for (const p of lockCheck.problems) problems.push(`${p.code}  ${p.message}`);
  const rows = (await deps.readLedger()) ?? [];
  const ledgerCheck = checkLedger([...afterLocal.keys()], (dir) => afterLocal.get(dir), rows);
  for (const p of ledgerCheck.problems) problems.push(`${p.code}  ${p.message}`);
  const allowedPending = new Set(pendingOnly);
  const unexpected = ledgerCheck.pending.filter((d) => !allowedPending.has(d));
  if (unexpected.length > 0) report.notes.push(`${unexpected.length} app directory(ies) are not applied yet (prisma migrate deploy applies them): ${unexpected.join(', ')}`);
  report.verify = { ok: problems.length === 0, problems };
  return report;
}

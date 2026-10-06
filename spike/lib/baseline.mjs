// Prototype of `platform db baseline` (#711).
//
// Inputs: the package history (the target platform version), the app's own prisma/migrations,
// a live database. Output: a report and, unless dry-run, the lock + `migrate resolve --applied` calls.
//
//  B1 MAP      each package migration -> a local directory, by exact sha256, else by comment-stripped sha256
//              (recorded as `localSha256`), else UNMAPPED. A rename of the directory alone needs no special case.
//  B2 LEDGER   every mapped local dir must be a finished, non-rolled-back row in _prisma_migrations whose
//              checksum equals the local file (Prisma itself never checks this on deploy/status).
//  B3 DIFF     replay the package history up to --through in the shadow database and diff it against the LIVE
//              database: `migrate diff --from-migrations <replay> --to-config-datasource --script`.
//              Statements that match a declared deviation are removed; anything left REFUSES the baseline.
//  B4 INDEXES  Prisma's diff is blind to partial/expression indexes, so compare pg_indexes of the live database
//              to the package's raw-SQL index list (name + definition).
//  B5 ACT      for unmapped migrations <= through: install (sync naming rule) and `migrate resolve --applied`.
//              For migrations > through: install only; `migrate deploy` applies them for real.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dbUrl, prisma, rows, withClient, write } from './env.mjs';
import { LOCAL_DIR_RE, nextTimestamps, packageMigrations, readLock, sha256File, writeLock } from './sync.mjs';
import { readdirSync } from 'node:fs';

/** Comment/whitespace-insensitive fingerprint of a migration. */
export function normalisedSha(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '').trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
  return createHash('sha256').update(stripped).digest('hex');
}

export function localMigrations(appDir) {
  const dir = join(appDir, 'prisma', 'migrations');
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && LOCAL_DIR_RE.test(e.name)).map((e) => ({
    dir: e.name,
    file: join(dir, e.name, 'migration.sql'),
  })).sort((a, b) => a.dir.localeCompare(b.dir));
}

/** B1 */
export function mapMigrations({ pkgDir, appDir, explicit = {} }) {
  const local = localMigrations(appDir).map((l) => ({ ...l, sha: sha256File(l.file), nsha: normalisedSha(readFileSync(l.file, 'utf8')) }));
  const used = new Set();
  const result = [];
  for (const p of packageMigrations(pkgDir)) {
    const psha = sha256File(p.file);
    const pn = normalisedSha(readFileSync(p.file, 'utf8'));
    let hit = explicit[p.id] ? local.find((l) => l.dir === explicit[p.id]) : local.find((l) => !used.has(l.dir) && l.sha === psha);
    let how = explicit[p.id] ? 'explicit' : 'identical bytes';
    if (!hit) { hit = local.find((l) => !used.has(l.dir) && l.nsha === pn); how = 'comment-only difference'; }
    if (hit) {
      used.add(hit.dir);
      const entry = { originId: p.id, localDir: hit.dir, sha256: psha, how, renamed: !hit.dir.endsWith(`_${p.slug}`) };
      if (hit.sha !== psha) entry.localSha256 = hit.sha;
      result.push(entry);
    } else {
      result.push({ originId: p.id, localDir: null, sha256: psha, how: 'UNMAPPED' });
    }
  }
  return { entries: result, appOnly: local.filter((l) => !used.has(l.dir)).map((l) => l.dir) };
}

/** B2 */
export async function ledgerProblems({ database, entries, appDir }) {
  const hasTable = await withClient(database, async (c) => (await c.query("select to_regclass('public._prisma_migrations') is not null as ok")).rows[0].ok);
  if (!hasTable) return { managed: false, problems: [] };
  const ledger = new Map((await rows(database, 'select migration_name, checksum, finished_at, rolled_back_at from _prisma_migrations')).map((r) => [r.migration_name, r]));
  const problems = [];
  for (const e of entries.filter((x) => x.localDir)) {
    const row = ledger.get(e.localDir);
    if (!row) { problems.push(`${e.originId}: ${e.localDir} is not in _prisma_migrations`); continue; }
    if (!row.finished_at || row.rolled_back_at) problems.push(`${e.originId}: ${e.localDir} is not a finished migration (failed or rolled back)`);
    const local = sha256File(join(appDir, 'prisma', 'migrations', e.localDir, 'migration.sql'));
    if (row.checksum !== local) problems.push(`${e.originId}: ledger checksum differs from the local file (the database applied different bytes)`);
  }
  return { managed: true, problems };
}

/** Prisma pads columns and qualifies tables with "public".; compare modulo both. */
export const normaliseStatement = (s) => s.replace(/"public"\./g, '').replace(/\s+/g, ' ').trim();

export function splitStatements(script) {
  // `migrate diff --script` emits `-- Comment` headings followed by statements ending in `;` at line end.
  return script.split(/;\s*\n/).map((s) => s.replace(/^(\s*--[^\n]*\n)+/g, '').trim()).filter(Boolean).map((s) => `${s};`);
}

/** B3 */
export function liveDiff({ cwd, database, shadowDatabase, pkgDir, through, deviations = [], workDir }) {
  const replay = join(workDir, 'replay');
  rmSync(replay, { recursive: true, force: true });
  mkdirSync(join(replay, 'migrations'), { recursive: true });
  writeFileSync(join(replay, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  for (const m of packageMigrations(pkgDir).filter((x) => x.seq <= through)) {
    cpSync(m.file, join(replay, 'migrations', m.dir, 'migration.sql'), { recursive: false, force: true });
  }
  const r = prisma(['migrate', 'diff', '--from-migrations', join(replay, 'migrations'), '--to-config-datasource', '--script'], {
    cwd,
    database,
    env: { SHADOW_DATABASE_URL: dbUrl(shadowDatabase) },
  });
  if (r.status !== 0) return { error: r.stderr || r.stdout, statements: [], unexpected: [] };
  const statements = splitStatements(r.stdout.replace(/^\s*-- This is an empty migration\.\s*$/m, ''));
  const declared = new Set(deviations.flatMap((d) => d.expectDiff.map(normaliseStatement)));
  const unexpected = statements.filter((s) => !declared.has(normaliseStatement(s)));
  return { statements, unexpected, raw: r.stdout };
}

/** B4: `{name, definition}` of every raw-SQL index, from pg_indexes. */
export async function rawIndexSnapshot(database, names) {
  const r = await rows(database, 'select indexname as name, indexdef as definition from pg_indexes where schemaname = $1 and indexname = any($2) order by indexname', ['public', names]);
  return r;
}

export function indexProblems(live, expected) {
  const problems = [];
  const byName = new Map(live.map((i) => [i.name, i.definition]));
  for (const e of expected) {
    if (!byName.has(e.name)) problems.push(`raw-SQL index ${e.name} is MISSING from the live database`);
    else if (byName.get(e.name) !== e.definition) problems.push(`raw-SQL index ${e.name} differs: live "${byName.get(e.name)}" vs expected "${e.definition}"`);
  }
  return problems;
}

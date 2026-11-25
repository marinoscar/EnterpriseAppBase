#!/usr/bin/env node
// Q4. Baseline an existing database onto the package history, on a copy.
//
// Run:  node spike/q4-baseline.mjs      (needs the compose test Postgres on :5433, plus pg_dump/pg_restore on PATH)

import {
  API_ROOT, begin, check as chk, cpSync, dbUrl, dropDb, freshWorkdir, join, main, pgEnv, prisma, read, realMigrationDirs, recreateDb,
  rows, run, say, scalar, show, withClient, write, writeConfig, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, PG,
} from './lib/env.mjs';
import { check as lockCheck, fmtTs, packageMigrations, parseTs, readLock, writeLock, LOCAL_DIR_RE } from './lib/sync.mjs';
import { indexProblems, ledgerProblems, liveDiff, localMigrations, mapMigrations, rawIndexSnapshot } from './lib/baseline.mjs';
import { composeDirs } from './platform-db-compose.mjs';
import { splitIntoFragments } from './lib/split-schema.mjs';
import { readdirSync, renameSync } from 'node:fs';

const P = 'pp_5_1_q4';
const SHADOW = `${P}_shadow`;
const N = realMigrationDirs().length; // the history keeps growing as other stories land; nothing here hard-codes it
const RAW_INDEXES = ['database_backup_runs_active_uniq_idx', 'jobs_active_dedup_uniq_idx', 'jobs_attempts_gt1_idx', 'jobs_succeeded_duration_idx'];

const root = freshWorkdir('q4');
const pkgDir = join(root, 'pkg');
const composed = join(root, 'composed');
let expectedIndexes = [];

function buildPackage() {
  const real = realMigrationDirs();
  real.forEach((d, i) => {
    const slug = d.replace(/^\d{14}_/, '');
    const id = `${String(i + 1).padStart(4, '0')}_${slug}`;
    mkdirSync(join(pkgDir, 'migrations', id), { recursive: true });
    cpSync(join(API_ROOT, 'prisma', 'migrations', d, 'migration.sql'), join(pkgDir, 'migrations', id, 'migration.sql'));
  });
  const { files } = splitIntoFragments(read(join(API_ROOT, 'prisma', 'schema.prisma')), { markExtensible: ['User', 'Job', 'StorageObject'] });
  const frag = join(root, 'fragments');
  for (const [n, t] of files) write(join(frag, n), t);
  composeDirs({ packageDir: frag, outDir: composed });
}

/** A fork app dir: real migrations (minus/with mutations), the composed schema, a config with a shadow database. */
function makeFork(name, { migrations = realMigrationDirs() } = {}) {
  const dir = join(root, name);
  writeConfig(dir, { schema: 'prisma/schema', shadowDatabaseUrl: true });
  mkdirSync(join(dir, 'prisma', 'migrations'), { recursive: true });
  cpSync(join(API_ROOT, 'prisma', 'migrations', 'migration_lock.toml'), join(dir, 'prisma', 'migrations', 'migration_lock.toml'));
  for (const d of migrations) cpSync(join(API_ROOT, 'prisma', 'migrations', d), join(dir, 'prisma', 'migrations', d), { recursive: true });
  cpSync(composed, join(dir, 'prisma', 'schema'), { recursive: true });
  return dir;
}

const sh = (app, db, args) => prisma(args, { cwd: app, database: db, env: { SHADOW_DATABASE_URL: dbUrl(SHADOW) } });

/** Places a baselined migration right after its package predecessor, or at the end. */
function placeAfter(app, predecessorDir) {
  const taken = new Set(localMigrations(app).map((l) => l.dir.slice(0, 14)));
  let t = parseTs(predecessorDir.slice(0, 14));
  do { t += 1000; } while (taken.has(fmtTs(new Date(t))));
  return fmtTs(new Date(t));
}
function placeAtEnd(app) {
  const all = localMigrations(app).map((l) => parseTs(l.dir.slice(0, 14)));
  return fmtTs(new Date(Math.max(Date.now(), Math.max(...all) + 1000)));
}

/**
 * The baseline procedure. dryRun: report only. Returns the report.
 * `through` is the package sequence number the database is claimed to equal.
 */
async function baseline({ app, database, through, deviations = [], dryRun, explicit = {} }) {
  const report = { refused: [], actions: [] };
  const map = mapMigrations({ pkgDir, appDir: app, explicit });
  report.entries = map.entries;
  report.appOnly = map.appOnly;
  const ledger = await ledgerProblems({ database, entries: map.entries, appDir: app });
  report.ledger = ledger;
  report.refused.push(...ledger.problems);
  const diff = liveDiff({ cwd: app, database, shadowDatabase: SHADOW, pkgDir, through, deviations, workDir: join(root, 'work-' + database) });
  report.diff = diff;
  if (diff.error) report.refused.push(`diff failed: ${diff.error}`);
  report.refused.push(...diff.unexpected.map((s) => `live database differs from package history up to ${through}: ${s}`));
  const idx = indexProblems(await rawIndexSnapshot(database, RAW_INDEXES), expectedIndexes);
  report.indexProblems = idx;
  report.refused.push(...idx);
  const pkg = packageMigrations(pkgDir);
  const unmapped = map.entries.filter((e) => !e.localDir);
  report.toResolve = unmapped.filter((e) => Number(/^platform:(\d{4})/.exec(e.originId)[1]) <= through).map((e) => e.originId);
  report.toInstall = unmapped.filter((e) => !report.toResolve.includes(e.originId)).map((e) => e.originId);
  if (report.refused.length || dryRun) return report;

  // ACT. Process in package order so predecessors are mapped before successors.
  const lock = { lockVersion: 1, platformVersion: '1.0.0', migrations: [], deviations: deviations.map((d) => ({ id: d.id, expectDiff: d.expectDiff })) };
  for (const e of map.entries) {
    if (e.localDir) {
      const entry = { originId: e.originId, localDir: e.localDir, sha256: e.sha256, since: '1.0.0' };
      if (e.localSha256) entry.localSha256 = e.localSha256;
      lock.migrations.push(entry);
      continue;
    }
    const p = pkg.find((x) => x.id === e.originId);
    const resolveIt = report.toResolve.includes(e.originId);
    const pred = lock.migrations[lock.migrations.length - 1];
    const ts = resolveIt && pred ? placeAfter(app, pred.localDir) : placeAtEnd(app);
    const localDir = `${ts}_${p.slug}`;
    mkdirSync(join(app, 'prisma', 'migrations', localDir), { recursive: true });
    cpSync(p.file, join(app, 'prisma', 'migrations', localDir, 'migration.sql'));
    lock.migrations.push({ originId: e.originId, localDir, sha256: e.sha256, since: '1.0.0' });
    if (resolveIt) {
      const r = sh(app, database, ['migrate', 'resolve', '--applied', localDir]);
      report.actions.push(`resolve --applied ${localDir}: exit ${r.status}${r.status ? ' ' + r.stderr.split('\n').slice(0, 3).join(' ') : ''}`);
      if (r.status !== 0) report.refused.push(`resolve failed for ${localDir}`);
    } else {
      report.actions.push(`install ${localDir} (to be applied by migrate deploy)`);
    }
  }
  writeLock(app, lock);
  report.lock = lock;
  return report;
}

await main(async () => {
  begin('q4-baseline');
  buildPackage();
  const pk = packageMigrations(pkgDir);
  say(`package v1: ${pk.length} migrations (${pk[0].id} .. ${pk[pk.length - 1].id}); composed schema: ${readdirSync(composed).length} files`);

  // ---- 0. what does Prisma's diff say about the raw-SQL indexes? ----------------------------------------------------
  say('\n## 0. the intentional drift: what does `migrate diff` actually report?');
  await recreateDb(`${P}_ref`);
  await recreateDb(SHADOW);
  const ref = makeFork('ref');
  let r = sh(ref, `${P}_ref`, ['migrate', 'deploy']);
  chk(`reference database (the ${N} package migrations) deploys`, r.status === 0);
  r = sh(ref, `${P}_ref`, ['migrate', 'diff', '--from-config-datasource', '--to-schema', composed, '--script', '--exit-code']);
  show('migrate diff reference DB -> composed schema (--script --exit-code)', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  chk('Prisma 7.9 reports NO drift for the four raw-SQL indexes (diff is empty, exit 0)', r.status === 0);
  const present = (await rows(`${P}_ref`, 'select indexname from pg_indexes where indexname = any($1) order by 1', [RAW_INDEXES])).map((x) => x.indexname);
  chk('...although all four exist in the catalogue', present.length === 4, present.join(', '));
  const discovered = (await rows(`${P}_ref`, "select indexname from pg_indexes where schemaname='public' and (indexdef ~ ' WHERE ' or indexdef ~ 'ON public\\.\\w+ \\(\\(') order by 1")).map((x) => x.indexname);
  chk('catalogue discovery (partial or expression indexes) finds EXACTLY the four the spec lists', JSON.stringify(discovered) === JSON.stringify(RAW_INDEXES), discovered.join(', '));
  // The CI drift test form: package migrations replayed in the shadow database vs the composed schema.
  const replayAll = join(root, 'replay-all');
  mkdirSync(join(replayAll, 'migrations'), { recursive: true });
  writeFileSync(join(replayAll, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  for (const m of packageMigrations(pkgDir)) cpSync(m.file, join(replayAll, 'migrations', m.dir, 'migration.sql'));
  r = sh(ref, `${P}_ref`, ['migrate', 'diff', '--from-migrations', join(replayAll, 'migrations'), '--to-schema', composed, '--exit-code', '--script']);
  show('migrate diff --from-migrations <package history> --to-schema <composed folder> --exit-code  (the CI drift test)', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  chk('CI drift test: package migrations replayed in a shadow database equal the composed schema (exit 0, no allow-list needed)', r.status === 0);
  const edited = join(root, 'composed-edited');
  cpSync(composed, edited, { recursive: true });
  writeFileSync(join(edited, 'platform.jobs.prisma'), `${read(join(edited, 'platform.jobs.prisma'))}\nmodel DriftProbe {\n  id String @id\n}\n`);
  r = sh(ref, `${P}_ref`, ['migrate', 'diff', '--from-migrations', join(replayAll, 'migrations'), '--to-schema', edited, '--exit-code', '--script']);
  chk('...and a schema edit WITHOUT a migration makes the same command exit 2 (the drift test has teeth)', r.status === 2, `exit ${r.status}`);
  expectedIndexes = await rawIndexSnapshot(`${P}_ref`, RAW_INDEXES);
  show('the allowed raw-SQL index list shipped with the package (name + definition)', expectedIndexes.map((i) => `${i.name}\n    ${i.definition}`).join('\n'));

  // ---- S1: a forked app ------------------------------------------------------------------------------------------------------
  say('\n## S1. a fork: renamed dir, comment-only difference, a platform migration with no local dir, a column deviation');
  const base = realMigrationDirs();
  const trace = '20260930120000_add_job_trace_context';
  const vitals = '20260928100000_add_worker_node_vitals';
  const commentOnly = '20260927000000_revoke_viewer_ai_use';
  const fork = makeFork('fork', { migrations: base.filter((d) => d !== trace) });
  renameSync(join(fork, 'prisma', 'migrations', vitals), join(fork, 'prisma', 'migrations', '20260929090000_worker_node_vitals'));
  const cf = join(fork, 'prisma', 'migrations', commentOnly, 'migration.sql');
  writeFileSync(cf, `-- fork: renumbered issue reference #9999\n${readFileSync(cf, 'utf8')}`);
  mkdirSync(join(fork, 'prisma', 'migrations', '20260930200000_fork_trace_context'), { recursive: true });
  write(join(fork, 'prisma', 'migrations', '20260930200000_fork_trace_context', 'migration.sql'), '-- the fork wrote its own version of the same change\nALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "trace_context" text;\n');
  const LIVE = `${P}_fork`;
  await recreateDb(LIVE);
  r = sh(fork, LIVE, ['migrate', 'deploy']);
  chk(`the fork history deploys (${N - 1} package migrations + 1 of its own)`, r.status === 0 && new RegExp(`${N} migrations found`).test(r.stdout), r.stdout.split('\n').find((l) => /found/.test(l)));
  await withClient(LIVE, (c) => c.query('ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT'));
  await withClient(LIVE, (c) => c.query("INSERT INTO users (id, email, updated_at) VALUES (gen_random_uuid(), 'baseline@example.test', now())"));
  chk('live fork has real data to protect', Number(await scalar(LIVE, 'select count(*) from users')) === 1);

  // rehearsal copy BEFORE touching anything
  const REH = `${P}_rehearsal`;
  const dump = join(root, 'fork.dump');
  const pgenv = { ...process.env, PGPASSWORD: PG.password };
  const dumpR = run('pg_dump', ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', LIVE, '-Fc', '--no-owner', '--no-acl', '-f', dump], { env: pgenv });
  await recreateDb(REH);
  const restR = run('pg_restore', ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', REH, '--no-owner', '--no-acl', dump], { env: pgenv });
  chk('rehearsal copy: pg_dump | pg_restore of the live database succeeds', dumpR.status === 0 && restR.status === 0, restR.stderr.slice(0, 200));
  chk('the restored copy carries _prisma_migrations and the data', Number(await scalar(REH, 'select count(*) from _prisma_migrations')) === N && Number(await scalar(REH, 'select count(*) from users')) === 1);
  const rehApp = join(root, 'fork-rehearsal');
  cpSync(fork, rehApp, { recursive: true });

  // dry run
  let rep = await baseline({ app: fork, database: LIVE, through: N, dryRun: true });
  show('B1 mapping', rep.entries.map((e) => `${e.originId.padEnd(52)} -> ${(e.localDir ?? '(none)').padEnd(46)} ${e.how}${e.renamed ? ', RENAMED' : ''}${e.localSha256 ? ', localSha256 recorded' : ''}`).join('\n'));
  const idc = rep.entries.filter((e) => e.how === 'identical bytes').length;
  chk(`B1: ${N - 2} identical (one of them under a renamed directory), 1 comment-only, 1 unmapped`,
    idc === N - 2 && rep.entries.filter((e) => e.how === 'comment-only difference').length === 1 && rep.entries.filter((e) => !e.localDir).length === 1 && rep.entries.filter((e) => e.renamed).length === 1);
  chk('B1: the fork-only migration is reported as app history', rep.appOnly.join() === '20260930200000_fork_trace_context');
  chk('B2: the ledger agrees with every mapped local file', rep.ledger.managed && rep.ledger.problems.length === 0, rep.ledger.problems.join('; '));
  show(`B3 diff: package history (${N}) -> LIVE database`, rep.diff.raw ?? JSON.stringify(rep.diff));
  chk('B3: the only difference is the column deviation', rep.diff.statements.length === 1 && /ADD COLUMN\s+"platform"/.test(rep.diff.statements[0]));
  chk('without a declared deviation the baseline REFUSES', rep.refused.length === 1 && /differs from package history/.test(rep.refused[0]));
  chk('B4: the four raw-SQL indexes are intact', rep.indexProblems.length === 0);

  const deviation = { id: 'fork:push_subscriptions.platform', expectDiff: ['ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT;'] };
  rep = await baseline({ app: fork, database: LIVE, through: N, deviations: [deviation], dryRun: true });
  chk('with the deviation declared (as in platform.lock) the dry run is clean', rep.refused.length === 0 && rep.toResolve.length === 1, rep.refused.join('; '));
  say(`dry-run plan: resolve ${rep.toResolve.join(', ')}; install ${rep.toInstall.join(', ') || '(nothing)'}`);

  // rehearsal first
  const rehRep = await baseline({ app: rehApp, database: REH, through: N, deviations: [deviation], dryRun: false });
  show('rehearsal on the restored copy: actions', rehRep.actions.join('\n'));
  chk('REHEARSAL on the restored backup succeeds', rehRep.refused.length === 0 && rehRep.actions.length === 1);
  let st = sh(rehApp, REH, ['migrate', 'status']);
  chk('rehearsal: `migrate status` says up to date', st.status === 0 && /Database schema is up to date/.test(st.stdout), st.stdout.split('\n').slice(-4).join(' '));

  // the real thing
  const real = await baseline({ app: fork, database: LIVE, through: N, deviations: [deviation], dryRun: false });
  show('real run: actions', real.actions.join('\n'));
  chk('real run: identical plan and result as the rehearsal', JSON.stringify(real.actions.map((a) => a.replace(/^(resolve --applied )\d+/, '$1<ts>'))) === JSON.stringify(rehRep.actions.map((a) => a.replace(/^(resolve --applied )\d+/, '$1<ts>'))));
  const newDir = real.lock.migrations.find((m) => m.originId.endsWith('add_job_trace_context')).localDir;
  say(`baselined directory placed right after its package predecessor: ${newDir} (predecessor ${real.lock.migrations.find((m) => m.originId.endsWith('add_worker_node_vitals')).localDir})`);
  st = sh(fork, LIVE, ['migrate', 'status']);
  show('migrate status after baseline', st.stdout);
  chk('migrate status: Database schema is up to date', st.status === 0 && /Database schema is up to date/.test(st.stdout));
  const dp = sh(fork, LIVE, ['migrate', 'deploy']);
  chk('migrate deploy is a no-op', dp.status === 0 && /No pending migrations/.test(dp.stdout));
  const row = (await rows(LIVE, 'select migration_name, checksum, applied_steps_count, finished_at is not null as finished from _prisma_migrations where migration_name = $1', [newDir]))[0];
  chk('the resolved row carries the package file checksum and counts 0 applied steps', row && row.checksum === real.lock.migrations.find((m) => m.localDir === newDir).sha256 && row.finished, JSON.stringify(row));
  chk('data untouched by the baseline', Number(await scalar(LIVE, 'select count(*) from users')) === 1);
  chk('offline `check` of the lock passes (comment-only entry carries localSha256)', lockCheck({ pkgDir, appDir: fork }).length === 0, lockCheck({ pkgDir, appDir: fork }).join('; '));
  show('platform.lock (excerpt)', JSON.stringify({ ...readLock(fork), migrations: readLock(fork).migrations.filter((m) => /revoke_viewer|vitals|trace/.test(m.localDir)) }, null, 2));
  rep = await baseline({ app: fork, database: LIVE, through: N, deviations: [deviation], dryRun: true });
  chk('a second dry run is a clean no-op (every migration mapped)', rep.refused.length === 0 && rep.toResolve.length === 0 && rep.entries.every((e) => e.localDir));

  // fresh-database replay of the adopted history
  const FRESH = `${P}_fresh`;
  await recreateDb(FRESH);
  r = sh(fork, FRESH, ['migrate', 'deploy']);
  chk('a FRESH database built from the fork\'s adopted history deploys (baselined dir ordered after its predecessor, so the fork\'s IF NOT EXISTS twin no-ops)', r.status === 0, r.stderr.slice(0, 300));
  // The alternative: append the baselined dir at the END.
  const bad = join(root, 'fork-append');
  cpSync(fork, bad, { recursive: true });
  renameSync(join(bad, 'prisma', 'migrations', newDir), join(bad, 'prisma', 'migrations', `${placeAtEnd(bad)}_add_job_trace_context`));
  const BAD = `${P}_fresh_bad`;
  await recreateDb(BAD);
  r = sh(bad, BAD, ['migrate', 'deploy']);
  show('negative control: baselined dir appended at the END instead, FRESH database', `exit ${r.status}\n${r.stderr.split('\n').filter((l) => /already exists|P3018|Error/.test(l)).slice(0, 4).join('\n')}`);
  chk('...fails with "column already exists": placement after the predecessor is REQUIRED', r.status !== 0 && /already exists/.test(r.stdout + r.stderr));
  await dropDb(BAD);
  const fd = sh(fork, FRESH, ['migrate', 'diff', '--from-config-datasource', '--to-schema', composed, '--exit-code', '--script']);
  chk('the fresh database equals the composed schema (diff empty)', fd.status === 0, fd.stdout.slice(0, 200));
  await dropDb(FRESH);

  // ---- S4: index drift invisible to Prisma ------------------------------------------------------------------------------------------
  say('\n## S4. a raw-SQL index is dropped by hand on the live database');
  await withClient(LIVE, (c) => c.query('DROP INDEX "jobs_attempts_gt1_idx"'));
  rep = await baseline({ app: fork, database: LIVE, through: N, deviations: [deviation], dryRun: true });
  chk('Prisma `migrate diff` (B3) stays SILENT about the missing partial index', rep.diff.unexpected.length === 0);
  chk('the catalogue comparison (B4) catches it', rep.indexProblems.length === 1 && /jobs_attempts_gt1_idx is MISSING/.test(rep.indexProblems[0]), rep.indexProblems.join('; '));
  chk('and the baseline refuses', rep.refused.length === 1);
  const wasDef = expectedIndexes.find((i) => i.name === 'jobs_attempts_gt1_idx').definition;
  await withClient(LIVE, (c) => c.query(wasDef));
  await withClient(LIVE, (c) => c.query('DROP INDEX "jobs_active_dedup_uniq_idx"'));
  await withClient(LIVE, (c) => c.query('CREATE UNIQUE INDEX "jobs_active_dedup_uniq_idx" ON "jobs"("dedup_key")'));
  rep = await baseline({ app: fork, database: LIVE, through: N, deviations: [deviation], dryRun: true });
  chk('a raw-SQL index re-created WITHOUT its WHERE clause is caught by the definition compare', rep.indexProblems.some((p) => /jobs_active_dedup_uniq_idx differs/.test(p)));

  // ---- S2: partial mode ------------------------------------------------------------------------------------------------------------------
  say('\n## S2. partial mode (kvox-shaped): the app lacks the last platform migrations (16 onwards)');
  const P15 = base.slice(0, 15);
  const part = makeFork('partial', { migrations: P15 });
  const PART = `${P}_partial`;
  await recreateDb(PART);
  r = sh(part, PART, ['migrate', 'deploy']);
  chk('partial fork deploys its 15 migrations', r.status === 0);
  rep = await baseline({ app: part, database: PART, through: N, dryRun: true });
  chk(`claiming "through ${N}" is REFUSED: the live schema lacks what 16..${N} add`, rep.refused.length > 0 && rep.diff.statements.length > 0, `${rep.diff.statements.length} differing statements, e.g. ${rep.diff.statements[0]?.split('\n')[0]}`);
  rep = await baseline({ app: part, database: PART, through: 15, dryRun: false });
  chk('"through 15" passes: live == package history replayed to 0015', rep.refused.length === 0 && rep.diff.statements.length === 0);
  chk(`16..${N} are installed (not resolved)`, rep.toInstall.length === N - 15 && rep.toResolve.length === 0, rep.actions.join('; '));
  r = sh(part, PART, ['migrate', 'deploy']);
  chk(`migrate deploy applies the ${N - 15} new package migrations for real`, r.status === 0 && (r.stdout.match(/Applying migration/g) ?? []).length === N - 15);
  r = sh(part, PART, ['migrate', 'diff', '--from-config-datasource', '--to-schema', composed, '--exit-code', '--script']);
  chk('afterwards the database equals the composed schema', r.status === 0);
  await dropDb(PART);

  // ---- S3: a database Prisma Migrate never managed ---------------------------------------------------------------------------------------
  say('\n## S3. a database that has the schema but no _prisma_migrations (never managed by Prisma Migrate)');
  const UNM = `${P}_unmanaged`;
  await recreateDb(UNM);
  for (const m of pk) await withClient(UNM, (c) => c.query(readFileSync(m.file, 'utf8')));
  const un = makeFork('unmanaged', { migrations: [] });
  // install all of them under local timestamps from a fixed base, as `sync` would
  let ts = parseTs('20261006100000');
  for (const m of pk) {
    const localDir = `${fmtTs(new Date(ts))}_${m.slug}`; ts += 1000;
    mkdirSync(join(un, 'prisma', 'migrations', localDir), { recursive: true });
    cpSync(m.file, join(un, 'prisma', 'migrations', localDir, 'migration.sql'));
  }
  r = sh(un, UNM, ['migrate', 'deploy']);
  show('migrate deploy on the unmanaged database', `exit ${r.status}\n${r.stderr}${r.stdout}`);
  chk('Prisma refuses to deploy onto a non-empty unmanaged database (P3005)', r.status !== 0 && /P3005/.test(r.stdout + r.stderr));
  rep = await baseline({ app: un, database: UNM, through: N, dryRun: false });
  say(`B1: ${rep.entries.filter((e) => e.localDir).length} of ${N} mapped`);
  // nothing is unmapped (all installed), so nothing was resolved by the procedure: resolve explicitly, in order.
  let allOk = true;
  for (const m of localMigrations(un)) {
    const rr = sh(un, UNM, ['migrate', 'resolve', '--applied', m.dir]);
    if (rr.status !== 0) { allOk = false; say(rr.stderr); break; }
  }
  chk('`migrate resolve --applied` creates _prisma_migrations on an unmanaged database and records all of them', allOk && Number(await scalar(UNM, 'select count(*) from _prisma_migrations')) === N);
  r = sh(un, UNM, ['migrate', 'status']);
  chk('migrate status: up to date', r.status === 0 && /up to date/.test(r.stdout));
  r = sh(un, UNM, ['migrate', 'resolve', '--applied', localMigrations(un)[0].dir]);
  show('resolving a migration that is already recorded', `exit ${r.status}\n${r.stderr}${r.stdout}`);
  chk('resolving twice is refused by Prisma (P3008), so the tool must skip recorded dirs', r.status !== 0 && /P3008/.test(r.stdout + r.stderr));

  for (const d of [`${P}_ref`, LIVE, REH, UNM, SHADOW]) await dropDb(d);
});

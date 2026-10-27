#!/usr/bin/env node
// Q3. Install package migrations into an app history with app-local timestamps,
//     prove checksums are preserved, ordering interleaves, and a lock detects tampering.
//
// Run:  node spike/q3-install-lock.mjs      (needs the compose test Postgres on :5433)

import {
  API_ROOT, begin, check as chk, cpSync, dropDb, finish, freshWorkdir, join, main, prisma, read, realMigrationDirs, recreateDb,
  rows, say, scalar, sha256, show, withClient, write, writeConfig, mkdirSync, readFileSync, writeFileSync, existsSync,
} from './lib/env.mjs';
import { check, nextTimestamps, packageMigrations, readLock, sync } from './lib/sync.mjs';
import { readdirSync } from 'node:fs';

const DB = 'pp_5_1_q3';

await main(async () => {
  begin('q3-install-lock');
  const root = freshWorkdir('q3');
  const real = realMigrationDirs();
  const pkgDir = join(root, 'pkg');
  const app = join(root, 'app');
  writeConfig(app, { schema: 'prisma/schema.prisma' });
  write(join(app, 'prisma', 'schema.prisma'), 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n');
  cpSync(join(API_ROOT, 'prisma', 'migrations', 'migration_lock.toml'), join(app, 'prisma', 'migrations', 'migration_lock.toml'));

  // ---- package: three base migrations, byte-identical, renamed to the package's NNNN_slug ids ------
  const take = ['20260124223146_initial', '20260329151231_add_personal_access_tokens', '20260830211041_add_credentials'];
  take.forEach((d, i) => {
    const slug = d.replace(/^\d{14}_/, '');
    mkdirSync(join(pkgDir, 'migrations', `${String(i + 1).padStart(4, '0')}_${slug}`), { recursive: true });
    cpSync(join(API_ROOT, 'prisma', 'migrations', d, 'migration.sql'), join(pkgDir, 'migrations', `${String(i + 1).padStart(4, '0')}_${slug}`, 'migration.sql'));
  });
  say('package migrations:', packageMigrations(pkgDir).map((m) => m.id).join(', '));

  // ---- 1. install the first two -----------------------------------------------------------------------
  say('\n## 1. install (sync) two package migrations into an empty app history');
  // Hide the third for the first sync.
  const third = join(pkgDir, 'migrations', '0003_add_credentials');
  cpSync(third, join(root, 'held-back', '0003_add_credentials'), { recursive: true });
  const { rmSync } = await import('node:fs');
  rmSync(third, { recursive: true });
  const t0 = new Date('2026-10-06T10:00:00Z');
  const first = sync({ pkgDir, appDir: app, platformVersion: '1.0.0', now: t0 });
  show('installed', first.map((i) => `${i.originId} -> ${i.localDir}`).join('\n'));
  chk('two migrations installed under app-local timestamps, in package order', first.length === 2 && first[0].localDir < first[1].localDir);
  chk('timestamps are 1 second apart from "now" for an empty history', first[0].localDir.startsWith('20261006100000_') && first[1].localDir.startsWith('20261006100001_'));
  chk('the second sync is a no-op (idempotent)', sync({ pkgDir, appDir: app, platformVersion: '1.0.0', now: t0 }).length === 0);
  show('platform.lock after the first sync', read(join(app, 'prisma', 'platform.lock')));

  await recreateDb(DB);
  let r = prisma(['migrate', 'deploy'], { cwd: app, database: DB });
  show('migrate deploy', r.stdout);
  chk('migrate deploy applies the installed migrations', r.status === 0 && /successfully applied/.test(r.stdout));
  const dbRows = await rows(DB, 'select migration_name, checksum from _prisma_migrations order by started_at');
  const lock = readLock(app);
  chk('_prisma_migrations.migration_name is the app-local directory name', lock.migrations.every((m, i) => dbRows[i].migration_name === m.localDir));
  chk('_prisma_migrations.checksum EQUALS sha256 of the package file (Prisma checksums the raw file; a copy keeps it)',
    lock.migrations.every((m, i) => dbRows[i].checksum === m.sha256 && m.sha256 === sha256(readFileSync(packageMigrations(pkgDir)[i].file))));
  chk('and equals the checksum the BASE app recorded for the same bytes', true && dbRows[0].checksum === sha256(readFileSync(join(API_ROOT, 'prisma', 'migrations', take[0], 'migration.sql'))));

  // ---- 2. interleave ----------------------------------------------------------------------------------------------
  say('\n## 2. an app migration lands, then a later package migration is installed');
  const appTs = nextTimestamps(app, 1, new Date('2026-10-06T12:00:00Z'))[0];
  mkdirSync(join(app, 'prisma', 'migrations', `${appTs}_add_workouts`), { recursive: true });
  write(join(app, 'prisma', 'migrations', `${appTs}_add_workouts`, 'migration.sql'), 'CREATE TABLE "workouts" ("id" UUID PRIMARY KEY, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE);\n');
  r = prisma(['migrate', 'deploy'], { cwd: app, database: DB });
  chk('the app migration applies after the installed ones', r.status === 0);
  // restore held-back migration into the package, sync LATER (clock earlier than the app migration: skew)
  cpSync(join(root, 'held-back', '0003_add_credentials'), third, { recursive: true });
  const skew = sync({ pkgDir, appDir: app, platformVersion: '1.1.0', now: new Date('2026-10-06T11:00:00Z') });
  show('sync with a clock BEHIND the newest app migration (skew)', skew.map((i) => `${i.originId} -> ${i.localDir}`).join('\n'));
  chk('the naming rule still sorts the new package migration AFTER the app migration (max(now, latest+1s))', skew[0].localDir > `${appTs}_add_workouts`, `${skew[0].localDir} > ${appTs}_add_workouts`);
  r = prisma(['migrate', 'deploy'], { cwd: app, database: DB });
  show('migrate deploy', r.stdout);
  chk('the later package migration applies', r.status === 0 && /successfully applied|Applying migration/.test(r.stdout));
  const order = (await rows(DB, 'select migration_name from _prisma_migrations order by started_at')).map((x) => x.migration_name);
  const lexical = [...order].sort();
  chk('apply order == lexicographic directory order == package-then-app-then-package intent', JSON.stringify(order) === JSON.stringify(lexical) && order[2].endsWith('add_workouts') && order[3].endsWith('add_credentials'), order.map((o) => o.replace(/^\d+_/, '')).join(' -> '));

  // ---- 3. why NOT keep the package's own fixed names ------------------------------------------------------------------
  say('\n## 3. negative control: what if the package migration kept a fixed name that sorts BEFORE an applied app migration?');
  const late = join(app, 'prisma', 'migrations', '20260601000000_package_fixed_name');
  mkdirSync(late, { recursive: true });
  write(join(late, 'migration.sql'), 'CREATE TABLE "late_pkg_table" ("id" INT PRIMARY KEY);\n');
  r = prisma(['migrate', 'status'], { cwd: app, database: DB });
  show('migrate status with an un-applied dir OLDER than applied ones', `exit ${r.status}\n${r.stdout}${r.stderr}`);
  const dep = prisma(['migrate', 'deploy'], { cwd: app, database: DB });
  show('migrate deploy', `exit ${dep.status}\n${dep.stdout}${dep.stderr}`);
  const applied = await scalar(DB, "select count(*) from information_schema.tables where table_name='late_pkg_table'");
  say(`late_pkg_table created by deploy: ${applied === '1' || applied === 1}`);
  chk('Prisma migrate deploy applies an out-of-order (older) directory silently, as the LAST migration of this database', dep.status === 0 && applied === '1');
  const fresh = `${DB}b`;
  await recreateDb(fresh);
  const fr = prisma(['migrate', 'deploy'], { cwd: app, database: fresh });
  const freshOrder = (await rows(fresh, 'select migration_name from _prisma_migrations order by started_at')).map((x) => x.migration_name);
  const liveOrder = (await rows(DB, 'select migration_name from _prisma_migrations order by started_at')).map((x) => x.migration_name);
  show('apply order on a FRESH database vs the deployed one', `fresh:    ${freshOrder.map((o) => o.replace(/^\d+_/, '')).join(' -> ')}\ndeployed: ${liveOrder.map((o) => o.replace(/^\d+_/, '')).join(' -> ')}`);
  chk('...but a FRESH database applies it FIRST: the two histories diverge. Hence the naming rule orders by construction', fr.status === 0 && freshOrder[0].endsWith('package_fixed_name') && liveOrder[liveOrder.length - 1].endsWith('package_fixed_name'));
  await dropDb(fresh);
  rmSync(late, { recursive: true });
  await withClient(DB, (c) => c.query('DROP TABLE IF EXISTS late_pkg_table'));
  await withClient(DB, (c) => c.query("DELETE FROM _prisma_migrations WHERE migration_name = '20260601000000_package_fixed_name'"));

  // ---- 4. tamper detection ---------------------------------------------------------------------------------------------
  say('\n## 4. lock verification');
  chk('clean state: `check` reports no problems', check({ pkgDir, appDir: app }).length === 0);
  const victim = join(app, 'prisma', 'migrations', readLock(app).migrations[1].localDir, 'migration.sql');
  const orig = readFileSync(victim);
  writeFileSync(victim, Buffer.concat([Buffer.from('-- a comment-only edit\n'), orig]));
  let problems = check({ pkgDir, appDir: app });
  show('check after a comment-only edit of an installed file', problems.join('\n'));
  chk('a comment-only edit of an installed migration is detected by the lock', problems.length === 1 && /differs from the lock/.test(problems[0]));
  const st = prisma(['migrate', 'status'], { cwd: app, database: DB });
  show('prisma migrate status with the edited, already-applied file', `exit ${st.status}\n${st.stdout}${st.stderr}`);
  const dv = prisma(['migrate', 'deploy'], { cwd: app, database: DB });
  show('prisma migrate deploy with the edited, already-applied file', `exit ${dv.status}\n${dv.stdout}${dv.stderr}`);
  say(`  observed: Prisma migrate status/deploy ${/modified|checksum/i.test(st.stdout + st.stderr + dv.stdout + dv.stderr) ? 'DOES' : 'does NOT'} complain about an edited applied file (so the lock is the only guard in CI).`);
  const dbChecksum = await scalar(DB, "select checksum from _prisma_migrations where migration_name = $1", [readLock(app).migrations[1].localDir]);
  chk('the DB still holds the ORIGINAL checksum (the lock can also compare file vs `_prisma_migrations`)', dbChecksum === readLock(app).migrations[1].sha256);
  writeFileSync(victim, orig);
  chk('restoring the bytes makes `check` clean again', check({ pkgDir, appDir: app }).length === 0);
  const pkgFile = packageMigrations(pkgDir)[0].file;
  const pkgOrig = readFileSync(pkgFile);
  writeFileSync(pkgFile, Buffer.concat([pkgOrig, Buffer.from('\n-- fixed a typo in a released migration\n')]));
  problems = check({ pkgDir, appDir: app });
  show('check after the PACKAGE rewrote a released migration', problems.join('\n'));
  chk('rewriting a released package migration is detected (immutability)', problems.some((p) => /PACKAGE file changed after release/.test(p)));
  writeFileSync(pkgFile, pkgOrig);

  // ---- 5. comment-only divergence recorded in the lock ---------------------------------------------------------------------
  say('\n## 5. a fork whose local copy differs from the package ONLY in comments (EvoPath add_job_trace_context)');
  const lockObj = readLock(app);
  const e = lockObj.migrations[0];
  const f = join(app, 'prisma', 'migrations', e.localDir, 'migration.sql');
  const keep = readFileSync(f);
  writeFileSync(f, Buffer.concat([keep, Buffer.from('\n-- app-local comment\n')]));
  e.localSha256 = sha256(readFileSync(f));
  e.note = 'comment-only difference (issue references renumbered per repository)';
  writeFileSync(join(app, 'prisma', 'platform.lock'), `${JSON.stringify(lockObj, null, 2)}\n`);
  chk('with `localSha256` recorded the comment-only difference is accepted knowingly', check({ pkgDir, appDir: app }).length === 0);
  writeFileSync(f, Buffer.concat([keep, Buffer.from('\n-- another edit\n')]));
  chk('and any FURTHER edit is still caught', check({ pkgDir, appDir: app }).length === 1);

  show('final shape: lock entries', JSON.stringify(readLock(app).migrations[0], null, 2));
  await dropDb(DB);
});

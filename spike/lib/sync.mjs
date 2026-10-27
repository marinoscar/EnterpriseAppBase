// Prototype of `platform db sync` + `platform.lock` verification (#710).
//
// PACKAGE HISTORY  <pkg>/migrations/NNNN_slug/migration.sql   (linear, immutable, NNNN = 4-digit sequence)
// APP HISTORY      <app>/prisma/migrations/<YYYYMMDDHHMMSS>_<slug>/migration.sql
// LOCK             <app>/prisma/platform.lock                  (JSON, committed)

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_VERSION = 1;
export const PKG_DIR_RE = /^(\d{4})_([a-z0-9][a-z0-9_]*)$/;
export const LOCAL_DIR_RE = /^(\d{14})_(.+)$/;

export const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function packageMigrations(pkgDir) {
  return readdirSync(join(pkgDir, 'migrations'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const m = PKG_DIR_RE.exec(e.name);
      if (!m) throw new Error(`package migration dir "${e.name}" must match NNNN_slug`);
      return { id: `platform:${e.name}`, seq: Number(m[1]), slug: m[2], dir: e.name, file: join(pkgDir, 'migrations', e.name, 'migration.sql') };
    })
    .sort((a, b) => a.seq - b.seq);
}

export function readLock(appDir) {
  const p = join(appDir, 'prisma', 'platform.lock');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { lockVersion: LOCK_VERSION, platformVersion: null, migrations: [], deviations: [] };
}

export function writeLock(appDir, lock) {
  writeFileSync(join(appDir, 'prisma', 'platform.lock'), `${JSON.stringify(lock, null, 2)}\n`);
}

export const fmtTs = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
export const parseTs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));

/**
 * THE NAMING RULE.  base = max(now, latestExistingLocalTimestamp + 1s);
 * the i-th migration installed in one run gets base + i seconds. "Existing" means EVERY
 * timestamped directory in the app history (installed or app-authored), so an installed
 * migration always sorts after everything already there and after its predecessors.
 */
export function nextTimestamps(appDir, count, now = new Date()) {
  const dir = join(appDir, 'prisma', 'migrations');
  const existing = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && LOCAL_DIR_RE.test(e.name)).map((e) => parseTs(LOCAL_DIR_RE.exec(e.name)[1])) : [];
  const latest = existing.length ? Math.max(...existing) : 0;
  const base = Math.max(Math.floor(now.getTime() / 1000) * 1000, latest + 1000);
  return Array.from({ length: count }, (_, i) => fmtTs(new Date(base + i * 1000)));
}

/** Installs every package migration not yet in the lock. Returns what it installed. */
export function sync({ pkgDir, appDir, platformVersion, now }) {
  const lock = readLock(appDir);
  const have = new Set(lock.migrations.map((m) => m.originId));
  const pending = packageMigrations(pkgDir).filter((m) => !have.has(m.id));
  // Package history is append-only: an id missing in the middle means the package or the lock was tampered with.
  const all = packageMigrations(pkgDir);
  const firstPending = pending[0] ? all.findIndex((m) => m.id === pending[0].id) : all.length;
  if (all.slice(0, firstPending).some((m) => !have.has(m.id)) || pending.some((m, i) => all[firstPending + i].id !== m.id)) {
    throw new Error('package history has a gap relative to the lock');
  }
  const stamps = nextTimestamps(appDir, pending.length, now);
  const installed = pending.map((m, i) => {
    const localDir = `${stamps[i]}_${m.slug}`;
    mkdirSync(join(appDir, 'prisma', 'migrations', localDir), { recursive: true });
    cpSync(m.file, join(appDir, 'prisma', 'migrations', localDir, 'migration.sql')); // byte copy, no rewrite
    lock.migrations.push({ originId: m.id, localDir, sha256: sha256File(m.file), since: platformVersion });
    return { originId: m.id, localDir };
  });
  lock.platformVersion = platformVersion;
  writeLock(appDir, lock);
  return installed;
}

/**
 * `platform db check` (offline half). Returns a list of problems, empty when clean.
 *  - the package file still has the sha256 the lock recorded (released migrations are immutable)
 *  - the local file equals the package file byte for byte, unless the lock records a comment-only `localSha256`
 *  - every local directory the lock names exists
 */
export function check({ pkgDir, appDir }) {
  const lock = readLock(appDir);
  const pkg = new Map(packageMigrations(pkgDir).map((m) => [m.id, m]));
  const problems = [];
  for (const e of lock.migrations) {
    const p = pkg.get(e.originId);
    if (!p) { problems.push(`${e.originId}: no longer in the package`); continue; }
    if (sha256File(p.file) !== e.sha256) problems.push(`${e.originId}: PACKAGE file changed after release (lock ${e.sha256.slice(0, 12)}, package ${sha256File(p.file).slice(0, 12)})`);
    const local = join(appDir, 'prisma', 'migrations', e.localDir, 'migration.sql');
    if (!existsSync(local)) { problems.push(`${e.originId}: local dir ${e.localDir} missing`); continue; }
    const want = e.localSha256 ?? e.sha256;
    if (sha256File(local) !== want) problems.push(`${e.originId}: local ${e.localDir}/migration.sql differs from the lock (${sha256File(local).slice(0, 12)} != ${want.slice(0, 12)})`);
  }
  return problems;
}

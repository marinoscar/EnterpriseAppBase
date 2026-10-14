import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/bin/platform.js';
import { emptyLock, parseLock, sha256Hex, type LockEntry, type ManifestEntry, type PlatformLock } from '../../src/lock/index.js';
import { applySync, checkAppMigrations, checkLock, planSync, SyncError } from '../../src/sync/index.js';
import { fixtureManifest, makeWorkspace, type Workspace } from '../helpers/fixtures.js';

const NOW = new Date('2026-10-06T10:00:00.700Z');

function lockOf(manifest: ManifestEntry[], dirs: string[], extra: Partial<PlatformLock> = {}): PlatformLock {
  const migrations: LockEntry[] = manifest.slice(0, dirs.length).map((m, i) => ({
    originId: `platform:${m.id}`,
    localDir: dirs[i]!,
    sha256: m.sha256,
    since: m.since,
  }));
  return { ...emptyLock('0.1.0'), migrations, ...extra };
}

const PLATFORM_DIRS = ['20260105000000_initial', '20260105000001_add_orgs', '20260105000002_add_org_slug_index'];

describe('checkAppMigrations', () => {
  const manifest = fixtureManifest();

  it('accepts an app migration that sorts after every installed platform migration', () => {
    const lock = lockOf(manifest, PLATFORM_DIRS, { appMigrations: [] });
    expect(checkAppMigrations(manifest, lock, [...PLATFORM_DIRS, '20260201000000_app_workouts'])).toEqual([]);
  });

  it('fails an app migration named like a package migration, with or without a snapshot', () => {
    for (const lock of [lockOf(manifest, PLATFORM_DIRS), lockOf(manifest, PLATFORM_DIRS, { appMigrations: [] })]) {
      const problems = checkAppMigrations(manifest, lock, [...PLATFORM_DIRS, '0002_add_orgs']);
      expect(problems).toEqual([expect.objectContaining({ code: 'APP_MIGRATION_ID_COLLISION', localDir: '0002_add_orgs' })]);
    }
  });

  it('accepts an app migration recorded at the last sync that sorts between platform migrations (the normal interleave)', () => {
    const dirs = ['20260105000000_initial', '20260105000001_add_orgs', '20260301000000_add_org_slug_index'];
    const lock = lockOf(manifest, dirs, { appMigrations: ['20260201000000_app_notes'] });
    expect(checkAppMigrations(manifest, lock, [...dirs, '20260201000000_app_notes'])).toEqual([]);
  });

  it('fails an app migration added after the last sync with a timestamp older than an installed platform migration', () => {
    const dirs = ['20260105000000_initial', '20260105000001_add_orgs', '20260301000000_add_org_slug_index'];
    const lock = lockOf(manifest, dirs, { appMigrations: [] });
    const problems = checkAppMigrations(manifest, lock, [...dirs, '20260201000000_stale_branch']);
    expect(problems).toEqual([expect.objectContaining({ code: 'APP_MIGRATION_OUT_OF_ORDER', localDir: '20260201000000_stale_branch' })]);
    expect(problems[0]!.message).toMatch(/20260301000000_add_org_slug_index/);
  });

  it('skips the order rule for a lock written before the snapshot existed', () => {
    const dirs = ['20260105000000_initial', '20260105000001_add_orgs', '20260301000000_add_org_slug_index'];
    expect(checkAppMigrations(manifest, lockOf(manifest, dirs), [...dirs, '20260201000000_whatever'])).toEqual([]);
  });

  it('is part of checkLock only when the directories are passed', () => {
    const lock = lockOf(manifest, PLATFORM_DIRS, { appMigrations: [] });
    const bytes = (dir: string): Uint8Array | undefined => {
      const index = PLATFORM_DIRS.indexOf(dir);
      return index < 0 ? undefined : Buffer.from(`-- ${dir}`);
    };
    const without = checkLock(manifest, { ...lock, migrations: [] }, bytes);
    expect(without.problems.every((p) => p.code === 'NOT_INSTALLED')).toBe(true);
    const withDirs = checkLock(manifest, { ...lock, migrations: [] }, bytes, undefined, ['0001_initial']);
    expect(withDirs.problems.map((p) => p.code)).toContain('APP_MIGRATION_ID_COLLISION');
  });
});

describe('planSync and applySync', () => {
  const manifest = fixtureManifest();

  it('refuses to install while an app migration collides, and names it', () => {
    const lock = lockOf(manifest, PLATFORM_DIRS.slice(0, 1), { appMigrations: [] });
    const dirs = [PLATFORM_DIRS[0]!, '0002_add_orgs'];
    expect(() => planSync(manifest, lock, dirs, NOW)).toThrow(SyncError);
    expect(() => planSync(manifest, lock, dirs, NOW)).toThrow(/APP_MIGRATION_COLLISION.*APP_MIGRATION_ID_COLLISION.*0002_add_orgs/s);
  });

  it('records the app directories that exist at install time in the new lock', () => {
    const lock = lockOf(manifest, PLATFORM_DIRS.slice(0, 1));
    const dirs = [PLATFORM_DIRS[0]!, '20260201000000_app_notes'];
    const plan = planSync(manifest, lock, dirs, new Date('2026-01-01T00:00:00Z'));
    expect(plan.appMigrations).toEqual(['20260201000000_app_notes']);
    const written: string[] = [];
    const next = applySync(plan, {
      readPackageFile: (dir) => readFileSync(join(__dirname, '..', 'fixtures', 'migrations-basic', 'package', 'migrations', dir, 'migration.sql')),
      writeLocalMigration: (dir) => void written.push(dir),
    });
    expect(next.appMigrations).toEqual(['20260201000000_app_notes']);
    // the installs sort after the app directory, so the next check accepts the interleave
    expect(checkAppMigrations(manifest, next, [...dirs, ...written])).toEqual([]);
  });

  it('leaves the lock untouched when there is nothing to install', () => {
    const lock = lockOf(manifest, PLATFORM_DIRS);
    const plan = planSync(manifest, lock, PLATFORM_DIRS, NOW);
    expect(plan.installs).toEqual([]);
    expect(applySync(plan, { readPackageFile: () => new Uint8Array(), writeLocalMigration: () => undefined }).appMigrations).toBeUndefined();
  });
});

describe('platform db sync and check', () => {
  async function run(ws: Workspace, args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['db', ...args], { out: (l) => out.push(l), err: (l) => err.push(l) }, { cwd: ws.appDir, env: {}, now: () => NOW, packageRoot: ws.packageDir });
    return { code, out, err };
  }

  it('sync writes the snapshot, check accepts it, and a stale-dated app migration then fails both commands', async () => {
    const ws = makeWorkspace();
    expect((await run(ws, ['sync'])).code).toBe(0);
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.appMigrations).toEqual(['20260101000000_app_base', '20990101000000_app_future']);
    expect((await run(ws, ['check'])).code).toBe(0);

    mkdirSync(join(ws.migrationsDir, '20260102000000_stale_branch'));
    writeFileSync(join(ws.migrationsDir, '20260102000000_stale_branch', 'migration.sql'), 'SELECT 1;\n');
    const check = await run(ws, ['check']);
    expect(check.code).toBe(1);
    expect(check.err.join('\n')).toMatch(/APP_MIGRATION_OUT_OF_ORDER.*20260102000000_stale_branch/);

    // a package release adds a migration: sync refuses until the directory is fixed
    const manifestFile = join(ws.packageDir, 'migrations', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as ManifestEntry[];
    const first = manifest[0]!;
    const extra = { ...first, id: '0004_extra', dir: '0004_extra' };
    mkdirSync(join(ws.packageDir, 'migrations', '0004_extra'));
    const sql = Buffer.from('SELECT 2;\n');
    writeFileSync(join(ws.packageDir, 'migrations', '0004_extra', 'migration.sql'), sql);
    writeFileSync(manifestFile, JSON.stringify([...manifest, { ...extra, sha256: sha256Hex(sql), requires: [] }], null, 2));
    const sync = await run(ws, ['sync']);
    expect(sync.code).toBe(1);
    expect(sync.err.join('\n')).toMatch(/APP_MIGRATION_COLLISION/);
  });
});

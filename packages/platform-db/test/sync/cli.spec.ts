import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/bin/platform.js';
import { writeLocalMigration } from '../../src/bin/fs-io.js';
import { parseLock, sha256Hex } from '../../src/lock/index.js';
import { makeWorkspace, type Workspace } from '../helpers/fixtures.js';

interface Run {
  code: number;
  out: string[];
  err: string[];
}

async function platform(ws: Workspace, args: string[], env: NodeJS.ProcessEnv = {}, now = '2026-10-06T10:00:00Z'): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['db', ...args], {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    cwd: ws.appDir,
    env,
    now: () => new Date(now),
    packageRoot: ws.packageDir,
  });
  return { code, out, err };
}

const localDirs = (ws: Workspace): string[] => readdirSync(ws.migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();
const installedFile = (ws: Workspace, suffix: string): string => {
  const dir = localDirs(ws).find((d) => d.endsWith(suffix))!;
  return join(ws.migrationsDir, dir, 'migration.sql');
};

describe('platform db sync', () => {
  it('installs byte-identical copies after the app-authored ones, writes the lock, and a second run installs nothing', async () => {
    const ws = makeWorkspace();
    const first = await platform(ws, ['sync']);
    expect(first.code).toBe(0);
    expect(first.out.join('\n')).toContain('installed 3 migration(s)');

    const dirs = localDirs(ws);
    expect(dirs.slice(0, 2)).toEqual(['20260101000000_app_base', '20990101000000_app_future']);
    expect(dirs.slice(2)).toEqual(['20990101000001_initial', '20990101000002_add_orgs', '20990101000003_add_org_slug_index']);

    for (const [pkgDir, suffix] of [['0001_initial', '_initial'], ['0002_add_orgs', '_add_orgs'], ['0003_add_org_slug_index', '_add_org_slug_index']] as const) {
      const pkg = readFileSync(join(ws.packageDir, 'migrations', pkgDir, 'migration.sql'));
      expect(readFileSync(installedFile(ws, suffix)).equals(pkg)).toBe(true);
    }
    // The CRLF migration is untouched.
    expect(readFileSync(installedFile(ws, '_add_org_slug_index')).includes(Buffer.from('\r\n'))).toBe(true);

    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.platformVersion).toBe('0.1.0');
    expect(lock.migrations.map((m) => m.localDir)).toEqual(dirs.slice(2));
    expect(lock.migrations[0]!.sha256).toBe(sha256Hex(readFileSync(installedFile(ws, '_initial'))));
    // Prisma's own lock file is left alone.
    expect(readFileSync(join(ws.migrationsDir, 'migration_lock.toml'), 'utf8')).toBe('provider = "postgresql"\n');

    const before = readFileSync(ws.lockFile, 'utf8');
    const second = await platform(ws, ['sync']);
    expect(second.code).toBe(0);
    expect(second.out.join('\n')).toContain('up to date');
    expect(readFileSync(ws.lockFile, 'utf8')).toBe(before);
    expect(localDirs(ws)).toEqual(dirs);
  });

  it('--dry-run prints the plan and writes nothing', async () => {
    const ws = makeWorkspace();
    const run = await platform(ws, ['sync', '--dry-run']);
    expect(run.code).toBe(0);
    expect(run.out.filter((l) => l.startsWith('would install'))).toHaveLength(3);
    expect(existsSync(ws.lockFile)).toBe(false);
    expect(localDirs(ws)).toHaveLength(2);
  });

  it('--timestamp overrides the clock', async () => {
    const ws = makeWorkspace();
    rmSync(join(ws.migrationsDir, '20990101000000_app_future'), { recursive: true, force: true });
    const run = await platform(ws, ['sync', '--timestamp', '2030-02-03T04:05:06Z']);
    expect(run.code).toBe(0);
    expect(localDirs(ws)[1]).toBe('20300203040506_initial');
  });

  it('never rewrites an existing directory', () => {
    const ws = makeWorkspace();
    const existing = join(ws.migrationsDir, '20260101000000_app_base');
    const before = readFileSync(join(existing, 'migration.sql'));
    expect(() => writeLocalMigration(ws.migrationsDir, '20260101000000_app_base', Buffer.from('overwritten'))).toThrowError(/LOCAL_DIR_EXISTS/);
    expect(readFileSync(join(existing, 'migration.sql')).equals(before)).toBe(true);
  });

  it('sync --check is read-only and equals `check`', async () => {
    const ws = makeWorkspace();
    const before = await platform(ws, ['sync', '--check']);
    expect(before.code).toBe(1);
    expect(before.err.join('\n')).toContain('platform.lock not found');
    expect(existsSync(ws.lockFile)).toBe(false);
    await platform(ws, ['sync']);
    expect((await platform(ws, ['sync', '--check'])).code).toBe(0);
  });
});

describe('platform db check', () => {
  it('passes after a sync and names the offending migration after a one-byte edit', async () => {
    const ws = makeWorkspace();
    await platform(ws, ['sync']);
    expect((await platform(ws, ['check'])).code).toBe(0);

    const file = installedFile(ws, '_add_orgs');
    const bytes = readFileSync(file);
    writeFileSync(file, Buffer.concat([bytes.subarray(0, 3), Buffer.from('X'), bytes.subarray(4)]));
    const run = await platform(ws, ['check']);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toMatch(/LOCAL_MODIFIED\s+platform:0002_add_orgs/);

    writeFileSync(file, bytes);
    expect((await platform(ws, ['check'])).code).toBe(0);
  });

  it('fails when the package file is edited after release, and when a package migration is not installed', async () => {
    const ws = makeWorkspace();
    await platform(ws, ['sync']);
    const pkgFile = join(ws.packageDir, 'migrations', '0001_initial', 'migration.sql');
    const original = readFileSync(pkgFile);
    writeFileSync(pkgFile, Buffer.concat([original, Buffer.from('-- fixed a typo\n')]));
    const edited = await platform(ws, ['check']);
    expect(edited.code).toBe(1);
    expect(edited.err.join('\n')).toContain('PACKAGE_FILE_MODIFIED');
    writeFileSync(pkgFile, original);

    const lock = JSON.parse(readFileSync(ws.lockFile, 'utf8'));
    lock.migrations.pop();
    writeFileSync(ws.lockFile, JSON.stringify(lock));
    const missing = await platform(ws, ['check']);
    expect(missing.code).toBe(1);
    expect(missing.err.join('\n')).toContain('NOT_INSTALLED');
  });

  it('reports a malformed lock as a failure, not a crash', async () => {
    const ws = makeWorkspace();
    writeFileSync(ws.lockFile, '{"lockVersion": 9}');
    const run = await platform(ws, ['check']);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('lockVersion 9');
  });

  it('passes trivially for an app with no lock and a package with no migrations', async () => {
    const ws = makeWorkspace();
    writeFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), '[]\n');
    const run = await platform(ws, ['check']);
    expect(run.code).toBe(0);
  });

  it('--database needs DATABASE_URL', async () => {
    const ws = makeWorkspace();
    await platform(ws, ['sync']);
    const run = await platform(ws, ['check', '--database']);
    expect(run.code).toBe(2);
    expect(run.err.join('\n')).toContain('DATABASE_URL');
  });
});

describe('platform db promote', () => {
  it('records an app-generated migration in the package, manifest and lock against the same local dir, idempotently', async () => {
    const ws = makeWorkspace();
    await platform(ws, ['sync']);
    const local = '20990102000000_add_members';
    mkdirSync(join(ws.migrationsDir, local));
    writeFileSync(join(ws.migrationsDir, local, 'migration.sql'), '-- CreateTable\nCREATE TABLE "fixture_members" ("id" UUID NOT NULL);\n');

    const run = await platform(ws, ['promote', local, '--id', 'add_members', '--slice', 'orgs', '--requires', 'orgs']);
    expect(run.code).toBe(0);
    const pkgFile = join(ws.packageDir, 'migrations', '0004_add_members', 'migration.sql');
    expect(readFileSync(pkgFile).equals(readFileSync(join(ws.migrationsDir, local, 'migration.sql')))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), 'utf8'));
    expect(manifest.at(-1)).toMatchObject({ id: '0004_add_members', since: '0.2.0', slice: 'orgs', requires: ['orgs'] });
    const lock = parseLock(readFileSync(ws.lockFile, 'utf8'));
    expect(lock.migrations.at(-1)).toMatchObject({ originId: 'platform:0004_add_members', localDir: local });
    expect((await platform(ws, ['check'])).code).toBe(0);

    const manifestBefore = readFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), 'utf8');
    const lockBefore = readFileSync(ws.lockFile, 'utf8');
    const again = await platform(ws, ['promote', local, '--id', 'add_members']);
    expect(again.code).toBe(0);
    expect(again.out.join('\n')).toContain('already promoted');
    expect(readFileSync(join(ws.packageDir, 'migrations', 'manifest.json'), 'utf8')).toBe(manifestBefore);
    expect(readFileSync(ws.lockFile, 'utf8')).toBe(lockBefore);

    // Another app syncing the package now installs it as an ordinary migration.
    const other = makeWorkspace();
    cpSync(join(ws.packageDir, 'migrations'), join(other.packageDir, 'migrations'), { recursive: true });
    const sync = await platform(other, ['sync']);
    expect(sync.code).toBe(0);
    expect(sync.out.join('\n')).toContain('installed 4 migration(s)');
  });

  it('refuses before the app is synced', async () => {
    const ws = makeWorkspace();
    const local = '20990102000000_add_members';
    mkdirSync(join(ws.migrationsDir, local));
    writeFileSync(join(ws.migrationsDir, local, 'migration.sql'), '-- x\n');
    const run = await platform(ws, ['promote', local, '--id', 'add_members']);
    expect(run.code).toBe(1);
    expect(run.err.join('\n')).toContain('PROMOTE_NOT_SYNCED');
  });
});

describe('platform db usage', () => {
  it('exits 2 for an unknown subcommand', async () => {
    const ws = makeWorkspace();
    expect((await platform(ws, ['bogus'])).code).toBe(2);
  });
});

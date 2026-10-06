import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emptyLock, type LockEntry, type ManifestEntry, type PlatformLock } from '../../src/lock/index.js';
import { applySync, nextTimestamps, planSync, SyncError } from '../../src/sync/index.js';
import { fixtureManifest } from '../helpers/fixtures.js';

const NOW = new Date('2026-10-06T10:00:00.700Z');

function lockOf(manifest: ManifestEntry[], count: number, dirs: string[]): PlatformLock {
  const migrations: LockEntry[] = manifest.slice(0, count).map((m, i) => ({
    originId: `platform:${m.id}`,
    localDir: dirs[i]!,
    sha256: m.sha256,
    since: m.since,
  }));
  return { ...emptyLock('0.1.0'), migrations };
}

describe('planSync', () => {
  it('installs the whole history on a fresh app, one second apart, in manifest order', () => {
    const plan = planSync(fixtureManifest(), emptyLock(), [], NOW, '0.1.0');
    expect(plan.installs.map((i) => i.localDir)).toEqual([
      '20261006100000_initial',
      '20261006100001_add_orgs',
      '20261006100002_add_org_slug_index',
    ]);
    expect(plan.installs.map((i) => i.originId)).toEqual([
      'platform:0001_initial',
      'platform:0002_add_orgs',
      'platform:0003_add_org_slug_index',
    ]);
    expect(plan.platformVersion).toBe('0.1.0');
  });

  it('sorts new directories after every app-authored one, even one dated in the future', () => {
    const dirs = ['20260101000000_app_base', '20990101000000_app_future', 'migration_lock.toml'];
    const plan = planSync(fixtureManifest(), emptyLock(), dirs, NOW);
    expect(plan.installs[0]!.localDir).toBe('20990101000001_initial');
    for (const install of plan.installs) {
      expect(dirs.filter((d) => /^\d{14}_/.test(d)).every((d) => install.localDir > d)).toBe(true);
    }
  });

  it('installs only what is missing after the app has authored its own migrations', () => {
    const manifest = fixtureManifest();
    const lock = lockOf(manifest, 1, ['20260105000000_initial']);
    const dirs = ['20260105000000_initial', '20260201000000_app_workouts'];
    const plan = planSync(manifest, lock, dirs, new Date('2026-01-01T00:00:00Z'));
    expect(plan.installs.map((i) => i.originId)).toEqual(['platform:0002_add_orgs', 'platform:0003_add_org_slug_index']);
    expect(plan.installs.map((i) => i.localDir)).toEqual(['20260201000001_add_orgs', '20260201000002_add_org_slug_index']);
  });

  it('gives migrations installed in one second distinct, ascending timestamps', () => {
    const stamps = nextTimestamps([], 3, new Date('2026-10-06T10:00:00.000Z'));
    expect(stamps).toEqual(['20261006100000', '20261006100001', '20261006100002']);
    // A second run in the same second still sorts after the first run's last directory.
    const second = nextTimestamps(['20261006100002_x'], 1, new Date('2026-10-06T10:00:00.900Z'));
    expect(second).toEqual(['20261006100003']);
  });

  it('is a no-op when the lock already holds the whole history', () => {
    const manifest = fixtureManifest();
    const lock = lockOf(manifest, 3, ['20260105000000_a', '20260105000001_b', '20260105000002_c']);
    expect(planSync(manifest, lock, [], NOW).installs).toEqual([]);
  });

  it('is pure: it does not mutate its inputs', () => {
    const manifest = fixtureManifest();
    const lock = emptyLock();
    const dirs = ['20260101000000_x'];
    const before = JSON.stringify({ manifest, lock, dirs });
    planSync(manifest, lock, dirs, NOW);
    expect(JSON.stringify({ manifest, lock, dirs })).toBe(before);
  });

  it('refuses a manifest whose entry requires a slice no earlier entry provides', () => {
    const manifest = fixtureManifest();
    manifest[1] = { ...manifest[1]!, requires: ['storage'] };
    expect(() => planSync(manifest, emptyLock(), [], NOW)).toThrowError(SyncError);
    try {
      planSync(manifest, emptyLock(), [], NOW);
    } catch (error) {
      expect((error as SyncError).code).toBe('REQUIRES_VIOLATION');
      expect((error as SyncError).message).toContain('0002_add_orgs');
      expect((error as SyncError).message).toContain('storage');
    }
  });

  it('refuses an entry that requires a slice that only appears later', () => {
    const manifest = fixtureManifest();
    manifest[0] = { ...manifest[0]!, requires: ['orgs'] };
    expect(() => planSync(manifest, emptyLock(), [], NOW)).toThrowError(/REQUIRES_VIOLATION/);
  });

  it('refuses a lock that names a migration the package dropped', () => {
    const manifest = fixtureManifest();
    const lock = lockOf(manifest, 2, ['20260105000000_a', '20260105000001_b']);
    expect(() => planSync(manifest.slice(0, 1), lock, [], NOW)).toThrowError(/NOT_IN_PACKAGE/);
  });

  it('refuses a lock that is not a prefix of the package history (a gap)', () => {
    const manifest = fixtureManifest();
    const lock = lockOf([manifest[0]!, manifest[2]!], 2, ['20260105000000_a', '20260105000001_c']);
    expect(() => planSync(manifest, lock, [], NOW)).toThrowError(/LOCK_GAP/);
  });

  it('names the directory slug without its numeric prefix, kebab to snake', () => {
    const manifest: ManifestEntry[] = [
      { id: '0001_add_orgs', dir: '0001_add_orgs', sha256: 'a'.repeat(64), since: '1.0.0', slice: 'core', requires: [] },
    ];
    expect(planSync(manifest, emptyLock(), [], NOW).installs[0]!.localDir).toBe('20261006100000_add_orgs');
  });
});

describe('applySync', () => {
  it('copies exact bytes, verifies hashes first, and returns the extended lock', () => {
    const manifest = fixtureManifest();
    const written = new Map<string, Uint8Array>();
    const sources = new Map(manifest.map((m) => [m.dir, Buffer.from(`-- ${m.id}\r\n`)]));
    // Make the manifest hash match these bytes.
    const hashed = manifest.map((m) => ({ ...m, sha256: createHash('sha256').update(sources.get(m.dir)!).digest('hex') }));
    const plan = planSync(hashed, emptyLock(), [], NOW, '0.1.0');
    const lock = applySync(plan, {
      readPackageFile: (dir) => sources.get(dir)!,
      writeLocalMigration: (dir, bytes) => written.set(dir, bytes),
    });
    expect([...written.keys()]).toEqual(plan.installs.map((i) => i.localDir));
    expect(Buffer.from(written.get(plan.installs[0]!.localDir)!).equals(sources.get('0001_initial')!)).toBe(true);
    expect(lock.migrations.map((m) => m.originId)).toEqual(plan.installs.map((i) => i.originId));
    expect(lock.platformVersion).toBe('0.1.0');
  });

  it('writes nothing when any package file disagrees with the manifest', () => {
    const manifest = fixtureManifest();
    const plan = planSync(manifest, emptyLock(), [], NOW);
    const written: string[] = [];
    expect(() =>
      applySync(plan, {
        readPackageFile: () => Buffer.from('tampered'),
        writeLocalMigration: (dir) => written.push(dir),
      }),
    ).toThrowError(/PACKAGE_FILE_MISMATCH/);
    expect(written).toEqual([]);
  });
});

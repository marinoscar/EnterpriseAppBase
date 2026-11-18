import { describe, expect, it } from 'vitest';
import { sha256Hex, type LockEntry, type ManifestEntry, type PlatformLock } from '../../src/lock/index.js';
import { checkLedger, checkLock, type CheckProblemCode } from '../../src/sync/index.js';
import { fixtureManifest } from '../helpers/fixtures.js';

const SQL = new Map<string, Buffer>([
  ['0001_initial', Buffer.from('-- one\n')],
  ['0002_add_orgs', Buffer.from('-- two\n')],
  ['0003_add_org_slug_index', Buffer.from('-- three\r\n')],
]);

function build(): { manifest: ManifestEntry[]; lock: PlatformLock; local: Map<string, Buffer> } {
  const manifest = fixtureManifest().map((m) => ({ ...m, sha256: sha256Hex(SQL.get(m.dir)!) }));
  const entries: LockEntry[] = manifest.map((m, i) => ({
    originId: `platform:${m.id}`,
    localDir: `2026010${i + 1}000000_${m.id.slice(5)}`,
    sha256: m.sha256,
    since: m.since,
  }));
  const local = new Map(entries.map((e, i) => [e.localDir, SQL.get(manifest[i]!.dir)!]));
  return { manifest, lock: { lockVersion: 1, platformVersion: '0.1.0', migrations: entries }, local };
}

const codes = (r: { problems: { code: CheckProblemCode }[] }): CheckProblemCode[] => r.problems.map((p) => p.code);

describe('checkLock', () => {
  it('passes on a clean install', () => {
    const { manifest, lock, local } = build();
    expect(checkLock(manifest, lock, (d) => local.get(d), (d) => SQL.get(d))).toEqual({ ok: true, problems: [] });
  });

  it('LOCAL_MODIFIED: a one-byte edit of an installed file, naming the migration', () => {
    const { manifest, lock, local } = build();
    const dir = lock.migrations[1]!.localDir;
    local.set(dir, Buffer.from('-- twp\n'));
    const result = checkLock(manifest, lock, (d) => local.get(d));
    expect(codes(result)).toEqual(['LOCAL_MODIFIED']);
    expect(result.problems[0]!.originId).toBe('platform:0002_add_orgs');
    expect(result.problems[0]!.message).toContain(dir);
  });

  it('LOCAL_MODIFIED: a line-ending change is a byte change', () => {
    const { manifest, lock, local } = build();
    const dir = lock.migrations[2]!.localDir;
    local.set(dir, Buffer.from('-- three\n'));
    expect(codes(checkLock(manifest, lock, (d) => local.get(d)))).toEqual(['LOCAL_MODIFIED']);
  });

  it('PACKAGE_MODIFIED: the package rewrote a released migration (lock hash differs from the manifest)', () => {
    const { manifest, lock, local } = build();
    manifest[0] = { ...manifest[0]!, sha256: sha256Hex('rewritten') };
    const result = checkLock(manifest, lock, (d) => local.get(d));
    expect(codes(result)).toEqual(['PACKAGE_MODIFIED']);
    expect(result.problems[0]!.originId).toBe('platform:0001_initial');
  });

  it('PACKAGE_FILE_MODIFIED: the package file differs from its manifest hash, or is missing', () => {
    const { manifest, lock, local } = build();
    const edited = new Map(SQL).set('0002_add_orgs', Buffer.from('-- edited\n'));
    edited.delete('0003_add_org_slug_index');
    const result = checkLock(manifest, lock, (d) => local.get(d), (d) => edited.get(d));
    expect(codes(result)).toEqual(['PACKAGE_FILE_MODIFIED', 'PACKAGE_FILE_MODIFIED']);
    expect(result.problems.map((p) => p.originId)).toEqual(['platform:0002_add_orgs', 'platform:0003_add_org_slug_index']);
  });

  it('NOT_INSTALLED: a package migration is not in the lock', () => {
    const { manifest, lock, local } = build();
    lock.migrations.pop();
    const result = checkLock(manifest, lock, (d) => local.get(d));
    expect(codes(result)).toEqual(['NOT_INSTALLED']);
    expect(result.problems[0]!.originId).toBe('platform:0003_add_org_slug_index');
  });

  it('LOCAL_DIR_MISSING: a locked localDir does not exist', () => {
    const { manifest, lock, local } = build();
    local.delete(lock.migrations[0]!.localDir);
    const result = checkLock(manifest, lock, (d) => local.get(d));
    expect(codes(result)).toEqual(['LOCAL_DIR_MISSING']);
    expect(result.problems[0]!.localDir).toBe(lock.migrations[0]!.localDir);
  });

  it('NOT_IN_PACKAGE: the lock names a migration the manifest lacks', () => {
    const { manifest, lock, local } = build();
    expect(codes(checkLock(manifest.slice(0, 2), lock, (d) => local.get(d)))).toEqual(['NOT_IN_PACKAGE']);
  });

  it('LOCAL_OUT_OF_ORDER: installed directories do not sort in package order', () => {
    const { manifest, lock, local } = build();
    const [a, b] = [lock.migrations[0]!, lock.migrations[1]!];
    const swapped = { ...lock, migrations: [{ ...a, localDir: b.localDir }, { ...b, localDir: a.localDir }, lock.migrations[2]!] };
    const result = checkLock(manifest, swapped, (d) => local.get(d));
    expect(codes(result)).toContain('LOCAL_OUT_OF_ORDER');
  });

  it('accepts a recorded comment-only divergence, and still catches any further edit', () => {
    const { manifest, lock, local } = build();
    const entry = lock.migrations[0]!;
    const divergent = Buffer.concat([SQL.get('0001_initial')!, Buffer.from('-- app-local comment\n')]);
    local.set(entry.localDir, divergent);
    expect(codes(checkLock(manifest, lock, (d) => local.get(d)))).toEqual(['LOCAL_MODIFIED']);
    entry.localSha256 = sha256Hex(divergent);
    entry.note = 'comment-only difference';
    expect(checkLock(manifest, lock, (d) => local.get(d)).ok).toBe(true);
    local.set(entry.localDir, Buffer.concat([divergent, Buffer.from('-- another\n')]));
    expect(codes(checkLock(manifest, lock, (d) => local.get(d)))).toEqual(['LOCAL_MODIFIED']);
  });

  it('is clean for an empty manifest and an empty lock', () => {
    expect(checkLock([], { lockVersion: 1, platformVersion: '0.0.0', migrations: [] }, () => undefined).ok).toBe(true);
  });
});

describe('checkLedger', () => {
  const dirs = ['20260101000000_a', '20260102000000_b', '20260103000000_c'];
  const files = new Map(dirs.map((d) => [d, Buffer.from(`-- ${d}\n`)]));
  const row = (name: string, checksum = sha256Hex(files.get(name)!), finishedAt: Date | null = new Date(), rolledBackAt: Date | null = null) => ({
    migrationName: name,
    checksum,
    finishedAt,
    rolledBackAt,
  });

  it('passes when every applied row matches its file, and reports unapplied directories as pending', () => {
    const result = checkLedger(dirs, (d) => files.get(d), [row(dirs[0]!), row(dirs[1]!)]);
    expect(result).toEqual({ ok: true, problems: [], pending: [dirs[2]] });
  });

  it('fails when an applied migration file was edited (Prisma itself does not notice)', () => {
    const result = checkLedger(dirs, (d) => files.get(d), [row(dirs[0]!, sha256Hex('old bytes'))]);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toEqual(['LEDGER_CHECKSUM_MISMATCH']);
    expect(result.problems[0]!.localDir).toBe(dirs[0]);
  });

  it('fails on a row that never finished', () => {
    const result = checkLedger(dirs, (d) => files.get(d), [row(dirs[0]!, undefined, null)]);
    expect(result.problems.map((p) => p.code)).toEqual(['LEDGER_UNFINISHED']);
  });

  it('ignores a rolled-back row when the directory was applied again', () => {
    const rows = [row(dirs[0]!, sha256Hex('failed attempt'), null, new Date()), row(dirs[0]!)];
    expect(checkLedger(dirs, (d) => files.get(d), rows).ok).toBe(true);
  });

  it('treats a rolled-back-only directory as pending', () => {
    const result = checkLedger(dirs, (d) => files.get(d), [row(dirs[0]!, undefined, null, new Date())]);
    expect(result.pending).toContain(dirs[0]);
  });
});

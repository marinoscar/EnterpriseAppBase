import { describe, expect, it } from 'vitest';
import { LockFormatError, ManifestFormatError, emptyLock, parseLock, parseManifest, serializeLock, sha256Hex } from '../../src/lock/index.js';
import { compareVersions, nextPlatformVersion } from '../../src/sync/index.js';

const HASH = 'a'.repeat(64);
const entry = { originId: 'platform:0001_initial', localDir: '20260124223146_initial', sha256: HASH, since: '0.0.0' };

describe('platform.lock', () => {
  it('round-trips and serialises with sorted keys, manifest-ordered arrays and one trailing newline', () => {
    const lock = {
      platformVersion: '0.1.0',
      migrations: [
        { since: '0.0.0', sha256: HASH, originId: 'platform:0001_initial', localDir: '20260124223146_initial' },
        { since: '0.1.0', sha256: HASH, originId: 'platform:0002_a', localDir: '20260125000000_a' },
      ],
      lockVersion: 1 as const,
    };
    const text = serializeLock(lock);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('"lockVersion"')).toBeLessThan(text.indexOf('"migrations"'));
    expect(text.indexOf('"localDir"')).toBeLessThan(text.indexOf('"originId"'));
    expect(text.indexOf('platform:0001_initial')).toBeLessThan(text.indexOf('platform:0002_a'));
    expect(parseLock(text)).toEqual(lock);
    expect(serializeLock(parseLock(text))).toBe(text);
  });

  it('accepts the empty lock and the optional deviations, raw-SQL indexes and comment-only divergence', () => {
    expect(parseLock(serializeLock(emptyLock()))).toEqual(emptyLock());
    const full = {
      ...emptyLock('1.0.0'),
      migrations: [{ ...entry, localSha256: 'b'.repeat(64), note: 'comment-only difference' }],
      deviations: [{ id: 'app:push_platform', reason: 'why', expectDiff: ['ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT;'] }],
      rawSqlIndexes: [{ name: 'app_x_idx', definition: 'CREATE INDEX app_x_idx ON public.x USING btree (a) WHERE (a > 1)' }],
    };
    expect(parseLock(serializeLock(full))).toEqual(full);
  });

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['a higher lockVersion', JSON.stringify({ lockVersion: 2, platformVersion: '1.0.0', migrations: [] }), /lockVersion 2/],
    ['a missing platformVersion', JSON.stringify({ lockVersion: 1, migrations: [] }), /platformVersion/],
    ['a bad sha256', JSON.stringify({ ...emptyLock(), migrations: [{ ...entry, sha256: 'xyz' }] }), /sha256/],
    ['an origin id without the platform: prefix', JSON.stringify({ ...emptyLock(), migrations: [{ ...entry, originId: '0001_initial' }] }), /originId/],
    ['a localDir with a path separator', JSON.stringify({ ...emptyLock(), migrations: [{ ...entry, localDir: 'a/b' }] }), /localDir/],
    ['an unknown key', JSON.stringify({ ...emptyLock(), extra: true }), /extra|Unrecognized/i],
    ['localSha256 without a note', JSON.stringify({ ...emptyLock(), migrations: [{ ...entry, localSha256: HASH }] }), /note/],
  ])('rejects %s', (_name, text, pattern) => {
    expect(() => parseLock(text as string, 'lock')).toThrowError(LockFormatError);
    expect(() => parseLock(text as string, 'lock')).toThrowError(pattern as RegExp);
  });
});

describe('manifest.json', () => {
  const ok = { id: '0001_initial', dir: '0001_initial', sha256: HASH, since: '0.1.0', slice: 'core', requires: [] };

  it('parses a valid manifest and the empty array', () => {
    expect(parseManifest('[]')).toEqual([]);
    expect(parseManifest(JSON.stringify([ok]))).toEqual([ok]);
  });

  it.each([
    ['a duplicate id', [ok, ok], /duplicate|out of sequence/],
    ['an out-of-sequence id', [{ ...ok, id: '0002_b', dir: '0002_b' }, ok], /out of sequence/],
    ['a dir that differs from the id', [{ ...ok, dir: '0001_other' }], /must match/],
    ['an id without the numeric prefix', [{ ...ok, id: 'initial', dir: 'initial' }], /NNNN_slug/],
    ['a missing field', [{ id: '0001_initial', dir: '0001_initial' }], /sha256/],
  ])('rejects %s', (_name, value, pattern) => {
    expect(() => parseManifest(JSON.stringify(value))).toThrowError(ManifestFormatError);
    expect(() => parseManifest(JSON.stringify(value))).toThrowError(pattern as RegExp);
  });
});

describe('hashing and versions', () => {
  it('hashes raw bytes without normalising line endings', () => {
    expect(sha256Hex(Buffer.from('a\r\n'))).not.toBe(sha256Hex(Buffer.from('a\n')));
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes the next platform version', () => {
    expect(nextPlatformVersion('0.0.0', [])).toBe('0.1.0');
    expect(nextPlatformVersion('1.2.3', ['1.0.0'])).toBe('1.3.0');
    expect(nextPlatformVersion('1.2.3', ['1.4.0', '1.3.0'])).toBe('1.4.0');
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('orders versions by semver precedence, prerelease included (the example chain of semver.org)', () => {
    const ascending = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < ascending.length; i += 1) {
      expect(compareVersions(ascending[i - 1]!, ascending[i]!), `${ascending[i - 1]} < ${ascending[i]}`).toBeLessThan(0);
      expect(compareVersions(ascending[i]!, ascending[i - 1]!)).toBeGreaterThan(0);
    }
    expect(compareVersions('0.1.0-next.10', '0.1.0-next.9')).toBeGreaterThan(0); // numeric, not lexical
    expect(compareVersions('0.1.0-next.1', '0.1.0')).toBeLessThan(0);
    expect(compareVersions('0.2.0-next.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0+build.5', '1.0.0+build.9')).toBe(0); // build metadata is ignored
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/not a version/);
  });

  it('a prerelease package ships its next migration in the release it leads to', () => {
    expect(nextPlatformVersion('0.1.0-next.1', [])).toBe('0.1.0');
    expect(nextPlatformVersion('0.1.0-next.1', ['0.1.0-next.1'])).toBe('0.1.0');
    expect(nextPlatformVersion('0.1.0-next.1', ['1.0.0'])).toBe('1.0.0');
    expect(nextPlatformVersion('1.2.3', ['1.3.0-next.1'])).toBe('1.3.0');
  });
});

describe('versions in the lock and the manifest', () => {
  it('accepts a prerelease platformVersion and since, and still rejects what is not semver', () => {
    const lock = { ...emptyLock('0.1.0-next.1'), migrations: [{ ...entry, since: '0.1.0-next.1' }] };
    expect(parseLock(serializeLock(lock))).toEqual(lock);
    expect(parseLock(serializeLock({ ...emptyLock('1.2.3+sha.5'), migrations: [] })).platformVersion).toBe('1.2.3+sha.5');
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-', '1.2.3-next..1', 'next']) {
      expect(() => parseLock(serializeLock(emptyLock(bad))), bad).toThrow(LockFormatError);
    }
  });

  it('accepts a prerelease since in the manifest', () => {
    const manifest = [{ id: '0001_initial', dir: '0001_initial', sha256: HASH, since: '0.1.0-next.1', slice: 'core', requires: [] }];
    expect(parseManifest(JSON.stringify(manifest))[0]!.since).toBe('0.1.0-next.1');
    expect(() => parseManifest(JSON.stringify([{ ...manifest[0]!, since: '0.1' }]))).toThrow(ManifestFormatError);
  });
});

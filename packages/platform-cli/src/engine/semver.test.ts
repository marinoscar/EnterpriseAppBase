import { describe, expect, it } from 'vitest';

import { compareSemver, isNewerVersion, parseSemver } from './semver.js';

// The precedence rules of semver.org §11, plus the strictness the update notice
// needs: a version read from the network or a cache file is printed on a
// terminal, so only a well-formed one may pass.

describe('parseSemver', () => {
  it.each(['0.0.0', '1.2.3', '10.20.30', '1.2.3-rc.1', '1.2.3-alpha', '1.0.0-0.3.7', '1.0.0+build.5', '1.2.3-rc.1+sha.abc', '1.0.0-x-y-z.--'])(
    'accepts %s',
    (value) => {
      expect(parseSemver(value)).toBeDefined();
    },
  );

  it.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    ' 1.2.3',
    '1.2.3 ',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3-rc..1',
    '1.2.3+',
    '1.2.3\n',
    '1.2.3\u001b[31m',
    '1.2.3-\u001b]0;x\u0007',
    'latest',
    'x'.repeat(500),
  ])('rejects %j', (value) => {
    expect(parseSemver(value)).toBeUndefined();
  });

  it.each([undefined, null, 1, {}, ['1.2.3']])('rejects a non-string %j', (value) => {
    expect(parseSemver(value)).toBeUndefined();
  });

  it('splits the prerelease into identifiers', () => {
    expect(parseSemver('1.2.3-rc.1.x')?.prerelease).toEqual(['rc', '1', 'x']);
    expect(parseSemver('1.2.3')?.prerelease).toEqual([]);
  });
});

describe('compareSemver / isNewerVersion', () => {
  // The ordering example of semver.org §11, lowest first.
  const ORDERED = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];

  it('orders a sequence by precedence, pairwise in both directions', () => {
    for (let i = 0; i < ORDERED.length; i += 1) {
      for (let j = 0; j < ORDERED.length; j += 1) {
        const a = parseSemver(ORDERED[i]);
        const b = parseSemver(ORDERED[j]);
        if (a === undefined || b === undefined) throw new Error('fixture is not semver');
        expect(Math.sign(compareSemver(a, b)), `${ORDERED[i] as string} vs ${ORDERED[j] as string}`).toBe(Math.sign(i - j));
      }
    }
  });

  it('is newer for a greater major, minor or patch', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true);
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true);
  });

  it('compares numbers numerically, not as text', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
    expect(isNewerVersion('100000000000000000000.0.0', '99999999999999999999.0.0')).toBe(true);
  });

  it('is not newer when equal or older', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false);
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
  });

  it('ignores build metadata', () => {
    expect(isNewerVersion('1.2.3+b', '1.2.3+a')).toBe(false);
    expect(isNewerVersion('1.2.3+a', '1.2.3')).toBe(false);
  });

  it('ranks a release above its own prerelease, and a prerelease below the release', () => {
    expect(isNewerVersion('1.2.3', '1.2.3-rc.1')).toBe(true);
    expect(isNewerVersion('1.2.3-rc.1', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3-rc.2', '1.2.3-rc.1')).toBe(true);
    expect(isNewerVersion('1.2.3-rc.1', '1.2.3-rc.1')).toBe(false);
    expect(isNewerVersion('1.2.3-rc.10', '1.2.3-rc.9')).toBe(true);
    expect(isNewerVersion('1.3.0-rc.1', '1.2.3')).toBe(true);
  });

  it('is false when either side is not valid semver', () => {
    expect(isNewerVersion('v9.9.9', '1.0.0')).toBe(false);
    expect(isNewerVersion('9.9.9', 'unknown')).toBe(false);
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false);
    expect(isNewerVersion('9.9.9', undefined)).toBe(false);
  });
});

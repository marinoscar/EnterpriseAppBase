import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from './errors.js';
import { cliVersion, envVar, replaceCliIdentityForTests } from './identity.js';
import {
  beginUpdateCheck,
  formatUpdateNotice,
  updateCheckCachePath,
  updateCheckSkipReason,
  type UpdateCheckContext,
} from './update-notice.js';
import {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  DEFAULT_UPDATE_CHECK_TIMEOUT_MS,
  hasUpdateNotice,
  resetUpdateNoticeForTests,
  resolveUpdateNotice,
  setUpdateNotice,
  type UpdateNoticeOptions,
} from './update-notice-options.js';

// =============================================================================
// The start-up update notice: options, skip rules, cache  (issue #1033)
// =============================================================================
//
// `beginUpdateCheck` is tested directly with its seams (env, home, stderr,
// clock) and a real temporary home directory, so the cache file is the real
// thing. The `run()` integration (ordering after the command's output, the
// exit code, the hang) is in update-notice-run.test.ts.
//
// The running version is `cliVersion()`: 1.0.0 (test/setup.ts).
// =============================================================================

const HINT = 'git pull && npm ci && npm run build';
const DAY = DEFAULT_UPDATE_CHECK_INTERVAL_MS;
const TTY = { isTTY: true as const };
const PIPE = {};

let home: string;
let written: string[];
let stderr: { isTTY: boolean; write: (chunk: string) => boolean };
let clock: number;

function ctx(overrides: Partial<UpdateCheckContext> = {}): UpdateCheckContext {
  return { env: {}, home, stderr, now: () => clock, ...overrides };
}

function enable(latestVersion: UpdateNoticeOptions['latestVersion'], extra: Partial<UpdateNoticeOptions> = {}): void {
  setUpdateNotice({ latestVersion, upgradeHint: HINT, ...extra });
}

function cachePath(): string {
  return updateCheckCachePath({ home });
}

function readCacheFile(): { checkedAt?: string; latest?: string } {
  return JSON.parse(readFileSync(cachePath(), 'utf8')) as { checkedAt?: string; latest?: string };
}

function seedCache(content: unknown): void {
  mkdirSync(dirname(cachePath()), { recursive: true });
  writeFileSync(cachePath(), typeof content === 'string' ? content : JSON.stringify(content));
}

beforeEach(() => {
  resetUpdateNoticeForTests();
  home = mkdtempSync(join(tmpdir(), 'update-notice-'));
  written = [];
  stderr = { isTTY: true, write: (chunk: string) => (written.push(chunk), true) };
  clock = Date.parse('2026-06-01T12:00:00.000Z');
});

afterEach(() => {
  resetUpdateNoticeForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('resolveUpdateNotice', () => {
  const ok = { latestVersion: async () => '1.0.0', upgradeHint: HINT };

  it('applies the defaults: 24 hours and 1.5 seconds', () => {
    const resolved = resolveUpdateNotice(ok);
    expect(resolved.intervalMs).toBe(DEFAULT_UPDATE_CHECK_INTERVAL_MS);
    expect(resolved.intervalMs).toBe(24 * 60 * 60 * 1000);
    expect(resolved.timeoutMs).toBe(DEFAULT_UPDATE_CHECK_TIMEOUT_MS);
    expect(resolved.timeoutMs).toBe(1500);
    expect(resolved.upgradeHint).toBe(HINT);
  });

  it('keeps the values it is given, and allows an interval of 0 (check every run)', () => {
    expect(resolveUpdateNotice({ ...ok, intervalMs: 0, timeoutMs: 500 })).toMatchObject({ intervalMs: 0, timeoutMs: 500 });
  });

  it('trims the hint', () => {
    expect(resolveUpdateNotice({ ...ok, upgradeHint: `  ${HINT}  ` }).upgradeHint).toBe(HINT);
  });

  it.each(['', '   ', '\t\n'])('rejects an empty upgradeHint %j', (upgradeHint) => {
    expect(() => resolveUpdateNotice({ ...ok, upgradeHint })).toThrow(UsageError);
    expect(() => resolveUpdateNotice({ ...ok, upgradeHint })).toThrow(/upgradeHint/);
  });

  it.each([undefined, null, 5])('rejects a non-string upgradeHint %j', (upgradeHint) => {
    expect(() => resolveUpdateNotice({ ...ok, upgradeHint: upgradeHint as unknown as string })).toThrow(/upgradeHint/);
  });

  it.each(['line one\nline two', 'a\rb', 'esc \u001b[31mred', 'nul\u0000', 'sep x'])(
    'rejects an upgradeHint that is not one plain line: %j',
    (upgradeHint) => {
      expect(() => resolveUpdateNotice({ ...ok, upgradeHint })).toThrow(/single line/);
    },
  );

  it.each([undefined, null, 'fn', {}])('rejects a latestVersion that is not a function: %j', (latestVersion) => {
    expect(() => resolveUpdateNotice({ ...ok, latestVersion: latestVersion as never })).toThrow(/latestVersion/);
  });

  it('rejects an undefined options object', () => {
    expect(() => resolveUpdateNotice(undefined as never)).toThrow(UsageError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '5'])('rejects intervalMs %j', (intervalMs) => {
    expect(() => resolveUpdateNotice({ ...ok, intervalMs: intervalMs as number })).toThrow(/intervalMs/);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, '5'])('rejects timeoutMs %j', (timeoutMs) => {
    expect(() => resolveUpdateNotice({ ...ok, timeoutMs: timeoutMs as number })).toThrow(/timeoutMs/);
  });
});

describe('setUpdateNotice', () => {
  it('is off until set, on after, and off again for undefined', () => {
    expect(hasUpdateNotice()).toBe(false);
    enable(async () => '9.9.9');
    expect(hasUpdateNotice()).toBe(true);
    setUpdateNotice(undefined);
    expect(hasUpdateNotice()).toBe(false);
  });

  it('keeps the previous setting when the new one is invalid', () => {
    enable(async () => '9.9.9');
    expect(() => setUpdateNotice({ latestVersion: async () => '1.0.0', upgradeHint: '' })).toThrow(UsageError);
    expect(hasUpdateNotice()).toBe(true);
  });
});

describe('updateCheckSkipReason', () => {
  const skip = (argv: string[], env: NodeJS.ProcessEnv = {}, stream: { isTTY?: boolean } = TTY) =>
    updateCheckSkipReason(argv, env, stream);

  it('checks an ordinary command on a terminal', () => {
    expect(skip(['deploy', 'status'])).toBeUndefined();
    expect(skip([])).toBeUndefined();
    expect(skip(['api', 'GET', '/api/health/live', '--raw'])).toBeUndefined();
  });

  it('skips when CI is set', () => {
    expect(skip(['deploy', 'status'], { CI: 'true' })).toBe('ci');
    expect(skip(['deploy', 'status'], { CI: '1' })).toBe('ci');
    expect(skip(['deploy', 'status'], { CONTINUOUS_INTEGRATION: 'true' })).toBe('ci');
  });

  it('does not read CI=false or CI=0 or an empty CI as set (the same reading as the TUI gate)', () => {
    for (const value of ['false', '0', 'no', '', '  ']) {
      expect(skip(['deploy', 'status'], { CI: value })).toBeUndefined();
    }
  });

  it('skips when stderr is not a terminal: a pipe (isTTY undefined) and a file (false)', () => {
    expect(skip(['deploy', 'status'], {}, PIPE)).toBe('stderr-not-a-tty');
    expect(skip(['deploy', 'status'], {}, { isTTY: false })).toBe('stderr-not-a-tty');
  });

  it('skips for --json anywhere before a "--"', () => {
    expect(skip(['deploy', 'doctor', '--json'])).toBe('json');
    expect(skip(['--json', 'deploy', 'status'])).toBe('json');
    expect(skip(['deploy', 'status', '--', '--json'])).toBeUndefined();
  });

  it.each(['--version', '-V', '-v'])('skips for %s', (flag) => {
    expect(skip([flag])).toBe('version');
    expect(skip(['deploy', flag])).toBe('version');
  });

  it.each(['--help', '-h'])('skips for %s', (flag) => {
    expect(skip([flag])).toBe('help');
    expect(skip(['deploy', 'update', flag])).toBe('help');
  });

  it('skips for the help command', () => {
    expect(skip(['help', 'deploy'])).toBe('help');
  });

  it('skips for the worker-node daemon, `node start`, in every form it is launched', () => {
    expect(skip(['node', 'start'])).toBe('node-daemon');
    expect(skip(['node', 'start', '--headless'])).toBe('node-daemon');
    expect(skip(['node', 'start', '--daemon'])).toBe('node-daemon');
    expect(skip(['node', 'start', '-d'])).toBe('node-daemon');
  });

  it('does not skip the rest of the node group, which is interactive', () => {
    for (const sub of ['status', 'logs', 'stop', 'doctor', 'config', 'register', 'enroll', 'set-concurrency']) {
      expect(skip(['node', sub]), `node ${sub}`).toBeUndefined();
    }
    expect(skip(['node', 'service', 'install'])).toBeUndefined();
    expect(skip(['deploy', 'start'])).toBeUndefined();
  });

  it('skips when <PREFIX>_NO_UPDATE_CHECK is set, using the CLI identity prefix', () => {
    const name = envVar('NO_UPDATE_CHECK');
    expect(name).toBe('APPCTL_NO_UPDATE_CHECK');
    expect(skip(['deploy', 'status'], { [name]: '1' })).toBe('opted-out');
    expect(skip(['deploy', 'status'], { [name]: 'true' })).toBe('opted-out');
    expect(skip(['deploy', 'status'], { [name]: '0' })).toBeUndefined();
    expect(skip(['deploy', 'status'], { [name]: '' })).toBeUndefined();
    // Another CLI's prefix is not this CLI's opt-out.
    expect(skip(['deploy', 'status'], { OTHERCTL_NO_UPDATE_CHECK: '1' })).toBeUndefined();
  });

  it('reports the operator\'s own opt-out first', () => {
    expect(skip(['--json'], { APPCTL_NO_UPDATE_CHECK: '1', CI: '1' }, PIPE)).toBe('opted-out');
  });
});

describe('formatUpdateNotice', () => {
  it('is one line: "<cli> <latest> is available (you have <current>). Update: <hint>"', () => {
    expect(formatUpdateNotice('1.3.0', '1.2.0', HINT)).toBe(`appctl 1.3.0 is available (you have 1.2.0). Update: ${HINT}\n`);
  });
});

describe('beginUpdateCheck: feature off', () => {
  it('does nothing when updateNotice was not set: no read, no fetch, no write, no output', async () => {
    const handle = beginUpdateCheck(['deploy', 'status'], ctx());
    await handle.finish();
    expect(written).toEqual([]);
    expect(existsSync(dirname(cachePath()))).toBe(false);
  });
});

describe('beginUpdateCheck: the cache', () => {
  it('with no cache: fetches, writes the cache and prints the notice for a newer version', async () => {
    const latestVersion = vi.fn(async () => '1.4.0');
    enable(latestVersion);

    const handle = beginUpdateCheck(['deploy', 'status'], ctx());
    expect(latestVersion).toHaveBeenCalledTimes(1);
    await handle.finish();

    expect(written).toEqual([`appctl 1.4.0 is available (you have ${cliVersion()}). Update: ${HINT}\n`]);
    expect(readCacheFile()).toEqual({ checkedAt: '2026-06-01T12:00:00.000Z', latest: '1.4.0' });
  });

  it('puts the cache at ~/.<cli>/update-check.json from the identity', () => {
    expect(cachePath()).toBe(join(home, '.appctl', 'update-check.json'));
  });

  it('with a fresh cache: no network, the notice comes from the cached version', async () => {
    const latestVersion = vi.fn(async () => '9.9.9');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - DAY / 2).toISOString(), latest: '1.5.0' });

    await beginUpdateCheck(['deploy', 'status'], ctx()).finish();

    expect(latestVersion).not.toHaveBeenCalled();
    expect(written).toEqual([`appctl 1.5.0 is available (you have ${cliVersion()}). Update: ${HINT}\n`]);
    // A fresh cache is not rewritten.
    expect(readCacheFile().checkedAt).toBe(new Date(clock - DAY / 2).toISOString());
  });

  it('with a fresh cache that is not newer: no network and no output', async () => {
    const latestVersion = vi.fn(async () => '9.9.9');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - 1000).toISOString(), latest: cliVersion() });

    await beginUpdateCheck(['deploy', 'status'], ctx()).finish();

    expect(latestVersion).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('with a fresh cache that holds no version (the last check failed): no network, no output', async () => {
    const latestVersion = vi.fn(async () => '9.9.9');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - 1000).toISOString() });

    await beginUpdateCheck(['deploy', 'status'], ctx()).finish();

    expect(latestVersion).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('with a stale cache (older than the interval): fetches and rewrites it', async () => {
    const latestVersion = vi.fn(async () => '2.0.0');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - DAY - 1).toISOString(), latest: '1.1.0' });

    await beginUpdateCheck(['deploy', 'status'], ctx()).finish();

    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(readCacheFile()).toEqual({ checkedAt: new Date(clock).toISOString(), latest: '2.0.0' });
    expect(written).toEqual([`appctl 2.0.0 is available (you have ${cliVersion()}). Update: ${HINT}\n`]);
  });

  it('treats a cache exactly one interval old as stale and one millisecond younger as fresh', async () => {
    const latestVersion = vi.fn(async () => '1.0.0');
    enable(latestVersion);

    seedCache({ checkedAt: new Date(clock - DAY + 1).toISOString() });
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).not.toHaveBeenCalled();

    seedCache({ checkedAt: new Date(clock - DAY).toISOString() });
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(1);
  });

  it('honours a custom intervalMs, and 0 checks on every run', async () => {
    const latestVersion = vi.fn(async () => '1.0.0');
    enable(latestVersion, { intervalMs: 1000 });
    seedCache({ checkedAt: new Date(clock - 999).toISOString() });
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).not.toHaveBeenCalled();
    seedCache({ checkedAt: new Date(clock - 1000).toISOString() });
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(1);

    enable(latestVersion, { intervalMs: 0 });
    seedCache({ checkedAt: new Date(clock).toISOString() });
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(2);
  });

  it('a cache dated in the future is stale: it would otherwise suppress the check until then', async () => {
    const latestVersion = vi.fn(async () => '1.7.0');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock + 10 * DAY).toISOString(), latest: '1.0.0' });

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(readCacheFile()).toEqual({ checkedAt: new Date(clock).toISOString(), latest: '1.7.0' });
  });

  it.each([
    ['not JSON', '{{{ not json'],
    ['empty', ''],
    ['a JSON array', '[]'],
    ['a JSON string', '"x"'],
    ['null', 'null'],
    ['no checkedAt', '{"latest":"1.2.0"}'],
    ['a numeric checkedAt', '{"checkedAt":1780000000000,"latest":"1.2.0"}'],
    ['an unparseable checkedAt', '{"checkedAt":"yesterday","latest":"1.2.0"}'],
    ['a binary blob', '\u0000\u0001\u0002'],
  ])('a corrupt cache (%s) is refetched and rewritten', async (_label, content) => {
    const latestVersion = vi.fn(async () => '1.8.0');
    enable(latestVersion);
    seedCache(content);

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(readCacheFile()).toEqual({ checkedAt: new Date(clock).toISOString(), latest: '1.8.0' });
    expect(written).toHaveLength(1);
  });

  it('refetches when the cache file is larger than any real one', async () => {
    const latestVersion = vi.fn(async () => '1.0.0');
    enable(latestVersion);
    seedCache(JSON.stringify({ checkedAt: new Date(clock).toISOString(), latest: '9.9.9', pad: 'x'.repeat(10_000) }));

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(written).toEqual([]);
  });

  it('never prints a cached version that is not semver (the file is editable)', async () => {
    const latestVersion = vi.fn(async () => undefined);
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - 1000).toISOString(), latest: '9.9.9\u001b[2J rm -rf' });

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(written).toEqual([]);
  });

  it('never prints a fetched version that is not semver', async () => {
    for (const bad of ['v9.9.9', '9.9', '9.9.9\n', '9.9.9\u001b[2J', 'latest', '']) {
      written.length = 0;
      rmSync(dirname(cachePath()), { recursive: true, force: true });
      enable(async () => bad);
      await beginUpdateCheck(['x'], ctx()).finish();
      expect(written, bad).toEqual([]);
      expect(readCacheFile().latest, bad).toBeUndefined();
    }
  });

  it('writes the cache owner-only (0600) in a 0700 directory, atomically, leaving no temp file', async () => {
    enable(async () => '1.4.0');

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(statSync(cachePath()).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(cachePath())).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(cachePath()))).toEqual(['update-check.json']);
  });

  it('a failed check records the attempt and keeps the last known version', async () => {
    const latestVersion = vi.fn(async (): Promise<string | undefined> => undefined);
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - DAY - 1).toISOString(), latest: '1.6.0' });

    await beginUpdateCheck(['x'], ctx()).finish();

    expect(readCacheFile()).toEqual({ checkedAt: new Date(clock).toISOString(), latest: '1.6.0' });
    // The stale version is still true, so the notice still shows.
    expect(written).toEqual([`appctl 1.6.0 is available (you have ${cliVersion()}). Update: ${HINT}\n`]);
  });

  it('an offline server does not retry on every command: the failure is cached for the interval', async () => {
    const latestVersion = vi.fn(async (): Promise<string | undefined> => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    enable(latestVersion);

    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(readCacheFile()).toEqual({ checkedAt: new Date(clock).toISOString() });

    clock += 60_000;
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(written).toEqual([]);

    clock += DAY;
    await beginUpdateCheck(['x'], ctx()).finish();
    expect(latestVersion).toHaveBeenCalledTimes(2);
  });

  it('is silent and prints the notice when the cache cannot be written', async () => {
    enable(async () => '1.4.0');
    // A directory where the cache file should be: the rename fails.
    mkdirSync(cachePath(), { recursive: true });

    await expect(beginUpdateCheck(['x'], ctx()).finish()).resolves.toBeUndefined();

    expect(written).toHaveLength(1);
    expect(readdirSync(dirname(cachePath()))).toEqual(['update-check.json']);
  });
});

describe('beginUpdateCheck: newer, equal, older, prerelease', () => {
  async function noticeFor(latest: string, current: string): Promise<string[]> {
    written.length = 0;
    rmSync(dirname(cachePath()), { recursive: true, force: true });
    const restore = replaceCliIdentityForTests({ name: 'appctl', displayName: 'x', repoSlug: 'a/b' }, current);
    try {
      enable(async () => latest);
      await beginUpdateCheck(['x'], ctx()).finish();
    } finally {
      restore();
    }
    return [...written];
  }

  it('prints for a greater patch, minor and major', async () => {
    expect(await noticeFor('1.2.4', '1.2.3')).toEqual([`appctl 1.2.4 is available (you have 1.2.3). Update: ${HINT}\n`]);
    expect(await noticeFor('1.3.0', '1.2.9')).toHaveLength(1);
    expect(await noticeFor('2.0.0', '1.9.9')).toHaveLength(1);
    expect(await noticeFor('1.10.0', '1.9.0')).toHaveLength(1);
  });

  it('is silent when equal or older', async () => {
    expect(await noticeFor('1.2.3', '1.2.3')).toEqual([]);
    expect(await noticeFor('1.2.2', '1.2.3')).toEqual([]);
    expect(await noticeFor('1.9.0', '1.10.0')).toEqual([]);
    expect(await noticeFor('0.9.9', '1.0.0')).toEqual([]);
  });

  it('orders prereleases: a release beats its own rc, an rc does not beat its release', async () => {
    expect(await noticeFor('1.2.3', '1.2.3-rc.1')).toHaveLength(1);
    expect(await noticeFor('1.2.3-rc.2', '1.2.3-rc.1')).toHaveLength(1);
    expect(await noticeFor('1.2.3-rc.10', '1.2.3-rc.9')).toHaveLength(1);
    expect(await noticeFor('1.3.0-rc.1', '1.2.3')).toHaveLength(1);
    expect(await noticeFor('1.2.3-rc.1', '1.2.3')).toEqual([]);
    expect(await noticeFor('1.2.3-rc.1', '1.2.3-rc.1')).toEqual([]);
    expect(await noticeFor('1.2.3-rc.1', '1.2.3-rc.2')).toEqual([]);
    expect(await noticeFor('1.2.3-alpha', '1.2.3-beta')).toEqual([]);
  });

  it('is silent when the running version is not semver', async () => {
    expect(await noticeFor('9.9.9', 'unknown')).toEqual([]);
  });
});

describe('beginUpdateCheck: skipped runs read and start nothing', () => {
  it.each<[string, string[], Partial<UpdateCheckContext>]>([
    ['CI set', ['deploy', 'status'], { env: { CI: 'true' } }],
    ['stderr not a TTY', ['deploy', 'status'], { stderr: { write: () => true } }],
    ['--json', ['deploy', 'doctor', '--json'], {}],
    ['--version', ['--version'], {}],
    ['-V', ['-V'], {}],
    ['--help', ['--help'], {}],
    ['-h', ['deploy', '-h'], {}],
    ['opt-out env', ['deploy', 'status'], { env: { APPCTL_NO_UPDATE_CHECK: '1' } }],
    ['node start', ['node', 'start'], {}],
    ['node start --headless', ['node', 'start', '--headless'], {}],
  ])('%s', async (_label, argv, overrides) => {
    const latestVersion = vi.fn(async () => '9.9.9');
    enable(latestVersion);
    seedCache({ checkedAt: new Date(clock - 2 * DAY).toISOString(), latest: '8.0.0' });
    const before = readFileSync(cachePath(), 'utf8');

    await beginUpdateCheck(argv, ctx(overrides)).finish();

    expect(latestVersion).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    expect(readFileSync(cachePath(), 'utf8')).toBe(before);
  });
});

describe('beginUpdateCheck: nothing it does can throw', () => {
  it.each<[string, () => Promise<string | undefined>]>([
    ['rejects', async () => Promise.reject(new Error('boom'))],
    ['throws synchronously', () => { throw new Error('boom'); }],
    ['returns a non-string', async () => 42 as unknown as string],
    ['returns an object', async () => ({}) as unknown as string],
  ])('latestVersion %s', async (_label, latestVersion) => {
    enable(latestVersion);
    const handle = beginUpdateCheck(['x'], ctx());
    await expect(handle.finish()).resolves.toBeUndefined();
    expect(written).toEqual([]);
  });

  it('a stderr whose write throws does not escape', async () => {
    enable(async () => '9.9.9');
    const broken = { isTTY: true, write: () => { throw new Error('EPIPE'); } };
    await expect(beginUpdateCheck(['x'], ctx({ stderr: broken })).finish()).resolves.toBeUndefined();
  });

  it('a clock that throws does not escape', async () => {
    enable(async () => '9.9.9');
    const handle = beginUpdateCheck(['x'], ctx({ now: () => { throw new Error('clock'); } }));
    await expect(handle.finish()).resolves.toBeUndefined();
  });
});

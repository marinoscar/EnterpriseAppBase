import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCli, type CliInstance, type CreateCliOptions } from './create-cli.js';
import { EXIT, UsageError } from './errors.js';
import { resetCliForTests, TEST_CLI_IDENTITY } from './test-support.js';
import type { UpdateCheckContext } from './update-notice.js';
import { hasUpdateNotice } from './update-notice-options.js';

// =============================================================================
// The update notice through `createCli` and `run()`  (issue #1033)
// =============================================================================
//
// What this pins, end to end: the notice is ONE line on stderr AFTER the
// command's output; the exit code is exactly what it would have been without
// the feature, including when the fetch throws or hangs; a slow fetch never
// holds the command back and never holds the end of it past the timeout; and
// every skip condition reaches the real `run()` and starts no fetch.
//
// The CLI under test is 2.3.4 (BASE below). Timing uses fake timers; the cache
// is a real file in a temporary home.
// =============================================================================

const BASE: CreateCliOptions = { identity: TEST_CLI_IDENTITY, version: '2.3.4' };
const HINT = 'git pull && npm ci && npm run build';
const NOTICE = `appctl 2.4.0 is available (you have 2.3.4). Update: ${HINT}\n`;

let events: string[];
let home: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

/** `~/.appctl/update-check.json` under the test home (spelled out: the identity is reset between runs). */
function cacheFile(): string {
  return join(home, '.appctl', 'update-check.json');
}

/** The `UpdateCheckContext` of a terminal: stderr is a TTY and every write is recorded in order. */
function terminal(overrides: Partial<UpdateCheckContext> = {}): UpdateCheckContext {
  return {
    env: {},
    home,
    stderr: { isTTY: true, write: (chunk: string) => (events.push(`stderr:${chunk}`), true) },
    ...overrides,
  };
}

function appCommands(program: Command): void {
  program
    .command('hello')
    .description('Print a line')
    .option('--json', 'machine output')
    .action(() => {
      process.stdout.write('hello output\n');
      events.push('command');
    });
  program
    .command('boom')
    .description('Fail with a usage error')
    .action(() => {
      events.push('command');
      throw new UsageError('bad usage');
    });
  program
    .command('slow')
    .description('Take two seconds')
    .action(async () => {
      events.push('command:start');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.stdout.write('slow output\n');
      events.push('command:end');
    });
}

function build(updateNotice?: CreateCliOptions['updateNotice']): CliInstance {
  return createCli({ ...BASE, extraCommands: [appCommands], ...(updateNotice !== undefined ? { updateNotice } : {}) });
}

function notice(latestVersion: (signal?: AbortSignal) => Promise<string | undefined>, extra: object = {}): CreateCliOptions['updateNotice'] {
  return { latestVersion, upgradeHint: HINT, ...extra };
}

beforeEach(() => {
  resetCliForTests();
  events = [];
  home = mkdtempSync(join(tmpdir(), 'update-notice-run-'));
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => (events.push(`stdout:${String(chunk)}`), true));
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  resetCliForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('createCli({ updateNotice }): validation at build', () => {
  it('is off when unset: existing apps are unchanged', () => {
    build();
    expect(hasUpdateNotice()).toBe(false);
  });

  it('is on when set', () => {
    build(notice(async () => '2.4.0'));
    expect(hasUpdateNotice()).toBe(true);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['an empty upgradeHint', { latestVersion: async () => '1.0.0', upgradeHint: '' }, /upgradeHint/],
    ['a blank upgradeHint', { latestVersion: async () => '1.0.0', upgradeHint: '   ' }, /upgradeHint/],
    ['a multi-line upgradeHint', { latestVersion: async () => '1.0.0', upgradeHint: 'a\nb' }, /single line/],
    ['no latestVersion', { upgradeHint: HINT }, /latestVersion/],
    ['a bad intervalMs', { latestVersion: async () => '1.0.0', upgradeHint: HINT, intervalMs: -1 }, /intervalMs/],
    ['a bad timeoutMs', { latestVersion: async () => '1.0.0', upgradeHint: HINT, timeoutMs: 0 }, /timeoutMs/],
  ])('throws a UsageError at createCli for %s', (_label, updateNotice, message) => {
    expect(() => createCli({ ...BASE, updateNotice: updateNotice as never })).toThrow(UsageError);
    resetCliForTests();
    expect(() => createCli({ ...BASE, updateNotice: updateNotice as never })).toThrow(message);
  });

  it('does not register anything when the option is invalid', () => {
    expect(() => createCli({ ...BASE, extraCommands: [appCommands], updateNotice: { latestVersion: async () => '1', upgradeHint: '' } })).toThrow();
    resetCliForTests();
    // The registries are not frozen or half-filled by the failed build.
    expect(() => build()).not.toThrow();
  });
});

describe('the real command names the skip rule depends on', () => {
  it('has `node start` (the worker daemon) and no `node run`', () => {
    const node = build().program.commands.find((command) => command.name() === 'node');
    const names = node?.commands.map((command) => command.name()) ?? [];
    expect(names).toContain('start');
    expect(names).not.toContain('run');
  });
});

describe('run(): the notice', () => {
  it('writes exactly one line to stderr, after the command output, and leaves stdout and the exit code alone', async () => {
    const cli = build(notice(async () => '2.4.0'));

    const code = await cli.run(['hello'], { updateCheck: terminal() });

    expect(code).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command', `stderr:${NOTICE}`]);
    expect(NOTICE.split('\n').filter(Boolean)).toHaveLength(1);
    // Nothing went through process.stderr either: the notice has its own stream seam.
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes to process.stderr when no stream is injected', async () => {
    const cli = build(notice(async () => '2.4.0'));
    const real = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
    try {
      const code = await cli.run(['hello'], { updateCheck: { env: {}, home } });
      expect(code).toBe(EXIT.OK);
    } finally {
      if (real !== undefined) Object.defineProperty(process.stderr, 'isTTY', real);
      else delete (process.stderr as { isTTY?: boolean }).isTTY;
    }
    expect(stderrSpy.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([NOTICE]);
  });

  it('prints nothing when the latest version is the running one or older', async () => {
    for (const latest of ['2.3.4', '2.3.3', '1.0.0']) {
      resetCliForTests();
      rmSync(cacheFile(), { force: true });
      events = [];
      const cli = build(notice(async () => latest));
      expect(await cli.run(['hello'], { updateCheck: terminal() })).toBe(EXIT.OK);
      expect(events.filter((event) => event.startsWith('stderr:')), latest).toEqual([]);
    }
  });

  it('prints for a newer prerelease line and not for an older prerelease of the same version', async () => {
    const cases: Array<[string, boolean]> = [['2.3.5-rc.1', true], ['2.3.4-rc.1', false], ['2.4.0-beta', true]];
    for (const [latest, shown] of cases) {
      resetCliForTests();
      rmSync(cacheFile(), { force: true });
      events = [];
      const cli = build(notice(async () => latest));
      await cli.run(['hello'], { updateCheck: terminal() });
      expect(events.some((event) => event.startsWith('stderr:')), latest).toBe(shown);
    }
  });

  it('shows the notice after a failing command too, and the exit code is the command\'s', async () => {
    const cli = build(notice(async () => '2.4.0'));

    const code = await cli.run(['boom'], { updateCheck: terminal() });

    expect(code).toBe(EXIT.USAGE);
    expect(events[events.length - 1]).toBe(`stderr:${NOTICE}`);
  });

  it('gives the same exit codes as a CLI without the feature, for success, failure and a usage error', async () => {
    const argvs = [['hello'], ['boom'], ['no-such-command'], ['--bogus-flag']];
    for (const argv of argvs) {
      resetCliForTests();
      const off = await build().run(argv, { updateCheck: terminal() });
      resetCliForTests();
      rmSync(cacheFile(), { force: true });
      const on = await build(notice(async () => '2.4.0')).run(argv, { updateCheck: terminal() });
      expect(on, argv.join(' ')).toBe(off);
    }
  });

  it('shows the cached notice without a network call on the next run, within the interval', async () => {
    const latestVersion = vi.fn(async () => '2.4.0');
    const cli = build(notice(latestVersion));

    await cli.run(['hello'], { updateCheck: terminal() });
    await cli.run(['hello'], { updateCheck: terminal() });

    expect(latestVersion).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event === `stderr:${NOTICE}`)).toHaveLength(2);
    expect(JSON.parse(readFileSync(cacheFile(), 'utf8')).latest).toBe('2.4.0');
  });
});

describe('run(): the feature is off when the option is unset', () => {
  it('starts no fetch, reads and writes no cache, prints nothing', async () => {
    const cli = build();

    const code = await cli.run(['hello'], { updateCheck: terminal() });

    expect(code).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
    expect(existsSync(cacheFile())).toBe(false);
    expect(existsSync(join(home, '.appctl'))).toBe(false);
  });
});

describe('run(): every skip condition starts no fetch and prints nothing', () => {
  it.each<[string, string[], Partial<UpdateCheckContext>, number]>([
    ['CI is set', ['hello'], { env: { CI: 'true' } }, EXIT.OK],
    ['stderr is not a TTY', ['hello'], { stderr: { write: (chunk: string) => (events.push(`stderr:${chunk}`), true) } }, EXIT.OK],
    ['--json', ['hello', '--json'], {}, EXIT.OK],
    ['--version', ['--version'], {}, EXIT.OK],
    ['-v', ['-v'], {}, EXIT.OK],
    ['-V', ['-V'], {}, EXIT.USAGE],
    ['--help', ['--help'], {}, EXIT.OK],
    ['-h', ['hello', '-h'], {}, EXIT.OK],
    ['the help command', ['help', 'hello'], {}, EXIT.OK],
    ['APPCTL_NO_UPDATE_CHECK=1', ['hello'], { env: { APPCTL_NO_UPDATE_CHECK: '1' } }, EXIT.OK],
  ])('%s', async (_label, argv, overrides, expected) => {
    const latestVersion = vi.fn(async () => '2.4.0');
    const cli = build(notice(latestVersion));

    const code = await cli.run(argv, { updateCheck: terminal(overrides) });

    expect(code).toBe(expected);
    expect(latestVersion).not.toHaveBeenCalled();
    expect(events.filter((event) => event.startsWith('stderr:'))).toEqual([]);
    expect(existsSync(cacheFile())).toBe(false);
  });

  it('checks again once the skip condition is gone (the same CLI, the same home)', async () => {
    const latestVersion = vi.fn(async () => '2.4.0');
    const cli = build(notice(latestVersion));

    await cli.run(['hello'], { updateCheck: terminal({ env: { CI: '1' } }) });
    expect(latestVersion).not.toHaveBeenCalled();

    await cli.run(['hello'], { updateCheck: terminal() });
    expect(latestVersion).toHaveBeenCalledTimes(1);
  });
});

describe('run(): failure and slowness of the fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Runs `argv` and settles all timers, returning the exit code. */
  async function runToEnd(cli: CliInstance, argv: string[], ms: number): Promise<number> {
    const result = cli.run(argv, { updateCheck: terminal() });
    await vi.advanceTimersByTimeAsync(ms);
    return result;
  }

  it('a latestVersion that rejects: silent, exit code unchanged', async () => {
    const cli = build(notice(async () => Promise.reject(new Error('network down'))));
    expect(await runToEnd(cli, ['hello'], 10)).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
  });

  it('a latestVersion that throws synchronously: silent, exit code unchanged', async () => {
    const cli = build(notice(() => { throw new Error('sync boom'); }));
    expect(await runToEnd(cli, ['hello'], 10)).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
  });

  it('a failing command keeps its own exit code when the fetch also throws', async () => {
    const cli = build(notice(async () => Promise.reject(new Error('network down'))));
    expect(await runToEnd(cli, ['boom'], 10)).toBe(EXIT.USAGE);
  });

  it('a latestVersion that never resolves: the command runs at once, the end waits for the timeout and no longer, exit code unchanged', async () => {
    const cli = build(notice(() => new Promise<string | undefined>(() => undefined)));

    let settled = false;
    const result = cli.run(['hello'], { updateCheck: terminal() }).then((code) => {
      settled = true;
      return code;
    });

    // The command ran and printed before any timer fired: the fetch did not hold it back.
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a hung fetch is aborted at the deadline through the signal it was given', async () => {
    let signal: AbortSignal | undefined;
    const cli = build(
      notice((given) => {
        signal = given;
        return new Promise<string | undefined>(() => undefined);
      }),
    );

    const result = cli.run(['hello'], { updateCheck: terminal() });
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);

    expect(await result).toBe(EXIT.OK);
    expect(signal?.aborted).toBe(true);
  });

  it('honours a custom timeoutMs', async () => {
    const cli = build(notice(() => new Promise<string | undefined>(() => undefined), { timeoutMs: 300 }));
    let settled = false;
    const result = cli.run(['hello'], { updateCheck: terminal() }).then((code) => ((settled = true), code));

    await vi.advanceTimersByTimeAsync(299);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(EXIT.OK);
  });

  it('a fetch that answers within the timeout is shown, and the end waits only for what remains', async () => {
    const cli = build(
      notice(() => new Promise<string | undefined>((resolve) => setTimeout(() => resolve('2.4.0'), 1000))),
    );
    let settled = false;
    const result = cli.run(['hello'], { updateCheck: terminal() }).then((code) => ((settled = true), code));

    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    expect(events).toEqual(['stdout:hello output\n', 'command']);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe(EXIT.OK);
    expect(events).toEqual(['stdout:hello output\n', 'command', `stderr:${NOTICE}`]);
  });

  it('a command longer than the timeout does not wait at all at its end, and a fetch that finished during it is shown', async () => {
    const cli = build(
      notice(() => new Promise<string | undefined>((resolve) => setTimeout(() => resolve('2.4.0'), 1000))),
    );

    const result = cli.run(['slow'], { updateCheck: terminal() });
    await vi.advanceTimersByTimeAsync(2000);

    // Settled at the moment the command ended: no extra timer was needed.
    expect(await result).toBe(EXIT.OK);
    expect(events).toEqual(['command:start', 'stdout:slow output\n', 'command:end', `stderr:${NOTICE}`]);
  });

  it('a command longer than the timeout drops a fetch that had not answered by the deadline, without waiting', async () => {
    const cli = build(
      notice(() => new Promise<string | undefined>((resolve) => setTimeout(() => resolve('2.4.0'), 5000))),
    );

    const result = cli.run(['slow'], { updateCheck: terminal() });
    await vi.advanceTimersByTimeAsync(2000);

    expect(await result).toBe(EXIT.OK);
    expect(events).toEqual(['command:start', 'stdout:slow output\n', 'command:end']);
  });

  it('a timed-out check is recorded, so the next run within the interval does not fetch again', async () => {
    const latestVersion = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const cli = build(notice(latestVersion));

    await runToEnd(cli, ['hello'], 1500);
    await runToEnd(cli, ['hello'], 1500);

    expect(latestVersion).toHaveBeenCalledTimes(1);
  });
});

describe('run(): the interactive TUI', () => {
  const tuiTty = { stdout: { isTTY: true }, stdin: { isTTY: true }, env: { TERM: 'xterm-256color' } };

  it('shows the notice once, at exit, after the UI has returned', async () => {
    const cli = build(notice(async () => '2.4.0'));
    const startTui = vi.fn(async () => {
      events.push('tui:mounted');
      return EXIT.OK;
    });

    const code = await cli.run([], { tty: tuiTty, startTui, updateCheck: terminal() });

    expect(code).toBe(EXIT.OK);
    expect(startTui).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['tui:mounted', `stderr:${NOTICE}`]);
  });

  it('keeps the UI\'s exit code', async () => {
    const cli = build(notice(async () => '2.4.0'));
    const code = await cli.run([], { tty: tuiTty, startTui: async () => 7, updateCheck: terminal() });
    expect(code).toBe(7);
  });

  it('prints nothing for the UI when CI is set or the opt-out is on', async () => {
    const latestVersion = vi.fn(async () => '2.4.0');
    const cli = build(notice(latestVersion));
    await cli.run([], { tty: tuiTty, startTui: async () => EXIT.OK, updateCheck: terminal({ env: { APPCTL_NO_UPDATE_CHECK: '1' } }) });
    await cli.run([], { tty: tuiTty, startTui: async () => EXIT.OK, updateCheck: terminal({ env: { CI: '1' } }) });
    expect(latestVersion).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

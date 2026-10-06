import { registerCliCommand } from '@marinoscar/platform-cli/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXIT } from './errors.js';
import { resetPlatformRegistrationsForTests } from './platform-host/register.js';
import { buildProgram, run } from './program.js';

// =============================================================================
// App commands added through registerCliCommand  (PP-4.5, #706)
// =============================================================================
//
// The reference use of the CLI command extension point: an app registers a
// command from its own code, and the CLI shows it after every built-in, runs
// it through the same `run()`, and maps its failure to a non-zero exit.
// =============================================================================

/** The built-in commands, in the order `buildProgram` documents. */
const BUILT_INS = ['init', 'login', 'api', 'config', 'node', 'deploy'];

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  resetPlatformRegistrationsForTests();
});

function written(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

/** Command names in the order `--help` lists them, commander's `help` excluded. */
function helpCommandOrder(help: string): string[] {
  const section = help.split(/^Commands:$/m)[1] ?? '';
  return [...section.matchAll(/^ {2}([a-z][\w-]*)/gm)]
    .map((match) => match[1] as string)
    .filter((name) => name !== 'help');
}

describe('registerCliCommand in the reference CLI', () => {
  it('lists the built-ins in the documented order when no app command is registered', async () => {
    expect(await run(['--help'])).toBe(EXIT.OK);
    expect(helpCommandOrder(written(stdoutSpy))).toEqual(BUILT_INS);
  });

  it('shows an app command last in --help, after every built-in', async () => {
    registerCliCommand((program) => program.command('hello').description('Say hello').action(() => undefined));

    expect(await run(['--help'])).toBe(EXIT.OK);
    expect(helpCommandOrder(written(stdoutSpy))).toEqual([...BUILT_INS, 'hello']);
  });

  it('runs an app command and exits 0', async () => {
    const action = vi.fn();
    registerCliCommand((program) => program.command('hello').argument('<who>').action(action));

    expect(await run(['hello', 'world'])).toBe(EXIT.OK);
    expect(action).toHaveBeenCalledWith('world', expect.anything(), expect.anything());
  });

  it('maps a throwing app command to a non-zero exit, with the message on stderr', async () => {
    registerCliCommand((program) =>
      program.command('hello').action(() => {
        throw new Error('hello failed');
      }),
    );

    const code = await run(['hello']);
    expect(code).not.toBe(EXIT.OK);
    expect(code).toBe(EXIT.FAILURE);
    expect(written(stderrSpy)).toContain('hello failed');
    expect(written(stdoutSpy)).toBe('');
  });

  it('refuses an app command named like a built-in', async () => {
    registerCliCommand((program) => program.command('deploy'));

    expect(() => buildProgram()).toThrow(/cannot be named "deploy": that name is already a built-in command/);
    // Through run(): a one-line message and a non-zero exit, not a rejection.
    expect(await run(['--help'])).toBe(EXIT.FAILURE);
    expect(written(stderrSpy)).toContain('cannot be named "deploy"');
  });
});

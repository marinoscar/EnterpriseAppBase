import { registerCliCommand } from '@marinoscar/platform-cli/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXIT } from '../../errors.js';
import { buildProgram, run } from '../../program.js';
import { resetPlatformRegistrationsForTests } from '../register.js';
import { helloCommand } from './hello.command.js';

// =============================================================================
// The registerCliCommand example (PP-4.6)
// =============================================================================
//
// `helloCommand` is the reference app's worked example of the CLI command
// registry. It is compiled and tested here but never registered by
// `platform-host/register.ts`, so the CLI's `--help` is unchanged.
// =============================================================================

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

const written = (spy: ReturnType<typeof vi.spyOn>): string => spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');

describe('helloCommand', () => {
  it('is not part of the shipped CLI: `appctl --help` does not list it', async () => {
    expect(await run(['--help'])).toBe(EXIT.OK);
    expect(written(stdoutSpy)).not.toMatch(/^ {2}hello\b/m);
    expect(buildProgram().commands.map((command) => command.name())).not.toContain('hello');
  });

  it('is listed after every built-in once registered', async () => {
    registerCliCommand(helloCommand);

    const names = buildProgram().commands.map((command) => command.name());
    expect(names.at(-1)).toBe('hello');
    expect(names.slice(0, -1)).toEqual(['init', 'login', 'api', 'config', 'node', 'deploy']);
  });

  it('greets the world by default and the named person when given one, exiting 0', async () => {
    registerCliCommand(helloCommand);

    expect(await run(['hello'])).toBe(EXIT.OK);
    expect(await run(['hello', 'Ada'])).toBe(EXIT.OK);
    expect(written(stdoutSpy)).toBe('Hello, world!\nHello, Ada!\n');
    expect(written(stderrSpy)).toBe('');
  });
});

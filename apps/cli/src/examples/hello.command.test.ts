import { EXIT, createCli } from '@marinoscar/platform-cli';
import { registerCliCommand } from '@marinoscar/platform-cli/core';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { helloCommand } from './hello.command.js';

// =============================================================================
// The registerCliCommand example (PP-4.6, #715)
// =============================================================================
//
// `helloCommand` is the reference app's worked example of the CLI command
// registry. It is compiled and tested here but not wired into `app.ts`, so
// the CLI's `--help` is unchanged.
// =============================================================================

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCliForTests();
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  resetCliForTests();
});

const written = (spy: ReturnType<typeof vi.spyOn>): string => spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
const BUILT_INS = ['init', 'login', 'api', 'config', 'node', 'deploy'];

describe('helloCommand', () => {
  it('is not part of the shipped CLI: `appctl --help` does not list it', async () => {
    const cli = createCli(APP_CLI_OPTIONS);
    expect(await cli.run(['--help'])).toBe(EXIT.OK);
    expect(written(stdoutSpy)).not.toMatch(/^ {2}hello\b/m);
    expect(cli.program.commands.map((command) => command.name())).not.toContain('hello');
  });

  it('is listed in help after every built-in once passed in extraCommands', async () => {
    const cli = createCli({ ...APP_CLI_OPTIONS, extraCommands: [helloCommand] });
    expect(cli.program.commands.map((command) => command.name())).toEqual([...BUILT_INS, 'hello']);
    expect(await cli.run(['--help'])).toBe(EXIT.OK);
    expect(written(stdoutSpy)).toMatch(/^ {2}hello \[who\]/m);
  });

  it('is the same CLI when registered with registerCliCommand instead', () => {
    registerCliCommand(helloCommand);
    const cli = createCli(APP_CLI_OPTIONS);
    expect(cli.program.commands.map((command) => command.name())).toEqual([...BUILT_INS, 'hello']);
  });

  it('greets the world by default and the named person when given one, exiting 0', async () => {
    const cli = createCli({ ...APP_CLI_OPTIONS, extraCommands: [helloCommand] });

    expect(await cli.run(['hello'])).toBe(EXIT.OK);
    expect(await cli.run(['hello', 'Ada'])).toBe(EXIT.OK);
    expect(written(stdoutSpy)).toBe('Hello, world!\nHello, Ada!\n');
    expect(written(stderrSpy)).toBe('');
  });
});

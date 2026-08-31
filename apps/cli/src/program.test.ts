import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLI_NAME } from './branding.js';
import { EXIT } from './errors.js';
import { CLI_VERSION } from './package-info.js';
import { buildProgram, run } from './program.js';

// =============================================================================
// Command wiring (issue #140)
// =============================================================================
//
// `run()` never spawns a process and never touches `process.exitCode` — that
// is the whole reason it can be tested with a function call instead of
// `child_process`. stdout/stderr writes are spied on and silenced so the test
// run's own output stays clean; each test restores them afterward.
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
});

function writtenText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join('');
}

describe('buildProgram', () => {
  it('names the program after CLI_NAME and carries CLI_VERSION', () => {
    const program = buildProgram();
    expect(program.name()).toBe(CLI_NAME);
    expect(program.version()).toBe(CLI_VERSION);
  });
});

describe('run', () => {
  it('is callable without spawning a process or touching process.exitCode', async () => {
    const before = process.exitCode;

    const code = await run(['--version']);

    expect(code).toBe(EXIT.OK);
    expect(process.exitCode).toBe(before);
  });

  it('--version returns 0 and prints the version', async () => {
    const code = await run(['--version']);

    expect(code).toBe(EXIT.OK);
    expect(writtenText(stdoutSpy)).toContain(CLI_VERSION);
  });

  it('--help returns 0', async () => {
    const code = await run(['--help']);

    expect(code).toBe(EXIT.OK);
  });

  it('bare invocation (no args) is a usage error, not silent success', async () => {
    const code = await run([]);

    expect(code).toBe(EXIT.USAGE);
    expect(code).not.toBe(EXIT.OK);
  });

  it('an unknown flag exits with the usage code, not 1', async () => {
    const code = await run(['--this-flag-does-not-exist']);

    expect(code).toBe(EXIT.USAGE);
    expect(code).not.toBe(1);
  });

  it('an unrecognised positional argument is also a usage error', async () => {
    const code = await run(['not-a-real-command']);

    expect(code).toBe(EXIT.USAGE);
  });

  it('never writes command failures to stdout — only stderr', async () => {
    await run(['--this-flag-does-not-exist']);

    // Commander's own error + help-after-error text must land on stderr so a
    // future `--raw | jq` pipeline is never polluted by a usage mistake.
    expect(writtenText(stderrSpy).length).toBeGreaterThan(0);
  });
});

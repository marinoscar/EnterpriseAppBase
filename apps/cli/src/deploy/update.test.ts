import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PreconditionError } from '../errors.js';
import { DATABASE_DEFERRED_CHECKS, DATABASE_GATE_CHECKS } from './database.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import { NotInstalledError } from './state.js';
import { buildUpdateSteps, runUpdate } from './update.js';

describe('the update pipeline', () => {
  const steps = buildUpdateSteps();
  const ids = steps.map((step) => step.id);

  it('looks for a new revision before it changes anything', () => {
    expect(ids).toEqual([
      'preflight',
      'fetch',
      'environment-drift',
      'ensure-database',
      'build',
      'migrate',
      'seed',
      'restart',
      'health',
      'publish',
      'renewal',
      'verify',
    ]);
  });

  function skipReason(id: string, context: Record<string, unknown>): string | undefined {
    return steps.find((step) => step.id === id)?.skip?.(context as never);
  }

  it('stands every later step down when the revision has not moved', () => {
    // Several minutes of build and a restart for a no-op is exactly the
    // friction that stops people updating often.
    for (const id of [
      'ensure-database',
      'build',
      'migrate',
      'seed',
      'restart',
      'health',
      'publish',
      'renewal',
      'verify',
    ]) {
      expect(skipReason(id, { unchanged: true, options: {}, state: {} })).toBe(
        'already up to date',
      );
    }
  });

  it('still runs the fetch step when unchanged, since that is what decides', () => {
    expect(skipReason('fetch', { unchanged: true, options: {}, state: {} })).toBeUndefined();
  });

  it('re-seeds by default', () => {
    // The only way permissions added by a new release reach an existing
    // deployment; without it the feature ships and the permission does not.
    expect(skipReason('seed', { options: {}, state: {} })).toBeUndefined();
  });

  it('honours --skip-seed', () => {
    expect(skipReason('seed', { options: { skipSeed: true }, state: {} })).toContain(
      '--skip-seed',
    );
  });

  it('skips publishing for a deployment that was never published', () => {
    expect(skipReason('publish', { options: {}, state: {} })).toContain('not published');
  });

  it('honours --skip-proxy', () => {
    expect(
      skipReason('publish', { options: { skipProxy: true }, state: { domain: 'x' } }),
    ).toContain('--skip-proxy');
    expect(
      skipReason('renewal', { options: { skipProxy: true }, state: { domain: 'x' } }),
    ).toContain('--skip-proxy');
  });

  it('checks renewal on every update, and honours --skip-renewal', () => {
    // A deployment installed before renewal existed has no schedule at all,
    // and a central script removed since take-over is exactly the state nobody
    // notices. The owner probe is cheap and almost always says "stand down".
    expect(skipReason('renewal', { options: {}, state: { domain: 'x' } })).toBeUndefined();
    expect(
      skipReason('renewal', { options: { skipRenewal: true }, state: { domain: 'x' } }),
    ).toContain('--skip-renewal');
  });

  it('does not check renewal for a deployment that was never published', () => {
    expect(skipReason('renewal', { options: {}, state: {} })).toContain('not published');
  });
});

describe('runUpdate preconditions', () => {
  it('refuses to run when nothing is installed, naming install', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'appctl-noinstall-'));

    const error = await runUpdate({ deployRoot: empty }).catch((caught: unknown) => caught);

    // The precondition install does not have, and the reason this is its own
    // command rather than a flag: the guards are opposite.
    expect(error).toBeInstanceOf(NotInstalledError);
    expect((error as Error).message).toContain('deploy install');
  });
});

// =============================================================================
// Update's own ensure-database  (issue #396)
// =============================================================================

/** A psql fake: `appdb` is absent until a CREATE DATABASE is issued. */
function postgres(): {
  runCommand: typeof import('./executor.js').runCommand;
  statements: string[];
} {
  const statements: string[] = [];
  let created = false;

  const runCommand = (async (
    argv: readonly string[],
    options: RunCommandOptions,
  ): Promise<CommandResult> => {
    const statement = argv.at(-1) ?? '';
    statements.push(statement);
    const result: CommandResult = {
      argv: [...argv],
      cwd: options.cwd,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
    };

    if (statement.startsWith('CREATE DATABASE')) {
      created = true;
      return { ...result, stdout: 'CREATE DATABASE' };
    }
    if (statement.includes('has_schema_privilege')) return { ...result, stdout: 't' };
    if (argv[argv.indexOf('-d') + 1] === 'appdb' && !created) {
      const failed = {
        ...result,
        exitCode: 1,
        stderr: 'psql: error: FATAL:  database "appdb" does not exist',
      };
      throw new CommandFailedError(failed.stderr, failed);
    }
    return { ...result, stdout: '1' };
  }) as typeof import('./executor.js').runCommand;

  return { runCommand, statements };
}

async function updateHarness(
  options: Record<string, unknown>,
  runCommand: typeof import('./executor.js').runCommand,
): Promise<{ context: Record<string, unknown>; lines: string[]; close: () => void }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const lines: string[] = [];

  return {
    lines,
    close: () => server.close(),
    context: {
      options: { deployRoot: '/opt/infra/apps/demo', ...options },
      runCommand,
      state: { bindPort: 3535 },
      env: new Map([
        ['POSTGRES_HOST', '127.0.0.1'],
        ['POSTGRES_PORT', String(port)],
        ['POSTGRES_USER', 'appuser'],
        ['POSTGRES_PASSWORD', 'p4ssword'],
        ['POSTGRES_DB', 'appdb'],
      ]),
      journal: {
        line: (line: string) => lines.push(line),
        addSecrets: () => undefined,
        command: () => undefined,
        redact: (text: string) => text,
      },
      completed: new Set<string>(),
    },
  };
}

async function runUpdateStep(
  id: string,
  context: Record<string, unknown>,
): Promise<unknown> {
  const step = buildUpdateSteps().find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return await (step as unknown as { run(value: unknown): Promise<void> })
    .run(context)
    .then(() => undefined)
    .catch((error: unknown) => error);
}

describe("update's preflight", () => {
  it('asks no database question at all, so it cannot dead-end on one', async () => {
    // Unlike install's, this preflight is the five host essentials. There is
    // nothing here to defer: the database is probed by `ensure-database`,
    // which is also the step that can act on the answer.
    const asked: string[] = [];
    const runCommand = (async (
      argv: readonly string[],
      options: RunCommandOptions,
    ): Promise<CommandResult> => {
      asked.push(argv.join(' '));
      return {
        argv: [...argv],
        cwd: options.cwd,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
        timedOut: false,
      };
    }) as typeof import('./executor.js').runCommand;

    const { context, lines } = await updateHarness({}, runCommand);
    await runUpdateStep('preflight', context);

    for (const id of [...DATABASE_GATE_CHECKS, ...DATABASE_DEFERRED_CHECKS]) {
      expect(lines.join('\n')).not.toContain(id);
    }
    expect(asked.join(' ')).not.toContain('psql');
  });
});

describe("update's ensure-database", () => {
  it('creates a database that has gone missing, then re-verifies it', async () => {
    const pg = postgres();
    const { context, lines, close } = await updateHarness(
      { createDatabase: true },
      pg.runCommand,
    );

    try {
      expect(await runUpdateStep('ensure-database', context)).toBeUndefined();
      expect(pg.statements).toContain('CREATE DATABASE "appdb"');
      expect(lines.join('\n')).toContain('database-privileges');
      expect(lines.join('\n')).toContain('can create tables');
    } finally {
      close();
    }
  });

  it('refuses unattended with no --create-database rather than prompting', async () => {
    const pg = postgres();
    const { context, close } = await updateHarness({ nonInteractive: true }, pg.runCommand);

    try {
      const error = await runUpdateStep('ensure-database', context);
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as Error).message).toContain('--create-database');
      expect(pg.statements.join(' ')).not.toContain('CREATE DATABASE');
    } finally {
      close();
    }
  });
});

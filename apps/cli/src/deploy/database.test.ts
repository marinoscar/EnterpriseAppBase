import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import type { CompletedCheck } from './checks/index.js';
import {
  assertValidDatabaseName,
  classifyDatabase,
  ensureDatabase,
  isValidDatabaseName,
  quoteIdentifier,
} from './database.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';

const PASSWORD = 'correct horse battery staple';

const ENV = new Map([
  ['POSTGRES_HOST', 'db.internal'],
  ['POSTGRES_PORT', '5432'],
  ['POSTGRES_USER', 'appuser'],
  ['POSTGRES_PASSWORD', PASSWORD],
  ['POSTGRES_DB', 'appdb'],
]);

type Canned = { exitCode: number; stdout?: string; stderr?: string };

interface Recorder {
  runCommand: typeof import('./executor.js').runCommand;
  calls: Array<{ argv: string[]; env: NodeJS.ProcessEnv | undefined }>;
}

function recorder(respond: () => Canned = () => ({ exitCode: 0, stdout: 'CREATE DATABASE' })): Recorder {
  const calls: Array<{ argv: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  const runCommand = (async (
    argv: readonly string[],
    options: RunCommandOptions,
  ): Promise<CommandResult> => {
    calls.push({ argv: [...argv], env: options.env });
    const canned = respond();
    const result: CommandResult = {
      argv: [...argv],
      cwd: options.cwd,
      exitCode: canned.exitCode,
      stdout: canned.stdout ?? '',
      stderr: canned.stderr ?? '',
      durationMs: 1,
      timedOut: false,
    };
    if (result.exitCode !== 0) throw new CommandFailedError(result.stderr || 'failed', result);
    return result;
  }) as typeof import('./executor.js').runCommand;

  return { runCommand, calls };
}

function check(id: string, status: CompletedCheck['status'], detail: string): CompletedCheck {
  return { id, title: id, severity: 'required', status, detail, durationMs: 1 };
}

describe('database names', () => {
  it('accepts a plain identifier', () => {
    for (const name of ['appdb', 'app_db', '_private', 'App2', 'a$b']) {
      expect(isValidDatabaseName(name)).toBe(true);
    }
  });

  it('rejects anything that would need quoting, escaping or a shell', () => {
    // CREATE DATABASE takes an identifier, not a bind parameter: there is no
    // placeholder to hide behind, so the answer is to REFUSE rather than to
    // escape. A name this tool cannot put in a connection string later is not
    // a name worth creating now.
    for (const name of [
      '',
      '1db',
      'app db',
      'app-db',
      'app;drop',
      'app"db',
      "app'db",
      'app\ndb',
      '--',
      'a'.repeat(64),
    ]) {
      expect(isValidDatabaseName(name)).toBe(false);
    }
  });

  it('throws a usage error naming the variable to fix', () => {
    const error = (() => {
      try {
        assertValidDatabaseName('app db');
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('POSTGRES_DB');
  });

  it('quotes the identifier so a keyword name is not a syntax error', () => {
    expect(quoteIdentifier('user')).toBe('"user"');
  });
});

describe('classifyDatabase', () => {
  it('reports `missing` only when the server answered and the credentials worked', () => {
    expect(
      classifyDatabase([
        check('database-reachable', 'pass', 'db.internal:5432'),
        check('database-credentials', 'pass', 'appuser authenticated'),
        check('database-exists', 'fail', 'database "appdb" does not exist'),
      ]),
    ).toBe('missing');
  });

  it('reports `blocked` when the server is unreachable', () => {
    // Creating a database is not the remedy for a refused connection, and
    // attempting it would replace a precise error with a vaguer one.
    expect(
      classifyDatabase([
        check('database-reachable', 'fail', 'connection refused'),
        check('database-credentials', 'skip', 'skipped'),
        check('database-exists', 'skip', 'skipped'),
      ]),
    ).toBe('blocked');
  });

  it('reports `blocked` for a failure that is not 3D000', () => {
    expect(
      classifyDatabase([
        check('database-reachable', 'pass', 'ok'),
        check('database-credentials', 'pass', 'ok'),
        check('database-exists', 'fail', 'permission denied for database appdb'),
      ]),
    ).toBe('blocked');
  });

  it('reports `ok` and `unknown` for the two quiet cases', () => {
    expect(classifyDatabase([check('database-exists', 'pass', 'appdb')])).toBe('ok');
    expect(
      classifyDatabase([check('database-exists', 'skip', 'no environment resolved yet')]),
    ).toBe('unknown');
  });
});

describe('ensureDatabase', () => {
  it('never puts the password in an argv, and passes it by name in the env', async () => {
    const { runCommand, calls } = recorder();

    await ensureDatabase({ runCommand, env: ENV, createDatabase: true });

    expect(calls).toHaveLength(1);
    const call = calls[0] as (typeof calls)[number];
    // The whole rule: -e PGPASSWORD names the variable, docker inherits the
    // value from this process's environment, and nothing that could be logged
    // ever holds it.
    expect(call.argv.join(' ')).not.toContain(PASSWORD);
    expect(call.argv).toContain('PGPASSWORD');
    expect(call.env?.['PGPASSWORD']).toBe(PASSWORD);
  });

  it('runs exactly one statement, and it is a quoted CREATE', async () => {
    const { runCommand, calls } = recorder();

    await ensureDatabase({ runCommand, env: ENV, createDatabase: true });

    const statement = (calls[0] as { argv: string[] }).argv.at(-1) ?? '';
    expect(statement).toBe('CREATE DATABASE "appdb"');
    // Nothing in this module may drop or alter anything.
    expect(statement).not.toMatch(/drop|alter/i);
  });

  it('connects to the maintenance database, not the one being created', async () => {
    const { runCommand, calls } = recorder();

    await ensureDatabase({ runCommand, env: ENV, createDatabase: true });

    const argv = (calls[0] as { argv: string[] }).argv;
    expect(argv[argv.indexOf('-d') + 1]).toBe('postgres');
  });

  it('refuses a name that is not a plain identifier, before asking anything', async () => {
    const { runCommand, calls } = recorder();
    let asked = false;

    const error = await ensureDatabase({
      runCommand,
      env: new Map([...ENV, ['POSTGRES_DB', 'app; drop database appdb']]),
      confirm: async () => {
        asked = true;
        return true;
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect(asked).toBe(false);
    expect(calls).toEqual([]);
  });

  it('creates nothing when the operator says the name is wrong', async () => {
    const { runCommand, calls } = recorder();

    const result = await ensureDatabase({ runCommand, env: ENV, confirm: async () => false });

    expect(result.outcome).toBe('declined');
    expect(calls).toEqual([]);
  });

  it('asks a question that distinguishes "not yet" from "wrong name"', async () => {
    const questions: string[] = [];
    await ensureDatabase({
      runCommand: recorder().runCommand,
      env: ENV,
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });

    // The reason this prompt exists at all: a typo in POSTGRES_DB would
    // otherwise create a second empty database that migrates and seeds
    // cleanly, and the operator's first evidence would be missing data.
    expect(questions[0]).toContain('POSTGRES_DB');
    expect(questions[0]).toContain('appdb');
  });

  it('refuses under --non-interactive without the flag, naming it', async () => {
    const error = await ensureDatabase({
      runCommand: recorder().runCommand,
      env: ENV,
      nonInteractive: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('--create-database');
  });

  it('treats a concurrent creation as success', async () => {
    const { runCommand } = recorder(() => ({
      exitCode: 1,
      stderr: 'ERROR:  database "appdb" already exists',
    }));

    const result = await ensureDatabase({ runCommand, env: ENV, createDatabase: true });
    expect(result.outcome).toBe('created');
  });

  it('explains a role that cannot create databases', async () => {
    const { runCommand } = recorder(() => ({
      exitCode: 1,
      stderr: 'ERROR:  permission denied to create database',
    }));

    const error = await ensureDatabase({
      runCommand,
      env: ENV,
      createDatabase: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('CREATEDB');
    expect((error as Error).message).not.toContain(PASSWORD);
  });
});

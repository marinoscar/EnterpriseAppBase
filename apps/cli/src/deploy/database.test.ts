import { describe, expect, it } from 'vitest';

import { PreconditionError, UsageError } from '../errors.js';
import type { CompletedCheck } from './checks/index.js';
import {
  assertCreatableDatabaseName,
  createDatabaseStatement,
  ensureDatabase,
  onlyDatabaseMissing,
} from './database.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions, type runCommand } from './executor.js';

const PASSWORD = 'the-database-password';

const ENV = new Map([
  ['POSTGRES_HOST', 'db.example.test'],
  ['POSTGRES_PORT', '5432'],
  ['POSTGRES_USER', 'appuser'],
  ['POSTGRES_PASSWORD', PASSWORD],
  ['POSTGRES_DB', 'appdb'],
]);

function completed(id: string, status: CompletedCheck['status'], detail = ''): CompletedCheck {
  return { id, title: id, status, detail, severity: 'required', durationMs: 0 };
}

const MISSING: CompletedCheck[] = [
  completed('database-reachable', 'pass'),
  completed('database-credentials', 'pass'),
  completed('database-exists', 'fail', 'database "appdb" does not exist'),
];

const EXISTS: CompletedCheck[] = [
  completed('database-reachable', 'pass'),
  completed('database-credentials', 'pass'),
  completed('database-exists', 'pass', 'appdb'),
];

interface Seen {
  argv: readonly string[];
  env: NodeJS.ProcessEnv | undefined;
}

/** Answers psql by the statement it carries (the argv's last element). */
function psqlFake(answer: (statement: string) => { ok: boolean; stdout?: string; stderr?: string }): {
  run: typeof runCommand;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const run = (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
    seen.push({ argv, env: options.env });
    const reply = answer(argv[argv.length - 1] ?? '');
    const result: CommandResult = {
      argv,
      cwd: options.cwd,
      exitCode: reply.ok ? 0 : 1,
      stdout: reply.stdout ?? '',
      stderr: reply.stderr ?? '',
      durationMs: 0,
      timedOut: false,
    };
    if (!reply.ok) throw new CommandFailedError(result.stderr, result);
    return result;
  }) as typeof runCommand;
  return { run, seen };
}

const CAN_CREATE = (statement: string) =>
  /rolcreatedb/.test(statement) ? { ok: true, stdout: 't' } : { ok: true, stdout: '1' };

function creates(seen: Seen[]): Seen[] {
  return seen.filter((call) => /CREATE DATABASE/.test(call.argv[call.argv.length - 1] ?? ''));
}

describe('the identifier rule', () => {
  it('accepts plain names and quotes them', () => {
    expect(createDatabaseStatement('appdb')).toBe('CREATE DATABASE "appdb"');
    expect(createDatabaseStatement('_App_2$')).toBe('CREATE DATABASE "_App_2$"');
  });

  it.each(['1app', 'app-db', 'app db', 'app"; DROP DATABASE x; --', '', 'a'.repeat(64)])(
    'refuses %j',
    (name) => {
      expect(() => assertCreatableDatabaseName(name)).toThrow(UsageError);
    },
  );
});

describe('onlyDatabaseMissing', () => {
  it('is true only when the missing database is the one required failure', () => {
    expect(onlyDatabaseMissing(MISSING)).toBe(true);
    expect(onlyDatabaseMissing(EXISTS)).toBe(false);
    expect(
      onlyDatabaseMissing([
        completed('database-reachable', 'pass'),
        completed('database-credentials', 'fail', 'password authentication failed for appuser'),
        completed('database-exists', 'skip'),
      ]),
    ).toBe(false);
  });
});

describe('ensureDatabase', () => {
  it('does nothing when the database exists', async () => {
    const { run, seen } = psqlFake(CAN_CREATE);
    const result = await ensureDatabase({ env: ENV, runCommand: run, check: async () => EXISTS });
    expect(result.outcome).toBe('exists');
    expect(seen).toEqual([]);
  });

  it('creates it with --create-database, against the maintenance database, password never in argv', async () => {
    const { run, seen } = psqlFake(CAN_CREATE);
    const result = await ensureDatabase({
      env: ENV,
      runCommand: run,
      createDatabase: true,
      nonInteractive: true,
      check: async () => MISSING,
    });

    expect(result.outcome).toBe('created');
    const [create] = creates(seen);
    expect(create?.argv[create.argv.length - 1]).toBe('CREATE DATABASE "appdb"');
    expect(create?.argv).toContain('postgres');
    expect(create?.env?.['PGPASSWORD']).toBe(PASSWORD);
    for (const call of seen) {
      expect(call.argv.join(' ')).not.toContain(PASSWORD);
      expect(call.argv.join(' ')).not.toMatch(/DROP|ALTER/i);
    }
  });

  it('asks when interactive, and creates only on yes', async () => {
    const yes = psqlFake(CAN_CREATE);
    const questions: string[] = [];
    await ensureDatabase({
      env: ENV,
      runCommand: yes.run,
      check: async () => MISSING,
      ask: async (question) => {
        questions.push(question);
        return true;
      },
    });
    expect(questions[0]).toContain('appdb');
    expect(creates(yes.seen)).toHaveLength(1);

    const no = psqlFake(CAN_CREATE);
    await expect(
      ensureDatabase({ env: ENV, runCommand: no.run, check: async () => MISSING, ask: async () => false }),
    ).rejects.toThrow(/declined/);
    expect(creates(no.seen)).toHaveLength(0);
  });

  it('refuses in a non-interactive run without the flag, naming it', async () => {
    const { run, seen } = psqlFake(CAN_CREATE);
    const error = await ensureDatabase({
      env: ENV,
      runCommand: run,
      nonInteractive: true,
      check: async () => MISSING,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('--create-database');
    expect(creates(seen)).toHaveLength(0);
  });

  it('fails with a remedy when the role cannot create databases', async () => {
    const { run, seen } = psqlFake((statement) =>
      /rolcreatedb/.test(statement) ? { ok: true, stdout: 'f' } : { ok: true },
    );
    const error = await ensureDatabase({
      env: ENV,
      runCommand: run,
      createDatabase: true,
      check: async () => MISSING,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toContain('CREATEDB');
    expect(creates(seen)).toHaveLength(0);
  });

  it('never acts on any other failure', async () => {
    const { run, seen } = psqlFake(CAN_CREATE);
    await expect(
      ensureDatabase({
        env: ENV,
        runCommand: run,
        createDatabase: true,
        check: async () => [
          completed('database-reachable', 'pass'),
          completed('database-credentials', 'fail', 'password authentication failed for appuser'),
          completed('database-exists', 'skip'),
        ],
      }),
    ).rejects.toThrow(/password authentication failed/);
    expect(seen).toEqual([]);
  });

  it('refuses a name outside the grammar before asking anything', async () => {
    const { run, seen } = psqlFake(CAN_CREATE);
    const asked: string[] = [];
    await expect(
      ensureDatabase({
        env: new Map([...ENV, ['POSTGRES_DB', 'app-db']]),
        runCommand: run,
        check: async () => MISSING,
        ask: async (question) => {
          asked.push(question);
          return true;
        },
      }),
    ).rejects.toThrow(UsageError);
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('treats a concurrent creation (42P04) as success', async () => {
    const { run } = psqlFake((statement) =>
      /CREATE DATABASE/.test(statement)
        ? { ok: false, stderr: 'ERROR:  database "appdb" already exists (42P04)' }
        : CAN_CREATE(statement),
    );
    const result = await ensureDatabase({ env: ENV, runCommand: run, createDatabase: true, check: async () => MISSING });
    expect(result.outcome).toBe('created');
  });
});

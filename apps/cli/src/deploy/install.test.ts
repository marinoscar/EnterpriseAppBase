import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { PreconditionError, UsageError } from '../errors.js';
import { ALL_CHECKS, requiredChecks } from './checks/index.js';
import { DATABASE_DEFERRED_CHECKS, DATABASE_GATE_CHECKS } from './database.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import {
  buildInstallSteps,
  composeArgv,
  composeCwd,
  defaultRootFor,
  preflightChecks,
  runInstall,
  secretsFrom,
  type InstallOptions,
} from './install.js';
import { DEPLOY_STATE_VERSION, writeState, type DeployState } from './state.js';

function installedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'appctl-install-'));
  const state: DeployState = {
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    bindPort: 3535,
    deployRoot: root,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-01T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
  };
  writeState(state);
  return root;
}

describe('the install pipeline', () => {
  const steps = buildInstallSteps();
  const ids = steps.map((step) => step.id);

  it('runs the steps in an order the deployment actually requires', () => {
    expect(ids).toEqual([
      'preflight',
      'checkout',
      'environment',
      'validate-environment',
      'ensure-database',
      'build',
      'migrate',
      'seed',
      'start',
      'health',
      'proxy-bootstrap',
      'publish',
      'renewal',
      'verify',
    ]);
  });

  it('creates the database before it migrates into it', () => {
    // And after the checks that decide whether it is missing at all: the step
    // acts on that verdict rather than re-deriving one of its own.
    expect(ids.indexOf('validate-environment')).toBeLessThan(ids.indexOf('ensure-database'));
    expect(ids.indexOf('ensure-database')).toBeLessThan(ids.indexOf('migrate'));
  });

  it('has a proxy to publish into before it publishes', () => {
    expect(ids.indexOf('proxy-bootstrap')).toBeLessThan(ids.indexOf('publish'));
  });

  it('schedules renewal after the certificate exists', () => {
    // Nothing to renew before `publish` has issued one.
    expect(ids.indexOf('publish')).toBeLessThan(ids.indexOf('renewal'));
  });

  it('checks prerequisites before it fetches anything', () => {
    // The whole point of a preflight: abort before the repository is cloned
    // and before .env is written.
    expect(ids.indexOf('preflight')).toBeLessThan(ids.indexOf('checkout'));
  });

  it('migrates before it starts the stack, and seeds after migrating', () => {
    expect(ids.indexOf('migrate')).toBeLessThan(ids.indexOf('start'));
    expect(ids.indexOf('migrate')).toBeLessThan(ids.indexOf('seed'));
  });

  it('publishes only after the API is known to be healthy', () => {
    // Issuing a certificate for a stack that never came up wastes rate limit.
    expect(ids.indexOf('health')).toBeLessThan(ids.indexOf('publish'));
  });

  function skipReasonFor(id: string, options: Record<string, unknown>): string | undefined {
    const step = steps.find((candidate) => candidate.id === id);
    // `databaseVerdict: 'missing'` so `ensure-database` is live by default,
    // the same way every other step is here.
    return step?.skip?.({ options, databaseVerdict: 'missing' } as never);
  }

  it('honours --skip-doctor, --skip-proxy, --skip-seed and --skip-renewal', () => {
    expect(skipReasonFor('preflight', { skipDoctor: true })).toContain('--skip-doctor');
    expect(skipReasonFor('seed', { skipSeed: true })).toContain('--skip-seed');
    expect(skipReasonFor('publish', { skipProxy: true, domain: 'x' })).toContain('--skip-proxy');
    expect(skipReasonFor('renewal', { skipRenewal: true, domain: 'x' })).toContain(
      '--skip-renewal',
    );
  });

  it('skips the proxy steps when there is no domain to publish under', () => {
    expect(skipReasonFor('publish', {})).toContain('no --domain');
    expect(skipReasonFor('proxy-bootstrap', {})).toContain('no --domain');
    expect(skipReasonFor('renewal', {})).toContain('no --domain');
  });

  it('skips creating a database that is already there', () => {
    // The step is gated on the verdict `validate-environment` recorded, so a
    // deployment pointing at an existing database never sees the question.
    const step = steps.find((candidate) => candidate.id === 'ensure-database');
    expect(step?.skip?.({ options: {}, databaseVerdict: 'ok' } as never)).toContain(
      'already exists',
    );
    expect(step?.skip?.({ options: {}, databaseVerdict: 'missing' } as never)).toBeUndefined();
    // A --resume that skipped `validate-environment` has no verdict, so the
    // step runs and asks for itself rather than assuming an answer from a
    // previous run that may be hours old.
    expect(step?.skip?.({ options: {} } as never)).toBeUndefined();
  });

  it('leaves an existing shared proxy alone', () => {
    // The rule the whole multi-app model rests on. The module re-checks too;
    // this is the pipeline reporting it as "nothing to do" rather than running
    // a step that decides to do nothing.
    const reason = skipReasonFor('proxy-bootstrap', {
      domain: 'app.example.test',
      proxyRoot: tmpdir(),
    });
    expect(reason).toContain('already exists');
  });

  it('does not skip anything by default', () => {
    for (const id of ids) {
      expect(
        skipReasonFor(id, {
          domain: 'app.example.test',
          // A path that does not exist, so the bootstrap step is live.
          proxyRoot: join(tmpdir(), 'appctl-no-such-proxy-root'),
        }),
      ).toBeUndefined();
    }
  });
});

describe('runInstall preconditions', () => {
  it('refuses to install over an existing deployment, pointing at update', async () => {
    const root = installedRoot();

    const error = await runInstall({
      deployRoot: root,
      bindPort: 3535,
      proxyRoot: '/tmp/proxy',
      domain: 'app.example.test',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('deploy update');
    expect((error as Error).message).toContain('--reinstall');
  });
});

describe('compose invocation', () => {
  it('layers base, prod and vps in that order', () => {
    // vps.compose.yml must come last: its `!override` on ports only replaces
    // what the earlier files declared if it is applied after them.
    expect(composeArgv(['up', '-d']).join(' ')).toBe(
      'docker compose -f base.compose.yml -f prod.compose.yml -f vps.compose.yml up -d',
    );
  });

  it('runs from the compose file directory', () => {
    // The relative build contexts (`../..`, `../nginx`) resolve against the
    // compose file's directory, so the working directory is not incidental.
    expect(composeCwd('/opt/infra/apps/demo')).toBe('/opt/infra/apps/demo/repo/infra/compose');
  });
});

describe('secretsFrom', () => {
  it('picks out exactly the values the journal must redact', () => {
    const env = new Map([
      ['POSTGRES_PASSWORD', 'p4ssword'],
      ['JWT_SECRET', 'jwt-secret-value'],
      ['POSTGRES_HOST', 'db.internal'],
      ['APP_URL', 'https://app.example.test'],
    ]);

    const secrets = secretsFrom(env).map((entry) => entry.key).sort();

    // Driven by the metadata registry rather than by a second guess at which
    // keys are sensitive.
    expect(secrets).toEqual(['JWT_SECRET', 'POSTGRES_PASSWORD']);
  });
});

describe('defaultRootFor', () => {
  it('derives the directory from the repository name, never a fixed one', () => {
    expect(defaultRootFor('https://example.test/o/MyApp.git', '/opt/infra/apps')).toBe(
      '/opt/infra/apps/myapp',
    );
  });
});


// =============================================================================
// The missing database no longer dead-ends the install  (issue #396)
// =============================================================================

const BASE: InstallOptions = {
  deployRoot: '/opt/infra/apps/demo',
  bindPort: 3535,
  proxyRoot: join(tmpdir(), 'appctl-no-such-proxy-root'),
};

function preflightIds(options: Partial<InstallOptions>): string[] {
  return preflightChecks({ ...BASE, ...options }).map((check) => check.id);
}

describe('the preflight check set', () => {
  it('defers the checks describing a database this run may create', () => {
    // The bug: `database-exists` is `required`, so a preflight that can see
    // the environment aborts at step one over precisely the condition step
    // five exists to fix. Deferred, exactly as the proxy bootstrap's checks
    // are, to the step that can act on it.
    for (const options of [{}, { createDatabase: true }, { nonInteractive: true, createDatabase: true }]) {
      const ids = preflightIds(options);
      for (const deferred of DATABASE_DEFERRED_CHECKS) {
        expect(ids).not.toContain(deferred);
      }
    }
  });

  it('keeps them when no creation will be offered, so nothing prompts unattended', () => {
    // `--non-interactive` with no `--create-database` still fails at the
    // preflight, before anything is cloned. That is the whole reason the
    // deferral is conditional.
    const ids = preflightIds({ nonInteractive: true });
    expect(ids).toContain('database-exists');
  });

  it('never defers "unreachable" or "wrong password", whatever it may create', () => {
    // Deferring these would blind the preflight to two failures creating a
    // database cannot remedy - and against which creating one is impossible.
    for (const options of [{}, { createDatabase: true }, { nonInteractive: true }]) {
      const ids = preflightIds(options);
      for (const gate of DATABASE_GATE_CHECKS) {
        expect(ids).toContain(gate);
      }
    }
  });

  it('leaves the registry alone, so doctor still fails on a missing database', () => {
    // The deferral is install's, not the check registry's: `doctor` answers
    // "is this server ready?" and the honest answer is still no.
    const required = requiredChecks(ALL_CHECKS).map((check) => check.id);
    expect(required).toContain('database-exists');
    expect(ALL_CHECKS.find((check) => check.id === 'database-exists')?.severity).toBe('required');
  });
});

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
    const database = argv[argv.indexOf('-d') + 1];
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
    if (database === 'appdb' && !created) {
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

/** A port something is listening on, and one nothing is. */
async function port(open: boolean): Promise<{ port: number; close: () => void }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = (server.address() as AddressInfo).port;
  if (!open) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return { port: value, close: () => undefined };
  }
  return { port: value, close: () => server.close() };
}

function environment(databasePort: number): Map<string, string> {
  return new Map([
    ['POSTGRES_HOST', '127.0.0.1'],
    ['POSTGRES_PORT', String(databasePort)],
    ['POSTGRES_USER', 'appuser'],
    ['POSTGRES_PASSWORD', 'p4ssword'],
    ['POSTGRES_DB', 'appdb'],
  ]);
}

interface StepHarness {
  context: Record<string, unknown>;
  lines: string[];
}

function harness(
  options: Partial<InstallOptions>,
  env: Map<string, string>,
  runCommand: typeof import('./executor.js').runCommand,
  extra: Record<string, unknown> = {},
): StepHarness {
  const lines: string[] = [];
  return {
    lines,
    context: {
      options: { ...BASE, ...options },
      runCommand,
      env,
      journal: {
        line: (line: string) => lines.push(line),
        addSecrets: () => undefined,
        command: () => undefined,
        redact: (text: string) => text,
      },
      completed: new Set<string>(),
      ...extra,
    },
  };
}

async function runStep(id: string, context: Record<string, unknown>): Promise<unknown> {
  const step = buildInstallSteps().find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return await (step as unknown as { run(value: unknown): Promise<void> })
    .run(context)
    .then(() => undefined)
    .catch((error: unknown) => error);
}

describe('validate-environment, against a database that is not there', () => {
  it('hands a missing database to ensure-database rather than failing', async () => {
    const listener = await port(true);
    try {
      const { context, lines } = harness(
        { createDatabase: true },
        environment(listener.port),
        postgres().runCommand,
      );

      expect(await runStep('validate-environment', context)).toBeUndefined();
      expect(context['databaseVerdict']).toBe('missing');
      expect(lines.join('\n')).toContain('ensure-database will offer to create it');
    } finally {
      listener.close();
    }
  });

  it('still fails unattended with no --create-database, naming the flag', async () => {
    const listener = await port(true);
    try {
      const { context } = harness(
        { nonInteractive: true },
        environment(listener.port),
        postgres().runCommand,
      );

      const error = await runStep('validate-environment', context);
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as Error).message).toContain('--create-database');
      // Before the build and before the migration: nothing was created.
      expect((error as Error).message).toContain('does not exist');
    } finally {
      listener.close();
    }
  });

  it('fails on an unreachable server even when it may create a database', async () => {
    // The deferral must not blind this: creating a database against a server
    // that will not answer is impossible, not merely inadvisable.
    const closed = await port(false);
    const { context } = harness(
      { createDatabase: true },
      environment(closed.port),
      postgres().runCommand,
    );

    const error = await runStep('validate-environment', context);
    expect(error).toBeInstanceOf(PreconditionError);
    expect((error as Error).message).toMatch(/connection refused|no response/i);
  });
});

describe('ensure-database, as a thin caller of offerDatabaseCreation', () => {
  it('creates the database and re-runs the checks the deferral held back', async () => {
    const listener = await port(true);
    try {
      const pg = postgres();
      const { context, lines } = harness(
        { createDatabase: true },
        environment(listener.port),
        pg.runCommand,
        { databaseVerdict: 'missing' },
      );

      expect(await runStep('ensure-database', context)).toBeUndefined();

      const log = lines.join('\n');
      expect(pg.statements).toContain('CREATE DATABASE "appdb"');
      // The answer an operator who has just created a database wants next,
      // rather than "skipped: database-exists did not pass".
      expect(log).toContain('pass database-exists: appdb');
      expect(log).toContain('database-privileges');
      expect(log).toContain('can create tables');
      expect(context['databaseVerdict']).toBe('ok');
    } finally {
      listener.close();
    }
  });

  it('stops when the operator says the name is wrong, naming POSTGRES_DB', async () => {
    const listener = await port(true);
    try {
      const pg = postgres();
      const terminal = scriptedTerminal(['n']);
      const { context } = harness(
        { promptContext: terminal.ctx },
        environment(listener.port),
        pg.runCommand,
        { databaseVerdict: 'missing' },
      );

      const error = await runStep('ensure-database', context);
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as Error).message).toContain('nothing to migrate into');
      expect((error as Error).message).toContain('POSTGRES_DB');
      // The path to edit, because "not yet" and "wrong name" look identical.
      expect((error as Error).message).toContain(composeCwd(BASE.deployRoot));
      expect(pg.statements.join(' ')).not.toContain('CREATE DATABASE');
    } finally {
      listener.close();
    }
  });

  it('creates without prompting for the TUI, which answers up front', async () => {
    // tui/screens/deploy.tsx passes `nonInteractive: true` (readline cannot
    // ask while ink holds stdin in raw mode) together with the answer it
    // collected as `createDatabase`. That pair must still reach the creation:
    // there is no TTY in a test run, so any attempt to prompt would throw.
    const listener = await port(true);
    try {
      const pg = postgres();
      const { context } = harness(
        { nonInteractive: true, createDatabase: true },
        environment(listener.port),
        pg.runCommand,
        { databaseVerdict: 'missing' },
      );

      expect(await runStep('ensure-database', context)).toBeUndefined();
      expect(pg.statements).toContain('CREATE DATABASE "appdb"');
      expect(context['databaseVerdict']).toBe('ok');
    } finally {
      listener.close();
    }
  });

  it('refuses unattended with no --create-database rather than prompting', async () => {
    const listener = await port(true);
    try {
      const pg = postgres();
      const { context } = harness(
        { nonInteractive: true },
        environment(listener.port),
        pg.runCommand,
        { databaseVerdict: 'missing' },
      );

      const error = await runStep('ensure-database', context);
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as Error).message).toContain('--create-database');
      expect(pg.statements.join(' ')).not.toContain('CREATE DATABASE');
    } finally {
      listener.close();
    }
  });
});

/** The scripted terminal prompt.test.ts and env-wizard.test.ts both use. */
function scriptedTerminal(answers: readonly string[]): {
  ctx: { input: NodeJS.ReadStream; output: NodeJS.WriteStream };
} {
  class FakeInput extends PassThrough {
    isTTY = true;
    setRawMode(): this {
      return this;
    }
  }
  class FakeOutput extends PassThrough {
    isTTY = true;
    onChunk: ((text: string) => void) | undefined;
    override write(chunk: unknown, ...rest: unknown[]): boolean {
      this.onChunk?.(String(chunk));
      return super.write(chunk as never, ...(rest as []));
    }
  }

  const input = new FakeInput();
  const output = new FakeOutput();
  const queue = [...answers];
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

  output.onChunk = (text: string): void => {
    const visible = text.replace(ANSI, '');
    if (visible === '' || visible.endsWith('\n') || !visible.endsWith(' ')) return;
    const answer = queue.shift();
    if (answer === undefined) return;
    setImmediate(() => input.write(`${answer}\n`));
  };

  return {
    ctx: {
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
    },
  };
}

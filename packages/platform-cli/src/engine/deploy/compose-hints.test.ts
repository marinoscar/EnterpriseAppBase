import { describe, expect, it } from 'vitest';

import { cliName } from '../identity.js';
import {
  composeMissingVariableHint,
  explainComposeFailure,
  missingComposeVariables,
} from './compose-hints.js';
import { CommandFailedError } from './executor.js';
import { collectHealth } from './health.js';
import { renderHealth } from '../commands/deploy.js';
import { isAlreadyDeployed } from './repo.js';

const ENV = '/srv/app/repo/infra/compose/.env';
const COMPOSE_OUTPUT =
  'required variable STACK_AGENT_TOKEN is missing a value: set STACK_AGENT_TOKEN in infra/compose/.env (appctl deploy generates it)';

function failed(message: string, stderr = ''): CommandFailedError {
  return new CommandFailedError(message, {
    argv: ['docker', 'compose', 'build'],
    cwd: '/srv/app',
    exitCode: 1,
    stdout: '',
    stderr,
    durationMs: 0,
    timedOut: false,
  });
}

describe('missingComposeVariables', () => {
  it('finds every variable once, in order', () => {
    expect(
      missingComposeVariables(
        `${COMPOSE_OUTPUT}\nrequired variable GREPTIME_ADMIN_PASSWORD is missing a value\n${COMPOSE_OUTPUT}`,
      ),
    ).toEqual(['STACK_AGENT_TOKEN', 'GREPTIME_ADMIN_PASSWORD']);
  });

  it('finds nothing in an unrelated failure', () => {
    expect(missingComposeVariables('pull access denied for example')).toEqual([]);
  });
});

describe('explainComposeFailure', () => {
  it('keeps the compose output and names the variable, both causes and the recovery command', () => {
    const original = failed(`\`docker compose build\` exited 1\n    ${COMPOSE_OUTPUT}`);

    const explained = explainComposeFailure(original, ENV) as CommandFailedError;

    expect(explained).toBeInstanceOf(CommandFailedError);
    expect(explained.result).toBe(original.result);
    expect(explained.message.startsWith(original.message)).toBe(true);
    expect(explained.message).toContain('STACK_AGENT_TOKEN');
    expect(explained.message).toMatch(/older than the revision being deployed/);
    expect(explained.message).toContain(`${ENV}`);
    expect(explained.message).toContain(`\`${cliName()} deploy update\``);
    expect(explained.message).toMatch(/updated separately from the application/);
  });

  it('reads the variable from stderr when the message does not carry it', () => {
    const explained = explainComposeFailure(failed('`docker compose up` exited 1', COMPOSE_OUTPUT), ENV);
    expect((explained as Error).message).toContain('STACK_AGENT_TOKEN');
  });

  it('is idempotent, so a re-thrown error does not collect the hint twice', () => {
    const once = explainComposeFailure(failed(COMPOSE_OUTPUT), ENV);
    expect(explainComposeFailure(once, ENV)).toBe(once);
  });

  it('returns any other error untouched', () => {
    const other = failed('pull access denied');
    expect(explainComposeFailure(other, ENV)).toBe(other);
    expect(explainComposeFailure('plain string', ENV)).toBe('plain string');
  });

  it('wraps a plain Error without a result', () => {
    const explained = explainComposeFailure(new Error(COMPOSE_OUTPUT), ENV) as Error;
    expect(explained.message).toContain('older than the revision');
    expect(explained.cause).toBeInstanceOf(Error);
  });

  it('pluralises for several variables', () => {
    expect(composeMissingVariableHint(['A', 'B'], ENV)).toContain('A, B have no value');
  });
});

describe('isAlreadyDeployed', () => {
  const sha = 'a'.repeat(40);

  it('is unchanged only when the checkout did not move and is at the deployed revision', () => {
    expect(isAlreadyDeployed({ sha, changed: false }, sha)).toBe(true);
    expect(isAlreadyDeployed({ sha, changed: true }, sha)).toBe(false);
    expect(isAlreadyDeployed({ sha, changed: false }, 'b'.repeat(40))).toBe(false);
  });

  it('falls back to "did not move" when no marker was recorded', () => {
    expect(isAlreadyDeployed({ sha, changed: false }, undefined)).toBe(true);
    expect(isAlreadyDeployed({ sha, changed: false }, '')).toBe(true);
    expect(isAlreadyDeployed({ sha, changed: true }, undefined)).toBe(false);
  });
});

describe('status when compose refuses over a required variable', () => {
  it('explains it under Containers instead of reporting only "none reported"', async () => {
    const report = await collectHealth({
      deployRoot: '/srv/app',
      bindPort: 1,
      runCommand: async (argv) => {
        if (argv.includes('ps')) throw failed(COMPOSE_OUTPUT);
        throw failed('unrelated');
      },
      fetch: async () => {
        throw new Error('down');
      },
      timeoutMs: 50,
    });

    expect(report.containers).toEqual([]);
    expect(report.composeProblem).toContain('older than the revision');

    const text = renderHealth(report, false, false);
    expect(text).toContain('none reported');
    expect(text).toContain('STACK_AGENT_TOKEN');
  });

  it('keeps "none reported" alone for any other compose failure', async () => {
    const report = await collectHealth({
      deployRoot: '/srv/app',
      bindPort: 1,
      runCommand: async () => {
        throw failed('daemon not running');
      },
      fetch: async () => {
        throw new Error('down');
      },
      timeoutMs: 50,
    });

    expect(report.composeProblem).toBeUndefined();
  });
});

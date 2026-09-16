import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import {
  buildInstallSteps,
  composeArgv,
  composeCwd,
  defaultRootFor,
  runInstall,
  secretsFrom,
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

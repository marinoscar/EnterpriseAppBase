import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import { runCommand } from './executor.js';
import {
  buildInstallSteps,
  composeArgv,
  composeCwd,
  defaultRootFor,
  runInstall,
  secretsFrom,
} from './install.js';
import { openJournal } from './journal.js';
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
      'build',
      'migrate',
      'seed',
      'start',
      'health',
      'publish',
      'verify',
    ]);
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
    return step?.skip?.({ options } as never);
  }

  it('honours --skip-doctor, --skip-proxy and --skip-seed', () => {
    expect(skipReasonFor('preflight', { skipDoctor: true })).toContain('--skip-doctor');
    expect(skipReasonFor('seed', { skipSeed: true })).toContain('--skip-seed');
    expect(skipReasonFor('publish', { skipProxy: true, domain: 'x' })).toContain('--skip-proxy');
  });

  it('skips publishing when there is no domain to publish under', () => {
    expect(skipReasonFor('publish', {})).toContain('no --domain');
  });

  it('does not skip anything by default', () => {
    for (const id of ids) {
      expect(skipReasonFor(id, { domain: 'app.example.test' })).toBeUndefined();
    }
  });
});

/** A root passing `isDeployment` (checkout + .env), but with no state file. */
function evidenceOnlyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'appctl-install-evidence-'));
  mkdirSync(join(root, 'repo', '.git'), { recursive: true });
  writeFileSync(join(root, '.env'), 'APP_BIND_PORT=3535\n');
  return root;
}

/** Refuses to run any subprocess; every check that touches it fails cleanly. */
const noSubprocessRunCommand: typeof runCommand = async () => {
  throw new Error('this test must not spawn a real subprocess');
};

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

  // ===========================================================================
  // The guard is EVIDENCE OR RECORD (install.ts, ~line 434). Before this it was
  // RECORD ONLY, so a deployment whose state file was lost - containers
  // running, certificate issued, site serving - was invisible to `install`,
  // which would proceed and clobber it: a fresh checkout over the live one, a
  // re-run wizard over the live `.env`. This is the mirror of the defect
  // `update` had, from the other side.
  // ===========================================================================
  it('refuses to install over a directory with a checkout and an .env but no deployment record', async () => {
    const root = evidenceOnlyRoot();

    const error = await runInstall({
      deployRoot: root,
      bindPort: 3535,
      proxyRoot: '/tmp/proxy',
      domain: 'app.example.test',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toContain('no deployment record');
    expect((error as Error).message).toContain('deploy update');
    expect((error as Error).message).toContain('--reinstall');
  });

  it('--reinstall bypasses the evidence-only guard and lets the pipeline start', async () => {
    const root = evidenceOnlyRoot();

    const error = await runInstall({
      deployRoot: root,
      bindPort: 3535,
      proxyRoot: '/tmp/proxy',
      domain: 'app.example.test',
      reinstall: true,
      runCommand: noSubprocessRunCommand,
    }).catch((caught: unknown) => caught);

    // The guard itself must not have fired: whatever failed next is the
    // *pipeline's* own PreconditionError (wrapped into a plain Error by
    // runInstall, same as every other pipeline failure), not the guard's
    // UsageError.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UsageError);
    const message = (error as Error).message;
    expect(message).not.toContain('no deployment record');
    expect(message).toContain('Check prerequisites failed');
  });

  it('--resume bypasses the evidence-only guard and lets the pipeline start', async () => {
    const root = evidenceOnlyRoot();

    const error = await runInstall({
      deployRoot: root,
      bindPort: 3535,
      proxyRoot: '/tmp/proxy',
      domain: 'app.example.test',
      resume: true,
      runCommand: noSubprocessRunCommand,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UsageError);
    const message = (error as Error).message;
    expect(message).not.toContain('no deployment record');
    expect(message).toContain('Check prerequisites failed');
  });

  it('--reinstall also bypasses the guard when a full deployment record is present', async () => {
    const root = installedRoot();

    const error = await runInstall({
      deployRoot: root,
      bindPort: 3535,
      proxyRoot: '/tmp/proxy',
      domain: 'app.example.test',
      reinstall: true,
      runCommand: noSubprocessRunCommand,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UsageError);
    const message = (error as Error).message;
    expect(message).not.toContain('deploy update');
    expect(message).toContain('Check prerequisites failed');
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
// The `environment` step: a blank answer must not beat an on-disk value (the
// secret-rotation guard). A re-install that overwrote JWT_SECRET, COOKIE_SECRET
// or SECRETS_ENCRYPTION_KEY with '' every time an operator left a field
// untouched would make every credential encrypted under the old key
// permanently undecryptable, with no visible symptom.
// =============================================================================
describe('the environment step: blank answers vs. an on-disk value', () => {
  const KNOWN_SECRET = 'on-disk-secret-that-is-plenty-long-enough-32ch';
  const NEW_SECRET = 'freshly-supplied-secret-also-plenty-long-enough';

  const runCommandStub: typeof runCommand = async () => {
    throw new Error('the environment step must not run any commands');
  };

  function environmentStep() {
    const step = buildInstallSteps().find((candidate) => candidate.id === 'environment');
    if (step === undefined) throw new Error('the "environment" step was removed or renamed');
    return step;
  }

  /** Seeds deployRoot/repo/infra/compose/.env.example and .env, the two files
   *  the environment step reads before it writes anything. */
  function seed(root: string, onDiskSecret: string): void {
    const dir = composeCwd(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/.env.example', 'JWT_SECRET=your-super-secret-key-min-32-characters-long\n');
    writeFileSync(dir + '/.env', `JWT_SECRET=${onDiskSecret}\n`);
  }

  function contextFor(root: string, answers: ReadonlyMap<string, string>) {
    return {
      options: {
        deployRoot: root,
        domain: 'app.example.test',
        bindPort: 3535,
        proxyRoot: '/tmp/proxy',
        nonInteractive: true,
        answers,
      },
      runCommand: runCommandStub,
      journal: openJournal({ deployRoot: root, command: 'install' }),
      hooks: undefined,
      completed: new Set<string>(),
      env: undefined as Map<string, string> | undefined,
    };
  }

  it('keeps the on-disk secret when the supplied answer is blank', async () => {
    const root = mkdtempSync(join(tmpdir(), 'appctl-env-step-'));
    seed(root, KNOWN_SECRET);

    const context = contextFor(root, new Map([['JWT_SECRET', '']]));
    await environmentStep().run(context as never);

    expect(context.env?.get('JWT_SECRET')).toBe(KNOWN_SECRET);
    const written = readFileSync(join(composeCwd(root), '.env'), 'utf8');
    expect(written).toContain(`JWT_SECRET=${KNOWN_SECRET}`);
    expect(written).not.toContain('JWT_SECRET=\n');
  });

  it('lets a genuinely supplied, non-blank answer win over the on-disk value', async () => {
    const root = mkdtempSync(join(tmpdir(), 'appctl-env-step-'));
    seed(root, KNOWN_SECRET);

    const context = contextFor(root, new Map([['JWT_SECRET', NEW_SECRET]]));
    await environmentStep().run(context as never);

    expect(context.env?.get('JWT_SECRET')).toBe(NEW_SECRET);
    const written = readFileSync(join(composeCwd(root), '.env'), 'utf8');
    expect(written).toContain(`JWT_SECRET=${NEW_SECRET}`);
    expect(written).not.toContain(KNOWN_SECRET);
  });
});

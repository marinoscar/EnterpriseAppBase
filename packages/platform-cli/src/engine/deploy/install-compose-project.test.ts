import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEnvExample } from './env-spec.js';
import { runInstall, type InstallOptions } from './install.js';
import { DEPLOY_STATE_VERSION, deployStatePath, readState, writeState, type DeployState } from './state.js';
import { createFakePostgres, postgresRoute, superRole } from './testing/fake-postgres.js';
import {
  createFakeVps,
  fakeGoogleFetch,
  listenForProbe,
  serveHealth,
  unattendedAnswers,
  type FakeRoute,
  type FakeVps,
} from './testing/fake-vps.js';

// =============================================================================
// What a FAILED install attempt may write down as the compose project  (#1015)
// =============================================================================
//
// `runInstall` writes the state file on failure too, so `--resume` knows what
// completed. It used to write the project it had been DRIVING the run with, and
// for a deployment that was already here that is the legacy `compose` assumed
// for a record naming none: a guess written down as if it were a record. Later
// runs then could not tell "the operator pinned compose" from "nothing was ever
// recorded", and a server running under an app-named project stayed driven as
// `compose`. Only a name THIS run chose is a record.
// =============================================================================

const TEMPLATE = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose', '.env.example'),
  'utf8',
);
const SPECS = parseEnvExample(TEMPLATE);
const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';

let probe: Awaited<ReturnType<typeof listenForProbe>>;
let api: Awaited<ReturnType<typeof serveHealth>>;
let ANSWERS: Map<string, string>;

beforeAll(async () => {
  probe = await listenForProbe();
  api = await serveHealth();
  ANSWERS = unattendedAnswers(
    SPECS,
    new Map([
      ['POSTGRES_HOST', '127.0.0.1'],
      ['POSTGRES_PORT', String(probe.port)],
      ['POSTGRES_USER', 'admin'],
      ['POSTGRES_PASSWORD', ADMIN_SECRET],
      ['POSTGRES_DB', 'appdb'],
    ]),
  );
});

afterAll(async () => {
  await probe.close();
  await api.close();
});

function install(vps: FakeVps, extra: Partial<InstallOptions> = {}) {
  return runInstall({
    deployRoot: vps.deployRoot,
    bindPort: api.port,
    proxyRoot: join(vps.appsRoot, 'proxy'),
    domain: 'app.example.test',
    repo: 'https://example.test/o/r',
    ref: 'main',
    runCommand: vps.runCommand,
    fetch: fakeGoogleFetch().fetch,
    answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)]]),
    nonInteractive: true,
    skipDoctor: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    allowSuperuser: true,
    ...extra,
  });
}

const FAIL_AT_CHECKOUT: readonly FakeRoute[] = [
  { match: ['git', 'fetch'], answer: { fail: new Error('fetch boom') } },
  { match: ['git', 'clone'], answer: { fail: new Error('clone boom') } },
];

/** A deployment that is already here: a checkout and an `.env`, and no state file. */
function existingDeployment(routes: readonly FakeRoute[] = FAIL_AT_CHECKOUT): FakeVps {
  return createFakeVps({
    envExample: TEMPLATE,
    withCheckout: true,
    files: { '.env': 'APP_BIND_PORT=3535\n' },
    routes,
  });
}

/** The state file as written, untouched by `readState`'s upgrade logic. */
const written = (vps: FakeVps): Record<string, unknown> =>
  JSON.parse(readFileSync(deployStatePath(vps.deployRoot), 'utf8')) as Record<string, unknown>;

/** A record as an earlier run left it; `composeProject` only where the test says. */
function recordOf(vps: FakeVps, overrides: Partial<DeployState> = {}): DeployState {
  return {
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    bindPort: 3535,
    deployRoot: vps.deployRoot,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
    ...overrides,
  } as DeployState;
}

describe('a FAILED install attempt', () => {
  it('records the project a FRESH install chose: its own folder name', async () => {
    const vps = createFakeVps({ envExample: TEMPLATE, routes: FAIL_AT_CHECKOUT });

    await expect(install(vps)).rejects.toThrow('failed');

    expect(written(vps)['composeProject']).toBe(basename(vps.deployRoot));
    expect(written(vps)['lastOutcome']).toBe('failure');
  });

  it('does NOT record `compose` for a deployment that was already here with no record', async () => {
    const vps = existingDeployment();

    await expect(install(vps, { reinstall: true })).rejects.toThrow('failed');

    const state = written(vps);
    expect(state['lastOutcome']).toBe('failure');
    expect(state['lastFailedStep']).toBe('checkout');
    expect(state).not.toHaveProperty('composeProject');
  });

  it('does NOT record `compose` for a record that names no project either', async () => {
    const vps = existingDeployment();
    writeState(recordOf(vps, { installedAt: '2026-02-02T00:00:00.000Z' }));

    await expect(install(vps, { reinstall: true })).rejects.toThrow('failed');

    const state = written(vps);
    expect(state).not.toHaveProperty('composeProject');
    // The rest of the record survives, as before.
    expect(state['installedAt']).toBe('2026-02-02T00:00:00.000Z');
    expect(state['lastOutcome']).toBe('failure');
  });

  it('keeps a project that is recorded, whatever it is', async () => {
    for (const project of ['myapp', 'compose']) {
      const vps = existingDeployment();
      writeState(recordOf(vps, { composeProject: project }));

      await expect(install(vps, { reinstall: true })).rejects.toThrow('failed');

      expect(written(vps)['composeProject']).toBe(project);
    }
  });

  it('keeps a failed --resume of an unrecorded deployment unrecorded too', async () => {
    const vps = existingDeployment();

    await expect(install(vps, { reinstall: true })).rejects.toThrow('failed');
    await expect(install(vps, { resume: true })).rejects.toThrow('failed');

    expect(written(vps)).not.toHaveProperty('composeProject');
  });
});

describe('a SUCCESSFUL install is unchanged', () => {
  function succeeding(): FakeVps {
    const postgres = createFakePostgres({ roles: { admin: superRole({ password: ADMIN_SECRET }) }, databases: ['appdb'] });
    return createFakeVps({
      envExample: TEMPLATE,
      routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
    });
  }

  it('records the folder name for a fresh install', async () => {
    const vps = succeeding();

    await install(vps);

    expect(readState(vps.deployRoot)?.composeProject).toBe(basename(vps.deployRoot));
    expect(written(vps)['lastOutcome']).toBe('success');
  });

  it('keeps the project a recorded deployment runs under on a reinstall', async () => {
    const vps = succeeding();
    await install(vps);
    writeState({ ...(readState(vps.deployRoot) as DeployState), composeProject: 'myapp' });
    mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });

    await install(vps, { reinstall: true });

    expect(readState(vps.deployRoot)?.composeProject).toBe('myapp');
  });

  it('records the project the run itself drove for a deployment with no record: `compose`', async () => {
    // Out of scope for #1015, pinned so a change to it is deliberate: on success the
    // record says what THIS run used, and install drives an unrecorded deployment as
    // `compose` (composeProjectFor). Only the failure path stopped writing a guess.
    const vps = succeeding();
    await install(vps);
    const state = { ...(readState(vps.deployRoot) as DeployState) };
    delete state.composeProject;
    writeState(state);
    mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });

    await install(vps, { reinstall: true });

    expect(readState(vps.deployRoot)?.composeProject).toBe('compose');
  });
});

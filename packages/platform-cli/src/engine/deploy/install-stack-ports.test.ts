import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeCwd } from './compose-command.js';
import { composeFilesFor } from './compose-files.js';
import { parseEnvExample } from './env-spec.js';
import { runInstall, type InstallOptions } from './install.js';
import { DEPLOY_STATE_VERSION, readState, writeState, type DeployState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';
import { createFakePostgres, postgresRoute, superRole } from './testing/fake-postgres.js';
import { createFakeVps, fakeGoogleFetch, listenForProbe, serveHealth, unattendedAnswers, type FakeVps } from './testing/fake-vps.js';

// =============================================================================
// `deploy install` asks about the stack's host ports before it builds or starts  (#1024)
// =============================================================================
//
// Install's preflight runs before there is a checkout or a `.env`, so the
// `stack-ports` step asks again once both exist. It is not a preflight check:
// `--skip-doctor` and `--resume` must not let a clashing port through to
// `start`, whose `up -d` would recreate a reinstalled stack and then die on it.
// =============================================================================

const INFRA = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose');
const TEMPLATE = readFileSync(join(INFRA, '.env.example'), 'utf8');
const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';
const PG = 14003;

/** The error a promise rejects with; a promise that resolves is a failed test. */
async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

let probe: Awaited<ReturnType<typeof listenForProbe>>;
let api: Awaited<ReturnType<typeof serveHealth>>;
let ANSWERS: Map<string, string>;

beforeAll(async () => {
  probe = await listenForProbe();
  api = await serveHealth();
  ANSWERS = unattendedAnswers(
    parseEnvExample(TEMPLATE),
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

const rendered = (): string => {
  const entry = (published: number, target: number) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published: String(published), protocol: 'tcp' });
  return JSON.stringify({ services: { nginx: { ports: [entry(api.port, 80)] }, greptimedb: { ports: [entry(PG, 4003)] } } });
};

/** A reinstall over a deployment (checkout, compose files, record) whose Docker holds 14003 under another project. */
function deployment(holder: 'foreign' | 'none'): FakeVps {
  const compose = Object.fromEntries(
    composeFilesFor(undefined, INFRA).map((name) => [`repo/infra/compose/${name}`, readFileSync(join(INFRA, name), 'utf8')]),
  );
  const postgres = createFakePostgres({ roles: { admin: superRole({ password: ADMIN_SECRET }) }, databases: ['appdb'] });
  const vps = createFakeVps({
    envExample: TEMPLATE,
    withCheckout: true,
    files: { ...compose, '.env': 'APP_BIND_PORT=3535\n' },
    routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
  });
  writeState({
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    bindPort: api.port,
    deployRoot: vps.deployRoot,
    composeProject: 'kvox',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
  } as DeployState);

  const containers = (): FakeContainer[] => [
    { project: 'kvox', workingDir: composeCwd(vps.deployRoot), name: 'kvox-nginx-1', ports: [{ hostIp: '127.0.0.1', port: api.port }] },
    ...(holder === 'none'
      ? []
      : [{ project: 'other', workingDir: '/opt/infra/apps/other/repo/infra/compose', name: 'other-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: PG }] }]),
  ];
  vps.route(['docker', 'ps', '-aq'], () => psOutput(containers()));
  vps.route(['docker', 'inspect', '--format'], () => inspectOutput(containers()));
  vps.route(
    ({ argv }) => argv[0] === 'docker' && argv[1] === 'compose' && argv.slice(-3).join(' ') === 'config --format json',
    () => rendered(),
  );
  return vps;
}

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
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    allowSuperuser: true,
    reinstall: true,
    ...extra,
  });
}

const mutations = (vps: FakeVps): string[][] =>
  vps
    .calls('docker', 'compose')
    .map((call) => [...call.argv])
    .filter((argv) => argv.some((word) => ['build', 'up', 'run', 'stop', 'start', 'restart', 'down'].includes(word)));

describe('install and the stack ports (#1024)', () => {
  it('stops at the stack-ports step, before build, migrate or start, when another stack holds 14003', async () => {
    const vps = deployment('foreign');

    const failure = await rejected(install(vps, { skipDoctor: true }));

    expect(failure.message).toContain('Check the ports the stack publishes failed');
    expect(failure.message).toContain('stack-ports-free');
    expect(failure.message).toContain('other-greptimedb-1');
    expect(failure.message).toContain('GREPTIME_BIND_PG_PORT');
    // The `.env` is final by then, and it is where the remedy points.
    expect(failure.message).toContain(`${composeCwd(vps.deployRoot)}/.env`);
    expect(mutations(vps)).toEqual([]);
    expect(readState(vps.deployRoot)?.lastFailedStep).toBe('stack-ports');
  });

  it('is not skipped by --skip-doctor (it is no doctor prerequisite) and is asked again by --resume', async () => {
    const first = deployment('foreign');
    await install(first, { skipDoctor: true }).catch(() => undefined);

    const state = readState(first.deployRoot);
    expect(state?.completedSteps).not.toContain('stack-ports');

    // A resume where an earlier run had finished the gate: the port may have been taken since.
    writeState({ ...(state as DeployState), completedSteps: ['preflight', 'checkout', 'environment', 'validate-environment', 'stack-ports'] });

    const failure = await rejected(install(first, { skipDoctor: true, resume: true, reinstall: false }));

    expect(failure.message).toContain('stack-ports-free');
    expect(mutations(first)).toEqual([]);
  });

  it('also fails the install PREFLIGHT when the checkout is already there and another stack holds a port', async () => {
    const vps = deployment('foreign');

    const failure = await rejected(install(vps, { skipDoctor: false }));

    expect(failure.message).toContain('Prerequisites not met');
    expect(failure.message).toContain('stack-ports-free');
    expect(readState(vps.deployRoot)?.lastFailedStep).toBe('preflight');
    expect(vps.calls('git', 'fetch')).toEqual([]);
  });

  it('installs when nothing else holds the ports, rendering the stack once the environment is written and before the build', async () => {
    const vps = deployment('none');

    await install(vps, { skipDoctor: true });

    const calls = vps.calls('docker', 'compose').map((call) => (call.argv.includes('config') ? 'config' : (call.argv.find((word) => ['build', 'up', 'run'].includes(word)) ?? 'other')));
    // --skip-doctor: the preflight is off, and the gate is the one (not skippable) question.
    expect(calls.filter((word) => word === 'config')).toHaveLength(1);
    expect(calls.lastIndexOf('config')).toBeLessThan(calls.indexOf('build'));
    expect(calls).toContain('up');
  });
});

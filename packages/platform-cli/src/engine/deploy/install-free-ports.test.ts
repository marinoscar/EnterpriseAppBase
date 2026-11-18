import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeCwd } from './compose-command.js';
import { composeFilesFor } from './compose-files.js';
import { parseEnvExample, parseEnvFile } from './env-spec.js';
import { runInstall, type InstallOptions } from './install.js';
import * as proxyModule from './proxy.js';
import { DEPLOY_STATE_VERSION, readState, writeState, type DeployState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';
import { createFakePostgres, postgresRoute, superRole } from './testing/fake-postgres.js';
import { createFakeVps, fakeGoogleFetch, listenForProbe, serveHealth, unattendedAnswers, type FakeVps } from './testing/fake-vps.js';

// Real behaviour preserved; only the certificate authority is stubbed, so the
// vhost the REAL `installVhost` writes can be read back.
vi.mock('./proxy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy.js')>();
  return { ...actual, issueCertificate: vi.fn(async () => ({ issued: false, path: '/nowhere/fullchain.pem' })) };
});

// =============================================================================
// `deploy install` picks free host ports instead of sharing the defaults  (#1027)
// =============================================================================
//
// Every app gets APP_BIND_PORT=3535 and GREPTIME_BIND_PG_PORT=14003 from the
// compose files, so the second app on a server collided with the first and
// `stack-ports-free` (#1024) stopped it, leaving a hand edit of `.env`. These
// run the REAL install pipeline against a fake Docker whose containers hold
// those ports, and prove the value the CLI WRITES is a free one, that every
// reader of the bind port sees the CHOSEN number, and that nothing already
// decided is moved. `docker compose config` is rendered FROM the `.env` the run
// wrote, so `stack-ports-free` is judging the real outcome.
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

const envOf = (vps: FakeVps): Map<string, string> => parseEnvFile(readFileSync(join(composeCwd(vps.deployRoot), '.env'), 'utf8'));

/** Compose as the run's own `.env` would render it: nginx on APP_BIND_PORT, greptimedb on GREPTIME_BIND_PG_PORT. */
function renderedFromEnv(vps: FakeVps): string {
  let env = new Map<string, string>();
  try {
    env = envOf(vps);
  } catch {
    // Before the environment is written the defaults render.
  }
  const entry = (published: string, target: number) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published, protocol: 'tcp' });
  return JSON.stringify({
    services: {
      nginx: { ports: [entry(env.get('APP_BIND_PORT') ?? '3535', 80)] },
      greptimedb: { ports: [entry(env.get('GREPTIME_BIND_PG_PORT') ?? String(PG), 4003)] },
    },
  });
}

interface Setup {
  /** Containers Docker knows (other apps'). */
  containers?: FakeContainer[];
  /** A deployment already here: its `.env` text, and a record. */
  existingEnv?: string;
}

function server(setup: Setup = {}): FakeVps {
  const compose = Object.fromEntries(
    composeFilesFor(undefined, INFRA).map((name) => [`repo/infra/compose/${name}`, readFileSync(join(INFRA, name), 'utf8')]),
  );
  const postgres = createFakePostgres({ roles: { admin: superRole({ password: ADMIN_SECRET }) }, databases: ['appdb'] });
  const existing = setup.existingEnv !== undefined;
  const vps = createFakeVps({
    envExample: TEMPLATE,
    withCheckout: existing,
    files: { ...compose, ...(existing ? { 'repo/infra/compose/.env': setup.existingEnv as string } : {}) },
    routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
  });
  if (existing) {
    writeState({
      version: DEPLOY_STATE_VERSION,
      repoUrl: 'https://example.test/o/r',
      ref: 'main',
      commitSha: 'a'.repeat(40),
      bindPort: api.port,
      deployRoot: vps.deployRoot,
      composeProject: 'app',
      installedAt: '2026-01-01T00:00:00.000Z',
      lastDeployedAt: '2026-01-02T00:00:00.000Z',
      lastCommand: 'install',
      appctlVersion: '1.0.0',
    } as DeployState);
  }

  const containers = setup.containers ?? [];
  vps.route(['docker', 'ps', '-aq'], () => psOutput(containers));
  vps.route(['docker', 'inspect', '--format'], () => inspectOutput(containers));
  vps.route(
    ({ argv }) => argv[0] === 'docker' && argv[1] === 'compose' && argv.slice(-3).join(' ') === 'config --format json',
    () => renderedFromEnv(vps),
  );
  return vps;
}

/** Another app on the server: its telemetry store on 127.0.0.1:14003, and its own web port. */
const evopath = (extra: Array<{ hostIp: string; port: number }> = []): FakeContainer => ({
  project: 'evopath',
  workingDir: '/opt/infra/apps/evopath/repo/infra/compose',
  name: 'evopath-greptimedb-1',
  ports: [{ hostIp: '127.0.0.1', port: PG }, ...extra],
});

/** Free-port decisions are made against the fake Docker; nothing on this machine is probed. */
const portFree = async (): Promise<boolean> => true;

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
    portFree,
    ...extra,
  });
}

/** Google as `fakeGoogleFetch` answers it, and the public domain (which the fake proxy cannot serve) as healthy. */
const fetchWithPublicDomain: typeof globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith('https://app.example.test') ? new Response('ok', { status: 200 }) : await fakeGoogleFetch().fetch(input, init);
};

const journalOf = (path: string): string => readFileSync(path, 'utf8');
const composeUps = (vps: FakeVps): number => vps.calls('docker', 'compose').filter((call) => call.argv.includes('up')).length;

describe('a fresh install beside another app (#1027)', () => {
  it('writes the next free telemetry port when another app holds 14003, names the holder, and passes stack-ports-free', async () => {
    const vps = server({ containers: [evopath()] });
    const progress: string[] = [];

    const result = await install(vps, { hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14004');
    const line = 'GREPTIME_BIND_PG_PORT=14004 (14003 is held by evopath-greptimedb-1)';
    expect(journalOf(result.journalPath)).toContain(line);
    expect(progress.some((message) => message.includes(line))).toBe(true);
    // The final guard judged the written file and let the stack come up.
    expect(journalOf(result.journalPath)).toMatch(/pass stack-ports-free/);
    expect(composeUps(vps)).toBe(1);
  });

  it('keeps the familiar defaults, and says nothing extra, on a server with no other app', async () => {
    const vps = server();
    const progress: string[] = [];

    const result = await install(vps, { hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
    expect(journalOf(result.journalPath)).not.toContain('Picked a free host port');
    expect(progress.filter((message) => message.includes('Picked a free host port'))).toEqual([]);
  });

  it('walks past a listener that is not Docker\'s, when the stack is rendered with the result', async () => {
    const vps = server({ containers: [evopath()] });

    await install(vps, { portFree: async (port) => port !== 14004 });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14005');
  });

  it('is probe-only when Docker cannot be asked, and still picks', async () => {
    const vps = server();
    vps.route(['docker', 'ps', '-aq'], { fail: new Error('Cannot connect to the Docker daemon') });

    await install(vps, { portFree: async (port) => port !== 14003 });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14004');
  });

  it('never overrides a port the operator answered', async () => {
    const vps = server({ containers: [evopath()] });

    // 14003 is held, but it was asked for: the stack-ports step reports it.
    const failure = await rejected(install(vps, { answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)], ['GREPTIME_BIND_PG_PORT', '14003']]) }));

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
    expect(failure.message).toContain('stack-ports-free');
    expect(failure.message).toContain('evopath-greptimedb-1');
    expect(composeUps(vps)).toBe(0);
  });
});

describe('the bind port of a fresh install without --port (#1027)', () => {
  // The fake health server listens on api.port, so the default is api.port - 1
  // and the pick lands on api.port: the one number the whole run can then answer on.
  const DEFAULT_PORT = (): number => api.port - 1;
  const foreignOnDefault = (): FakeContainer => ({
    project: 'evopath', workingDir: '/opt/infra/apps/evopath/repo/infra/compose', name: 'evopath-nginx-1', ports: [{ hostIp: '127.0.0.1', port: DEFAULT_PORT() }],
  });

  it('is chosen when the default is held, and every reader of the bind port uses the chosen value', async () => {
    const vps = server({ containers: [foreignOnDefault()] });
    const progress: string[] = [];

    const result = await install(vps, {
      bindPort: DEFAULT_PORT(),
      bindPortIsDefault: true,
      skipProxy: false,
      skipRenewal: true,
      skipOAuthCheck: true,
      fetch: fetchWithPublicDomain,
      proxyMode: 'container',
      proxyContainer: 'proxy-nginx',
      hooks: { onProgress: (message: string) => progress.push(message) },
    });

    const chosen = api.port;
    // .env, the written state, the info.json the health gate wrote...
    expect(envOf(vps).get('APP_BIND_PORT')).toBe(String(chosen));
    expect(readState(vps.deployRoot)?.bindPort).toBe(chosen);
    const info = JSON.parse(readFileSync(join(vps.deployRoot, 'deploy-info', 'info.json'), 'utf8')) as { bindPort?: number; proxy?: { bindPort?: number } };
    expect(info.bindPort).toBe(chosen);
    // ...the vhost the proxy forwards with...
    const vhostFile = readdirSync(join(vps.appsRoot, 'proxy'), { recursive: true, encoding: 'utf8' }).find((name) => name.endsWith('app.example.test.conf'));
    expect(vhostFile).toBeDefined();
    const vhost = readFileSync(join(vps.appsRoot, 'proxy', vhostFile as string), 'utf8');
    expect(vhost).toContain(`proxy_pass http://127.0.0.1:${chosen};`);
    expect(vhost).not.toContain(`127.0.0.1:${DEFAULT_PORT()};`);
    // ...the health probe (the run passed it, so it asked the chosen port), and the operator's next step.
    expect(result.nextStep).toContain('app.example.test');
    // Said once, with the holder named.
    const line = `APP_BIND_PORT=${chosen} (${DEFAULT_PORT()} is held by evopath-nginx-1)`;
    expect(progress.some((message) => message.includes(line))).toBe(true);
    expect(journalOf(result.journalPath)).toContain(line);
    expect(vi.mocked(proxyModule.issueCertificate).mock.calls.at(-1)?.[0]).toMatchObject({ bindPort: chosen });
  });

  it('keeps the default, and says nothing, when it is free', async () => {
    const vps = server();
    const progress: string[] = [];

    // The fake health server answers on api.port, so the "free default" is api.port itself.
    const result = await install(vps, { bindPortIsDefault: true, hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(envOf(vps).get('APP_BIND_PORT')).toBe(String(api.port));
    expect(readState(vps.deployRoot)?.bindPort).toBe(api.port);
    expect(journalOf(result.journalPath)).not.toContain('Picked a free host port');
  });

  it('is not chosen when --port was passed: a taken port still fails at preflight, as before', async () => {
    const vps = server({
      containers: [{ project: 'evopath', workingDir: '/opt/infra/apps/evopath/repo/infra/compose', name: 'evopath-nginx-1', ports: [{ hostIp: '127.0.0.1', port: api.port }] }],
    });

    const failure = await rejected(install(vps, { skipDoctor: false }));

    expect(failure.message).toContain('Prerequisites not met');
    expect(failure.message).toContain('bind-port-owner');
    expect(failure.message).toContain(`port ${api.port} is promised to evopath-nginx-1`);
    // Nothing moved: no environment, no checkout, no stack.
    expect(vps.calls('git', 'clone')).toEqual([]);
    expect(composeUps(vps)).toBe(0);
    expect(readState(vps.deployRoot)?.bindPort).toBe(api.port);
  });

  it('gives up with a clear error when no port above the default is free', async () => {
    const vps = server();

    const failure = await rejected(install(vps, { bindPort: 3535, bindPortIsDefault: true, portFree: async () => false }));

    expect(failure.message).toContain('No free host port for APP_BIND_PORT');
    expect(failure.message).toContain('from 3535 to 3734');
    expect(vps.calls('git', 'clone')).toEqual([]);
  });
});

describe('an install over a deployment that is already here (#1027)', () => {
  it('keeps the APP_BIND_PORT it wrote, even though the default was not asked for and is free', async () => {
    const vps = server({ existingEnv: `APP_BIND_PORT=${api.port}\nGREPTIME_BIND_PG_PORT=14009\n` });

    await install(vps, { bindPort: 3535, bindPortIsDefault: true, reinstall: true });

    expect(envOf(vps).get('APP_BIND_PORT')).toBe(String(api.port));
    expect(readState(vps.deployRoot)?.bindPort).toBe(api.port);
  });

  it('adds a free port only for the key the environment lacks, and never moves one it has', async () => {
    // The .env predates the telemetry key; another app holds 14003.
    const vps = server({ containers: [evopath()], existingEnv: `APP_BIND_PORT=${api.port}\n` });

    await install(vps, { reinstall: true });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14004');
    expect(envOf(vps).get('APP_BIND_PORT')).toBe(String(api.port));
  });

  it('does not let the preflight stop a reinstall over the key the environment lacks: the environment step is about to give it a free port', async () => {
    const vps = server({ containers: [evopath()], existingEnv: `APP_BIND_PORT=${api.port}\n` });

    // The fake server fails other prerequisites (DNS, git); what matters is that this one is not among them.
    const outcome = await install(vps, { reinstall: true, skipDoctor: false }).then(
      () => 'installed',
      (error: Error) => error.message,
    );

    expect(outcome).not.toContain('stack-ports-free');
  });

  it('does not move a telemetry port the environment already has, even when another app holds it', async () => {
    const vps = server({ containers: [evopath()], existingEnv: `APP_BIND_PORT=${api.port}\nGREPTIME_BIND_PG_PORT=14003\n` });

    const failure = await rejected(install(vps, { reinstall: true }));

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
    expect(failure.message).toContain('Check the ports the stack publishes failed');
    expect(failure.message).toContain('GREPTIME_BIND_PG_PORT');
    expect(composeUps(vps)).toBe(0);
  });

  it('counts the stack\'s own containers as its own: they do not push a reinstall off its ports', async () => {
    const own: FakeContainer = {
      project: 'app', workingDir: '/x', name: 'app-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: PG }],
    };
    const vps = server({ containers: [own], existingEnv: `APP_BIND_PORT=${api.port}\n` });

    await install(vps, { reinstall: true });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
  });
});

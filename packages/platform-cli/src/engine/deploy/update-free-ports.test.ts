import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeCwd } from './compose-command.js';
import { composeFilesFor } from './compose-files.js';
import { parseEnvExample, parseEnvFile } from './env-spec.js';
import { runInstall } from './install.js';
import { readState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';
import { createFakePostgres, postgresRoute, superRole } from './testing/fake-postgres.js';
import { createFakeVps, fakeGoogleFetch, listenForProbe, serveHealth, unattendedAnswers, type FakeVps } from './testing/fake-vps.js';
import { runUpdate, type UpdateOptions } from './update.js';

// =============================================================================
// `deploy update` adds a free port for a published-port key it introduces  (#1027)
// =============================================================================
//
// Production: kvox's update was stopped by `stack-ports-free` because
// `evopath-greptimedb-1` (project evopath, running) held 127.0.0.1:14003, the
// default of GREPTIME_BIND_PG_PORT, a key kvox's `.env` did not have yet (the
// deployment predates the telemetry stack). The operator edited `.env` by hand.
//
// `environment-drift` now picks a free port for such a key. A key the `.env`
// ALREADY has is never changed: an SSH tunnel or BI tool may depend on it, and
// `stack-ports-free` reports the clash with the fix. These run install, then
// the REAL update pipeline, with `docker compose config` rendered from the
// `.env` on disk, so the guard judges what the drift step wrote.
// =============================================================================

const INFRA = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose');
const TEMPLATE = readFileSync(join(INFRA, '.env.example'), 'utf8');
const ADMIN_SECRET = 'admin-secret-7f3a91c2-zz';
const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 10000000 80000000 12% /';
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

const envPath = (vps: FakeVps): string => join(composeCwd(vps.deployRoot), '.env');
const envOf = (vps: FakeVps): Map<string, string> => parseEnvFile(readFileSync(envPath(vps), 'utf8'));

/** Compose as the `.env` on disk renders it: nginx on APP_BIND_PORT, greptimedb on GREPTIME_BIND_PG_PORT. */
function renderedFromEnv(vps: FakeVps): string {
  const env = envOf(vps);
  const entry = (published: string, target: number) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published, protocol: 'tcp' });
  return JSON.stringify({
    services: {
      nginx: { ports: [entry(env.get('APP_BIND_PORT') ?? '3535', 80)] },
      greptimedb: { ports: [entry(env.get('GREPTIME_BIND_PG_PORT') ?? String(PG), 4003)] },
    },
  });
}

/** Another app on the server: its telemetry store on 127.0.0.1:14003. */
const evopath: FakeContainer = {
  project: 'evopath',
  workingDir: '/opt/infra/apps/evopath/repo/infra/compose',
  name: 'evopath-greptimedb-1',
  ports: [{ hostIp: '127.0.0.1', port: PG }],
};

interface Deployed {
  vps: FakeVps;
  /** What else Docker holds from now on, besides the stack's own nginx. */
  holds(containers: FakeContainer[]): void;
}

/**
 * A deployment installed by the real pipeline on an empty server, then put in
 * the state the test needs: its `.env` with or without the telemetry key.
 */
async function deployed(options: { telemetryKey: 'absent' | 'present' }): Promise<Deployed> {
  const compose = Object.fromEntries(
    composeFilesFor(undefined, INFRA).map((name) => [`repo/infra/compose/${name}`, readFileSync(join(INFRA, name), 'utf8')]),
  );
  const postgres = createFakePostgres({ roles: { admin: superRole({ password: ADMIN_SECRET }) }, databases: ['appdb'] });
  const vps = createFakeVps({
    envExample: TEMPLATE,
    files: compose,
    routes: [{ match: (invocation) => invocation.argv.includes('curl'), answer: '200' }, postgresRoute(postgres)],
  });
  // The stack's own nginx is up on the bind port (the health server stands in for it, so something listens there).
  const ownNginx: FakeContainer = { project: 'app', workingDir: composeCwd(vps.deployRoot), name: 'app-nginx-1', ports: [{ hostIp: '127.0.0.1', port: api.port }] };
  let held: FakeContainer[] = [ownNginx];
  vps.route(['docker', 'ps', '-aq'], () => psOutput(held));
  vps.route(['docker', 'inspect', '--format'], () => inspectOutput(held));
  vps.route(
    ({ argv }) => argv[0] === 'docker' && argv[1] === 'compose' && argv.slice(-3).join(' ') === 'config --format json',
    () => renderedFromEnv(vps),
  );

  await runInstall({
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
    portFree: async () => true,
  });

  if (options.telemetryKey === 'absent') {
    // A deployment from before the telemetry stack: the key was never written.
    const lines = readFileSync(envPath(vps), 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('GREPTIME_BIND_PG_PORT='));
    writeFileSync(envPath(vps), lines.join('\n'));
    expect(envOf(vps).has('GREPTIME_BIND_PG_PORT')).toBe(false);
  } else {
    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
  }

  mkdirSync(join(vps.deployRoot, 'repo', '.git'), { recursive: true });
  vps.route(['df'], DF);
  vps.route(['git', 'rev-parse', 'HEAD'], 'e'.repeat(40));
  vps.invocations.length = 0;
  return { vps, holds: (containers) => void (held = [ownNginx, ...containers]) };
}

function update(vps: FakeVps, extra: Partial<UpdateOptions> = {}) {
  return runUpdate({
    deployRoot: vps.deployRoot,
    runCommand: vps.runCommand,
    fetch: fakeGoogleFetch().fetch,
    nonInteractive: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    skipOAuthCheck: true,
    force: true,
    answers: new Map([...ANSWERS, ['POSTGRES_PORT', String(probe.port)]]),
    portFree: async () => true,
    ...extra,
  });
}

const upCalls = (vps: FakeVps): number => vps.calls('docker', 'compose').filter((call) => call.argv.includes('up')).length;
const journalText = (vps: FakeVps): string => {
  const logs = join(vps.deployRoot, 'logs');
  // The newest update journal.
  const name = readdirSync(logs).filter((file) => file.startsWith('appctl-update-')).sort().at(-1);
  return readFileSync(join(logs, name as string), 'utf8');
};

describe('REGRESSION #1027: an update that adds the telemetry port beside another app that holds 14003', () => {
  it('writes the next free port, names the holder, passes stack-ports-free and brings the stack up', async () => {
    const { vps, holds } = await deployed({ telemetryKey: 'absent' });
    holds([evopath]);
    const progress: string[] = [];

    await update(vps, { hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14004');
    const line = 'GREPTIME_BIND_PG_PORT=14004 (14003 is held by evopath-greptimedb-1)';
    expect(progress.some((message) => message.includes(line))).toBe(true);
    expect(journalText(vps)).toContain(line);
    // The preflight (old files, old `.env`) defers the key the drift step is about to add; the gate after it judges the final file.
    expect(journalText(vps)).toContain('a free port is chosen when the environment is written');
    expect(journalText(vps)).toMatch(/pass stack-ports-free: 2 host ports available/);
    expect(upCalls(vps)).toBeGreaterThan(0);
    // The rest of the environment is what it was.
    expect(envOf(vps).get('APP_BIND_PORT')).toBe(String(api.port));
    expect(readState(vps.deployRoot)?.bindPort).toBe(api.port);
  });

  it('keeps the familiar default, and says nothing extra, when nothing holds it', async () => {
    const { vps } = await deployed({ telemetryKey: 'absent' });
    const progress: string[] = [];

    await update(vps, { hooks: { onProgress: (message: string) => progress.push(message) } });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
    expect(journalText(vps)).not.toContain('Picked a free host port');
    expect(progress.filter((message) => message.includes('Picked a free host port'))).toEqual([]);
  });

  it('does not count the stack\'s own container as a holder: a lone app keeps 14003', async () => {
    const { vps, holds } = await deployed({ telemetryKey: 'absent' });
    holds([{ project: 'app', workingDir: composeCwd(vps.deployRoot), name: 'app-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: PG }] }]);

    await update(vps);

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
  });

  it('is probe-only when Docker cannot be asked, and still picks', async () => {
    const { vps } = await deployed({ telemetryKey: 'absent' });
    vps.route(['docker', 'ps', '-aq'], { fail: new Error('Cannot connect to the Docker daemon') });

    await update(vps, { portFree: async (port) => port !== PG });

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14004');
  });
});

describe('an existing value is never moved by an update (#1027)', () => {
  it('leaves GREPTIME_BIND_PG_PORT alone when it clashes, and stack-ports-free still stops the update with the fix', async () => {
    const { vps, holds } = await deployed({ telemetryKey: 'present' });
    holds([evopath]);

    const failure = await rejected(update(vps));

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14003');
    expect(failure.message).toContain('stack-ports-free');
    expect(failure.message).toContain('evopath-greptimedb-1');
    expect(failure.message).toContain('GREPTIME_BIND_PG_PORT');
    expect(upCalls(vps)).toBe(0);
  });

  it('leaves a value the operator changed alone even when it is free', async () => {
    const { vps } = await deployed({ telemetryKey: 'present' });
    writeFileSync(envPath(vps), readFileSync(envPath(vps), 'utf8').replace('GREPTIME_BIND_PG_PORT=14003', 'GREPTIME_BIND_PG_PORT=14123'));

    await update(vps);

    expect(envOf(vps).get('GREPTIME_BIND_PG_PORT')).toBe('14123');
  });
});

import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeCwd } from './compose-command.js';
import { composeFilesFor } from './compose-files.js';
import { CommandFailedError } from './executor.js';
import { DEPLOY_STATE_VERSION, writeState, type DeployState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer } from './testing/fake-containers.js';
import { createFakeVps, serveHealth, type FakeInvocation, type FakeVps } from './testing/fake-vps.js';
import { runUpdate } from './update.js';

// =============================================================================
// REGRESSION #1024: `deploy update` must not recreate the stack into a host-port clash
// =============================================================================
//
// platform-cli 0.1.0-next.13, production: with the compose project right
// (`-p kvox`), `up -d` recreated web, api and nginx and THEN failed on
// `Bind for 127.0.0.1:14003 failed: port is already allocated` -- greptimedb's
// second published port, held by something else on the host. The site stayed
// down. `bind-port-owner` and `bind-port-free` only looked at the main port.
//
// These run the REAL update pipeline on a fake server that holds the port, with
// the real generated compose files laid down in the checkout, and read the argv
// the pipeline emitted. ⚠ The fake never spawns docker: what is proved is WHEN
// the question is asked and that nothing mutating is issued after a "no".
// =============================================================================

const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 10000000 80000000 12% /';
const REAL_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose');
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

let api: Awaited<ReturnType<typeof serveHealth>>;

beforeAll(async () => {
  api = await serveHealth();
});

afterAll(async () => {
  await api.close();
});

/** The stack as compose renders it: nginx on the bind port, greptimedb on 14003, both on loopback. */
function rendered(options: { telemetryPort: boolean }): string {
  const entry = (published: number, target: number) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published: String(published), protocol: 'tcp' });
  return JSON.stringify({
    name: 'kvox',
    services: {
      nginx: { ports: [entry(api.port, 80)] },
      api: { environment: { JWT_SECRET: 'a-secret' } },
      greptimedb: { ports: options.telemetryPort ? [entry(PG, 4003)] : [] },
    },
  });
}

interface Subject {
  vps: FakeVps;
  progress: string[];
  update(extra?: { force?: boolean; noCache?: boolean }): ReturnType<typeof runUpdate>;
}

/**
 * A deployment recorded under project `kvox`, with the real compose files in
 * its checkout, whose Docker holds `containers`. `config` answers with
 * `configs` in turn (the last answer repeats): the preflight sees the checkout
 * as it is, the later gate sees it after `fetch`.
 */
function deployment(containers: (vps: FakeVps) => FakeContainer[], configs: Array<string | Error>): Subject {
  const compose = Object.fromEntries(
    composeFilesFor(undefined, REAL_DIR).map((name) => [`repo/infra/compose/${name}`, readFileSync(join(REAL_DIR, name), 'utf8')]),
  );
  const vps = createFakeVps({ withCheckout: true, files: compose });
  writeState({
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    deployedHead: 'a'.repeat(40),
    bindPort: api.port,
    deployRoot: vps.deployRoot,
    composeProject: 'kvox',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
  } as DeployState);

  vps.route(['df'], DF);
  vps.route(['git', 'rev-parse', 'HEAD'], 'e'.repeat(40));
  vps.route((invocation) => invocation.argv.includes('curl'), '200');
  vps.route(['docker', 'ps', '-aq'], () => psOutput(containers(vps)));
  vps.route(['docker', 'inspect', '--format'], () => inspectOutput(containers(vps)));
  let asked = 0;
  vps.route(
    ({ argv }) => argv[0] === 'docker' && argv[1] === 'compose' && argv.slice(-3).join(' ') === 'config --format json',
    () => {
      const answer = configs[Math.min(asked++, configs.length - 1)] ?? '{"services":{}}';
      return answer instanceof Error ? { fail: answer } : answer;
    },
  );

  const progress: string[] = [];
  return {
    vps,
    progress,
    update: (extra = {}) =>
      runUpdate({
        deployRoot: vps.deployRoot,
        runCommand: vps.runCommand,
        nonInteractive: true,
        skipProxy: true,
        skipSeed: true,
        noVersionBump: true,
        skipOAuthCheck: true,
        // The checkout is "already deployed" otherwise, and nothing would run.
        force: true,
        ...extra,
        hooks: { onProgress: (message: string) => progress.push(message) },
      }),
  };
}

const composeDir = (vps: FakeVps): string => composeCwd(vps.deployRoot);

const ownNginx = (vps: FakeVps): FakeContainer => ({
  project: 'kvox', workingDir: composeDir(vps), name: 'kvox-nginx-1', ports: [{ hostIp: '127.0.0.1', port: api.port }],
});
const foreignGreptime = (state: Partial<FakeContainer> = {}): FakeContainer => ({
  project: 'other', workingDir: '/opt/infra/apps/other/repo/infra/compose', name: 'other-greptimedb-1',
  ports: [{ hostIp: '127.0.0.1', port: PG }], ...state,
});

/** Compose invocations other than the read-only `version` and `config`. */
function stackCommands(vps: FakeVps): FakeInvocation[] {
  return vps.calls('docker', 'compose').filter((call) => !call.argv.includes('config') && !call.argv.includes('version'));
}

const isMutation = (call: FakeInvocation): boolean =>
  ['up', 'build', 'down', 'stop', 'start', 'restart', 'run', 'rm', 'create', 'kill', 'pull'].some((word) => call.argv.includes(word));

describe('REGRESSION #1024: the preflight stops an update whose stack cannot bind its ports', () => {
  it('fails at preflight with stack-ports-free, and issues no up, build, down, stop or recreate command', async () => {
    const subject = deployment((vps) => [ownNginx(vps), foreignGreptime()], [rendered({ telemetryPort: true })]);

    const failure = await rejected(subject.update());

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('Check the essentials failed');
    expect(failure.message).toContain('stack-ports-free');
    expect(failure.message).toContain('127.0.0.1:14003');
    expect(failure.message).toContain('other-greptimedb-1 (project other, running)');
    expect(failure.message).toContain('GREPTIME_BIND_PG_PORT');
    expect(failure.message).toContain(`${composeDir(subject.vps)}/.env`);
    // Nothing was touched: not even the checkout moved...
    expect(subject.vps.calls('git', 'fetch')).toEqual([]);
    expect(subject.vps.calls('git', 'pull')).toEqual([]);
    // ...and no compose command but the read-only ones ran.
    expect(stackCommands(subject.vps)).toEqual([]);
    expect(subject.vps.invocations.filter((call) => call.argv[0] === 'docker' && call.argv[1] === 'compose').every((call) => call.argv.includes('config') || call.argv.includes('version'))).toBe(true);
  });

  it('is not skipped by --force or --no-cache, which only decide whether to rebuild', async () => {
    for (const extra of [{ force: true }, { noCache: true, force: false }]) {
      const subject = deployment((vps) => [ownNginx(vps), foreignGreptime()], [rendered({ telemetryPort: true })]);

      await expect(subject.update(extra)).rejects.toThrow(/stack-ports-free/);

      expect(stackCommands(subject.vps)).toEqual([]);
    }
  });

  it('renders the stack with the run\'s project and its telemetry files, in the compose directory', async () => {
    const subject = deployment((vps) => [ownNginx(vps), foreignGreptime()], [rendered({ telemetryPort: true })]);

    await subject.update().catch(() => undefined);

    const [config] = subject.vps.calls('docker', 'compose').filter((call) => call.argv.includes('config'));
    expect(config?.argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 'kvox']);
    expect(config?.argv).toContain('vps.telemetry.compose.yml');
    expect(config?.cwd).toBe(composeDir(subject.vps));
  });

  it('also fails for a non-Docker listener that holds the port (the real loopback probe)', async () => {
    // A plain process on the machine, on an ephemeral port, not Docker's.
    const listener = createServer();
    await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
    const held = (listener.address() as AddressInfo).port;
    try {
      const entry = { mode: 'ingress', host_ip: '127.0.0.1', target: 4003, published: String(held), protocol: 'tcp' };
      const config = JSON.stringify({ services: { nginx: { ports: [{ ...entry, target: 80, published: String(api.port) }] }, greptimedb: { ports: [entry] } } });
      const subject = deployment((vps) => [ownNginx(vps)], [config]);

      const failure = await rejected(subject.update());

      expect(failure.message).toContain('stack-ports-free');
      // 14003 is the variable's default, not this port: no variable is named.
      expect(failure.message).toContain(`127.0.0.1:${held} (greptimedb) is in use by a process outside Docker`);
      expect(stackCommands(subject.vps)).toEqual([]);
    } finally {
      await new Promise<void>((done) => listener.close(() => done()));
    }
  });

  it('lets an update through when the stack\'s own containers hold the ports, and asks before it builds', async () => {
    const own = (vps: FakeVps): FakeContainer[] => [
      ownNginx(vps),
      { project: 'kvox', workingDir: composeDir(vps), name: 'kvox-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: PG }] },
    ];
    const subject = deployment(own, [rendered({ telemetryPort: true })]);

    await subject.update();

    const order = subject.vps.calls('docker', 'compose').map((call) => (call.argv.includes('config') ? 'config' : call.argv.includes('version') ? 'version' : (call.argv.find((word) => ['build', 'up', 'run', 'stop', 'start'].includes(word)) ?? 'other')));
    expect(order).toContain('up');
    expect(order.indexOf('config')).toBeLessThan(order.indexOf('build'));
    expect(order.lastIndexOf('config')).toBeLessThan(order.indexOf('up'));
  });

  it('warns (and updates) about a stopped leftover of another stack while the run\'s own container holds the port', async () => {
    const containers = (vps: FakeVps): FakeContainer[] => [
      ownNginx(vps),
      { project: 'kvox', workingDir: composeDir(vps), name: 'kvox-greptimedb-1', ports: [{ hostIp: '127.0.0.1', port: PG }] },
      foreignGreptime({ running: false, workingDir: composeDir(vps), project: 'compose', name: 'compose-greptimedb-1' }),
    ];
    const subject = deployment(containers, [rendered({ telemetryPort: true })]);

    await subject.update();

    const warning = subject.progress.find((message) => message.startsWith('warning: stack-ports-free'));
    expect(warning).toContain('compose-greptimedb-1');
    expect(warning).toContain('xargs -r docker rm -f');
    expect(stackCommands(subject.vps).some((call) => call.argv.includes('up'))).toBe(true);
  });
});

describe('REGRESSION #1024: the gate after fetch sees what the NEW revision publishes', () => {
  it('stops before database-role, build, migrate or restart when the new revision publishes a port the old one did not', async () => {
    // The preflight renders the checkout as it is: greptimedb publishes nothing there.
    // After `fetch` and `environment-drift` the same question is asked of the new files.
    const subject = deployment(
      (vps) => [ownNginx(vps), foreignGreptime()],
      [rendered({ telemetryPort: false }), rendered({ telemetryPort: true })],
    );

    const failure = await rejected(subject.update());

    expect(failure.message).toContain('Check the ports the stack publishes failed');
    expect(failure.message).toContain('stack-ports-free');
    expect(failure.message).toContain('other-greptimedb-1');
    // The checkout did move (fetch ran) but no container was touched.
    expect(subject.vps.calls('git', 'checkout')).toHaveLength(1);
    expect(stackCommands(subject.vps).filter(isMutation)).toEqual([]);
    expect(stackCommands(subject.vps)).toEqual([]);
  });
});

describe('a stack that cannot be rendered', () => {
  const missingKey = (): Error =>
    new CommandFailedError('`docker compose config` exited 1\n    required variable STACK_AGENT_TOKEN is missing a value', {
      argv: [], cwd: '', exitCode: 1, stdout: '', stderr: 'required variable STACK_AGENT_TOKEN is missing a value', durationMs: 1, timedOut: false,
    });

  it('is judged after environment-drift, not in the preflight: the drift step may be what supplies the missing key', async () => {
    // A checkout moved by an earlier failed run needs a key the .env does not have yet.
    const subject = deployment((vps) => [ownNginx(vps)], [missingKey(), rendered({ telemetryPort: true })]);
    // Nothing holds 14003, so once the key exists the update goes through.

    await subject.update();

    expect(stackCommands(subject.vps).some((call) => call.argv.includes('up'))).toBe(true);
  });

  it('FAILS the update with compose\'s error at the stack-ports step, before any container is touched', async () => {
    const subject = deployment((vps) => [ownNginx(vps)], [missingKey()]);

    const failure = await rejected(subject.update());

    expect(failure.message).toContain('Check the ports the stack publishes failed');
    expect(failure.message).toContain('docker compose cannot render the stack');
    expect(failure.message).toContain('STACK_AGENT_TOKEN');
    expect(stackCommands(subject.vps)).toEqual([]);
  });
});

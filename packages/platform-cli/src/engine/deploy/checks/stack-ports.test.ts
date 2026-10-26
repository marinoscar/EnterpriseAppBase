import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeArgv, composeCwd } from '../compose-command.js';
import { composeFilesFor } from '../compose-files.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from '../executor.js';
import { deployStatePath } from '../state.js';
import { inspectOutput, psOutput, type FakeContainer } from '../testing/fake-containers.js';
import { ALL_CHECKS, requiredChecks } from './index.js';
import { STACK_PORT_CHECKS } from './stack-ports.js';
import { checksPassed, runChecks, type CheckContext, type CheckFs } from './types.js';

// =============================================================================
// stack-ports-free  (#1024)
// =============================================================================
//
// Driven through an injected runCommand that answers the three questions the
// check asks Docker -- `docker ps -aq`, one `docker inspect --format`, and
// `docker compose ... config --format json` -- from data, as Docker would, and
// through the REAL generated compose files (so the variable named in a remedy is
// the one the files really use).
// =============================================================================

const ROOT = '/opt/infra/apps/kvox';
const COMPOSE_DIR = composeCwd(ROOT);
const REAL_DIR = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'compose');
const MAIN = 3535;
const PG = 14003;

const check = STACK_PORT_CHECKS[0];
if (check === undefined) throw new Error('no stack-ports-free check');

/** The rendered stack: nginx on the main port and greptimedb on 14003, both on loopback. */
function stack(overrides: { main?: number; pg?: number } = {}): string {
  const entry = (published: number, target: number) => ({ mode: 'ingress', host_ip: '127.0.0.1', target, published: String(published), protocol: 'tcp' });
  return JSON.stringify({
    name: 'kvox',
    services: {
      nginx: { ports: [entry(overrides.main ?? MAIN, 80)] },
      api: { environment: { JWT_SECRET: 'secret-value' } },
      greptimedb: { ports: [entry(overrides.pg ?? PG, 4003)] },
    },
  });
}

interface Docker {
  containers?: readonly FakeContainer[] | 'down';
  /** What `config` prints, or an error for it. */
  config?: string | Error;
}

function docker(options: Docker): { run: CheckContext['runCommand']; seen: string[][] } {
  const seen: string[][] = [];
  const run = (async (argv: readonly string[], runOptions: RunCommandOptions): Promise<CommandResult> => {
    seen.push([...argv]);
    const result = (stdout: string): CommandResult => ({
      argv: [...argv], cwd: runOptions.cwd, exitCode: 0, stdout, stderr: '', durationMs: 1, timedOut: false,
    });
    const containers = options.containers ?? [];
    if (argv[1] === 'ps' || argv[1] === 'inspect') {
      if (containers === 'down') {
        throw new CommandFailedError('Cannot connect to the Docker daemon', { ...result(''), exitCode: 1 });
      }
      return result(argv[1] === 'ps' ? psOutput(containers) : inspectOutput(containers));
    }
    if (argv[1] === 'compose' && argv.includes('config')) {
      const config = options.config ?? stack();
      if (config instanceof Error) throw config;
      return result(config);
    }
    throw new Error(`unexpected command ${argv.join(' ')}`);
  }) as CheckContext['runCommand'];
  return { run, seen };
}

/** A filesystem holding the real compose files and the given `.env`. */
function files(env = ''): CheckFs {
  const known = new Set(composeFilesFor(undefined, COMPOSE_DIR));
  return {
    exists: (path) => known.has(path.slice(COMPOSE_DIR.length + 1)),
    isDirectory: () => true,
    isWritable: () => true,
    readFile: (path) => {
      const name = path.slice(COMPOSE_DIR.length + 1);
      if (name === '.env') return env;
      return known.has(name) ? readFileSync(join(REAL_DIR, name), 'utf8') : undefined;
    },
    readdir: () => [],
  };
}

function context(options: Docker, overrides: Omit<Partial<CheckContext>, 'env'> & { env?: string; listening?: readonly number[] } = {}): CheckContext & { seen: string[][] } {
  const { env, listening = [], ...rest } = overrides;
  const { run, seen } = docker(options);
  return {
    runCommand: run,
    deployRoot: ROOT,
    bindPort: MAIN,
    composeProject: 'kvox',
    proxyRoot: '/opt/infra/proxy',
    fs: files(env),
    portFree: async (port) => !listening.includes(port),
    ...rest,
    seen,
  };
}

const lo = '127.0.0.1';
const nginx: FakeContainer = { project: 'kvox', workingDir: COMPOSE_DIR, name: 'kvox-nginx-1', ports: [{ hostIp: lo, port: MAIN }] };
const ownGreptime: FakeContainer = { project: 'kvox', workingDir: COMPOSE_DIR, name: 'kvox-greptimedb-1', ports: [{ hostIp: lo, port: PG }] };
const leftover: FakeContainer = { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-greptimedb-1', ports: [{ hostIp: lo, port: PG }] };
const otherApp: FakeContainer = {
  project: 'other',
  workingDir: '/opt/infra/apps/other/repo/infra/compose',
  name: 'other-greptimedb-1',
  ports: [{ hostIp: lo, port: PG }],
};

const removal = (project: string, dir: string): string =>
  `docker ps -aq --filter label=com.docker.compose.project=${project} --filter label=com.docker.compose.project.working_dir=${dir} | xargs -r docker rm -f`;

describe('stack-ports-free: registration', () => {
  it('is a required check in the registry, after the Docker checks it requires, run by the install preflight and doctor', () => {
    expect(check.id).toBe('stack-ports-free');
    expect(check.title).toBe('Every host port the stack publishes is available');
    expect(check.severity).toBe('required');
    expect(check.requires).toEqual(['docker-daemon', 'docker-compose-v2']);
    expect(ALL_CHECKS).toContain(check);
    for (const id of check.requires ?? []) {
      expect(ALL_CHECKS.findIndex((candidate) => candidate.id === id)).toBeLessThan(ALL_CHECKS.indexOf(check));
    }
    // install's preflight and doctor take the required subset of the registry.
    expect(requiredChecks(ALL_CHECKS, context({})).map((candidate) => candidate.id)).toContain('stack-ports-free');
  });

  it('is skipped by `requires` when a Docker check did not pass', async () => {
    const [result] = await runChecks([check], context({ containers: [nginx] }));

    expect(result?.status).toBe('skip');
  });
});

describe('stack-ports-free: what holds a port', () => {
  it('passes when only the run\'s own project publishes the ports (they are recreated)', async () => {
    for (const running of [true, false]) {
      const result = await check.run(context({ containers: [{ ...nginx, running }, { ...ownGreptime, running }] }));

      expect(result.status).toBe('pass');
      expect(result.detail).toContain('127.0.0.1:14003');
    }
  });

  it('passes on a host with no containers and nothing listening', async () => {
    expect((await check.run(context({ containers: [] }))).status).toBe('pass');
  });

  it('FAILS on a RUNNING leftover of this folder under another project: the production failure of #1024', async () => {
    const result = await check.run(context({ containers: [nginx, leftover] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:14003');
    expect(result.detail).toContain('greptimedb');
    expect(result.detail).toContain('GREPTIME_BIND_PG_PORT');
    expect(result.detail).toContain('compose-greptimedb-1 (project compose, running)');
    expect(result.remedy).toContain(removal('compose', COMPOSE_DIR));
    expect(result.remedy).toContain(`"composeProject" to it in ${deployStatePath(ROOT)}`);
  });

  it('FAILS on a STOPPED leftover too when no running container of the run\'s project holds the port', async () => {
    for (const own of [[], [{ ...ownGreptime, running: false }]]) {
      const result = await check.run(context({ containers: [nginx, ...own, { ...leftover, running: false }] }));

      expect(result.status).toBe('fail');
      expect(result.detail).toContain('compose-greptimedb-1 (project compose, stopped)');
      expect(result.remedy).toContain(removal('compose', COMPOSE_DIR));
    }
  });

  it('only WARNS about a stopped leftover while the run\'s own container holds the port, with the removal command', async () => {
    const result = await check.run(context({ containers: [nginx, ownGreptime, { ...leftover, running: false }] }));

    expect(result.status).toBe('warn');
    expect(result.detail).toContain('compose-greptimedb-1 (project compose) is a stopped leftover');
    expect(result.detail).toContain('127.0.0.1:14003');
    expect(result.remedy).toContain(removal('compose', COMPOSE_DIR));
  });

  it('still FAILS on a running foreign container while the run\'s own container holds the port', async () => {
    // Two running containers cannot both hold it; whichever is wrong, `up -d` will not get the port.
    const result = await check.run(context({ containers: [nginx, ownGreptime, leftover] }));

    expect(result.status).toBe('fail');
  });

  it('FAILS on another app\'s container, naming the variable and the .env that sets the port', async () => {
    const result = await check.run(context({ containers: [nginx, otherApp] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:14003 (greptimedb, set by GREPTIME_BIND_PG_PORT)');
    expect(result.detail).toContain('other-greptimedb-1 (project other, running)');
    expect(result.remedy).toContain(`set GREPTIME_BIND_PG_PORT=<free port> in ${COMPOSE_DIR}/.env`);
    expect(result.remedy).toContain('docker stop other-greptimedb-1');
    // Not this folder's: nothing here suggests deleting another app's container.
    expect(result.remedy).not.toContain('xargs -r docker rm -f');
  });

  it('names the variable the operator changed, from the .env', async () => {
    const result = await check.run(
      context(
        { containers: [nginx, { ...otherApp, ports: [{ hostIp: lo, port: 14100 }] }], config: stack({ pg: 14100 }) },
        { env: 'GREPTIME_BIND_PG_PORT=14100\n' },
      ),
    );

    expect(result.status).toBe('fail');
    expect(result.remedy).toContain('set GREPTIME_BIND_PG_PORT=<free port>');
  });

  it('says so when no variable sets the port (a literal in an overlay)', async () => {
    const result = await check.run(
      context({ containers: [nginx, { ...otherApp, ports: [{ hostIp: lo, port: 15000 }] }], config: stack({ pg: 15000 }) }),
    );

    expect(result.status).toBe('fail');
    expect(result.remedy).toContain('no .env variable sets 127.0.0.1:15000');
    expect(result.remedy).toContain('app.*.compose.yml');
  });

  it('FAILS on a non-Docker listener, naming the port, the service and the variable', async () => {
    const result = await check.run(context({ containers: [nginx] }, { listening: [PG] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:14003 (greptimedb, set by GREPTIME_BIND_PG_PORT) is in use by a process outside Docker');
    expect(result.remedy).toContain('set GREPTIME_BIND_PG_PORT=<free port>');
  });

  it('does not call a port a stranger\'s listener while a running container accounts for it', async () => {
    // docker-proxy listens for the run's own greptimedb; the probe would call that "busy".
    const result = await check.run(context({ containers: [nginx, ownGreptime] }, { listening: [PG] }));

    expect(result.status).toBe('pass');
  });

  it('probes a port only its own stopped container is configured for', async () => {
    const result = await check.run(context({ containers: [nginx, { ...ownGreptime, running: false }] }, { listening: [PG] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('outside Docker');
  });

  it('reports every blocked port, not just the first', async () => {
    const result = await check.run(context({ containers: [leftover] }, { bindPort: 1, listening: [MAIN] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:3535 (nginx, set by APP_BIND_PORT)');
    expect(result.detail).toContain('127.0.0.1:14003');
  });
});

describe('stack-ports-free: one owner per port, and exact matching', () => {
  it('leaves the MAIN bind port\'s container question to bind-port-owner (no double message)', async () => {
    const foreignOnMain: FakeContainer = { project: 'other', workingDir: '/opt/infra/apps/other', name: 'other-nginx-1', ports: [{ hostIp: lo, port: MAIN }] };

    const result = await check.run(context({ containers: [foreignOnMain, ownGreptime] }));

    expect(result.status).toBe('pass');
  });

  it('still probes the main bind port for a listener outside Docker, which bind-port-owner never does', async () => {
    const result = await check.run(context({ containers: [ownGreptime] }, { listening: [MAIN] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:3535 (nginx, set by APP_BIND_PORT) is in use by a process outside Docker');
  });

  it('treats a main bind port that differs from the stack\'s rendered one as an ordinary port', async () => {
    // APP_BIND_PORT in .env moved nginx to 3600 while the state still says 3535.
    const onNew: FakeContainer = { project: 'other', workingDir: '/x', name: 'other-nginx-1', ports: [{ hostIp: lo, port: 3600 }] };

    const result = await check.run(context({ containers: [onNew, ownGreptime], config: stack({ main: 3600 }) }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('127.0.0.1:3600');
  });

  it('does not collide a UDP binding with a TCP one, or two different loopback addresses', async () => {
    const udp: FakeContainer = { ...otherApp, ports: [{ hostIp: lo, port: PG, protocol: 'udp' }] };
    const elsewhere: FakeContainer = { ...otherApp, ports: [{ hostIp: '127.0.0.2', port: PG }] };

    for (const holder of [udp, elsewhere]) {
      expect((await check.run(context({ containers: [nginx, ownGreptime, holder] }))).status).toBe('pass');
    }
  });

  it('collides with a foreign binding on every interface, and a foreign range that covers the port', async () => {
    const wildcard: FakeContainer = { ...otherApp, ports: [{ hostIp: '', port: PG }] };
    const range: FakeContainer = { ...otherApp, ports: [{ hostIp: lo, port: '14000-14010' }] };

    for (const holder of [wildcard, range]) {
      expect((await check.run(context({ containers: [nginx, holder] }))).status).toBe('fail');
    }
  });

  it('counts a container that is not a compose container as foreign', async () => {
    const plain: FakeContainer = { project: '', workingDir: '', name: 'redis', ports: [{ hostIp: lo, port: PG }] };

    const result = await check.run(context({ containers: [nginx, plain] }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('redis (not a compose container, running)');
  });

  it('with no recorded project (a fresh install, a bare doctor run) accepts only a container of this folder as its own', async () => {
    const fresh = { composeProject: undefined };
    const sameNameElsewhere: FakeContainer = { project: 'kvox', workingDir: '/opt/other/kvox/repo/infra/compose', name: 'kvox-greptimedb-1', ports: [{ hostIp: lo, port: PG }] };

    expect((await check.run(context({ containers: [ownGreptime] }, fresh))).status).toBe('pass');
    expect((await check.run(context({ containers: [sameNameElsewhere] }, fresh))).status).toBe('fail');
  });
});

describe('stack-ports-free: what it cannot ask', () => {
  it('is skipped, never failed, when Docker cannot be asked which containers exist', async () => {
    const result = await check.run(context({ containers: 'down' }));

    expect(result.status).toBe('skip');
  });

  it('is skipped when the compose render finds Docker unreachable', async () => {
    const error = new CommandFailedError('Cannot connect to the Docker daemon at unix:///var/run/docker.sock', {
      argv: [], cwd: '', exitCode: 1, stdout: '', stderr: '', durationMs: 1, timedOut: false,
    });

    expect((await check.run(context({ containers: [], config: error }))).status).toBe('skip');
  });

  it('is skipped before the checkout exists: there are no compose files to render', async () => {
    const empty: CheckFs = { ...files(), exists: () => false };

    const result = await check.run(context({ containers: [] }, { fs: empty }));

    expect(result.status).toBe('skip');
    expect(result.detail).toContain('no compose files');
  });

  it('FAILS with compose\'s own error when the stack cannot be rendered, and says how to see it all', async () => {
    const error = new CommandFailedError(
      '`docker compose config` exited 1\n    error while interpolating: required variable STACK_AGENT_TOKEN is missing a value',
      { argv: [], cwd: '', exitCode: 1, stdout: '', stderr: 'required variable STACK_AGENT_TOKEN is missing a value', durationMs: 1, timedOut: false },
    );

    const result = await check.run(context({ containers: [nginx], config: error }));

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('docker compose cannot render the stack');
    expect(result.detail).toContain('STACK_AGENT_TOKEN is missing a value');
    expect(result.remedy).toContain(`Set STACK_AGENT_TOKEN in ${COMPOSE_DIR}/.env`);
  });

  it('FAILS on a render error with no missing variable, giving the command that shows the whole error', async () => {
    const error = new CommandFailedError('`docker compose config` exited 1\n    yaml: line 3: mapping values are not allowed', {
      argv: [], cwd: '', exitCode: 1, stdout: '', stderr: '', durationMs: 1, timedOut: false,
    });

    const result = await check.run(context({ containers: [nginx], config: error }));

    expect(result.status).toBe('fail');
    expect(result.remedy).toContain(composeArgv(['config'], 'kvox', undefined, COMPOSE_DIR).join(' '));
  });

  it('FAILS on output that is not a compose project', async () => {
    expect((await check.run(context({ containers: [], config: 'warning: nothing\n' }))).status).toBe('fail');
  });

  it('does NOT fail a render error while the environment is still to be written (the install preflight)', async () => {
    const error = new CommandFailedError('`docker compose config` exited 1\n    required variable JWT_SECRET is missing a value', {
      argv: [], cwd: '', exitCode: 1, stdout: '', stderr: '', durationMs: 1, timedOut: false,
    });

    const result = await check.run(context({ containers: [], config: error }, { environmentPending: true }));

    expect(result.status).toBe('skip');
    // Port clashes are still found in that preflight when the stack does render.
    expect((await check.run(context({ containers: [nginx, otherApp] }, { environmentPending: true }))).status).toBe('fail');
  });
});

describe('stack-ports-free: it asks for the same stack `up -d` starts, and changes nothing', () => {
  it('renders with the run\'s project, files and compose directory, and only reads', async () => {
    const subject = context({ containers: [nginx, ownGreptime] }, { groups: ['email'] });

    await check.run(subject);

    const config = subject.seen.find((argv) => argv.includes('config'));
    expect(config).toEqual(composeArgv(['config', '--format', 'json'], 'kvox', ['email'], COMPOSE_DIR));
    expect(subject.seen.every((argv) => (argv[1] === 'ps' || argv[1] === 'inspect') || argv.includes('config'))).toBe(true);
    expect(subject.seen.some((argv) => ['up', 'build', 'down', 'stop', 'rm', 'run', 'restart', 'create'].some((word) => argv.includes(word)))).toBe(false);
  });

  it('never puts the rendered stack (it holds the secrets) in a result', async () => {
    const result = await check.run(context({ containers: [nginx, otherApp] }));

    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('passes through runChecks with the Docker checks satisfied, and a failure fails the run', async () => {
    const subject = context({ containers: [nginx, otherApp] });
    const satisfied = ['docker-daemon', 'docker-compose-v2'].map((id) => ({ id, title: id, severity: 'required' as const, run: async () => ({ status: 'pass' as const, detail: 'ok' }) }));

    const results = await runChecks([...satisfied, check], subject);

    expect(results.at(-1)?.status).toBe('fail');
    expect(checksPassed(results)).toBe(false);
  });
});

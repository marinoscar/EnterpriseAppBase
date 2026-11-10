import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectComposeProject,
  isPathUnder,
  reconcileComposeProject,
  type ComposeProjectCommandRunner,
} from './compose-project.js';
import { LEGACY_COMPOSE_PROJECT, composeArgv, composeProjectFor } from './install.js';
import { isDeployment } from './deployment-evidence.js';
import { DEPLOY_STATE_VERSION, deployStatePath, readState, writeState, type DeployState } from './state.js';
import { inspectOutput, psOutput, type FakeContainer as FakeContainerRecord } from './testing/fake-containers.js';

/**
 * The compose project name is the one piece of bookkeeping in this CLI that can
 * cause an outage by being RIGHT in the wrong place.
 *
 * Without `-p`, Compose derives the project from the compose file's DIRECTORY,
 * which is `compose` for every deployment on the host -- so two applications
 * share one project and each `up -d` fights the other.
 *
 * But naming an EXISTING deployment's project renames it, and Compose then sees
 * no existing containers: it builds a parallel stack that collides with the one
 * still running and holding the bind port. Fixing the first problem naively
 * causes the second.
 */
describe('composeProjectFor: the recorded name, never a derived one', () => {
  it('answers "compose" for a deployment with no record at all', () => {
    expect(composeProjectFor(undefined)).toBe(LEGACY_COMPOSE_PROJECT);
    expect(LEGACY_COMPOSE_PROJECT).toBe('compose');
  });

  it('answers "compose" for a record written before the field existed', () => {
    // ⚠ This is every deployment in the field. Absent MUST mean the
    // directory-derived default they are already running under -- anything else
    // renames their project on the next update and starts a parallel stack.
    expect(composeProjectFor({})).toBe('compose');
  });

  it('answers the recorded name when there is one', () => {
    expect(composeProjectFor({ composeProject: 'myapp' })).toBe('myapp');
  });
});

describe('composeArgv', () => {
  it('emits no -p at all when no project is given', () => {
    const argv = composeArgv(['up', '-d']);

    expect(argv).not.toContain('-p');
    expect(argv.slice(0, 2)).toEqual(['docker', 'compose']);
  });

  it('puts -p <name> before the -f flags, where Compose expects it', () => {
    const argv = composeArgv(['up', '-d'], 'myapp');

    expect(argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 'myapp']);
    expect(argv.indexOf('-p')).toBeLessThan(argv.indexOf('-f'));
  });

  it('still layers base, prod and vps in that order, with the always-on telemetry files (#567)', () => {
    const argv = composeArgv(['build'], 'myapp');
    const files = argv.filter((_, index) => argv[index - 1] === '-f');

    expect(files).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'telemetry.compose.yml',
      'vps.compose.yml',
      'vps.telemetry.compose.yml',
    ]);
  });

  it('adds the telemetry files when the observability group is passed (#531)', () => {
    const argv = composeArgv(['up', '-d'], 'myapp', ['observability']);
    const files = argv.filter((_, index) => argv[index - 1] === '-f');

    expect(files).toEqual([
      'base.compose.yml',
      'prod.compose.yml',
      'telemetry.compose.yml',
      'vps.compose.yml',
      'vps.telemetry.compose.yml',
    ]);
    expect(argv.slice(-2)).toEqual(['up', '-d']);
  });

  it('an adopted deployment keeps -p compose, not a name derived from its directory', () => {
    // The whole point. A deployment that predates this field is recognised by
    // the evidence predicate but carries no `composeProject`, and its containers
    // are running under `compose`. Deriving a name from the directory here is
    // what would start the parallel stack.
    const deployRoot = mkdtempSync(join(tmpdir(), 'appctl-adopted-'));
    mkdirSync(join(deployRoot, 'repo', '.git'), { recursive: true });
    writeFileSync(join(deployRoot, '.env'), 'APP_BIND_PORT=3535\n');
    expect(isDeployment(deployRoot)).toBe(true);

    const argv = composeArgv(['up', '-d'], composeProjectFor(undefined));

    expect(argv).toContain('-p');
    expect(argv[argv.indexOf('-p') + 1]).toBe('compose');
  });
});

// =============================================================================
// Which project do the containers REALLY run under?  (#1015)
// =============================================================================
//
// `composeProjectFor` answers `compose` for a record that names no project, and
// that is wrong for a server installed with an app-named `-p` project that
// recorded nothing: every `docker compose -p compose` call then looks at a stack
// that is not there and `up -d` starts a SECOND one on the bind port. Docker
// knows the truth (every container carries the directory compose ran from), so
// `detectComposeProject` reads it and `reconcileComposeProject` records it.
//
// Docker is a fake runner; the state file is a real file in a temporary folder.
// =============================================================================

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';

/**
 * A container as these tests write it: `[project, workingDir, extra?]`, where
 * `extra` sets the name, whether it runs (default yes) and the ports it publishes.
 */
type FakeContainer = readonly [project: string, workingDir: string, extra?: Partial<FakeContainerRecord>];

interface FakeDocker {
  run: ComposeProjectCommandRunner;
  /** Every invocation, argv and options as the caller passed them. */
  calls: Array<{ argv: string[]; options: { cwd: string; timeoutMs?: number | undefined } }>;
}

/** A Docker holding `containers`, or `'down'` for a daemon that cannot be reached. */
function fakeDocker(containers: readonly FakeContainer[] | 'down'): FakeDocker {
  const calls: FakeDocker['calls'] = [];
  const run: ComposeProjectCommandRunner = async (argv, options) => {
    calls.push({ argv: [...argv], options });
    if (containers === 'down') throw new Error('Cannot connect to the Docker daemon');
    const records = containers.map(([project, workingDir, extra]) => ({ project, workingDir, ...extra }));
    if (argv[1] === 'ps') return { stdout: psOutput(records) + '\n' };
    if (argv[1] === 'inspect') return { stdout: inspectOutput(records) + '\n' };
    throw new Error(`unexpected command ${argv.join(' ')}`);
  };
  return { run, calls };
}

/** A runner that prints `ps` and `inspect` output verbatim, for output shapes the fake above cannot make. */
function rawDocker(ps: string, inspect: string): ComposeProjectCommandRunner {
  return async (argv) => ({ stdout: argv[1] === 'ps' ? ps : inspect });
}

/** What the real `runCommand` does for a command that exits non-zero. */
function nonZero(): Error {
  return Object.assign(new Error('docker exited with code 1'), { result: { exitCode: 1, stdout: '', stderr: 'denied' } });
}

describe('isPathUnder', () => {
  const ROOT = '/opt/infra/apps/myapp';

  it('is true for the root itself', () => {
    expect(isPathUnder(ROOT, ROOT)).toBe(true);
  });

  it('is true for a child and for a deeper descendant', () => {
    expect(isPathUnder(`${ROOT}/repo`, ROOT)).toBe(true);
    expect(isPathUnder(`${ROOT}/repo/infra/compose`, ROOT)).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isPathUnder(`${ROOT}/repo/`, `${ROOT}/`)).toBe(true);
    expect(isPathUnder(`${ROOT}/`, ROOT)).toBe(true);
  });

  it('is false for a sibling whose name merely starts with the root name', () => {
    expect(isPathUnder(`${ROOT}-2/repo`, ROOT)).toBe(false);
    expect(isPathUnder(`${ROOT}2`, ROOT)).toBe(false);
  });

  it('is false for the parent and for an unrelated path', () => {
    expect(isPathUnder('/opt/infra/apps', ROOT)).toBe(false);
    expect(isPathUnder('/srv/other', ROOT)).toBe(false);
  });

  it('resolves `..` before comparing, in either direction', () => {
    expect(isPathUnder(`${ROOT}/../other`, ROOT)).toBe(false);
    expect(isPathUnder(`${ROOT}/repo/..`, ROOT)).toBe(true);
    expect(isPathUnder(`${ROOT}/repo/../../myapp-2`, ROOT)).toBe(false);
  });

  it('treats every absolute path as under the filesystem root', () => {
    expect(isPathUnder('/opt/infra', '/')).toBe(true);
  });

  it('does not need either path to exist', () => {
    expect(existsSync(ROOT)).toBe(false);
    expect(isPathUnder(`${ROOT}/repo`, ROOT)).toBe(true);
  });
});

describe('detectComposeProject', () => {
  let root: string;

  beforeEach(() => {
    root = join(mkdtempSync(join(tmpdir(), 'appctl-detect-')), 'apps', 'myapp');
  });

  afterEach(() => {
    rmSync(join(root, '..', '..'), { recursive: true, force: true });
  });

  it('finds the single project whose containers were started from inside the folder', async () => {
    const docker = fakeDocker([
      ['myapp', join(root, 'repo', 'infra', 'compose')],
      ['myapp', join(root, 'repo', 'infra', 'compose')],
      ['tools', '/opt/tools'],
    ]);

    expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'found', project: 'myapp', basis: 'only' });
  });

  it('also matches a container started from the folder itself', async () => {
    expect(await detectComposeProject(root, fakeDocker([['myapp', root]]).run)).toEqual({
      kind: 'found',
      project: 'myapp',
      basis: 'only',
    });
  });

  it('is none on a host without containers, and does not inspect', async () => {
    const docker = fakeDocker([]);

    expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'none' });
    expect(docker.calls.map((call) => call.argv.slice(0, 3))).toEqual([['docker', 'ps', '-aq']]);
  });

  it('is none when no container was started from inside the folder', async () => {
    const docker = fakeDocker([
      ['tools', '/opt/tools'],
      ['other', '/srv/other/compose'],
    ]);

    expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'none' });
  });

  it('is ambiguous, with the projects sorted and listed once, when several started from inside the folder', async () => {
    const docker = fakeDocker([
      ['zeta', join(root, 'repo')],
      ['alpha', join(root, 'other')],
      ['zeta', join(root, 'repo')],
    ]);

    expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'ambiguous', projects: ['alpha', 'zeta'] });
  });

  describe('several projects in one folder: the strongest evidence decides (#1020)', () => {
    const repo = (): string => join(root, 'repo', 'infra', 'compose');

    it('prefers the project whose container publishes the bind port', async () => {
      const docker = fakeDocker([
        ['kvox', repo(), { ports: [3535] }],
        ['compose', repo(), { running: false }],
      ]);

      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toEqual({
        kind: 'found',
        project: 'kvox',
        basis: 'bind-port',
      });
    });

    it('prefers a RUNNING port holder over a stopped one that is configured to publish the same port', async () => {
      const docker = fakeDocker([
        ['compose', repo(), { running: false, ports: [3535] }],
        ['kvox', repo(), { ports: [3535] }],
      ]);

      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toMatchObject({
        project: 'kvox',
        basis: 'bind-port',
      });
    });

    it('uses a stopped port holder when no running container publishes the port', async () => {
      const docker = fakeDocker([
        ['compose', repo(), { running: false, ports: [3535] }],
        ['kvox', repo()],
      ]);

      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toMatchObject({
        project: 'compose',
        basis: 'bind-port',
      });
    });

    it('is ambiguous when two running projects publish the port', async () => {
      const docker = fakeDocker([
        ['alpha', repo(), { ports: [3535] }],
        ['zeta', repo(), { ports: [3535] }],
      ]);

      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toEqual({
        kind: 'ambiguous',
        projects: ['alpha', 'zeta'],
      });
    });

    it('ignores a port holder outside the folder, and a port that is only another port', async () => {
      const docker = fakeDocker([
        ['elsewhere', '/opt/tools', { ports: [3535] }],
        ['kvox', repo(), { ports: [3536] }],
        ['compose', repo(), { running: false }],
      ]);

      // Nothing here holds 3535, so the running project decides.
      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toEqual({
        kind: 'found',
        project: 'kvox',
        basis: 'running',
      });
    });

    it('counts a port range and ignores an empty HostPort', async () => {
      const ranged = fakeDocker([
        ['kvox', repo(), { ports: ['3530-3540'] }],
        ['compose', repo(), { running: false }],
      ]);
      const unpinned = fakeDocker([
        ['kvox', repo(), { ports: [''] }],
        ['compose', repo(), { running: false }],
      ]);

      expect(await detectComposeProject(root, ranged.run, { bindPort: 3535 })).toMatchObject({ basis: 'bind-port' });
      expect(await detectComposeProject(root, unpinned.run, { bindPort: 3535 })).toMatchObject({ basis: 'running' });
    });

    it('decides by the running containers without a bind port (the 2-argument form)', async () => {
      const docker = fakeDocker([
        ['kvox', repo()],
        ['compose', repo(), { running: false }],
      ]);

      expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'found', project: 'kvox', basis: 'running' });
    });

    it('is ambiguous when nothing separates the projects', async () => {
      const docker = fakeDocker([
        ['kvox', repo(), { running: false }],
        ['compose', repo(), { running: false }],
      ]);

      expect(await detectComposeProject(root, docker.run, { bindPort: 3535 })).toEqual({
        kind: 'ambiguous',
        projects: ['compose', 'kvox'],
      });
    });
  });

  it('is unavailable, never a throw, when the runner rejects', async () => {
    await expect(detectComposeProject(root, fakeDocker('down').run)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is unavailable when the runner throws synchronously', async () => {
    const run: ComposeProjectCommandRunner = () => {
      throw new Error('spawn docker ENOENT');
    };

    await expect(detectComposeProject(root, run)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is unavailable when the command exits non-zero (the real runner rejects)', async () => {
    const run: ComposeProjectCommandRunner = async () => {
      throw nonZero();
    };

    await expect(detectComposeProject(root, run)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is unavailable when only the inspect fails', async () => {
    const run: ComposeProjectCommandRunner = async (argv) => {
      if (argv[1] === 'ps') return { stdout: 'abc\n' };
      throw nonZero();
    };

    await expect(detectComposeProject(root, run)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('is segment-aware: a sibling folder sharing the prefix is not under the root', async () => {
    const docker = fakeDocker([['sibling', `${root}-2/repo/infra/compose`]]);

    expect(await detectComposeProject(root, docker.run)).toEqual({ kind: 'none' });
  });

  it('ignores a container with no labels (the nil-guard line `|`) and one missing either label', async () => {
    const run = rawDocker(
      'a\nb\nc\nd\n',
      `/a|true||||\n/b|true|||${root}/repo\n/c|true|||lost|\n/d|true||myapp|${root}/repo\n`,
    );

    expect(await detectComposeProject(root, run)).toEqual({ kind: 'found', project: 'myapp', basis: 'only' });
  });

  it('ignores a line without a separator, such as the `<no value>` an unguarded template prints', async () => {
    const run = rawDocker('a\nb\n', `<no value>\n/b|true||myapp|${root}\n`);

    expect(await detectComposeProject(root, run)).toEqual({ kind: 'found', project: 'myapp', basis: 'only' });
  });

  it('keeps a working directory that itself contains a separator', async () => {
    const run = rawDocker('a\n', `/a|true||myapp|${root}/re|po\n`);

    expect(await detectComposeProject(root, run)).toEqual({ kind: 'found', project: 'myapp', basis: 'only' });
  });

  it('asks Docker once for the ids, then ONCE for every inspect, ids as separate argv entries', async () => {
    const docker = fakeDocker([
      ['myapp', root],
      ['tools', '/opt/tools'],
      ['myapp', root],
    ]);

    await detectComposeProject(root, docker.run);

    expect(docker.calls).toHaveLength(2);
    expect(docker.calls[0]?.argv).toEqual(['docker', 'ps', '-aq']);
    const inspect = docker.calls[1]?.argv ?? [];
    expect(inspect.slice(0, 3)).toEqual(['docker', 'inspect', '--format']);
    // The ids come last, one argv entry each: no shell string anywhere.
    expect(inspect.slice(4)).toEqual(['id0', 'id1', 'id2']);
    expect(inspect.slice(4).some((entry) => /\s/.test(entry))).toBe(false);
  });

  it('asks the inspect for the name, the running state and the published ports as well', async () => {
    const docker = fakeDocker([['myapp', root]]);

    await detectComposeProject(root, docker.run, { bindPort: 3535 });

    const format = docker.calls[1]?.argv[3] ?? '';
    expect(format).toContain('.Name');
    expect(format).toContain('.State.Running');
    expect(format).toContain('.HostConfig.PortBindings');
  });

  it('asks the inspect for BOTH compose labels, guarding a container without labels', async () => {
    const docker = fakeDocker([['myapp', root]]);

    await detectComposeProject(root, docker.run);

    const format = docker.calls[1]?.argv[3] ?? '';
    expect(format).toContain(COMPOSE_PROJECT_LABEL);
    expect(format).toContain(COMPOSE_WORKING_DIR_LABEL);
    expect(format).toContain('{{if .Config.Labels}}');
  });

  it('bounds every call with a timeout so a wedged socket cannot hang the command', async () => {
    const docker = fakeDocker([['myapp', root]]);

    await detectComposeProject(root, docker.run);

    for (const call of docker.calls) {
      expect(call.options.timeoutMs).toBeGreaterThan(0);
      expect(call.options.timeoutMs).toBeLessThanOrEqual(30_000);
    }
  });

  it('includes stopped containers (`-a`), which keep their labels', async () => {
    const docker = fakeDocker([['myapp', root]]);

    await detectComposeProject(root, docker.run);

    expect(docker.calls[0]?.argv).toContain('-aq');
  });
});

describe('reconcileComposeProject', () => {
  let work: string;
  let root: string;
  let statePath: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'appctl-reconcile-'));
    root = join(work, 'apps', 'myapp');
    mkdirSync(root, { recursive: true });
    statePath = deployStatePath(root);
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  /** A state with a good many fields, so "everything else is kept" means something. */
  function stateOf(overrides: Partial<DeployState> = {}): DeployState {
    return {
      version: DEPLOY_STATE_VERSION,
      repoUrl: 'https://example.test/o/r',
      ref: 'main',
      commitSha: 'a'.repeat(40),
      deployedHead: 'b'.repeat(40),
      domain: 'app.example.test',
      bindPort: 3535,
      deployRoot: root,
      installedAt: '2026-01-01T00:00:00.000Z',
      lastDeployedAt: '2026-01-02T00:00:00.000Z',
      lastCommand: 'install',
      appctlVersion: '1.0.0',
      proxyRoot: join(work, 'proxy'),
      groups: ['observability'],
      ...overrides,
    } as DeployState;
  }

  /** Writes the state with the engine's own writer and returns it as the caller would have loaded it. */
  function install(overrides: Partial<DeployState> = {}): DeployState {
    const state = stateOf(overrides);
    writeState(state);
    return state;
  }

  const raw = (): Record<string, unknown> => JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  const underRoot = (): string => join(root, 'repo', 'infra', 'compose');

  it('records the project Docker names when the state records none, keeping every other field', async () => {
    const state = install();
    const before = raw();
    const docker = fakeDocker([['myapp', underRoot()]]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.state).toEqual({ ...state, composeProject: 'myapp' });
    expect(raw()).toEqual({ ...before, composeProject: 'myapp' });
    expect(result.message).toContain('recorded compose project myapp');
    expect(result.message).toContain(root);
  });

  it('does not bump the state version', async () => {
    const state = install();

    await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker([['myapp', underRoot()]]).run });

    expect(raw()['version']).toBe(DEPLOY_STATE_VERSION);
    expect(readState(root)?.version).toBe(DEPLOY_STATE_VERSION);
  });

  it('keeps the previous file once as .appctl-deploy.json.bak, mode 0600, with the original content', async () => {
    const state = install();
    const original = readFileSync(statePath, 'utf8');

    await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker([['myapp', underRoot()]]).run });

    expect(`${statePath}.bak`.endsWith('.appctl-deploy.json.bak')).toBe(true);
    expect(readFileSync(`${statePath}.bak`, 'utf8')).toBe(original);
    expect(statSync(`${statePath}.bak`).mode & 0o777).toBe(0o600);
  });

  it('keeps an EXISTING .bak: the copy from before the first change is the one worth having', async () => {
    const state = install();
    writeFileSync(`${statePath}.bak`, 'the first backup\n');

    await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker([['myapp', underRoot()]]).run });

    expect(readFileSync(`${statePath}.bak`, 'utf8')).toBe('the first backup\n');
    expect(raw()['composeProject']).toBe('myapp');
  });

  it('leaves no temporary file behind', async () => {
    const state = install();

    await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker([['myapp', underRoot()]]).run });

    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('corrects the legacy `compose` an earlier failed attempt wrote back', async () => {
    const state = install({ composeProject: 'compose' });

    const result = await reconcileComposeProject({
      deployRoot: root,
      state,
      runCommand: fakeDocker([['myapp', underRoot()]]).run,
    });

    expect(result.state?.composeProject).toBe('myapp');
    expect(raw()['composeProject']).toBe('myapp');
    expect(result.message).toContain('had compose');
  });

  it('says the record had `none` when it recorded nothing', async () => {
    const state = install();

    const result = await reconcileComposeProject({
      deployRoot: root,
      state,
      runCommand: fakeDocker([['myapp', underRoot()]]).run,
    });

    expect(result.message).toContain('had none');
  });

  it('never overwrites a project recorded on purpose, and says nothing when Docker agrees or has no evidence', async () => {
    const state = install({ composeProject: 'pinned' });
    const before = readFileSync(statePath, 'utf8');

    for (const containers of [
      [['pinned', underRoot(), { ports: [3535] }]],
      [['myapp', underRoot()]],
      [],
    ] as FakeContainer[][]) {
      const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker(containers).run });

      expect(result.state).toBe(state);
      expect(result.message).toBeUndefined();
    }
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('never overwrites a recorded project, but WARNS when the container holding the bind port is of another one (#1020)', async () => {
    const state = install({ composeProject: 'pinned' });
    const before = readFileSync(statePath, 'utf8');
    const docker = fakeDocker([['myapp', underRoot(), { ports: [3535] }]]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.state).toBe(state);
    expect(result.message).toContain('warning');
    expect(result.message).toContain('pinned');
    expect(result.message).toContain('myapp');
    expect(result.message).toContain('3535');
    expect(result.message).toContain(statePath);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('is a no-op when Docker names the project the legacy default already says', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');

    const result = await reconcileComposeProject({
      deployRoot: root,
      state,
      runCommand: fakeDocker([['compose', underRoot()]]).run,
    });

    expect(result.state).toBe(state);
    expect(result.message).toBeUndefined();
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('is a no-op when no container belongs to the folder', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');

    for (const containers of [[], [['tools', '/opt/tools']], [['sibling', `${root}-2/repo`]]] as FakeContainer[][]) {
      const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker(containers).run });

      expect(result.state).toBe(state);
      expect(result.message).toBeUndefined();
    }
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('is a no-op when Docker cannot be asked', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: fakeDocker('down').run });

    expect(result.state).toBe(state);
    expect(result.message).toBeUndefined();
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('is idempotent: a second run changes nothing and says nothing', async () => {
    const state = install();
    const docker = fakeDocker([['myapp', underRoot()]]);
    const first = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });
    const after = readFileSync(statePath, 'utf8');

    const again = await reconcileComposeProject({ deployRoot: root, state: first.state, runCommand: docker.run });

    expect(again.message).toBeUndefined();
    expect(again.state).toBe(first.state);
    expect(readFileSync(statePath, 'utf8')).toBe(after);
  });

  it('warns, naming the projects and the state file, and writes nothing, when several projects run here', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');
    const docker = fakeDocker([
      ['zeta', underRoot()],
      ['alpha', underRoot()],
    ]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.message).toContain('warning');
    expect(result.message).toContain('alpha, zeta');
    expect(result.message).toContain(statePath);
    expect(result.state).toBe(state);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('is NOT silent when the several projects include `compose` and nothing is decisive (#1020)', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');
    const docker = fakeDocker([
      ['compose', underRoot()],
      ['myapp', underRoot()],
    ]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.message).toContain('warning');
    expect(result.message).toContain('compose, myapp');
    expect(result.message).toContain(statePath);
    expect(result.state).toBe(state);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('REGRESSION #1020: records the project that holds the bind port, not the legacy `compose` beside it', async () => {
    const state = install();
    // The live stack, plus the legacy project's leftovers: one stopped nginx that
    // is CONFIGURED to publish the same port.
    const docker = fakeDocker([
      ['myapp', underRoot(), { name: 'myapp-nginx-1', ports: [3535] }],
      ['myapp', underRoot(), { name: 'myapp-api-1' }],
      ['compose', underRoot(), { name: 'compose-nginx-1', running: false, ports: [3535] }],
      ['compose', underRoot(), { name: 'compose-api-1', running: false }],
    ]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.state?.composeProject).toBe('myapp');
    expect(raw()['composeProject']).toBe('myapp');
    expect(result.message).toContain('it holds port 3535');
  });

  it('decides by the running containers when none publishes the port', async () => {
    const state = install();
    const docker = fakeDocker([
      ['myapp', underRoot()],
      ['compose', underRoot(), { running: false }],
    ]);

    const result = await reconcileComposeProject({ deployRoot: root, state, runCommand: docker.run });

    expect(result.state?.composeProject).toBe('myapp');
    expect(result.message).toContain('only project with a running container');
  });

  it('says the project is the only one here when it alone has containers', async () => {
    const result = await reconcileComposeProject({
      deployRoot: root,
      state: install(),
      runCommand: fakeDocker([['myapp', underRoot(), { running: false }]]).run,
    });

    expect(result.message).toContain('only project with containers here');
  });

  it('still returns the corrected project, and says it was not recorded, when the file cannot be written', async () => {
    const state = install();
    const before = readFileSync(statePath, 'utf8');
    // `writeState` creates `<file>.<pid>.tmp` exclusively: a directory in the way makes it fail
    // even for root, which a chmod would not.
    mkdirSync(`${statePath}.${process.pid}.tmp`);

    const result = await reconcileComposeProject({
      deployRoot: root,
      state,
      runCommand: fakeDocker([['myapp', underRoot()]]).run,
    });

    expect(result.state?.composeProject).toBe('myapp');
    expect(result.message).toContain('could not be recorded');
    expect(result.message).toContain('myapp');
    expect(result.message).toContain(statePath);
    // The record on disk is exactly what it was.
    expect(readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('only corrects the state in memory when no state file is on disk (an adopted deployment)', async () => {
    const adopted = stateOf();
    const docker = fakeDocker([['myapp', underRoot()]]);

    const result = await reconcileComposeProject({ deployRoot: root, state: adopted, runCommand: docker.run });

    expect(result.state).toEqual({ ...adopted, composeProject: 'myapp' });
    expect(result.message).toContain('recorded compose project myapp');
    expect(existsSync(statePath)).toBe(false);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
  });

  it('only corrects the state in memory when it records a different deploy root', async () => {
    install();
    const before = readFileSync(statePath, 'utf8');
    const elsewhere = join(work, 'moved', 'myapp');
    const moved = stateOf({ deployRoot: elsewhere });

    const result = await reconcileComposeProject({
      deployRoot: root,
      state: moved,
      runCommand: fakeDocker([['myapp', underRoot()]]).run,
    });

    expect(result.state?.composeProject).toBe('myapp');
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(existsSync(`${statePath}.bak`)).toBe(false);
    // `writeState` would have created the other folder.
    expect(existsSync(elsewhere)).toBe(false);
  });

  it('is a no-op for an absent state: there is nothing to reconcile and Docker is not asked', async () => {
    const run = vi.fn(fakeDocker([['myapp', underRoot()]]).run);

    const result = await reconcileComposeProject({ deployRoot: root, state: undefined, runCommand: run });

    expect(result).toEqual({ state: undefined });
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(statePath)).toBe(false);
  });

  it('never throws: a runner that throws leaves the state as given', async () => {
    const state = install();
    const run: ComposeProjectCommandRunner = () => {
      throw new Error('boom');
    };

    await expect(reconcileComposeProject({ deployRoot: root, state, runCommand: run })).resolves.toEqual({ state });
  });

  it('never throws: a state that cannot be reasoned about comes back as given', async () => {
    // A record read from a hand-edited file: no deployRoot at all. Writing it would throw.
    const broken = { ...stateOf(), deployRoot: undefined } as unknown as DeployState;
    install();

    const result = await reconcileComposeProject({
      deployRoot: root,
      state: broken,
      runCommand: fakeDocker([['myapp', underRoot()]]).run,
    });

    expect(result.state).toBe(broken);
  });
});

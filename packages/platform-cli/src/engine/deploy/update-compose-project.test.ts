import { existsSync, readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { registerDeployCheck, resetDeployCheckRegistryForTests } from './checks/registry.js';
import { DEPLOY_STATE_VERSION, deployStatePath, readState, writeState, type DeployState } from './state.js';
import { createFakeVps, serveHealth, type FakeVps } from './testing/fake-vps.js';
import { runUpdate } from './update.js';

// =============================================================================
// `deploy update` runs compose under the project the containers REALLY use (#1015)
// =============================================================================
//
// A server installed by a pre-platform CLI runs under an app-named compose
// project (`myapp-nginx-1`) and recorded none. The engine read the absent value
// as the legacy `compose`, so every `docker compose -p compose ...` of an update
// looked at a stack that is not there, and `up -d` started a SECOND one on the
// bind port. These tests run the REAL update pipeline on a fake server whose
// containers run under `myapp` and whose state file says nothing, and read the
// argv the pipeline actually emitted.
//
// ⚠ The fake never spawns docker (see fake-vps.ts): what these prove is the
// project NAME that reaches every compose argv and the check context, which is
// exactly the bookkeeping that failed.
// =============================================================================

const DF = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100000000 10000000 80000000 12% /';

let api: Awaited<ReturnType<typeof serveHealth>>;

beforeAll(async () => {
  api = await serveHealth();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  resetDeployCheckRegistryForTests();
});

/**
 * One container: its compose project and the directory compose ran from. A
 * relative directory is inside the deployment; an absolute one is taken as is.
 */
type Container = readonly [project: string, workingDir: string];

interface Deployment {
  vps: FakeVps;
  /** The `composeProject` the check context carried, one entry per preflight run. */
  seenByChecks: Array<string | undefined>;
  progress: string[];
}

/**
 * A deployment as the pre-platform CLI left it: a checkout, an `.env`, a state
 * file that records NO compose project, and containers Docker knows under
 * whichever projects the test names.
 */
function deployment(containers: readonly Container[] | 'down', recorded: Partial<DeployState> = {}): Deployment {
  const vps = createFakeVps({ withCheckout: true, files: { '.env': 'APP_BIND_PORT=3535\n' } });
  const state = {
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    deployedHead: 'a'.repeat(40),
    bindPort: api.port,
    deployRoot: vps.deployRoot,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
    ...recorded,
  } as DeployState;
  writeState(state);

  vps.route(['df'], DF);
  vps.route(['git', 'rev-parse', 'HEAD'], 'e'.repeat(40));
  vps.route((invocation) => invocation.argv.includes('curl'), '200');
  vps.route(['docker', 'ps', '-aq'], (): { stdout?: string; fail?: Error } =>
    containers === 'down'
      ? { fail: new Error('Cannot connect to the Docker daemon') }
      : { stdout: containers.map((_, index) => `id${index}`).join('\n') },
  );
  vps.route(['docker', 'inspect', '--format'], () =>
    containers === 'down'
      ? ''
      : containers.map(([project, dir]) => `${project}|${dir.startsWith('/') ? dir : vps.path(dir)}`).join('\n'),
  );

  const seenByChecks: Array<string | undefined> = [];
  registerDeployCheck({
    id: 'records-compose-project',
    title: 'Records the compose project',
    severity: 'required',
    run: async (context) => {
      seenByChecks.push(context.composeProject);
      return { status: 'pass', detail: 'ok' };
    },
  });

  return { vps, seenByChecks, progress: [] };
}

function update(subject: Deployment) {
  return runUpdate({
    deployRoot: subject.vps.deployRoot,
    runCommand: subject.vps.runCommand,
    nonInteractive: true,
    skipProxy: true,
    skipSeed: true,
    noVersionBump: true,
    skipOAuthCheck: true,
    // The checkout is "already deployed" otherwise, and nothing would run.
    force: true,
    hooks: { onProgress: (message: string) => subject.progress.push(message) },
  });
}

/**
 * The `-p` value of every project-scoped `docker compose` invocation (the ones
 * naming compose files; `docker compose version` is a probe of the plugin);
 * undefined where none was passed.
 */
function composeProjects(vps: FakeVps): Array<string | undefined> {
  return vps.calls('docker', 'compose').filter((call) => call.argv.includes('-f')).map((call) => {
    const at = call.argv.indexOf('-p');
    return at === -1 ? undefined : call.argv[at + 1];
  });
}

/** The compose invocations that change the stack. */
function mutations(vps: FakeVps): string[][] {
  return vps
    .calls('docker', 'compose')
    .map((call) => [...call.argv])
    .filter((argv) => argv.some((word) => ['build', 'up', 'run', 'stop', 'restart'].includes(word)));
}

const INSTALLED_BY_AN_OLDER_CLI: readonly Container[] = [
  ['myapp', 'repo/infra/compose'],
  ['myapp', 'repo/infra/compose'],
];

describe('runUpdate uses the compose project Docker reports when none is recorded', () => {
  it('REGRESSION #1015: a server whose containers run under an app-named project is not driven as `-p compose`', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI);

    await update(subject);

    // Every compose call of the update names the real project...
    const projects = composeProjects(subject.vps);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((project) => project === 'myapp')).toBe(true);
    // ...in particular the ones that would have started a second stack.
    const changing = mutations(subject.vps);
    expect(changing.some((argv) => argv.includes('build'))).toBe(true);
    expect(changing.some((argv) => argv.includes('up'))).toBe(true);
    for (const argv of changing) expect(argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 'myapp']);
    expect(subject.vps.invocations.some((call) => call.argv.join(' ').includes('-p compose'))).toBe(false);
    // The deploy checks are told the same.
    expect(subject.seenByChecks).toEqual(['myapp']);
  });

  it('puts `-p <project>` before the -f flags, where Compose expects it', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI);

    await update(subject);

    for (const call of subject.vps.calls('docker', 'compose').filter((c) => c.argv.includes('-f'))) {
      expect(call.argv.indexOf('-p')).toBeGreaterThan(-1);
      expect(call.argv.indexOf('-p')).toBeLessThan(call.argv.indexOf('-f'));
    }
  });

  it('records the project in the state file, keeping the previous file once as .bak', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI);
    const before = readFileSync(deployStatePath(subject.vps.deployRoot), 'utf8');

    await update(subject);

    expect(readState(subject.vps.deployRoot)?.composeProject).toBe('myapp');
    expect(readFileSync(`${deployStatePath(subject.vps.deployRoot)}.bak`, 'utf8')).toBe(before);
  });

  it('tells the operator, in the journal and through the progress hook', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI);

    const result = await update(subject);

    const note = subject.progress.find((message) => message.includes('recorded compose project myapp'));
    expect(note).toBeDefined();
    expect(readFileSync(result.journalPath, 'utf8')).toContain(note as string);
  });

  it('corrects the legacy `compose` an earlier failed install attempt wrote back', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI, { composeProject: 'compose' });

    await update(subject);

    expect(composeProjects(subject.vps).every((project) => project === 'myapp')).toBe(true);
    expect(subject.seenByChecks).toEqual(['myapp']);
    expect(readState(subject.vps.deployRoot)?.composeProject).toBe('myapp');
  });

  it('keeps the project the operator recorded, and does not ask Docker at all', async () => {
    const subject = deployment(INSTALLED_BY_AN_OLDER_CLI, { composeProject: 'pinned' });

    await update(subject);

    expect(composeProjects(subject.vps).every((project) => project === 'pinned')).toBe(true);
    expect(subject.seenByChecks).toEqual(['pinned']);
    expect(subject.vps.calls('docker', 'ps')).toEqual([]);
    expect(subject.vps.calls('docker', 'inspect', '--format')).toEqual([]);
    expect(existsSync(`${deployStatePath(subject.vps.deployRoot)}.bak`)).toBe(false);
    expect(subject.progress.some((message) => message.includes('compose project'))).toBe(false);
  });

  it('still uses `compose` when Docker cannot be asked: the update is not made to fail', async () => {
    const subject = deployment('down');

    await update(subject);

    expect(composeProjects(subject.vps).every((project) => project === 'compose')).toBe(true);
    expect(subject.seenByChecks).toEqual(['compose']);
    expect(readState(subject.vps.deployRoot)?.composeProject).toBeUndefined();
  });

  it('still uses `compose` when Docker knows no container of this deployment', async () => {
    const subject = deployment([['tools', '/opt/tools']]);

    await update(subject);

    expect(composeProjects(subject.vps).every((project) => project === 'compose')).toBe(true);
    expect(subject.seenByChecks).toEqual(['compose']);
  });

  it('warns, and changes nothing, when containers of several projects run here', async () => {
    const subject = deployment([
      ['alpha', 'repo/infra/compose'],
      ['zeta', 'repo/infra/compose'],
    ]);

    const result = await update(subject);

    const warning = subject.progress.find((message) => message.startsWith('warning:'));
    expect(warning).toContain('alpha, zeta');
    expect(warning).toContain(deployStatePath(subject.vps.deployRoot));
    expect(readFileSync(result.journalPath, 'utf8')).toContain('alpha, zeta');
    expect(composeProjects(subject.vps).every((project) => project === 'compose')).toBe(true);
    expect(readState(subject.vps.deployRoot)?.composeProject).toBeUndefined();
    expect(existsSync(`${deployStatePath(subject.vps.deployRoot)}.bak`)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { CommandFailedError, type CommandResult, type RunCommandOptions } from '../executor.js';
import { deployStatePath } from '../state.js';
import { inspectOutput, psOutput, type FakeContainer } from '../testing/fake-containers.js';
import { ALL_CHECKS, requiredChecks } from './index.js';
import { COMPOSE_CHECKS } from './compose.js';
import { checksPassed, runChecks, type Check, type CheckContext } from './types.js';

// =============================================================================
// bind-port-owner and stray-compose-stack  (#1020)
// =============================================================================
//
// Driven through an injected runCommand that answers the engine's two Docker
// questions (`docker ps -aq`, then one `docker inspect --format`) from a list
// of containers, as the real Docker would.
// =============================================================================

const ROOT = '/opt/infra/apps/kvox';
const COMPOSE_DIR = `${ROOT}/repo/infra/compose`;
const PORT = 3535;

function docker(containers: readonly FakeContainer[] | 'down'): CheckContext['runCommand'] {
  return (async (argv: readonly string[], options: RunCommandOptions): Promise<CommandResult> => {
    const result = (stdout: string): CommandResult => ({
      argv: [...argv],
      cwd: options.cwd,
      exitCode: 0,
      stdout,
      stderr: '',
      durationMs: 1,
      timedOut: false,
    });
    if (containers === 'down') {
      throw new CommandFailedError('Cannot connect to the Docker daemon', { ...result(''), exitCode: 1 });
    }
    if (argv[1] === 'ps') return result(psOutput(containers));
    if (argv[1] === 'inspect') return result(inspectOutput(containers));
    throw new Error(`unexpected command ${argv.join(' ')}`);
  }) as CheckContext['runCommand'];
}

function context(containers: readonly FakeContainer[] | 'down', overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    runCommand: docker(containers),
    deployRoot: ROOT,
    bindPort: PORT,
    composeProject: 'kvox',
    proxyRoot: '/opt/infra/proxy',
    ...overrides,
  };
}

const find = (id: string): Check => {
  const check = COMPOSE_CHECKS.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(`no check ${id}`);
  return check;
};

const live: FakeContainer = { project: 'kvox', workingDir: COMPOSE_DIR, name: 'kvox-nginx-1', ports: [PORT] };

describe('bind-port-owner', () => {
  const check = find('bind-port-owner');

  it('is a required check in the registry, after docker-daemon, and in the install preflight', () => {
    expect(check.severity).toBe('required');
    expect(check.requires).toEqual(['docker-daemon']);
    expect(ALL_CHECKS.indexOf(check)).toBeGreaterThan(ALL_CHECKS.findIndex((c) => c.id === 'docker-daemon'));
    expect(requiredChecks(ALL_CHECKS, context([])).map((c) => c.id)).toContain('bind-port-owner');
  });

  it('passes when nothing publishes the port', async () => {
    const result = await check.run(context([{ project: 'kvox', workingDir: COMPOSE_DIR, ports: [8080] }]));

    expect(result.status).toBe('pass');
  });

  it('passes when the only claimant is of the run project, in any state', async () => {
    for (const running of [true, false]) {
      const result = await check.run(context([{ ...live, running }]));

      expect(result.status).toBe('pass');
      expect(result.detail).toContain('kvox-nginx-1');
    }
  });

  it('is skipped, never failed, when Docker cannot be asked', async () => {
    const result = await check.run(context('down'));

    expect(result.status).toBe('skip');
  });

  it('is skipped by `requires` when docker-daemon did not pass, like every dependent check', async () => {
    const [result] = await runChecks([check], context([live]));

    // runChecks only skips on a missing required result; with none run, it is unmet.
    expect(result?.status).toBe('skip');
  });

  describe("fails when this deployment's stack runs under another project", () => {
    it('names both projects and offers the state-file fix and the removal command', async () => {
      const result = await check.run(
        context([live], { composeProject: 'compose' }),
      );

      expect(result.status).toBe('fail');
      expect(result.detail).toContain("this deployment's stack runs under project kvox but this run would use compose");
      expect(result.detail).toContain(`second stack would collide on port ${PORT}`);
      expect(result.remedy).toContain(`"composeProject" to kvox in ${deployStatePath(ROOT)}`);
      expect(result.remedy).toContain(
        `docker ps -aq --filter label=com.docker.compose.project=kvox --filter label=com.docker.compose.project.working_dir=${COMPOSE_DIR} | xargs -r docker rm -f`,
      );
    });

    it('fails on a STOPPED leftover when no running container of the run project holds the port', async () => {
      const stopped: FakeContainer = { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-nginx-1', running: false, ports: [PORT] };

      for (const own of [[], [{ ...live, running: false }], [{ project: 'kvox', workingDir: COMPOSE_DIR, name: 'kvox-api-1' }]]) {
        const result = await check.run(context([...own, stopped]));

        expect(result.status).toBe('fail');
        expect(result.detail).toContain('compose-nginx-1, not running');
        expect(result.remedy).toContain('label=com.docker.compose.project=compose ');
      }
    });

    it('only WARNS about a stopped leftover of this folder when a RUNNING container of the run project holds the port', async () => {
      const result = await check.run(
        context([live, { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-nginx-1', running: false, ports: [PORT] }]),
      );

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('compose-nginx-1');
      expect(result.detail).toContain('stopped leftover');
      expect(result.remedy).toContain(
        `docker ps -aq --filter label=com.docker.compose.project=compose --filter label=com.docker.compose.project.working_dir=${COMPOSE_DIR} | xargs -r docker rm -f`,
      );
      // A warning never fails a run.
      const [completed] = await runChecks([check], context([live, { project: 'compose', workingDir: COMPOSE_DIR, running: false, ports: [PORT] }]));
      expect(completed && checksPassed([completed])).toBe(true);
    });

    it('still FAILS when the foreign claimant runs, or is outside this folder, even with a live own holder', async () => {
      const running = await check.run(
        context([live, { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-nginx-1', ports: [PORT] }]),
      );
      const outside = await check.run(
        context([live, { project: 'tools', workingDir: '/opt/tools', name: 'tools-web-1', running: false, ports: [PORT] }]),
      );

      expect(running.status).toBe('fail');
      expect(outside.status).toBe('fail');
      expect(outside.detail).toContain('tools-web-1');
    });

    it('does not count a leftover that publishes nothing', async () => {
      const result = await check.run(
        context([live, { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-api-1', running: false }]),
      );

      expect(result.status).toBe('pass');
    });
  });

  describe('fails when the port is promised to something outside this deployment', () => {
    it('names the container and its project, with --port as the way out', async () => {
      const result = await check.run(
        context([{ project: 'tools', workingDir: '/opt/tools', name: 'tools-web-1', ports: [PORT] }]),
      );

      expect(result.status).toBe('fail');
      expect(result.detail).toBe(`port ${PORT} is promised to tools-web-1 (project tools)`);
      expect(result.remedy).toContain('--port');
      expect(result.remedy).toContain('tools-web-1');
    });

    it('counts a container with no compose label as foreign', async () => {
      const result = await check.run(context([{ project: '', workingDir: '', name: 'hand-run', ports: [PORT] }]));

      expect(result.status).toBe('fail');
      expect(result.detail).toContain('hand-run (not a compose container)');
    });

    it('counts a container of the run project started from OUTSIDE the folder as the run project (the project is the identity)', async () => {
      const result = await check.run(context([{ project: 'kvox', workingDir: '/elsewhere', name: 'kvox-nginx-1', ports: [PORT] }]));

      expect(result.status).toBe('pass');
    });

    it('sees a port range and ignores an empty HostPort', async () => {
      const ranged = await check.run(
        context([{ project: 'tools', workingDir: '/opt/tools', ports: ['3530-3540'] }]),
      );
      const unpinned = await check.run(context([{ project: 'tools', workingDir: '/opt/tools', ports: [''] }]));

      expect(ranged.status).toBe('fail');
      expect(unpinned.status).toBe('pass');
    });
  });

  describe('with no known project (a fresh install)', () => {
    const fresh = (containers: readonly FakeContainer[]): CheckContext => context(containers, { composeProject: undefined });

    it('passes when nothing claims the port', async () => {
      expect((await check.run(fresh([]))).status).toBe('pass');
    });

    it("passes for a container of the folder's own name started from inside the folder", async () => {
      const result = await check.run(fresh([{ project: 'kvox', workingDir: COMPOSE_DIR, ports: [PORT] }]));

      expect(result.status).toBe('pass');
    });

    it('fails for any other claimant, naming the project a fresh install would use', async () => {
      const inside = await check.run(fresh([{ project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-nginx-1', ports: [PORT] }]));
      const outside = await check.run(fresh([{ project: 'kvox', workingDir: '/elsewhere', name: 'kvox-nginx-1', ports: [PORT] }]));

      expect(inside.status).toBe('fail');
      expect(inside.detail).toContain('would use kvox');
      expect(outside.status).toBe('fail');
      expect(outside.detail).toContain('is promised to kvox-nginx-1');
    });
  });
});

describe('stray-compose-stack', () => {
  const check = find('stray-compose-stack');

  it('is a recommended check, so only doctor runs it', () => {
    expect(check.severity).toBe('recommended');
    expect(requiredChecks(ALL_CHECKS, context([])).map((c) => c.id)).not.toContain('stray-compose-stack');
  });

  it('passes when every container of the folder is of the run project', async () => {
    const result = await check.run(context([live, { project: 'tools', workingDir: '/opt/tools' }]));

    expect(result.status).toBe('pass');
  });

  it('warns about containers of another project started from inside the folder, with the exact removal command', async () => {
    const result = await check.run(
      context([live, { project: 'compose', workingDir: COMPOSE_DIR, name: 'compose-api-1', running: false }]),
    );

    expect(result.status).toBe('warn');
    expect(result.detail).toContain('project compose');
    expect(result.detail).toContain('compose-api-1, not running');
    expect(result.remedy).toContain(
      `docker ps -aq --filter label=com.docker.compose.project=compose --filter label=com.docker.compose.project.working_dir=${COMPOSE_DIR} | xargs -r docker rm -f`,
    );
    expect(result.remedy).toContain(deployStatePath(ROOT));
  });

  it('never runs anything that changes Docker', async () => {
    const seen: string[][] = [];
    const base = docker([live, { project: 'compose', workingDir: COMPOSE_DIR }]);
    const recording = ((argv, options) => {
      seen.push([...argv]);
      return base(argv, options);
    }) as CheckContext['runCommand'];

    await check.run(context([], { runCommand: recording }));

    expect(seen.every((argv) => argv[0] === 'docker' && (argv[1] === 'ps' || argv[1] === 'inspect'))).toBe(true);
  });

  it('is skipped when no project is known, and when Docker cannot be asked', async () => {
    expect((await check.run(context([live], { composeProject: undefined }))).status).toBe('skip');
    expect((await check.run(context('down'))).status).toBe('skip');
  });
});

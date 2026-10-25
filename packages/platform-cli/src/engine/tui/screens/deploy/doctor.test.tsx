import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Check } from '../../../deploy/checks/index.js';
import type { runCommand } from '../../../deploy/executor.js';
import { DEPLOY_STATE_VERSION, deployStatePath, type DeployState } from '../../../deploy/state.js';
import { inspectOutput, psOutput, type FakeContainer } from '../../../deploy/testing/fake-containers.js';
import { DoctorScreen } from './doctor.js';

// =============================================================================
// The TUI doctor asks the compose project the containers really run under  (#1015)
// =============================================================================
//
// `performDoctor` is not exported; the screen is the only way in, so this drives
// the real DoctorScreen (name, advanced, domain, run) with ink's own `render`
// into a PassThrough terminal (ink-testing-library is not a dependency; see
// android/screen.test.tsx). Three seams are replaced: the apps root (a
// temporary folder), `runCommand` (a fake Docker) and the list of checks (one
// that records the context it was given and waits to be released, so the
// running frame, which carries the log, is on screen while the test reads it).
// =============================================================================

const world = vi.hoisted(() => ({
  appsRoot: '',
  run: undefined as unknown as typeof runCommand,
  check: undefined as unknown as Check,
}));

vi.mock('../../../deploy/layout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deploy/layout.js')>();
  return {
    ...actual,
    get DEFAULT_APPS_ROOT() {
      return world.appsRoot;
    },
  };
});

vi.mock('../../../deploy/executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deploy/executor.js')>();
  return { ...actual, runCommand: ((...args: Parameters<typeof runCommand>) => world.run(...args)) as typeof runCommand };
});

vi.mock('../../../deploy/checks/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../deploy/checks/index.js')>();
  return { ...actual, allChecks: () => [world.check] };
});

const ENTER = '\r';
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventuallyContains(frame: () => string, text: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!frame().includes(text) && Date.now() < deadline) await settle(25);
  expect(frame()).toContain(text);
}

interface Harness {
  frame: () => string;
  press: (...keys: string[]) => Promise<void>;
  unmount: () => void;
}

async function mount(located: string): Promise<Harness> {
  const stdout = Object.assign(new PassThrough(), { columns: 220, rows: 70, isTTY: true });
  let output = '';
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => undefined,
    ref: () => undefined,
    unref: () => undefined,
  });
  const app = render(<DoctorScreen onDone={() => undefined} located={located} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await settle(200);
  return {
    frame: () => {
      const marker = output.lastIndexOf('╭');
      return marker === -1 ? output : output.slice(marker);
    },
    press: async (...keys) => {
      for (const key of keys) {
        stdin.write(key);
        await settle(120);
      }
    },
    unmount: () => app.unmount(),
  };
}

let work: string;
let root: string;
let harness: Harness | undefined;
let release: () => void;
let seen: Array<string | undefined>;
let docker: string[][];

/** What `docker ps -aq` and `docker inspect` answer: `[project, directory, extra?]`, relative to the deployment. */
type Container = readonly [project: string, directory: string, extra?: Partial<FakeContainer>];

function useDocker(containers: readonly Container[] | 'down'): void {
  world.run = (async (argv: readonly string[]) => {
    const isPs = argv[0] === 'docker' && argv[1] === 'ps' && argv.includes('-aq');
    const isInspect =
      argv[0] === 'docker' && argv[1] === 'inspect' && argv.some((word) => word.includes('com.docker.compose.project'));
    if (!isPs && !isInspect) throw new Error(`${argv[0] ?? ''}: command not found`);
    docker.push([...argv]);
    if (containers === 'down') throw new Error('Cannot connect to the Docker daemon');
    const records = containers.map(([project, directory, extra]) => ({ project, workingDir: join(root, directory), ...extra }));
    const stdout = isPs ? psOutput(records) : inspectOutput(records);
    return { argv: [...argv], cwd: '', exitCode: 0, stdout, stderr: '', durationMs: 0, timedOut: false };
  }) as unknown as typeof runCommand;
}

function recordWith(overrides: Partial<DeployState> = {}): void {
  const state = {
    version: DEPLOY_STATE_VERSION,
    repoUrl: 'https://example.test/o/r',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    bindPort: 3535,
    deployRoot: root,
    installedAt: '2026-01-01T00:00:00.000Z',
    lastDeployedAt: '2026-01-02T00:00:00.000Z',
    lastCommand: 'install',
    appctlVersion: '1.0.0',
    ...overrides,
  };
  writeFileSync(deployStatePath(root), JSON.stringify(state));
}

/** Name (prefilled), Advanced ("Use these"), domain (empty): then the run starts. */
async function startRun(screen: Harness): Promise<void> {
  await eventuallyContains(screen.frame, 'Which deployment?');
  await screen.press(ENTER);
  await eventuallyContains(screen.frame, 'Use these');
  await screen.press(ENTER);
  await eventuallyContains(screen.frame, 'domain');
  await screen.press(ENTER);
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'appctl-tui-doctor-'));
  world.appsRoot = join(work, 'apps');
  root = join(world.appsRoot, 'myapp');
  mkdirSync(root, { recursive: true });
  seen = [];
  docker = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  world.check = {
    id: 'records-compose-project',
    title: 'records the compose project',
    severity: 'recommended',
    async run(context) {
      seen.push(context.composeProject);
      await gate;
      return { status: 'pass', detail: 'ok' };
    },
  };
});

afterEach(() => {
  release();
  harness?.unmount();
  harness = undefined;
  rmSync(work, { recursive: true, force: true });
});

describe('the TUI doctor: the compose project the containers really run under', () => {
  it('logs the note through hooks.onLog and hands the checks the project Docker reports', async () => {
    recordWith();
    useDocker([
      ['myapp', 'repo/infra/compose'],
      ['myapp', 'repo/infra/compose'],
    ]);
    harness = await mount('myapp');

    await startRun(harness);

    await eventuallyContains(harness.frame, 'recorded compose project myapp');
    expect(harness.frame()).toContain(root);
    expect(seen).toEqual(['myapp']);
    release();
    await eventuallyContains(harness.frame, 'doctor — passed');
    expect(JSON.parse(readFileSync(deployStatePath(root), 'utf8'))).toMatchObject({ composeProject: 'myapp' });
  });

  it('logs the warning, and keeps `compose`, when containers of several projects run in the folder', async () => {
    recordWith();
    useDocker([
      ['zeta', 'repo'],
      ['alpha', 'repo'],
    ]);
    harness = await mount('myapp');

    await startRun(harness);

    await eventuallyContains(harness.frame, 'alpha, zeta');
    expect(harness.frame()).toContain('warning:');
    expect(seen).toEqual(['compose']);
    expect(JSON.parse(readFileSync(deployStatePath(root), 'utf8'))).not.toHaveProperty('composeProject');
  });

  it('leaves a recorded project alone and says nothing when no container holds the bind port', async () => {
    recordWith({ composeProject: 'pinned' });
    useDocker([['myapp', 'repo/infra/compose']]);
    harness = await mount('myapp');

    await startRun(harness);

    await eventuallyContains(harness.frame, 'running');
    expect(seen).toEqual(['pinned']);
    expect(harness.frame()).not.toContain('recorded compose project');
    expect(JSON.parse(readFileSync(deployStatePath(root), 'utf8'))).toMatchObject({ composeProject: 'pinned' });
  });

  it('is unchanged when Docker cannot be asked: `compose`, and no note', async () => {
    recordWith();
    useDocker('down');
    harness = await mount('myapp');

    await startRun(harness);

    await eventuallyContains(harness.frame, 'running');
    expect(seen).toEqual(['compose']);
    expect(harness.frame()).not.toContain('compose project');
    release();
    await eventuallyContains(harness.frame, 'doctor — passed');
  });
});

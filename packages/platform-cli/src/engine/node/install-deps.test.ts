import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectDistro,
  ensureAptPackages,
  ensureDockerContainer,
  listInstallSteps,
  registerInstallStep,
  resetInstallStepRegistryForTests,
  runInstallDeps,
  runWithSudoAnnounced,
  type InstallContext,
  type InstallStep,
} from './install-deps.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'appctl-deps-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('detectDistro (issue #276)', () => {
  it('reads /etc/os-release content', () => {
    const distro = detectDistro({
      platform: 'linux',
      osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\nID_LIKE=debian\n',
    });
    expect(distro).toEqual({ id: 'ubuntu', versionId: '24.04', family: 'debian' });
  });

  it('classifies alpine and rhel families', () => {
    expect(detectDistro({ platform: 'linux', osRelease: 'ID=alpine\n' }).family).toBe('alpine');
    expect(detectDistro({ platform: 'linux', osRelease: 'ID=rocky\nID_LIKE="rhel centos fedora"\n' }).family).toBe('rhel');
  });

  it('falls back to unknown rather than guessing a package manager', () => {
    expect(detectDistro({ platform: 'linux', osRelease: 'ID=plan9\n' }).family).toBe('unknown');
  });

  it('handles the non-Linux platforms without reading a file', () => {
    expect(detectDistro({ platform: 'win32' }).family).toBe('windows');
    expect(detectDistro({ platform: 'darwin' }).family).toBe('darwin');
  });
});

describe('runInstallDeps', () => {
  function step(overrides: Partial<InstallStep> & Pick<InstallStep, 'id'>): InstallStep {
    return {
      label: overrides.id,
      supported: () => true,
      detect: () => false,
      install: () => {},
      ...overrides,
    } as InstallStep;
  }

  it('--dry-run performs no mutation and reports the plan', async () => {
    const install = vi.fn();
    const stateDir = join(dir, 'state');

    const report = await runInstallDeps({
      stateDir,
      dryRun: true,
      steps: [step({ id: 'thing', install })],
      distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }),
    });

    expect(install).not.toHaveBeenCalled();
    expect(report.results[0]).toMatchObject({ outcome: 'installed', detail: 'Would install (dry run)' });
    expect(existsSync(stateDir)).toBe(false);
  });

  it('records the four outcomes independently', async () => {
    const report = await runInstallDeps({
      stateDir: dir,
      steps: [
        step({ id: 'already', detect: () => true }),
        step({ id: 'fresh' }),
        step({ id: 'elsewhere', supported: () => false }),
        step({
          id: 'broken',
          install: () => {
            throw new Error('apt exploded');
          },
        }),
      ],
      distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }),
    });

    expect(report.results.map((result) => result.outcome)).toEqual(['skipped', 'installed', 'unsupported', 'failed']);
    // `unsupported` is not a failure; `failed` is.
    expect(report.ok).toBe(false);
  });

  it('announces sudo before running anything', async () => {
    const messages: string[] = [];
    await runInstallDeps({
      stateDir: dir,
      steps: [step({ id: 'privileged', requiresSudo: true, detect: () => true })],
      log: (message) => messages.push(message),
      distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }),
    });

    // A command that quietly escalates is a command people stop trusting.
    expect(messages.join('\n')).toContain('sudo');
    expect(messages.join('\n')).toContain('privileged');
  });

  it('turns a throwing detect into a failed step rather than an exception', async () => {
    const report = await runInstallDeps({
      stateDir: dir,
      steps: [
        step({
          id: 'weird',
          detect: () => {
            throw new Error('probe blew up');
          },
        }),
      ],
      distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }),
    });

    expect(report.results[0]).toMatchObject({ outcome: 'failed', detail: 'probe blew up' });
  });

  it('creates the state directory with the shipped default steps', async () => {
    const stateDir = join(dir, 'created');
    const report = await runInstallDeps({ stateDir, distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }) });

    expect(existsSync(stateDir)).toBe(true);
    expect(report.ok).toBe(true);
  });
});

describe('runInstallDeps with asynchronous steps', () => {
  const ubuntu = detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' });

  it('awaits an async supported, detect and install, in order', async () => {
    const order: string[] = [];
    const delayed = (name: string, value: boolean) => async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(name);
      return value;
    };

    const report = await runInstallDeps({
      stateDir: dir,
      distro: ubuntu,
      steps: [
        {
          id: 'slow',
          label: 'slow',
          supported: delayed('supported', true),
          detect: delayed('detect', false),
          install: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push('install');
          },
        },
      ],
    });

    expect(order).toEqual(['supported', 'detect', 'install']);
    expect(report.results[0]?.outcome).toBe('installed');
  });

  it('reports a rejected async install as failed with its message, and keeps going', async () => {
    const report = await runInstallDeps({
      stateDir: dir,
      distro: ubuntu,
      steps: [
        { id: 'bad', label: 'bad', supported: () => true, detect: () => false, install: async () => { throw new Error('boom'); } },
        { id: 'good', label: 'good', supported: () => true, detect: async () => true, install: () => {} },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.results.map((r) => [r.id, r.outcome])).toEqual([['bad', 'failed'], ['good', 'skipped']]);
    expect(report.results[0]?.detail).toBe('boom');
  });
});

// =============================================================================
// The step registry and its helpers  (RETRO-G2.4, #1074)
// =============================================================================

function stepOf(id: string, extra: Partial<InstallStep> & { order?: number; after?: string } = {}) {
  return { id, label: id, supported: () => true, detect: () => false, install: () => {}, ...extra };
}

function contextOf(overrides: Partial<InstallContext> = {}): InstallContext & { ran: string[]; logs: string[] } {
  const ran: string[] = [];
  const logs: string[] = [];
  return {
    distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\nID_LIKE=debian\n' }),
    dryRun: false,
    stateDir: '/tmp/none',
    run: (command, args) => {
      ran.push([command, ...args].join(' '));
    },
    capture: async () => {
      throw new Error('not found');
    },
    log: (message) => logs.push(message),
    ...overrides,
    ran,
    logs,
  };
}

describe('registerInstallStep and listInstallSteps', () => {
  afterEach(() => resetInstallStepRegistryForTests());

  it('lists the built-ins alone when nothing is registered', () => {
    expect(listInstallSteps().map((s) => s.id)).toEqual(['state-dir', 'node-runtime']);
  });

  it('runs registered steps after the built-ins, by order then registration', () => {
    registerInstallStep(stepOf('c', { order: 5 }));
    registerInstallStep(stepOf('a'));
    registerInstallStep(stepOf('b', { order: -1 }));
    registerInstallStep(stepOf('a2'));

    expect(listInstallSteps().map((s) => s.id)).toEqual(['state-dir', 'node-runtime', 'b', 'a', 'a2', 'c']);
  });

  it('places a step right after the one it names, including a built-in and a chain', () => {
    registerInstallStep(stepOf('first'));
    registerInstallStep(stepOf('after-state', { after: 'state-dir' }));
    registerInstallStep(stepOf('chained', { after: 'after-state' }));
    registerInstallStep(stepOf('after-first', { after: 'first' }));
    registerInstallStep(stepOf('after-first-2', { after: 'first' }));

    expect(listInstallSteps().map((s) => s.id)).toEqual([
      'state-dir',
      'after-state',
      'chained',
      'node-runtime',
      'first',
      'after-first',
      'after-first-2',
    ]);
  });

  it('refuses an unknown or cyclic after, a duplicate id and a malformed step', () => {
    registerInstallStep(stepOf('lost', { after: 'nowhere' }));
    expect(() => listInstallSteps()).toThrow(/cannot be ordered.*lost/);
    resetInstallStepRegistryForTests();

    registerInstallStep(stepOf('x', { after: 'y' }));
    registerInstallStep(stepOf('y', { after: 'x' }));
    expect(() => listInstallSteps()).toThrow(/cannot be ordered/);
    resetInstallStepRegistryForTests();

    registerInstallStep(stepOf('dup'));
    expect(() => registerInstallStep(stepOf('dup'))).toThrow(/already registered/);
    expect(() => registerInstallStep(stepOf('state-dir'))).toThrow(/already registered/);
    expect(() => registerInstallStep(stepOf('Bad Id'))).toThrow(/valid step id/);
    expect(() => registerInstallStep({ ...stepOf('nodetect'), detect: undefined as never })).toThrow(/detect/);
  });

  it('runInstallDeps runs the defaults then the registered steps, and --only narrows the plan', async () => {
    const order: string[] = [];
    registerInstallStep(stepOf('mine', { install: () => void order.push('mine') }));
    registerInstallStep(stepOf('other', { install: () => void order.push('other') }));
    const distro = detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' });

    const all = await runInstallDeps({ stateDir: join(dir, 's'), distro });
    expect(all.results.map((r) => r.id)).toEqual(['state-dir', 'node-runtime', 'mine', 'other']);
    expect(order).toEqual(['mine', 'other']);

    order.length = 0;
    const only = await runInstallDeps({ stateDir: join(dir, 's'), distro, only: ['other'] });
    expect(only.results.map((r) => r.id)).toEqual(['other']);
    expect(order).toEqual(['other']);

    await expect(runInstallDeps({ stateDir: dir, distro, only: ['nope'] })).rejects.toThrow(/Unknown install step: nope. Known steps: state-dir, node-runtime, mine, other/);
  });

  it('--dry-run runs detect only for registered steps and never an install', async () => {
    const install = vi.fn();
    const detect = vi.fn(() => false);
    registerInstallStep(stepOf('mine', { detect, install }));

    const report = await runInstallDeps({ stateDir: join(dir, 's'), dryRun: true, distro: detectDistro({ platform: 'linux', osRelease: 'ID=ubuntu\n' }) });

    expect(detect).toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(report.results.find((r) => r.id === 'mine')?.detail).toMatch(/dry run/i);
    expect(existsSync(join(dir, 's'))).toBe(false);
  });
});

describe('install helpers', () => {
  it('runWithSudoAnnounced announces, then elevates unless root, and runs nothing in a dry run', async () => {
    const real = contextOf();
    await runWithSudoAnnounced('apt-get', ['install', '-y', 'x'], real);
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    expect(real.logs[0]).toMatch(/^Running: /);
    expect(real.ran).toEqual([isRoot ? 'apt-get install -y x' : 'sudo apt-get install -y x']);

    const dry = contextOf({ dryRun: true });
    await runWithSudoAnnounced('apt-get', ['install', '-y', 'x'], dry);
    expect(dry.ran).toEqual([]);
    expect(dry.logs[0]).toMatch(/^Would run: /);
  });

  it('ensureAptPackages installs only the missing packages, once', async () => {
    const context = contextOf({
      capture: async (_command, args) => {
        if (args[1] === 'present') return 'Status: install ok installed\n';
        throw new Error('not installed');
      },
    });

    const installed = await ensureAptPackages(['present', 'absent', 'absent2'], context);

    expect(installed).toEqual(['absent', 'absent2']);
    expect(context.ran).toHaveLength(1);
    expect(context.ran[0]).toMatch(/apt-get install -y absent absent2$/);
  });

  it('ensureAptPackages does nothing when all are present, nothing in a dry run, and refuses a non-Debian distro or bad name', async () => {
    const present = contextOf({ capture: async () => 'Status: install ok installed' });
    expect(await ensureAptPackages(['a'], present)).toEqual([]);
    expect(present.ran).toEqual([]);

    const dry = contextOf({ dryRun: true });
    expect(await ensureAptPackages(['a'], dry)).toEqual(['a']);
    expect(dry.ran).toEqual([]);

    await expect(ensureAptPackages(['a'], contextOf({ distro: detectDistro({ platform: 'darwin' }) }))).rejects.toThrow(/Debian-family/);
    await expect(ensureAptPackages(['--evil'], contextOf())).rejects.toThrow(/valid apt package/);
  });

  it('ensureDockerContainer creates a missing container, then polls verify until it passes', async () => {
    const answers = [false, false, true];
    const context = contextOf({
      capture: async (_command, args) => {
        if (args[0] === '--version') return 'Docker version 27';
        throw new Error('No such object');
      },
    });
    const sleeps: number[] = [];

    const outcome = await ensureDockerContainer(
      { name: 'sidecar', image: 'registry.example.test/side:1', args: ['-p', '9000:9000'], verify: () => answers.shift() ?? true, verifyIntervalMs: 7, sleep: async (ms) => void sleeps.push(ms) },
      context,
    );

    expect(outcome).toBe('created');
    expect(context.ran).toEqual(['docker run -d --name sidecar --restart unless-stopped -p 9000:9000 registry.example.test/side:1']);
    expect(sleeps).toEqual([7, 7]);
  });

  it('ensureDockerContainer starts a stopped one, leaves a running one alone, and fails when verify never passes', async () => {
    const stopped = contextOf({ capture: async (_c, args) => (args[0] === 'inspect' ? 'false\n' : 'ok') });
    expect(await ensureDockerContainer({ name: 'n', image: 'i' }, stopped)).toBe('started');
    expect(stopped.ran).toEqual(['docker start n']);

    const running = contextOf({ capture: async (_c, args) => (args[0] === 'inspect' ? 'true\n' : 'ok') });
    expect(await ensureDockerContainer({ name: 'n', image: 'i' }, running)).toBe('running');
    expect(running.ran).toEqual([]);

    await expect(
      ensureDockerContainer({ name: 'n', image: 'i', verify: () => false, verifyAttempts: 2, sleep: async () => {} }, running),
    ).rejects.toThrow(/did not become healthy after 2 checks/);
  });

  it('ensureDockerContainer plans without running in a dry run, and rejects a missing docker or a malformed name', async () => {
    const dry = contextOf({ dryRun: true, capture: async (_c, args) => { if (args[0] === '--version') return 'v'; throw new Error('absent'); } });
    expect(await ensureDockerContainer({ name: 'n', image: 'i' }, dry)).toBe('planned');
    expect(dry.ran).toEqual([]);

    await expect(ensureDockerContainer({ name: 'n', image: 'i' }, contextOf())).rejects.toThrow(/Docker is not installed/);
    await expect(ensureDockerContainer({ name: '-bad', image: 'i' }, contextOf())).rejects.toThrow(/container name/);
    await expect(ensureDockerContainer({ name: 'ok', image: '--privileged' }, contextOf())).rejects.toThrow(/image reference/);
  });
});

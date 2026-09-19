import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CommandResult, runCommand } from './executor.js';
import { DeployStateError, NotInstalledError, deployStatePath } from './state.js';
import { buildUpdateSteps, runUpdate } from './update.js';

describe('the update pipeline', () => {
  const steps = buildUpdateSteps();
  const ids = steps.map((step) => step.id);

  it('looks for a new revision before it changes anything', () => {
    expect(ids).toEqual([
      'preflight',
      'fetch',
      'environment-drift',
      'version',
      'build',
      'migrate',
      'seed',
      'restart',
      'health',
      'deploy-info',
      'publish',
      'verify',
      'publish-version',
    ]);
  });

  it('records what was deployed as soon as the API answers', () => {
    expect(ids.indexOf('deploy-info')).toBe(ids.indexOf('health') + 1);
    expect(ids.indexOf('deploy-info')).toBeLessThan(ids.indexOf('publish'));
  });

  it('does not bump a version when the revision has not moved', () => {
    // ⚠ THE TREADMILL THIS PREVENTS. An update that finds the remote
    // unchanged rebuilds nothing -- so bumping here would commit and push a
    // release for code nobody wrote, which makes the remote "move", which
    // makes the NEXT update rebuild and bump again, for ever.
    expect(skipReason('version', { unchanged: true, options: {}, state: {} })).toBe(
      'already up to date',
    );
    expect(
      skipReason('publish-version', { unchanged: true, options: {}, state: {} }),
    ).toBe('no version was bumped');
  });

  function skipReason(id: string, context: Record<string, unknown>): string | undefined {
    return steps.find((step) => step.id === id)?.skip?.(context as never);
  }

  it('stands every later step down when the revision has not moved', () => {
    // Several minutes of build and a restart for a no-op is exactly the
    // friction that stops people updating often.
    for (const id of ['build', 'migrate', 'seed', 'restart', 'health', 'publish', 'verify']) {
      expect(skipReason(id, { unchanged: true, options: {}, state: {} })).toBe(
        'already up to date',
      );
    }
  });

  it('still runs the fetch step when unchanged, since that is what decides', () => {
    expect(skipReason('fetch', { unchanged: true, options: {}, state: {} })).toBeUndefined();
  });

  it('re-seeds by default', () => {
    // The only way permissions added by a new release reach an existing
    // deployment; without it the feature ships and the permission does not.
    expect(skipReason('seed', { options: {}, state: {} })).toBeUndefined();
  });

  it('honours --skip-seed', () => {
    expect(skipReason('seed', { options: { skipSeed: true }, state: {} })).toContain(
      '--skip-seed',
    );
  });

  it('skips publishing for a deployment that was never published', () => {
    expect(skipReason('publish', { options: {}, state: {} })).toContain('not published');
  });

  it('honours --skip-proxy', () => {
    expect(
      skipReason('publish', { options: { skipProxy: true }, state: { domain: 'x' } }),
    ).toContain('--skip-proxy');
  });
});

describe('runUpdate preconditions', () => {
  it('refuses to run when nothing is installed, naming install', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'appctl-noinstall-'));

    const error = await runUpdate({ deployRoot: empty }).catch((caught: unknown) => caught);

    // The precondition install does not have, and the reason this is its own
    // command rather than a flag: the guards are opposite.
    expect(error).toBeInstanceOf(NotInstalledError);
    expect((error as Error).message).toContain('deploy install');
  });

  it('names which half is missing when refusing, rather than asserting a bare negative', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'appctl-noinstall-'));

    const error = await runUpdate({ deployRoot: empty }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotInstalledError);
    expect((error as Error).message).toContain('a checkout at repo/');
    expect((error as Error).message).toContain('a readable environment file');
  });
});

describe('runUpdate: adopting an unrecorded deployment (#not the NotInstalledError refusal)', () => {
  /** A minimal CommandResult, for a stub that only needs a few argvs to succeed. */
  function ok(argv: readonly string[], cwd: string, stdout: string): CommandResult {
    return { argv, cwd, exitCode: 0, stdout, stderr: '', durationMs: 0, timedOut: false };
  }

  /**
   * Answers just enough git plumbing (used by `resolveRepoTarget` to work out
   * what to redeploy from the checkout's own origin) for `resolveStateForUpdate`
   * to reach adoption, then refuses everything else (docker/df probes used by
   * the `preflight` step) so the pipeline fails fast and predictably rather
   * than hanging on a real subprocess.
   */
  const gitOnlyRunCommand: typeof runCommand = async (argv, options) => {
    const cmd = argv.join(' ');
    if (cmd === 'git remote get-url origin') {
      return ok(argv, options.cwd, 'https://example.test/o/demo.git\n');
    }
    if (cmd === 'git rev-parse --abbrev-ref HEAD') {
      return ok(argv, options.cwd, 'main\n');
    }
    throw new Error(`unexpected command in adoption test: ${cmd}`);
  };

  function unrecordedDeploymentRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'appctl-adopt-update-'));
    mkdirSync(join(root, 'repo', '.git'), { recursive: true });
    writeFileSync(join(root, '.env'), 'APP_BIND_PORT=3535\n');
    return root;
  }

  it('does not throw NotInstalledError for a root with evidence but no state file - it adopts and proceeds', async () => {
    const root = unrecordedDeploymentRoot();

    const error = await runUpdate({
      deployRoot: root,
      runCommand: gitOnlyRunCommand,
    }).catch((caught: unknown) => caught);

    // It is fine for the run to fail further into the pipeline (the preflight
    // checks have nothing real to probe here) - what must never happen again
    // is the "no deployment" refusal for a directory that plainly is one.
    expect(error).not.toBeInstanceOf(NotInstalledError);
  });

  it('still refuses a root with NEITHER a checkout nor an .env, even alongside this adoption path', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'appctl-adopt-update-empty-'));

    const error = await runUpdate({
      deployRoot: empty,
      runCommand: gitOnlyRunCommand,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotInstalledError);
  });
});

describe('runUpdate: an unreadable state file is not an unrecorded deployment', () => {
  it('surfaces DeployStateError, not the adoption path and not NotInstalledError', async () => {
    const root = mkdtempSync(join(tmpdir(), 'appctl-badstate-'));
    mkdirSync(join(root, 'repo', '.git'), { recursive: true });
    writeFileSync(join(root, '.env'), 'APP_BIND_PORT=3535\n');
    // The file is present but this build cannot interpret it - a different
    // problem from "nothing recorded", deserving a different message.
    writeFileSync(deployStatePath(root), '{ not json');

    const error = await runUpdate({ deployRoot: root }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeployStateError);
    expect(error).not.toBeInstanceOf(NotInstalledError);
  });
});

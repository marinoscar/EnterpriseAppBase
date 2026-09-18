import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildInstallSteps, composeCwd } from './install.js';
import { openJournal } from './journal.js';
import { UsageError } from '../errors.js';
import { DEPLOY_STATE_VERSION, readState, writeState, type DeployState } from './state.js';

function fixture(): string {
  const deployRoot = mkdtempSync(join(tmpdir(), 'appctl-harden-'));
  mkdirSync(composeCwd(deployRoot), { recursive: true });
  writeFileSync(
    join(composeCwd(deployRoot), '.env.example'),
    '# ---\n# Core\n# ---\nNODE_ENV=development\nAPP_BIND_PORT=3535\n',
  );
  return deployRoot;
}

function step(id: string) {
  const found = buildInstallSteps().find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no step ${id}`);
  return found;
}

describe('install: the deploy-info bind source exists before the stack starts', () => {
  it('creates <deployRoot>/deploy-info, and it is there when compose runs', async () => {
    // ⚠ Docker creates a MISSING bind source itself, as root:root, after which
    // this CLI cannot write the deployment record into it -- and the failure
    // surfaces much later as an EACCES from a step that has nothing to do with
    // Docker, with every step up to that point green. Ordering is the fix, so
    // ordering is what this asserts: the directory must exist AT THE MOMENT the
    // compose command is spawned, not merely by the end of the run.
    const deployRoot = fixture();
    let existedWhenComposeRan: boolean | undefined;

    const runCommand = vi.fn().mockImplementation(async (argv: readonly string[]) => {
      if (argv[1] === 'compose') {
        existedWhenComposeRan = existsSync(join(deployRoot, 'deploy-info'));
      }
      return { argv, cwd: '/tmp', exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
    });

    const journal = openJournal({ deployRoot, command: 'install', secrets: [] });
    await step('start').run({
      options: { deployRoot, bindPort: 3535, proxyRoot: join(deployRoot, 'proxy') },
      runCommand,
      journal,
      hooks: undefined,
      completed: new Set<string>(),
    } as never);
    journal.finish('success');

    expect(existedWhenComposeRan).toBe(true);
  });
});

describe('install: --domain is only required when something will be published', () => {
  const base = (deployRoot: string, skipProxy: boolean) => ({
    options: {
      deployRoot,
      bindPort: 3535,
      proxyRoot: join(deployRoot, 'proxy'),
      nonInteractive: true,
      skipProxy,
    },
    runCommand: vi.fn(),
    journal: openJournal({ deployRoot, command: 'install', secrets: [] }),
    hooks: undefined,
    completed: new Set<string>(),
  });

  it('still refuses without --domain when the proxy will be configured', async () => {
    const deployRoot = fixture();

    await expect(step('environment').run(base(deployRoot, false) as never)).rejects.toBeInstanceOf(
      UsageError,
    );
  });

  it('does not demand a domain under --skip-proxy: there is nothing to publish', async () => {
    const deployRoot = fixture();

    // It may still fail later for its own reasons; what it must NOT do is throw
    // the "a domain is required" usage error.
    const outcome = await step('environment')
      .run(base(deployRoot, true) as never)
      .then(() => undefined)
      .catch((error: unknown) => error);

    if (outcome instanceof UsageError) {
      expect(outcome.message).not.toMatch(/domain is required/i);
    }
  });
});

describe('deploy state stays readable across this change', () => {
  it('a record with neither composeProject nor proxyRoot still loads', () => {
    const deployRoot = mkdtempSync(join(tmpdir(), 'appctl-state-compat-'));
    writeState({
      version: DEPLOY_STATE_VERSION,
      repoUrl: 'https://example.invalid/app.git',
      ref: 'main',
      commitSha: 'a'.repeat(40),
      bindPort: 3535,
      deployRoot,
      installedAt: '2026-01-01T00:00:00.000Z',
      lastDeployedAt: '2026-01-01T00:00:00.000Z',
      lastCommand: 'install',
      appctlVersion: '1.0.0',
    } as DeployState);

    const state = readState(deployRoot);

    expect(state?.composeProject).toBeUndefined();
    expect(state?.proxyRoot).toBeUndefined();
    // ⚠ The version must NOT have been bumped to add optional fields: a bump
    // makes this CLI refuse every state file already on every live server.
    expect(state?.version).toBe(1);
  });
});

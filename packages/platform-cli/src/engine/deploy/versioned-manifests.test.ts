import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCli, type CreateCliOptions } from '../create-cli.js';
import { resetCliForTests, TEST_CLI_IDENTITY } from '../test-support.js';
import { UsageError } from '../errors.js';
import type { CommandResult, runCommand } from './executor.js';
import { buildInstallSteps } from './install.js';
import { buildUpdateSteps } from './update.js';
import { versionedManifests } from './app-version.js';

// =============================================================================
// `createCli({ deploy: { versionedManifests } })` reaches the deploy steps
// (issue #1030).
//
// An app whose CLI keeps its own version (kvox) leaves `apps/cli` out. The
// option is given to createCli and the `version` step of BOTH pipelines must
// honour it without being handed the list again: that is the whole contract,
// and a unit test of `writeVersion` alone cannot prove the wiring.
// =============================================================================

const BASE: CreateCliOptions = { identity: TEST_CLI_IDENTITY, version: '2.3.4' };
const WITHOUT_CLI = ['apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json'];
const ALL_FOUR = [
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
];

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  }).trim();
}

const manifest = (version: string): string => JSON.stringify({ name: 'x', version }, null, 2) + '\n';

/**
 * A deploy root whose `repo/` is a git checkout of an app at release 1.2.2
 * whose CLI is at its own 1.10.7, with a lockfile naming all four workspaces.
 */
function deployRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'appctl-versioned-manifests-'));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch=main');
  for (const relative of ALL_FOUR) {
    mkdirSync(join(repo, dirname(relative)), { recursive: true });
    writeFileSync(join(repo, relative), manifest(relative.startsWith('apps/cli') ? '1.10.7' : '1.2.2'));
  }
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'apps/api': { version: '1.2.2' },
          'apps/web': { version: '1.2.2' },
          'apps/cli': { version: '1.10.7' },
          'packages/shared': { version: '1.2.2' },
        },
      },
      null,
      2,
    ) + '\n',
  );
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'first');
  return root;
}

/** Real git, recorded; the version step runs nothing else. */
const gitRunner = (async (argv: readonly string[], options: { cwd: string }): Promise<CommandResult> => {
  const stdout = execFileSync(argv[0] as string, argv.slice(1), { cwd: options.cwd, encoding: 'utf8' });
  return { argv, cwd: options.cwd, exitCode: 0, stdout, stderr: '', durationMs: 0, timedOut: false };
}) as typeof runCommand;

function versionStep(pipeline: 'install' | 'update') {
  const steps = pipeline === 'install' ? buildInstallSteps() : buildUpdateSteps();
  const found = steps.find((candidate) => candidate.id === 'version');
  if (found === undefined) throw new Error(`the ${pipeline} "version" step was removed or renamed`);
  return found;
}

async function runVersion(pipeline: 'install' | 'update', root: string, appVersion: string): Promise<string[]> {
  const lines: string[] = [];
  const context = {
    options: { deployRoot: root, appVersion },
    state: { bindPort: 3535, composeProject: 'demo' },
    runCommand: gitRunner,
    journal: { line: (line: string) => lines.push(line), command: () => undefined, redact: (text: string) => text },
    hooks: undefined,
    completed: new Set<string>(),
    unchanged: false,
  };
  await versionStep(pipeline).run(context as never);
  return lines;
}

const versionAt = (root: string, relative: string): string =>
  (JSON.parse(readFileSync(join(root, 'repo', relative), 'utf8')) as { version: string }).version;

const lockVersion = (root: string, workspace: string): string =>
  (JSON.parse(readFileSync(join(root, 'repo', 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version: string }>;
  }).packages[workspace]?.version ?? '';

describe.each(['update', 'install'] as const)('createCli({ deploy: { versionedManifests } }) reaches deploy %s', (pipeline) => {
  it('leaves apps/cli and its lockfile entry alone when the app lists the other three', async () => {
    createCli({ ...BASE, deploy: { versionedManifests: WITHOUT_CLI } });
    const root = deployRoot();

    const lines = await runVersion(pipeline, root, '1.2.3');

    for (const relative of WITHOUT_CLI) expect(versionAt(root, relative)).toBe('1.2.3');
    expect(versionAt(root, 'apps/cli/package.json')).toBe('1.10.7');
    expect(lockVersion(root, 'apps/api')).toBe('1.2.3');
    expect(lockVersion(root, 'apps/web')).toBe('1.2.3');
    expect(lockVersion(root, 'packages/shared')).toBe('1.2.3');
    expect(lockVersion(root, 'apps/cli')).toBe('1.10.7');
    expect(git(join(root, 'repo'), 'status', '--porcelain')).toBe('');

    // The journal names what was written, and apps/cli is not among it.
    const line = lines.find((candidate) => candidate.startsWith('Version:')) ?? '';
    expect(line).toContain('apps/api/package.json');
    expect(line).toContain('package-lock.json');
    expect(line).not.toContain('apps/cli');
  });

  it('writes all four when the app sets nothing (the default is unchanged)', async () => {
    createCli(BASE);
    const root = deployRoot();
    // The default version source is apps/api (1.2.2), so 1.2.3 moves forward.
    await runVersion(pipeline, root, '1.2.3');

    for (const relative of ALL_FOUR) expect(versionAt(root, relative)).toBe('1.2.3');
    expect(lockVersion(root, 'apps/cli')).toBe('1.2.3');
  });

  it('takes the version source from the first listed manifest', async () => {
    createCli({ ...BASE, deploy: { versionedManifests: ['apps/cli/package.json', 'apps/api/package.json'] } });
    const root = deployRoot();

    // 1.2.3 does not sort above the CLI's 1.10.7, which is now the source.
    await expect(runVersion(pipeline, root, '1.2.3')).rejects.toBeInstanceOf(UsageError);
    expect(versionAt(root, 'apps/api/package.json')).toBe('1.2.2');

    await runVersion(pipeline, root, '1.11.0');
    expect(versionAt(root, 'apps/cli/package.json')).toBe('1.11.0');
    expect(versionAt(root, 'apps/api/package.json')).toBe('1.11.0');
    expect(versionAt(root, 'apps/web/package.json')).toBe('1.2.2');
  });
});

describe('createCli deploy.versionedManifests validation', () => {
  it('is the default four until an app sets it', () => {
    createCli(BASE);
    expect([...versionedManifests()]).toEqual(ALL_FOUR);
  });

  it('applies the app list in the process', () => {
    createCli({ ...BASE, deploy: { versionedManifests: WITHOUT_CLI } });
    expect([...versionedManifests()]).toEqual(WITHOUT_CLI);
  });

  it('restores the default when a later createCli sets nothing', () => {
    createCli({ ...BASE, deploy: { versionedManifests: WITHOUT_CLI } });
    createCli(BASE);
    expect([...versionedManifests()]).toEqual(ALL_FOUR);
  });

  it.each([
    ['an empty list', [], /at least one/],
    ['a duplicate', ['apps/api/package.json', 'apps/api/package.json'], /more than once/],
    ['a path outside the repository', ['../x/package.json'], /\.\./],
    ['an absolute path', ['/apps/api/package.json'], /relative/],
    ['a file that is not a package.json', ['apps/api/tsconfig.json'], /package\.json/],
    ['the root manifest', ['package.json'], /root manifest/],
  ])('throws at createCli for %s', (_label, list, message) => {
    expect(() => createCli({ ...BASE, deploy: { versionedManifests: list } })).toThrow(UsageError);
    resetCliForTests();
    expect(() => createCli({ ...BASE, deploy: { versionedManifests: list } })).toThrow(message);
  });

  it('a rejected list leaves the process on the default', () => {
    expect(() => createCli({ ...BASE, deploy: { versionedManifests: [] } })).toThrow();
    expect([...versionedManifests()]).toEqual(ALL_FOUR);
  });
});

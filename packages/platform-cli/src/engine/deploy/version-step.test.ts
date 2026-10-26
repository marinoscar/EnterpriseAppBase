import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { UsageError } from '../errors.js';
import { VERSIONED_MANIFESTS } from './app-version.js';
import { readEnvFile } from './env-file.js';
import { parseEnvExample, serializeEnvFile } from './env-spec.js';
import { CommandFailedError, type CommandResult, type RunCommandOptions } from './executor.js';
import {
  checkoutPathFor,
  publishVersion,
  runVersionStep,
  stampAppVersion,
  type VersionStepResult,
} from './version-step.js';

// =============================================================================
// Real git, not a mock -- same rationale as repo.test.ts: whether the tree is
// clean, what HEAD moved to, and what a failed push leaves behind are all
// git's own behaviour, and a stubbed `git` would only prove the stub was
// called with the arguments this file expects it to be called with.
// =============================================================================

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

/** A minimal, valid manifest for one of the four versioned workspaces. */
function manifestJson(version: string): string {
  return JSON.stringify({ name: 'x', version, dependencies: {} }, null, 2) + '\n';
}

/** A real git repository carrying all four versioned manifests, one commit deep. */
function makeRepo(version = '1.0.0'): string {
  const dir = mkdtempSync(join(tmpdir(), 'appctl-versionstep-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  for (const relative of VERSIONED_MANIFESTS) {
    mkdirSync(join(dir, dirname(relative)), { recursive: true });
    writeFileSync(join(dir, relative), manifestJson(version));
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'first');
  return dir;
}

/** A real git repository carrying NONE of the versioned manifests. */
function makeEmptyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'appctl-versionstep-empty-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(dir, 'README.md'), 'nothing versioned here\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'first');
  return dir;
}

describe('checkoutPathFor', () => {
  it('is <deployRoot>/repo', () => {
    expect(checkoutPathFor('/srv/app')).toBe(join('/srv/app', 'repo'));
  });
});

describe('runVersionStep', () => {
  it('honours --no-version-bump without touching the tree at all', async () => {
    const repo = makeRepo();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = await runVersionStep({ checkoutPath: repo, disabled: true });

    expect(result.bumped).toBe(false);
    expect(result.detail).toContain('--no-version-bump');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('takes the suggested patch bump when no --app-version was given ("--non-interactive")', async () => {
    const repo = makeRepo('1.0.0');

    const result = await runVersionStep({ checkoutPath: repo });

    expect(result.bumped).toBe(true);
    expect(result.version).toBe('1.0.1');
  });

  it('stops the run for a malformed --app-version, rather than falling back to the suggestion', async () => {
    const repo = makeRepo('1.0.0');
    const before = git(repo, 'rev-parse', 'HEAD');

    await expect(
      runVersionStep({ checkoutPath: repo, requested: 'not-a-version' }),
    ).rejects.toBeInstanceOf(UsageError);

    // Nothing must happen to the tree before the request is even validated.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('stops the run for a requested version that does not move forward', async () => {
    const repo = makeRepo('1.0.0');

    await expect(
      runVersionStep({ checkoutPath: repo, requested: '1.0.0' }),
    ).rejects.toBeInstanceOf(UsageError);
    await expect(
      runVersionStep({ checkoutPath: repo, requested: '0.9.0' }),
    ).rejects.toBeInstanceOf(UsageError);
  });

  // ⚠ CRITERION 2: THE INVARIANT THE WHOLE DESIGN RESTS ON. The write and the
  // commit happen in ONE step precisely because the checkout step refuses a
  // dirty tree; if this ever regresses to leaving the write uncommitted, a
  // deploy that dies at `build` wedges every later `update` behind a refusal
  // about files the operator never touched.
  it('leaves a perfectly clean tree after the write+commit', async () => {
    const repo = makeRepo('1.0.0');

    const result = await runVersionStep({ checkoutPath: repo });

    expect(result.bumped).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  // ⚠ CRITERION 4: ON SUCCESS THE RECORDED DEPLOYED COMMIT IS THE BUMP COMMIT.
  // Recording the pre-bump commit would leave every server permanently
  // reporting itself one commit behind, rebuilding identical code forever.
  it('records commitSha as the bump commit, distinct from baseSha, equal to HEAD', async () => {
    const repo = makeRepo('1.0.0');

    const result = await runVersionStep({ checkoutPath: repo });

    const head = git(repo, 'rev-parse', 'HEAD');
    expect(result.commitSha).toBe(head);
    expect(result.commitSha).not.toBe(result.baseSha);
  });

  it('actually writes the version into the manifests before committing', async () => {
    const repo = makeRepo('1.0.0');

    const result = await runVersionStep({ checkoutPath: repo, requested: '5.0.0' });

    expect(result.version).toBe('5.0.0');
    for (const relative of VERSIONED_MANIFESTS) {
      const parsed = JSON.parse(readFileSync(join(repo, relative), 'utf8')) as { version: string };
      expect(parsed.version).toBe('5.0.0');
    }
  });

  it('produces a real commit whose message names the version, attributed to appctl deploy (not the operator)', async () => {
    const repo = makeRepo('1.0.0');

    await runVersionStep({ checkoutPath: repo, requested: '2.5.0' });

    expect(git(repo, 'log', '-1', '--format=%s')).toBe('chore(release): 2.5.0');
    expect(git(repo, 'log', '-1', '--format=%an')).toBe('appctl deploy');
  });

  // Also: writeVersion on a repo whose manifests are already at the target
  // version reports zero changed files - see app-version.test.ts for that
  // direct case. Here it is the ONLY way runVersionStep itself can reach
  // `bumped: false` while still validating a forward-moving version: a
  // checkout carrying none of the versioned manifests at all, so
  // currentVersion() falls back to the documented 1.0.0 fiction and
  // suggestNext offers 1.0.1 forward of it, yet writeVersion has nothing to
  // write into.
  it('returns bumped: false and makes no commit when writeVersion finds nothing to change', async () => {
    const repo = makeEmptyRepo();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = await runVersionStep({ checkoutPath: repo });

    expect(result.bumped).toBe(false);
    expect(result.detail).toContain('already carries this version');
    // No commit was made - HEAD did not move, and the tree is unchanged.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});

describe('publishVersion', () => {
  /** A `VersionStepResult` as if runVersionStep had bumped and committed. */
  function bumpedResult(overrides: Partial<VersionStepResult> = {}): VersionStepResult {
    return {
      bumped: true,
      version: '1.2.3',
      baseSha: 'a'.repeat(40),
      commitSha: 'b'.repeat(40),
      detail: 'wrote 1.2.3 to 4 file(s) and committed',
      ...overrides,
    };
  }

  it('does nothing when nothing was bumped', async () => {
    const repo = makeRepo();
    const result = await publishVersion({
      checkoutPath: repo,
      ref: 'main',
      result: { bumped: false, version: '1.0.0', detail: 'skipped' },
    });

    expect(result).toEqual({ pushed: false, rolledBack: false, detail: 'nothing to publish' });
  });

  it('pushes the exact bump commit to the exact ref, explicitly (works from a detached HEAD)', async () => {
    const repo = makeRepo('1.0.0');
    const bumped = await runVersionStep({ checkoutPath: repo });
    // The checkout step ends every normal deployment detached; reproduce that.
    git(repo, 'checkout', '--quiet', '--detach', 'HEAD');

    const pushCalls: string[][] = [];
    const runCommand: typeof import('./executor.js').runCommand = (async (
      argv: readonly string[],
      options: RunCommandOptions,
    ): Promise<CommandResult> => {
      if (argv[0] === 'git' && argv[1] === 'push') pushCalls.push([...argv]);
      const stdout = execFileSync(argv[0] as string, argv.slice(1), {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return {
        argv: [...argv],
        cwd: options.cwd,
        exitCode: 0,
        stdout,
        stderr: '',
        durationMs: 1,
        timedOut: false,
      };
    }) as typeof import('./executor.js').runCommand;

    // A real bare remote so the push has somewhere genuine to land.
    const bare = mkdtempSync(join(tmpdir(), 'appctl-versionstep-bare-'));
    git(bare, 'init', '--quiet', '--bare', '--initial-branch=main');
    git(repo, 'remote', 'add', 'origin', bare);

    const result = await publishVersion({ checkoutPath: repo, ref: 'main', result: bumped, runCommand });

    expect(result).toEqual({ pushed: true, rolledBack: false, detail: 'pushed 1.0.1 to main' });
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]).toEqual(['git', 'push', 'origin', 'HEAD:refs/heads/main']);
    expect(git(bare, 'rev-parse', 'main')).toBe(bumped.commitSha);
  });

  // ⚠ CRITERION 3: A FAILED PUSH ROLLS THE BUMP COMMIT BACK OUT, silently
  // (never throws), and NEVER retries or forces. Left in place, the clone
  // would sit one commit ahead of origin forever and every later `update`
  // would see itself as behind, rebuilding byte-identical images forever.
  it('rolls HEAD back to baseSha, reports pushed:false/rolledBack:true, and does not throw', async () => {
    const repo = makeRepo('1.0.0');
    const baseSha = git(repo, 'rev-parse', 'HEAD');
    const bumped = await runVersionStep({ checkoutPath: repo });
    expect(bumped.baseSha).toBe(baseSha);

    const pushCalls: string[][] = [];
    const failingRunCommand: typeof import('./executor.js').runCommand = (async (
      argv: readonly string[],
      options: RunCommandOptions,
    ): Promise<CommandResult> => {
      if (argv[0] === 'git' && argv[1] === 'push') {
        pushCalls.push([...argv]);
        const failed: CommandResult = {
          argv: [...argv],
          cwd: options.cwd,
          exitCode: 1,
          stdout: '',
          stderr: 'simulated: could not reach origin',
          durationMs: 1,
          timedOut: false,
        };
        throw new CommandFailedError('simulated: could not reach origin', failed);
      }
      const stdout = execFileSync(argv[0] as string, argv.slice(1), {
        cwd: options.cwd,
        encoding: 'utf8',
      });
      return {
        argv: [...argv],
        cwd: options.cwd,
        exitCode: 0,
        stdout,
        stderr: '',
        durationMs: 1,
        timedOut: false,
      };
    }) as typeof import('./executor.js').runCommand;

    const result = await publishVersion({
      checkoutPath: repo,
      ref: 'main',
      result: bumped,
      runCommand: failingRunCommand,
    });

    expect(result.pushed).toBe(false);
    expect(result.rolledBack).toBe(true);
    // HEAD is back at the pre-bump commit - the clone matches origin again.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // Exactly one push attempt: no retry. A retry would re-commit the bump on
    // top of wherever origin moved, against a deployment built from the OLD
    // tip - a code change wearing a bookkeeping retry's clothes.
    expect(pushCalls).toHaveLength(1);
    // Never --force, under any circumstance.
    expect(pushCalls[0]).not.toContain('--force');
  });

  it('reports rolledBack:false, still without throwing, when the rollback itself cannot happen', async () => {
    const runCommand: typeof import('./executor.js').runCommand = (async (
      argv: readonly string[],
      options: RunCommandOptions,
    ): Promise<CommandResult> => {
      const failed: CommandResult = {
        argv: [...argv],
        cwd: options.cwd,
        exitCode: 1,
        stdout: '',
        stderr: 'simulated failure',
        durationMs: 1,
        timedOut: false,
      };
      throw new CommandFailedError('simulated failure', failed);
    }) as typeof import('./executor.js').runCommand;

    // baseSha does not correspond to any real commit in this repo, so the
    // rollback checkout itself fails - and the function must still resolve.
    const repo = makeRepo('1.0.0');
    const result = await publishVersion({
      checkoutPath: repo,
      ref: 'main',
      result: bumpedResult({ baseSha: 'f'.repeat(40) }),
      runCommand,
    });

    expect(result.pushed).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.detail).toContain('could NOT be rolled back');
  });
});

describe('stampAppVersion', () => {
  const TEMPLATE_PATH = resolve(__dirname, '..', '..', '..', '..', '..', 'infra', 'compose', '.env.example');
  const SPECS = parseEnvExample(readFileSync(TEMPLATE_PATH, 'utf8'));

  /** A real `.env`, built the same way the wizard would: from the real spec list. */
  function makeEnv(overrides: Record<string, string> = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'appctl-stampversion-'));
    const values = new Map<string, string>();
    for (const spec of SPECS) {
      if (!spec.optional) values.set(spec.key, spec.defaultValue);
    }
    values.set('POSTGRES_PASSWORD', 'a-real-answered-secret');
    for (const [key, value] of Object.entries(overrides)) values.set(key, value);

    const path = join(dir, '.env');
    writeFileSync(path, serializeEnvFile(values, SPECS));
    return path;
  }

  it('returns false when there is no .env to stamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appctl-stampversion-noenv-'));
    expect(stampAppVersion(join(dir, '.env'), TEMPLATE_PATH, '1.2.3')).toBe(false);
  });

  it('returns false when the template itself is missing', () => {
    const envPath = makeEnv();
    expect(stampAppVersion(envPath, join(dirname(envPath), 'nonexistent.example'), '1.2.3')).toBe(
      false,
    );
  });

  it('writes APP_VERSION through the full spec list, preserving section banners and key order', () => {
    const envPath = makeEnv();

    const wrote = stampAppVersion(envPath, TEMPLATE_PATH, '1.2.3');

    expect(wrote).toBe(true);
    const rendered = readFileSync(envPath, 'utf8');
    // Section banners from the real template survive the rewrite.
    expect(rendered).toContain('# Application');
    expect(rendered).toContain('# Database (PostgreSQL)');
    // APP_VERSION is deliberately not in .env.example, so it must land under
    // the serializer's own catch-all banner, not scattered in mid-file.
    expect(rendered).toContain('# Not in .env.example');
    const notInExampleIndex = rendered.indexOf('# Not in .env.example');
    const appVersionIndex = rendered.indexOf('APP_VERSION=1.2.3');
    expect(appVersionIndex).toBeGreaterThan(notInExampleIndex);
  });

  it('round-trips through parseEnvFile, and leaves a pre-existing answered key untouched', () => {
    const envPath = makeEnv();

    stampAppVersion(envPath, TEMPLATE_PATH, '1.2.3');

    const values = readEnvFile(envPath);
    expect(values.get('APP_VERSION')).toBe('1.2.3');
    // The wizard's own answer for an ordinary key must survive unrelated to
    // this stamp - a rewrite that clobbered other values would be a much
    // worse bug than a missing version number.
    expect(values.get('POSTGRES_PASSWORD')).toBe('a-real-answered-secret');
    expect(values.get('NODE_ENV')).toBe('development');
  });

  it('is idempotent: stamping the same version again does not rewrite the file at all', () => {
    const envPath = makeEnv();
    stampAppVersion(envPath, TEMPLATE_PATH, '1.2.3');
    const firstPass = readFileSync(envPath, 'utf8');

    const wroteAgain = stampAppVersion(envPath, TEMPLATE_PATH, '1.2.3');

    expect(wroteAgain).toBe(true);
    // Byte-identical: the early-return path never reaches writeEnvFile.
    expect(readFileSync(envPath, 'utf8')).toBe(firstPass);
  });

  it('does overwrite a previously stamped, different version', () => {
    const envPath = makeEnv({ APP_VERSION: '1.0.0' });

    stampAppVersion(envPath, TEMPLATE_PATH, '1.2.3');

    expect(readEnvFile(envPath).get('APP_VERSION')).toBe('1.2.3');
  });
});

// =============================================================================
// An app chooses which manifests the step writes (issue #1030): kvox keeps its
// CLI on its own version, and a production deploy rewrote it from 1.10.7 to the
// app release.
// =============================================================================
describe('runVersionStep with a custom manifest list', () => {
  const WITHOUT_CLI = ['apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json'];

  /** The default repo, then the CLI moved to its own version in a second commit. */
  function makeRepoWithOwnCliVersion(appVersion = '1.2.2', cliVersion = '1.10.7'): string {
    const repo = makeRepo(appVersion);
    writeFileSync(join(repo, 'apps/cli/package.json'), manifestJson(cliVersion));
    git(repo, 'commit', '--quiet', '-am', 'cli keeps its own version');
    return repo;
  }

  const versionOf = (repo: string, relative: string): string =>
    (JSON.parse(readFileSync(join(repo, relative), 'utf8')) as { version: string }).version;

  it('moves the listed manifests and leaves the CLI manifest at its own version', async () => {
    const repo = makeRepoWithOwnCliVersion();
    const cliBefore = readFileSync(join(repo, 'apps/cli/package.json'), 'utf8');

    const result = await runVersionStep({ checkoutPath: repo, requested: '1.2.3', manifests: WITHOUT_CLI });

    expect(result.bumped).toBe(true);
    for (const relative of WITHOUT_CLI) expect(versionOf(repo, relative)).toBe('1.2.3');
    expect(readFileSync(join(repo, 'apps/cli/package.json'), 'utf8')).toBe(cliBefore);
    expect(versionOf(repo, 'apps/cli/package.json')).toBe('1.10.7');
  });

  it('still makes ONE commit, leaves the tree clean, and the commit holds only the listed files', async () => {
    const repo = makeRepoWithOwnCliVersion();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = await runVersionStep({ checkoutPath: repo, requested: '1.2.3', manifests: WITHOUT_CLI });

    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-list', '--count', `${before}..HEAD`)).toBe('1');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('chore(release): 1.2.3');
    expect(git(repo, 'diff', '--name-only', before, 'HEAD').split('\n').sort()).toEqual([...WITHOUT_CLI].sort());
    expect(result.commitSha).toBe(git(repo, 'rev-parse', 'HEAD'));
  });

  it('names the files it wrote in the step detail and in `files`', async () => {
    const repo = makeRepoWithOwnCliVersion();

    const result = await runVersionStep({ checkoutPath: repo, requested: '1.2.3', manifests: WITHOUT_CLI });

    expect(result.files).toEqual(WITHOUT_CLI);
    expect(result.detail).toBe(`wrote 1.2.3 to ${WITHOUT_CLI.join(', ')} and committed`);
    expect(result.detail).not.toContain('apps/cli');
  });

  it('reads the current version from the first listed manifest, so the suggestion follows it', async () => {
    const repo = makeRepoWithOwnCliVersion('1.2.2', '1.10.7');

    const fromApi = await runVersionStep({ checkoutPath: repo, manifests: WITHOUT_CLI });
    expect(fromApi.version).toBe('1.2.3');

    const other = makeRepoWithOwnCliVersion('1.2.2', '1.10.7');
    const fromCli = await runVersionStep({
      checkoutPath: other,
      manifests: ['apps/cli/package.json', 'apps/api/package.json'],
    });
    expect(fromCli.version).toBe('1.10.8');
  });

  it('keeps assertMovesForward: a version that does not sort above the first manifest is refused untouched', async () => {
    const repo = makeRepoWithOwnCliVersion('1.2.2', '1.10.7');
    const before = git(repo, 'rev-parse', 'HEAD');

    // The first listed manifest is the version source: 1.5.0 sorts above the
    // app's 1.2.2 but not above the CLI's 1.10.7 when the CLI is listed first.
    await expect(runVersionStep({ checkoutPath: repo, requested: '1.2.2', manifests: WITHOUT_CLI })).rejects.toBeInstanceOf(UsageError);
    await expect(
      runVersionStep({ checkoutPath: repo, requested: '1.5.0', manifests: ['apps/cli/package.json'] }),
    ).rejects.toBeInstanceOf(UsageError);

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('stages and commits the lockfile with only the listed workspaces moved', async () => {
    const repo = makeRepoWithOwnCliVersion('1.2.2', '1.10.7');
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', workspaces: ['apps/*', 'packages/*'] },
        'apps/api': { version: '1.2.2' },
        'apps/web': { version: '1.2.2' },
        'apps/cli': { version: '1.10.7' },
        'packages/shared': { version: '1.2.2' },
      },
    };
    writeFileSync(join(repo, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    git(repo, 'add', 'package-lock.json');
    git(repo, 'commit', '--quiet', '-m', 'lockfile');

    const result = await runVersionStep({ checkoutPath: repo, requested: '1.2.3', manifests: WITHOUT_CLI });

    expect(result.files).toContain('package-lock.json');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    const after = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')) as typeof lock;
    expect(after.packages['apps/api'].version).toBe('1.2.3');
    expect(after.packages['apps/web'].version).toBe('1.2.3');
    expect(after.packages['packages/shared'].version).toBe('1.2.3');
    expect(after.packages['apps/cli'].version).toBe('1.10.7');
  });

  it('refuses an invalid list before touching anything', async () => {
    const repo = makeRepoWithOwnCliVersion();
    const before = git(repo, 'rev-parse', 'HEAD');

    await expect(runVersionStep({ checkoutPath: repo, manifests: [] })).rejects.toBeInstanceOf(UsageError);
    await expect(
      runVersionStep({ checkoutPath: repo, manifests: ['apps/api/package.json', 'apps/api/package.json'] }),
    ).rejects.toBeInstanceOf(UsageError);

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('with no list, still writes all four (the default is unchanged)', async () => {
    const repo = makeRepo('1.0.0');

    const result = await runVersionStep({ checkoutPath: repo, requested: '1.2.3' });

    expect(result.files).toEqual([...VERSIONED_MANIFESTS]);
    for (const relative of VERSIONED_MANIFESTS) expect(versionOf(repo, relative)).toBe('1.2.3');
  });
});

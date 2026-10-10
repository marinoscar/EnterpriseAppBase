import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `scripts/new-project.mjs` is real ESM with no build step and runs no CLI code
// on import (see its `isDirectExecution` guard), so the pure licence helpers can
// be imported directly.
import { UPSTREAM_LICENSE_HOLDER, isUpstreamLicense, starterFiles } from '../../../scripts/new-project.mjs';
import { EXAMPLE_IDENTITY } from '../../../scripts/rename.mjs';
import { STARTER_DIR, findIdentityLiterals, listFiles, readIdentity as readStarterIdentity } from '../../../scripts/starter-identity.mjs';
import { caretSatisfies, checkRanges, platformVersion, starterPlatformRanges } from '../../../scripts/sync-starter-versions.mjs';

// =============================================================================
// Guards scripts/new-project.mjs's safety check and its non-destructive paths
// (issue #344, epic #341)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli
// -----------------------------------------------------------------------------
// Same reasoning as `rename-script.test.ts` beside this file: this workspace
// already runs ESM tests that spawn real subprocesses, and CI already runs
// `npm run test:run --workspace=cli`. There is no separate "repo tooling"
// test workspace to put this in instead.
//
// WHAT THIS SUITE DELIBERATELY NEVER DOES
// -----------------------------------------------------------------------------
// `new-project.mjs --reset-release` (without `--dry-run`) and `--license`
// (without `--dry-run`) both write real files: package.json versions,
// CHANGELOG.md, and LICENSE. This suite never runs either of those against
// THIS checkout. Every case below is either:
//
//   - a refusal (the template safety check, or input validation) — nothing
//     is ever written on that path, or
//   - `--dry-run`, which the script's own `resetRelease()`/`writeLicense()`
//     gate behind `if (!dryRun) writeFileSync(...)`, or
//   - `--audit`/`--help`, which are read-only by construction (see
//     `audit()` and `main()`: nothing in either path calls `writeFileSync`).
//
// The write path (an actual `--reset-release` or `--license` with neither
// `--dry-run` nor a refusal) is intentionally NOT exercised here. Doing that
// safely would mean copying the whole repository to a scratch directory
// first, and the fixed relative walk from this file up to `REPO_ROOT` plus
// the git-remote read inside `assertNotTemplate()` make a trustworthy copy
// more machinery than this suite's other five cases justify. See the task
// note this file was written against for the same call.
//
// THE MOST IMPORTANT CASE HERE
// -----------------------------------------------------------------------------
// `assertNotTemplate()` is what stops `--reset-release` from ever running
// unguarded against the template itself — discarding real release history
// and renumbering four packages. The first describe block below exercises it
// hermetically: it spins up a throwaway local clone of THIS checkout, points
// that clone's `origin` at a URL built from `identity.json`'s own `repoSlug`
// (never at whatever the real checkout's remote happens to be), and runs the
// script inside the clone. That is what `assertNotTemplate()` actually keys
// off of — `origin.includes(identity.repoSlug)` — so this reproduces the
// real guard without asserting anything about the environment this suite
// happens to run in. Before this, the test instead asserted that the real
// checkout's `origin` already matched `identity.json` — true only for the
// template repository itself, and false (so the test failed outright) for
// every fork the instant it re-points `origin`, even before it has renamed
// anything (issue #514).
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'new-project.mjs');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
const LICENSE_PATH = join(REPO_ROOT, 'LICENSE');
const WORKSPACE_MANIFEST_RELATIVE_PATHS = [
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
];
const WORKSPACE_MANIFESTS = WORKSPACE_MANIFEST_RELATIVE_PATHS.map((rel) => join(REPO_ROOT, rel));

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run `node scripts/new-project.mjs <args>` from the repo root, never throwing on a non-zero exit. */
function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

function gitPorcelainStatus(): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function readAll(paths: string[]): string[] {
  return paths.map((p) => readFileSync(p, 'utf8'));
}

/**
 * Run `node <script> <args>` in `cwd`, never throwing on a non-zero exit.
 * Same shape as `run()` above, generalised to a caller-supplied script path
 * and working directory so the hermetic clone below can exercise its own
 * copy of `new-project.mjs` rather than the one under `REPO_ROOT`.
 */
function runScript(scriptPath: string, args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [scriptPath, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

/**
 * A throwaway local clone of `REPO_ROOT`, with `origin` re-pointed at a URL
 * built from `identity.json`'s own `repoSlug` — reproducing exactly the
 * condition `assertNotTemplate()` checks for
 * (`origin.includes(identity.repoSlug)`), without depending on what this
 * checkout's real `origin` happens to be.
 *
 * `--local --no-hardlinks` clones over the filesystem with no network access
 * and no shared objects with `REPO_ROOT`, so mutating the clone (or `git
 * remote set-url` on it) can never touch the real checkout. `--depth 1`
 * needs a `file://` URL rather than a bare path to take effect; only the
 * current commit is needed here, not history, so the shallow clone keeps
 * this fast even though `--local` itself is a no-op once `--depth` is given
 * (git always does a full network-style clone in that case, just over the
 * filesystem).
 */
function withTemplateClone<T>(callback: (cloneDir: string) => T): T {
  const cloneDir = mkdtempSync(join(tmpdir(), 'new-project-premise-'));
  try {
    execFileSync(
      'git',
      ['clone', '--local', '--no-hardlinks', '--depth', '1', `file://${REPO_ROOT}`, cloneDir],
      { encoding: 'utf8' },
    );
    return callback(cloneDir);
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// 1. The safety check — the reason this script cannot bootstrap over itself.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --reset-release safety check', () => {
  it('refuses to run against a checkout whose origin still names identity.json\'s repoSlug', () => {
    withTemplateClone((cloneDir) => {
      const clonedManifestPath = join(cloneDir, 'packages', 'shared', 'identity.json');
      const identity = JSON.parse(readFileSync(clonedManifestPath, 'utf8')) as { repoSlug?: string };
      expect(identity.repoSlug, 'expected identity.json repoSlug to be set').toBeTruthy();

      // The clone's `origin` (set by `git clone` itself) points at
      // `REPO_ROOT` on disk, which never contains `repoSlug` as a substring —
      // re-point it to a URL that does, exactly as a real fork's `origin`
      // would look right after it is renamed on GitHub but before
      // `rename.mjs` has run.
      const origin = `https://github.com/${identity.repoSlug}.git`;
      execFileSync('git', ['remote', 'set-url', 'origin', origin], { cwd: cloneDir, encoding: 'utf8' });

      const clonedScript = join(cloneDir, 'scripts', 'new-project.mjs');
      const clonedWorkspaceManifests = WORKSPACE_MANIFEST_RELATIVE_PATHS.map((rel) => join(cloneDir, rel));
      const clonedChangelog = join(cloneDir, 'CHANGELOG.md');
      const clonedGitStatus = () =>
        execFileSync('git', ['status', '--porcelain'], { cwd: cloneDir, encoding: 'utf8' });

      const statusBefore = clonedGitStatus();
      const before = readAll([...clonedWorkspaceManifests, clonedChangelog]);

      const result = runScript(clonedScript, ['--reset-release'], cloneDir);

      const statusAfter = clonedGitStatus();
      const after = readAll([...clonedWorkspaceManifests, clonedChangelog]);

      expect(result.status, `expected non-zero exit, got 0. stdout:\n${result.stdout}`).not.toBe(0);
      expect(result.stderr).toMatch(/still points at the repository named in identity\.json/);
      expect(result.stderr).toContain(origin);
      expect(result.stderr).toContain(identity.repoSlug as string);
      // A refusal must be a true no-op.
      expect(after).toEqual(before);
      expect(statusAfter).toBe(statusBefore);
    });
  });
});

// -----------------------------------------------------------------------------
// 2. --audit (and the implied default) — read-only, and must keep
//    recommending KEEP for the example handlers.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --audit', () => {
  it('exits 0, writes nothing, and reports the example handlers as KEEP', () => {
    const statusBefore = gitPorcelainStatus();

    const result = run(['--audit']);

    const statusAfter = gitPorcelainStatus();

    expect(result.status, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`).toBe(0);
    expect(statusAfter).toBe(statusBefore);

    expect(result.stdout).toMatch(/FOR A NEW PROJECT/);
    expect(result.stdout).toMatch(/Nothing above was changed\./);

    // The example-handlers item is load-bearing: example.checksum is the
    // canonical node-eligible job type and the jobs/worker-node test suites
    // depend on it as a fixture (see the long comment at the top of
    // scripts/new-project.mjs). If a future edit ever flips this
    // recommendation to "delete", this assertion must fail.
    expect(result.stdout).toMatch(/Example job handlers and storage processor/);
    expect(result.stdout).toMatch(/KEEP unless you deliberately refactor/);
    expect(result.stdout).toMatch(/example\.checksum/);
  });

  it('running with no arguments implies --audit', () => {
    const statusBefore = gitPorcelainStatus();

    const result = run([]);

    const statusAfter = gitPorcelainStatus();

    expect(result.status, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`).toBe(0);
    expect(statusAfter).toBe(statusBefore);
    expect(result.stdout).toMatch(/FOR A NEW PROJECT/);
    expect(result.stdout).toMatch(/KEEP unless you deliberately refactor/);
  });
});

// -----------------------------------------------------------------------------
// 3. --dry-run --reset-release — deliberately bypasses assertNotTemplate()
//    (verified by reading the function: it returns immediately when
//    `dryRun` is true, before the git-remote / identity comparison), so this
//    must succeed here with no --force. It must still write nothing.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --dry-run --reset-release', () => {
  it('exits 0 without --force, and leaves the working tree byte-identical', () => {
    const statusBefore = gitPorcelainStatus();
    const before = readAll([...WORKSPACE_MANIFESTS, CHANGELOG_PATH]);

    const result = run(['--dry-run', '--reset-release']);

    const statusAfter = gitPorcelainStatus();
    const after = readAll([...WORKSPACE_MANIFESTS, CHANGELOG_PATH]);

    expect(result.status, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Would change/);
    expect(result.stdout).toMatch(/version -> 0\.1\.0/);
    expect(result.stdout).toMatch(/CHANGELOG\.md/);
    expect(result.stdout).toMatch(/\(--dry-run: nothing was written\.\)/);

    expect(after).toEqual(before);
    expect(statusAfter).toBe(statusBefore);
  });
});

// -----------------------------------------------------------------------------
// 4. --help / -h
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --help', () => {
  it('exits 0 and prints usage', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Prepare a fresh fork of this template as a new product\./);
    expect(result.stdout).toMatch(/--reset-release/);
    expect(result.stdout).toMatch(/--license/);
    expect(result.stdout).toMatch(/--dry-run/);
    expect(result.stdout).toMatch(/--force/);
  });

  it('-h is the same as --help', () => {
    const result = run(['-h']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Prepare a fresh fork of this template as a new product\./);
  });
});

// -----------------------------------------------------------------------------
// 5. --license validation. `main()` runs `assertNotTemplate()` whenever
//    `opts.license` is set at all — before `writeLicense()`'s own id/holder
//    checks ever run — and this checkout IS the template (see case 1 above).
//    So every case here needs `--dry-run` too, purely to get past that gate
//    and reach the validation this describe block is actually testing;
//    `writeLicense()`'s own die() calls happen before any `writeFileSync`
//    regardless of `--dry-run`, so this stays read-only either way.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --license validation', () => {
  it('rejects an unsupported license id and names the supported ones', () => {
    const statusBefore = gitPorcelainStatus();

    const result = run(['--dry-run', '--license', 'apache-2.0', '--holder', 'Test Holder']);

    const statusAfter = gitPorcelainStatus();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown --license "apache-2\.0"/);
    expect(result.stderr).toMatch(/Supported: mit, proprietary\./);
    expect(statusAfter).toBe(statusBefore);
  });

  it('rejects --license mit without --holder', () => {
    const statusBefore = gitPorcelainStatus();

    const result = run(['--dry-run', '--license', 'mit']);

    const statusAfter = gitPorcelainStatus();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--holder/);
    expect(statusAfter).toBe(statusBefore);
  });
});

// -----------------------------------------------------------------------------
// 6. Unknown flag
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs unknown arguments', () => {
  it('exits non-zero on an unrecognised flag', () => {
    const result = run(['--not-a-real-flag']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown argument: --not-a-real-flag/);
  });
});

// -----------------------------------------------------------------------------
// 7. The platform's own licence is kept when a fork writes its own. MIT requires
//    the upstream notice to stay with substantial portions of the code, so
//    `--license` moves an upstream LICENSE to LICENSE.platform instead of
//    overwriting it, and still refuses to overwrite any other LICENSE without
//    --force. Everything here is --dry-run, or runs in a throwaway clone.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs upstream licence', () => {
  const proprietary = 'Copyright (c) 2026 Fork Co. All rights reserved.\n\nProprietary.\n';

  it('isUpstreamLicense is true for the committed root LICENSE', () => {
    expect(UPSTREAM_LICENSE_HOLDER).toBe('marinoscar');
    expect(isUpstreamLicense(readFileSync(LICENSE_PATH, 'utf8'))).toBe(true);
  });

  it('isUpstreamLicense ignores line-ending differences', () => {
    const text = readFileSync(LICENSE_PATH, 'utf8').replace(/\n/g, '\r\n');
    expect(isUpstreamLicense(text)).toBe(true);
  });

  it('isUpstreamLicense is false for a proprietary text', () => {
    expect(isUpstreamLicense(proprietary)).toBe(false);
  });

  it('isUpstreamLicense is false for the MIT text under another holder', () => {
    const text = readFileSync(LICENSE_PATH, 'utf8').replace(UPSTREAM_LICENSE_HOLDER, 'Fork Co');
    expect(isUpstreamLicense(text)).toBe(false);
  });

  it('isUpstreamLicense is false for the upstream text with an edited body', () => {
    const text = readFileSync(LICENSE_PATH, 'utf8').replace('AS IS', 'AS-IS');
    expect(isUpstreamLicense(text)).toBe(false);
  });

  it('a dry run reports the rename to LICENSE.platform and the new licence, and writes nothing', () => {
    const statusBefore = gitPorcelainStatus();

    const result = run(['--dry-run', '--license', 'mit', '--holder', 'Fork Co']);

    const statusAfter = gitPorcelainStatus();

    expect(result.status, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/Would change/);
    expect(result.stdout).toContain('LICENSE -> LICENSE.platform');
    expect(result.stdout).toContain('LICENSE written (mit)');
    expect(result.stdout).toMatch(/README\.md\s+licence line replaced/);
    expect(statusAfter).toBe(statusBefore);
  });

  it('the audit reports the inherited platform licence', () => {
    const result = run(['--audit']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('LICENSE is the platform\'s MIT licence');
    expect(result.stdout).toContain('keep it as LICENSE.platform; run --license to add your own');
  });

  it('refuses to replace a LICENSE that is not the upstream text, unless --force', () => {
    withTemplateClone((cloneDir) => {
      writeFileSync(join(cloneDir, 'LICENSE'), proprietary);
      const clonedScript = join(cloneDir, 'scripts', 'new-project.mjs');
      const args = ['--dry-run', '--license', 'mit', '--holder', 'Fork Co'];

      const refused = runScript(clonedScript, args, cloneDir);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(/a LICENSE file already exists/);

      const forced = runScript(clonedScript, [...args, '--force'], cloneDir);
      expect(forced.status, `stderr:\n${forced.stderr}`).toBe(0);
      expect(forced.stdout).toContain('LICENSE written (mit)');
      expect(forced.stdout).not.toContain('LICENSE.platform');
    });
  });
});

// =============================================================================
// create: a new product from starter/ (issue #741)
// =============================================================================
//
// Every write below goes to a fresh temporary directory OUTSIDE this checkout;
// nothing touches the working tree. The real create copies ~80 files and runs
// the copy's own rename (plus platform-infra sync when the packages are
// built), so the block gets a longer timeout than the suite default.

const CREATE_TIMEOUT_MS = 60_000;
const INFRA_BUILT = existsSync(join(REPO_ROOT, 'packages', 'platform-infra', 'dist', 'cli.js'));

function runCreate(args: string[]): RunResult {
  return runIn(REPO_ROOT, ['create', ...args]);
}

function runIn(cwd: string, args: string[], script = SCRIPT): RunResult {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Every file of a directory with its content, for byte-identity checks. */
function snapshot(root: string): Map<string, string> {
  return new Map(listFiles(root).map((file: string) => [file, readFileSync(join(root, file), 'utf8')]));
}

describe('starter/ depends on published platform versions only (issue #741)', () => {
  it('has no workspace:, file: or path dependency on a platform package, and its ranges include the current version', () => {
    const ranges = starterPlatformRanges(REPO_ROOT);
    expect(ranges.length).toBeGreaterThanOrEqual(5);
    for (const { range } of ranges) expect(range).not.toMatch(/^(workspace:|file:|link:|\.|\/)/);
    expect(checkRanges(ranges, platformVersion(REPO_ROOT))).toEqual([]);
  });

  it('flags a workspace spec and a range that excludes the version', () => {
    const ranges = [
      { manifest: 'm', field: 'dependencies', name: '@marinoscar/platform-api', range: 'workspace:*' },
      { manifest: 'm', field: 'dependencies', name: '@marinoscar/platform-web', range: '^0.0.9' },
    ];
    expect(checkRanges(ranges, '0.1.0')).toHaveLength(2);
    expect(caretSatisfies('^0.1.0-next.3', '0.1.0-next.4')).toBe(true);
    expect(caretSatisfies('^0.1.0-next.3', '0.1.5')).toBe(true);
    expect(caretSatisfies('^0.1.0-next.3', '0.2.0')).toBe(false);
    expect(caretSatisfies('^0.1.0', '0.1.1-next.0')).toBe(false);
  });

  it('is not one of the root workspaces (it has its own install)', () => {
    const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { workspaces: string[] };
    expect(root.workspaces.some((glob) => glob.startsWith('starter'))).toBe(false);
  });
});

describe('scripts/new-project.mjs create refusals (issue #741)', () => {
  it('--dry-run writes nothing, not even the target directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'new-project-create-'));
    const dir = join(parent, 'acme');
    const statusBefore = gitPorcelainStatus();
    try {
      const result = runCreate(['--dir', dir, '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--cli', 'acmectl', '--dry-run']);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Planned edits/);
      expect(result.stdout).toMatch(/nothing was written/);
      expect(existsSync(dir)).toBe(false);
      expect(gitPorcelainStatus()).toBe(statusBefore);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, CREATE_TIMEOUT_MS);

  it('refuses a non-empty --dir and leaves it alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'new-project-create-'));
    writeFileSync(join(dir, 'keep.txt'), 'mine');
    try {
      const result = runCreate(['--dir', dir, '--name', 'Acme Hub', '--repo', 'acme/acme-hub']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not empty/);
      expect(readdirSync(dir)).toEqual(['keep.txt']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a --dir inside this repository', () => {
    const result = runCreate(['--dir', join(REPO_ROOT, 'worktrees', 'never-created'), '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--dry-run']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/inside this repository/);
  });

  it('requires --dir, --name and --repo, and validates the identity', () => {
    expect(runCreate(['--name', 'Acme Hub', '--repo', 'acme/acme-hub']).stderr).toMatch(/--dir/);
    expect(runCreate(['--dir', '/tmp/x', '--repo', 'acme/acme-hub']).stderr).toMatch(/--name/);
    const parent = mkdtempSync(join(tmpdir(), 'new-project-create-'));
    try {
      const bad = runCreate(['--dir', join(parent, 'a'), '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--theme', '#fff', '--dry-run']);
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toMatch(/6-digit hex/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('scripts/new-project.mjs create (issue #741)', () => {
  let parent = '';
  let dir = '';
  let result: RunResult = { status: -1, stdout: '', stderr: '' };

  beforeAll(() => {
    parent = mkdtempSync(join(tmpdir(), 'new-project-create-'));
    dir = join(parent, 'acme-hub');
    result = runCreate(['--dir', dir, '--name', EXAMPLE_IDENTITY.name, '--repo', 'acme/acme-hub', '--cli', 'acmectl', '--license', 'mit', '--holder', 'Acme Inc']);
  }, CREATE_TIMEOUT_MS);

  afterAll(() => {
    if (parent) rmSync(parent, { recursive: true, force: true });
  });

  it('succeeds and prints the next steps and the three values nothing can generate', () => {
    expect(result.status, result.stderr).toBe(0);
    for (const value of ['npm install', 'npm run setup', 'INITIAL_ADMIN_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
      expect(result.stdout).toContain(value);
    }
  });

  it('copies the starter without installs, build output or a lockfile', () => {
    expect(existsSync(join(dir, 'apps', 'api', 'src', 'app.module.ts'))).toBe(true);
    expect(listFiles(dir).filter((f: string) => /(^|\/)(node_modules|dist)\//.test(f) || f === 'package-lock.json')).toEqual([]);
    expect(listFiles(dir).length).toBe(starterFiles().length + 1); // + LICENSE
  });

  it('writes the new identity, CLI name included', () => {
    const identity = JSON.parse(readFileSync(join(dir, 'packages', 'shared', 'identity.json'), 'utf8'));
    expect(identity).toMatchObject({ productName: EXAMPLE_IDENTITY.name, repoSlug: 'acme/acme-hub', cliName: 'acmectl' });
    const cli = JSON.parse(readFileSync(join(dir, 'apps', 'cli', 'package.json'), 'utf8')) as { bin: Record<string, string> };
    expect(Object.keys(cli.bin)).toEqual(['acmectl']);
    const root = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string };
    expect(root.name).toBe('acme-hub');
  });

  it.skipIf(!INFRA_BUILT)('renders the worker fragment with ACMECTL_* (needs `npm run build:packages`)', () => {
    const worker = readFileSync(join(dir, 'infra', 'compose', 'worker.compose.yml'), 'utf8');
    expect(worker).toMatch(/ACMECTL_TOKEN/);
    expect(worker).not.toMatch(/APPCTL_/);
    const base = readFileSync(join(dir, 'infra', 'compose', 'base.compose.yml'), 'utf8');
    expect(base).toContain('acme-hub-api');
  });

  it.skipIf(!INFRA_BUILT)('leaves no value of the starter identity anywhere in the project', () => {
    const findings = findIdentityLiterals(dir, listFiles(dir), readStarterIdentity(STARTER_DIR));
    expect(findings.map((f: { file: string; line: number; value: string }) => `${f.file}:${f.line} [${f.value}]`)).toEqual([]);
  });

  it('resets the release state, writes the LICENSE, and runs git init without committing', () => {
    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(/## \[Unreleased\]\n\n## \[0\.1\.0\] - \d{4}-\d{2}-\d{2}/);
    for (const manifest of ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/cli/package.json']) {
      expect(JSON.parse(readFileSync(join(dir, manifest), 'utf8')).version).toBe('0.1.0');
    }
    expect(readFileSync(join(dir, 'LICENSE'), 'utf8')).toMatch(/^MIT License\n\nCopyright \(c\) \d{4} Acme Inc/);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('MIT — see [LICENSE](LICENSE).');
    expect(existsSync(join(dir, '.git'))).toBe(true);
    const commits = runGit(dir, ['rev-list', '--all', '--count']);
    expect(commits.trim()).toBe('0');
  });

  it('is idempotent: the copy\'s own rename.mjs with the same arguments changes nothing', () => {
    const before = snapshot(dir);
    const again = runIn(dir, ['--name', EXAMPLE_IDENTITY.name, '--repo', 'acme/acme-hub', '--cli-name', 'acmectl', '--force'], join(dir, 'scripts', 'rename.mjs'));
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/every target already carries the new values/);
    expect(snapshot(dir)).toEqual(before);
  });
});

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return '0';
  }
}

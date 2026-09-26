import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

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
// and renumbering four packages.
//
// `assertNotTemplate()`'s input is `git remote get-url origin` — not this
// checkout's identity, this checkout's remote. An earlier version of this
// suite read THIS checkout's own origin and asserted it matched
// `identity.json`'s `repoSlug`, on the theory that this repository IS the
// template right now. That premise holds for the template itself, but not
// for a fresh fork: the very first thing `docs/RENAMING.md` and the
// `/rename-app` skill do is rename the repo and re-point `origin`, and that
// is a manual step the checklist lists AFTER "run the tests, expect green" —
// so on every fork, right up until that manual step, `origin` does not
// contain `repoSlug` and the old assertion failed for a reason that has
// nothing to do with whether `assertNotTemplate()` itself still works.
//
// So the first describe block below supplies its OWN remote instead of
// inheriting this checkout's: it clones the repository into a throwaway
// directory and points that clone's `origin` at the exact URL
// `identity.json`'s `repoSlug` implies, which is precisely the state
// `assertNotTemplate()` is supposed to refuse. That makes the test an
// assertion about the SCRIPT, true on the template, on a fresh fork before
// renaming, and on a fresh fork after — never about which remote this
// particular checkout happens to have.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'new-project.mjs');
const CHANGELOG_PATH = join(REPO_ROOT, 'CHANGELOG.md');
const WORKSPACE_MANIFEST_RELATIVE = [
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
];
const WORKSPACE_MANIFESTS = WORKSPACE_MANIFEST_RELATIVE.map((rel) => join(REPO_ROOT, rel));

/** The same manifest set, resolved against an arbitrary root — used to read a clone's own copies. */
function workspaceManifestsIn(root: string): string[] {
  return WORKSPACE_MANIFEST_RELATIVE.map((rel) => join(root, rel));
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run `node <script> <args>` from `cwd`, never throwing on a non-zero exit. */
function runScript(script: string, args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [script, ...args], {
      cwd,
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

/** Run `node scripts/new-project.mjs <args>` from the repo root, never throwing on a non-zero exit. */
function run(args: string[]): RunResult {
  return runScript(SCRIPT, args, REPO_ROOT);
}

function gitPorcelainStatus(cwd: string = REPO_ROOT): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
}

function readAll(paths: string[]): string[] {
  return paths.map((p) => readFileSync(p, 'utf8'));
}

// -----------------------------------------------------------------------------
// 1. The safety check — the reason this script cannot bootstrap over itself.
// -----------------------------------------------------------------------------

describe('scripts/new-project.mjs --reset-release safety check', () => {
  // One clone, shared by the (single) test in this block, cleaned up
  // afterwards regardless of pass/fail.
  let clonedRoot: string | undefined;

  afterAll(() => {
    if (clonedRoot) rmSync(clonedRoot, { recursive: true, force: true });
  });

  it('refuses to run against the repository named in identity.json, naming both the origin and the identity value', () => {
    clonedRoot = mkdtempSync(join(tmpdir(), 'new-project-template-guard-'));

    // A local clone of this ~12 MB repository takes about a second. `--local`
    // is deliberately NOT passed: it is ignored whenever the SOURCE repo
    // itself is a shallow clone (true in CI), so relying on it would make
    // this clone silently fall back to a full network-style copy in some
    // environments and a hardlinked one in others.
    try {
      execFileSync('git', ['clone', '-q', REPO_ROOT, clonedRoot], { encoding: 'utf8' });
    } catch (err) {
      // Never a silent skip: if cloning fails, this test cannot exercise
      // anything and must say so loudly rather than passing vacuously.
      throw new Error(
        `new-project-script.test.ts: \`git clone ${REPO_ROOT} ${clonedRoot}\` failed, so this ` +
          `test cannot exercise the safety check. Underlying error: ${String(err)}`,
      );
    }

    // Read the manifest from the CLONE, not from REPO_ROOT: `git clone`
    // copies committed files only, so right after a rename's uncommitted
    // edits (the state the /rename-app skill's own checklist tests IN,
    // deliberately before committing) REPO_ROOT's working tree and the
    // clone's HEAD can name different repos entirely. Reading the clone's
    // own identity.json is what keeps origin and slug in agreement inside
    // the clone regardless of what the working tree currently holds.
    const clonedManifestPath = join(clonedRoot, 'packages', 'shared', 'identity.json');
    const identity = JSON.parse(readFileSync(clonedManifestPath, 'utf8')) as { repoSlug?: string };
    expect(identity.repoSlug, 'expected the clone\'s identity.json repoSlug to be set').toBeTruthy();
    const repoSlug = identity.repoSlug as string;

    // The safety check's input is `git remote get-url origin` — not
    // whichever remote this checkout happens to have. Set the clone's own
    // origin to exactly the URL the CLONE's own repoSlug implies, which is
    // precisely the state `assertNotTemplate()` exists to refuse.
    execFileSync(
      'git',
      ['-C', clonedRoot, 'remote', 'set-url', 'origin', `https://github.com/${repoSlug}.git`],
      { encoding: 'utf8' },
    );
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: clonedRoot,
      encoding: 'utf8',
    }).trim();

    const statusBefore = gitPorcelainStatus(clonedRoot);
    // The clone's own copies — a clone contains committed files only, which
    // is fine for a refusal path that must write nothing regardless.
    const before = readAll([...workspaceManifestsIn(clonedRoot), join(clonedRoot, 'CHANGELOG.md')]);

    // The script resolves its own REPO_ROOT from `import.meta.url`, so
    // running the CLONE's copy of the script (with cwd = the clone) is what
    // makes it read and refuse against the clone's identity.json and origin,
    // not this checkout's.
    const result = runScript(join(clonedRoot, 'scripts', 'new-project.mjs'), ['--reset-release'], clonedRoot);

    const statusAfter = gitPorcelainStatus(clonedRoot);
    const after = readAll([...workspaceManifestsIn(clonedRoot), join(clonedRoot, 'CHANGELOG.md')]);

    expect(result.status, `expected non-zero exit, got 0. stdout:\n${result.stdout}`).not.toBe(0);
    expect(result.stderr).toMatch(/still points at the repository named in identity\.json/);
    expect(result.stderr).toContain(origin);
    expect(result.stderr).toContain(repoSlug);
    // A refusal must be a true no-op.
    expect(after).toEqual(before);
    expect(statusAfter).toBe(statusBefore);
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

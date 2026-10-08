import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildPlan, derive, detectLayout } from '../../../scripts/rename.mjs';
import { buildStarterPlan, derive as deriveStarter } from '../../../starter/scripts/rename.mjs';

// =============================================================================
// Guards scripts/rename.mjs against decaying into a no-op (issue #343, epic #341)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli
// -----------------------------------------------------------------------------
// Same reasoning as `template-identity.test.ts` beside this file: this
// workspace already runs ESM tests that spawn real subprocesses
// (`apps/cli/src/deploy/repo.test.ts` spawns real `git`), and CI already runs
// `npm run test:run --workspace=cli`. There is no separate "repo tooling"
// test workspace to put this in instead.
//
// WHAT THIS DOES AND DOES NOT PROVE
// -----------------------------------------------------------------------------
// `rename.mjs` rewrites files in place under normal operation, and this suite
// deliberately never lets it do that against the real working tree — every
// invocation below passes `--dry-run`. The point of the suite is narrower and,
// for a codemod, more important than "it edits files": every anchor the
// script's `buildPlan()` declares must still find exactly the hit count it
// expects RIGHT NOW, against the repository as it exists today. `buildPlan()`
// fails loudly (`problems`, non-zero exit) the moment an anchor's surrounding
// file changes shape — a refactor of README.md, a reworded install.sh line —
// and it is exactly that failure mode this suite exists to catch. A codemod
// that silently skips a file and reports success would leave the old name in
// a published OpenAPI document; see the long comment at the top of
// `scripts/rename.mjs` itself.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const RENAME_SCRIPT = join(REPO_ROOT, 'scripts', 'rename.mjs');
const MANIFEST_PATH = join(REPO_ROOT, 'packages', 'shared', 'identity.json');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run `node scripts/rename.mjs <args>` from the repo root, never throwing on a non-zero exit. */
function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [RENAME_SCRIPT, ...args], {
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

// -----------------------------------------------------------------------------
// `--dry-run` skips the dirty-tree check entirely (verified by reading
// `main()`: the `git status --porcelain` check is gated on
// `!opts.dryRun && !opts.force`), so every test below is safe to run against
// whatever state this checkout happens to be in — dirty or clean — without
// `--force`.
// -----------------------------------------------------------------------------

describe('scripts/rename.mjs --dry-run writes nothing', () => {
  it('exits 0 and leaves the working tree byte-identical', () => {
    const before = readFileSync(MANIFEST_PATH, 'utf8');
    const statusBefore = gitPorcelainStatus();

    const result = run([
      '--dry-run',
      '--name',
      'Rename Guard Sample',
      '--repo',
      'sample-owner/sample-repo',
      '--theme',
      '#123456',
    ]);

    const statusAfter = gitPorcelainStatus();
    const after = readFileSync(MANIFEST_PATH, 'utf8');

    expect(result.status, `expected exit 0, got ${result.status}. stderr:\n${result.stderr}`).toBe(0);
    expect(after).toBe(before);
    expect(statusAfter).toBe(statusBefore);
  });
});

describe('scripts/rename.mjs --dry-run reports a hit for every declared anchor', () => {
  it('produces no "did not match as declared" failures', () => {
    // The real point of this test: if an unrelated refactor changes the shape
    // of a file `buildPlan()` targets (a reworded README line, a moved env
    // default), the script's own hit-count check goes red here — instead of
    // the codemod silently skipping that file and reporting a clean run.
    const result = run([
      '--dry-run',
      '--name',
      'Rename Guard Sample',
      '--repo',
      'sample-owner/sample-repo',
      '--theme',
      '#123456',
    ]);

    expect(
      result.status,
      `rename.mjs exited ${result.status}; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stderr).not.toMatch(/did not match as declared/);
    expect(result.stdout).toMatch(/Planned edits/);
    // Every anchor line in the "planned" listing is prefixed `~` for a real
    // hit or `=` for "already applied"; neither prefix appears if the plan is
    // empty, so require at least one real edit to guard against a plan that
    // silently shrank to nothing.
    expect(result.stdout).toMatch(/^\s*~ /m);
  });
});

describe('scripts/rename.mjs never touches the platform packages', () => {
  it('plans no edit under packages/platform-* and leaves their names alone (issue #690)', () => {
    // `@marinoscar/platform-*` names a published npm package, not this
    // product: a fork that renames itself still depends on the same
    // packages, and each platform package.json carries the platform's own
    // repository URL (which shares a prefix with anchors the codemod
    // rewrites in README.md and install.sh). docs/RENAMING.md lists them
    // under "never renamed".
    const manifest = join(REPO_ROOT, 'packages', 'platform-api', 'package.json');
    const before = readFileSync(manifest, 'utf8');

    const result = run([
      '--dry-run',
      '--name',
      'Rename Guard Sample',
      '--repo',
      'sample-owner/sample-repo',
      '--theme',
      '#123456',
      '--cli-name',
      'samplectl',
    ]);

    expect(result.status, `stderr:\n${result.stderr}`).toBe(0);
    const planned = result.stdout.split('\n').filter((line) => /^\s*[~=] /.test(line));
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.filter((line) => line.includes('packages/platform-'))).toEqual([]);
    expect(result.stdout).not.toMatch(/@marinoscar\/platform-/);
    expect(readFileSync(manifest, 'utf8')).toBe(before);
    expect(JSON.parse(before).name).toBe('@marinoscar/platform-api');
  });
});

describe('scripts/rename.mjs --help', () => {
  it('exits 0 and prints usage', () => {
    const result = run(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Rebrand this template/);
    expect(result.stdout).toMatch(/--dry-run/);
    expect(result.stdout).toMatch(/--theme/);
    expect(result.stdout).toMatch(/--repo/);
  });

  it('-h is the same as --help', () => {
    const result = run(['-h']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Rebrand this template/);
  });
});

describe('scripts/rename.mjs input validation', () => {
  it('rejects a 3-digit --theme with a message naming the 6-digit requirement', () => {
    const result = run(['--dry-run', '--theme', '#fff']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/6-digit hex/);
  });

  it('rejects a --repo that is not owner/name', () => {
    const result = run(['--dry-run', '--repo', 'notaslug']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/owner\/name/);
  });
});

// =============================================================================
// Layouts: a template fork keeps today's plan, a starter-based app gets the
// starter plan (issue #741)
// =============================================================================
//
// The starter case runs against a throwaway COPY of starter/ in a temporary
// directory (git-initialised, so the clean-tree check is real), never against
// this checkout.

describe('scripts/rename.mjs layout detection (issue #741)', () => {
  it('sees this repository as a template fork and starter/ as a starter-based app', () => {
    expect(detectLayout(REPO_ROOT)).toBe('template');
    expect(detectLayout(join(REPO_ROOT, 'starter'))).toBe('starter');
    expect(detectLayout(tmpdir())).toBe(null);
  });

  it('keeps the template plan free of starter files and the starter plan free of template-only targets', () => {
    const current = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const old = derive(current, 'appctl');
    const next = derive({ ...current, productName: 'Rename Guard Sample', repoSlug: 'sample-owner/sample-repo' }, 'samplectl');
    expect(buildPlan(old, next).some((edit: { file: string }) => edit.file.startsWith('starter/'))).toBe(false);

    const starterIdentity = JSON.parse(readFileSync(join(REPO_ROOT, 'starter', 'packages', 'shared', 'identity.json'), 'utf8'));
    const starterPlan = buildStarterPlan(
      deriveStarter(starterIdentity),
      deriveStarter({ ...starterIdentity, productName: 'Rename Guard Sample', repoSlug: 'sample-owner/sample-repo', cliName: 'samplectl', themeColor: '#123456' }),
    );
    const files = new Set(starterPlan.map((edit: { file: string }) => edit.file));
    for (const templateOnly of ['apps/api/.env.test', 'scripts/dev.ps1', 'apps/cli/src/branding.ts', 'infra/compose/.env.example']) {
      expect(files.has(templateOnly)).toBe(false);
    }
    expect([...files].sort()).toEqual(
      ['.github/workflows/ci.yml', 'README.md', 'apps/cli/package.json', 'apps/web/public/favicon.svg', 'apps/web/public/icons/source.svg', 'install.sh', 'package.json'],
    );
  });
});

describe('scripts/rename.mjs on a starter-based app (issue #741)', () => {
  let app = '';

  beforeAll(() => {
    app = mkdtempSync(join(tmpdir(), 'rename-starter-'));
    cpSync(join(REPO_ROOT, 'starter'), app, {
      recursive: true,
      filter: (src) => !/[\\/](node_modules|dist|coverage)([\\/]|$)/.test(src.slice(REPO_ROOT.length)),
    });
    const git = (args: string[]) => execFileSync('git', args, { cwd: app, stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['-c', 'user.email=guard@example.test', '-c', 'user.name=guard', 'commit', '-q', '-m', 'starter']);
  });

  afterAll(() => {
    if (app) rmSync(app, { recursive: true, force: true });
  });

  const args = () => ['--root', app, '--name', 'Acme Hub', '--repo', 'acme/acme-hub', '--cli-name', 'acmectl', '--theme', '#c62828'];

  it('applies only the starter plan, each edit with its declared hit count', () => {
    const result = run(args());
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/starter-based app; applying the starter plan/);
    const edited = result.stdout
      .split('\n')
      .map((line) => /^\s*\* (\S+)\s+(\d+)x/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null);
    expect(edited.length).toBeGreaterThan(5);
    expect(edited.every((m) => Number(m[2]) >= 1)).toBe(true);
    const changed = execFileSync('git', ['diff', '--name-only'], { cwd: app, encoding: 'utf8' }).trim().split('\n').sort();
    expect(changed).toEqual([
      '.github/workflows/ci.yml',
      'README.md',
      'apps/cli/package.json',
      'apps/web/public/favicon.svg',
      'apps/web/public/icons/source.svg',
      'install.sh',
      'package.json',
      'packages/shared/identity.json',
    ]);
    expect(JSON.parse(readFileSync(join(app, 'packages', 'shared', 'identity.json'), 'utf8'))).toMatchObject({
      productName: 'Acme Hub',
      repoSlug: 'acme/acme-hub',
      themeColor: '#c62828',
      cliName: 'acmectl',
    });
  });

  it('is idempotent: a second run with the same arguments changes nothing', () => {
    const before = execFileSync('git', ['diff'], { cwd: app, encoding: 'utf8' });
    const again = run([...args(), '--force']);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/every target already carries the new values/);
    expect(execFileSync('git', ['diff'], { cwd: app, encoding: 'utf8' })).toBe(before);
  });

  it('refuses a dirty tree without --force', () => {
    const result = run(['--root', app, '--name', 'Other Name']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/uncommitted changes/);
  });
});

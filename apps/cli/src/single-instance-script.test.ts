import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// `scripts/check-single-instance.mjs` is real ESM with no build step and
// guards its `main()` behind `isDirectExecution`, so importing it runs
// nothing; it just exposes the pure functions (same pattern as rename.mjs and
// platform-drift.mjs).
import {
  SINGLE_INSTANCE_PACKAGES,
  discoverPlatformPackages,
  discoverWorkspaces,
  findLockfileDuplicates,
  findResolutionSplits,
  fixHint,
  guardedNames,
} from '../../../scripts/check-single-instance.mjs';

// =============================================================================
// Guards scripts/check-single-instance.mjs (issue #695)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli
// -----------------------------------------------------------------------------
// Same reasoning as `rename-script.test.ts` beside this file: this workspace
// already runs ESM tests that spawn real subprocesses, and CI already runs
// `npm run test:run --workspace=cli`.
//
// FIXTURES (src/__fixtures__/single-instance/)
// -----------------------------------------------------------------------------
// - `repo/`: a minimal repository root (root `workspaces`, two apps, two
//   `packages/platform-*` workspaces under an invented `@acme` scope, so a
//   fork that renames itself never touches this file). Tests copy it to a
//   temp directory before adding a platform package or a `node_modules`
//   tree; the checked-in copy is never written to.
// - `lockfiles/*.lock.json`: package-lock v3 shapes for `repo/` (not named
//   `package-lock.json`, so no tool takes them for a real lockfile):
//   `clean`, `nested-platform-web` (second react under
//   packages/platform-web/node_modules), `nested-cli` (second react under
//   apps/cli/node_modules), `linked-workspace` (a platform package linked
//   twice, still one instance).
//
// The resolution check is tested against real directories and symlinks in
// os.tmpdir(), because the point of that check is what Node's resolver and
// `realpath` actually see.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-single-instance.mjs');
const FIXTURES = join(HERE, '__fixtures__', 'single-instance');
const FIXTURE_REPO = join(FIXTURES, 'repo');

type Lockfile = { packages: Record<string, Record<string, unknown>> };

function lockfile(name: string): Lockfile {
  return JSON.parse(
    readFileSync(join(FIXTURES, 'lockfiles', `${name}.lock.json`), 'utf8')
  ) as Lockfile;
}
const lockfilePath = (name: string): string => join(FIXTURES, 'lockfiles', `${name}.lock.json`);

const TMP = mkdtempSync(join(tmpdir(), 'single-instance-test-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let counter = 0;
/** A fresh copy of the fixture repository in a temp directory. */
function copyRepo(): string {
  const dir = join(TMP, `repo-${++counter}`);
  cpSync(FIXTURE_REPO, dir, { recursive: true });
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Install a fake package at `<dir>/node_modules/<name>`. `hideManifest`
 * gives it an `exports` map without `./package.json`, the shape that makes
 * `require.resolve('<name>/package.json')` throw.
 */
function installPackage(dir: string, name: string, version: string, hideManifest = false): string {
  const pkgDir = join(dir, 'node_modules', name);
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version,
    main: 'index.js',
    ...(hideManifest ? { exports: { '.': './index.js' } } : {}),
  });
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {};\n');
  return pkgDir;
}

/** Symlink `<dir>/node_modules/<name>` to `target`, the way npm links a workspace. */
function linkPackage(dir: string, name: string, target: string): void {
  const linkPath = join(dir, 'node_modules', name);
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, 'dir');
}

/** A copy of the fixture repo with a clean, installed node_modules tree. */
function installedRepo(): string {
  const root = copyRepo();
  installPackage(root, 'react', '19.2.8');
  installPackage(root, '@mui/material', '9.3.1', true);
  installPackage(root, '@nestjs/core', '11.2.1');
  installPackage(root, 'zod', '4.4.3');
  installPackage(root, 'ink', '7.1.1');
  linkPackage(root, '@acme/platform-web', join(root, 'packages', 'platform-web'));
  linkPackage(root, '@acme/platform-api', join(root, 'packages', 'platform-api'));
  writeFileSync(join(root, 'package-lock.json'), readFileSync(lockfilePath('clean')));
  return root;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** The value, asserted present (the suite runs under noUncheckedIndexedAccess). */
function must<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

function runScript(args: string[]): RunResult {
  const result = spawnSync('node', [SCRIPT, ...args], { cwd: TMP, encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

// -----------------------------------------------------------------------------

describe('the guarded list', () => {
  it('names every single-instance library the spec lists', () => {
    for (const name of [
      '@nestjs/common',
      '@nestjs/core',
      'fastify',
      '@prisma/client',
      'zod',
      'react',
      'react-dom',
      '@mui/material',
      '@emotion/react',
      '@emotion/styled',
      '@opentelemetry/api',
      'ink',
    ]) {
      expect(SINGLE_INSTANCE_PACKAGES).toContain(name);
    }
  });

  it('discovers the platform packages from packages/platform-*/package.json', () => {
    expect(discoverPlatformPackages(FIXTURE_REPO)).toEqual([
      '@acme/platform-api',
      '@acme/platform-web',
    ]);
  });

  it('guards a seventh platform package without editing the script', () => {
    const root = copyRepo();
    writeJson(join(root, 'packages', 'platform-extra', 'package.json'), {
      name: '@acme/platform-extra',
    });
    // A directory without a manifest is not a package.
    mkdirSync(join(root, 'packages', 'platform-empty'));
    expect(guardedNames(root)).toContain('@acme/platform-extra');
    expect(guardedNames(root)).not.toContain('platform-empty');

    const lock = lockfile('clean');
    lock.packages['node_modules/@acme/platform-extra'] = { version: '1.0.0' };
    lock.packages['apps/web/node_modules/@acme/platform-extra'] = { version: '1.1.0' };
    const dups = findLockfileDuplicates(lock, guardedNames(root));
    expect(dups.map((d: { name: string }) => d.name)).toEqual(['@acme/platform-extra']);
  });

  it('discovers the platform packages of this repository', () => {
    const names = discoverPlatformPackages(REPO_ROOT);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) expect(name).toMatch(/\/platform-/);
  });
});

describe('workspace discovery', () => {
  it('expands "<dir>/*" globs to directories that have a package.json', () => {
    const root = copyRepo();
    mkdirSync(join(root, 'apps', 'no-manifest'));
    expect(discoverWorkspaces(root)).toEqual([
      'apps/cli',
      'apps/web',
      'packages/platform-api',
      'packages/platform-web',
    ]);
  });

  it('rejects a glob it cannot expand without a glob dependency', () => {
    const root = copyRepo();
    writeJson(join(root, 'package.json'), { name: 'x', workspaces: ['apps/**'] });
    expect(() => discoverWorkspaces(root)).toThrow(/unsupported workspaces pattern/);
  });
});

describe('findLockfileDuplicates', () => {
  const names = [...SINGLE_INSTANCE_PACKAGES, '@acme/platform-web', '@acme/platform-api'];

  it('finds nothing in a clean lockfile', () => {
    expect(findLockfileDuplicates(lockfile('clean'), names)).toEqual([]);
  });

  it('names both locations and versions of a nested react under a platform package', () => {
    const [first, ...rest] = findLockfileDuplicates(lockfile('nested-platform-web'), names);
    const dup = must(first);
    expect(rest).toEqual([]);
    expect(dup.name).toBe('react');
    expect(
      dup.instances.map((i: { location: string; version: string }) => [i.location, i.version])
    ).toEqual([
      ['node_modules/react', '19.2.8'],
      ['packages/platform-web/node_modules/react', '19.1.0'],
    ]);
  });

  it('finds a nested react under apps/cli', () => {
    const dup = must(findLockfileDuplicates(lockfile('nested-cli'), names)[0]);
    expect(dup.name).toBe('react');
    expect(dup.instances.map((i: { location: string }) => i.location)).toContain(
      'apps/cli/node_modules/react'
    );
  });

  it('counts a workspace link and its target as one instance, however many links point at it', () => {
    expect(findLockfileDuplicates(lockfile('linked-workspace'), names)).toEqual([]);
  });

  it('flags a registry copy of a platform package beside its workspace link', () => {
    const lock = lockfile('linked-workspace');
    lock.packages['apps/web/node_modules/@acme/platform-web'] = { version: '0.0.9' };
    const dup = must(findLockfileDuplicates(lock, names)[0]);
    expect(dup.name).toBe('@acme/platform-web');
    expect(dup.instances).toHaveLength(2);
    expect(dup.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link: 'packages/platform-web', version: '0.1.0' }),
        expect.objectContaining({
          location: 'apps/web/node_modules/@acme/platform-web',
          version: '0.0.9',
        }),
      ])
    );
  });

  it('ignores names that are not guarded and keys that are not installs', () => {
    const lock = lockfile('clean');
    lock.packages['node_modules/left-pad'] = { version: '1.0.0' };
    lock.packages['apps/web/node_modules/left-pad'] = { version: '1.1.0' };
    // A key ending in "react" that is not `node_modules/react`.
    lock.packages['node_modules/preact'] = { version: '10.0.0' };
    expect(findLockfileDuplicates(lock, names)).toEqual([]);
  });

  it('matches this repository: one copy of every guarded package', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as Lockfile;
    expect(findLockfileDuplicates(lock, guardedNames(REPO_ROOT))).toEqual([]);
  });
});

describe('fixHint', () => {
  it('points at the workspace manifest for a nested workspace copy', () => {
    expect(fixHint('react', 'apps/cli/node_modules/react')).toBe(
      'align the "react" range in apps/cli/package.json with the root copy, then run `npm dedupe`'
    );
  });

  it('names the dependency that pulls a transitive copy', () => {
    expect(fixHint('react', 'node_modules/@acme/widget/node_modules/react')).toMatch(
      /^@acme\/widget asks for/
    );
  });

  it('has nothing to say about the hoisted copy', () => {
    expect(fixHint('react', 'node_modules/react')).toBeNull();
  });
});

describe('findResolutionSplits', () => {
  const names = [
    'react',
    '@mui/material',
    '@nestjs/core',
    'zod',
    'ink',
    '@acme/platform-web',
    '@acme/platform-api',
  ];

  it('finds nothing when every workspace resolves to the hoisted copy', () => {
    const root = installedRepo();
    expect(findResolutionSplits(root, discoverWorkspaces(root), names)).toEqual([]);
  });

  it('flags apps/web and packages/platform-web resolving @mui/material to different real paths', () => {
    const root = installedRepo();
    installPackage(join(root, 'packages', 'platform-web'), '@mui/material', '9.2.0', true);
    const splits = findResolutionSplits(root, discoverWorkspaces(root), names);
    expect(splits).toHaveLength(1);
    const split = must(splits[0]);
    expect(split.name).toBe('@mui/material');
    expect(split.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ realPath: 'node_modules/@mui/material', version: '9.3.1' }),
        expect.objectContaining({
          realPath: 'packages/platform-web/node_modules/@mui/material',
          version: '9.2.0',
          origins: ['packages/platform-web'],
        }),
      ])
    );
    expect(
      must(split.instances.find((i: { version: string }) => i.version === '9.3.1')).origins
    ).toContain('apps/web');
  });

  it('checks an npm-linked platform package, which resolves its peers from its own checkout', () => {
    const root = installedRepo();
    const outside = join(TMP, `linked-checkout-${++counter}`);
    writeJson(join(outside, 'package.json'), { name: '@acme/platform-web', version: '0.2.0' });
    installPackage(outside, 'react', '19.0.0');
    rmSync(join(root, 'node_modules', '@acme', 'platform-web'));
    linkPackage(root, '@acme/platform-web', outside);

    const splits = findResolutionSplits(root, discoverWorkspaces(root), names);
    // Every workspace resolves the package to the linked checkout (one
    // copy), but that checkout resolves its own, second react.
    expect(splits.map((s: { name: string }) => s.name)).toEqual(['react']);
    const react = must(splits.find((s: { name: string }) => s.name === 'react'));
    expect(react.instances.flatMap((i: { origins: string[] }) => i.origins)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^@acme\/platform-web \(at /)])
    );
  });

  it('skips a name a workspace cannot resolve', () => {
    const root = copyRepo();
    installPackage(join(root, 'apps', 'cli'), 'ink', '7.1.1');
    expect(findResolutionSplits(root, discoverWorkspaces(root), ['ink', 'react'])).toEqual([]);
  });
});

describe('the CLI', () => {
  it('exits 0 on a clean installed tree and prints each guarded name with its version', () => {
    const root = installedRepo();
    const result = runScript(['--root', root]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Single-instance check passed/);
    expect(result.stdout).toMatch(/react\s+19\.2\.8/);
    expect(result.stdout).toMatch(/@acme\/platform-web\s+0\.1\.0/);
    expect(result.stdout).toMatch(/fastify\s+not installed/);
  });

  it('exits 1 on a nested react in the lockfile and names both locations and versions', () => {
    const result = runScript([
      '--root',
      FIXTURE_REPO,
      '--lockfile',
      lockfilePath('nested-platform-web'),
      '--lockfile-only',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/react: 2 copies/);
    expect(result.stderr).toMatch(/node_modules\/react\s+version 19\.2\.8/);
    expect(result.stderr).toMatch(/packages\/platform-web\/node_modules\/react\s+version 19\.1\.0/);
    expect(result.stderr).toContain(
      'align the "react" range in packages/platform-web/package.json'
    );
    expect(result.stderr).toContain('npm dedupe');
  });

  it('exits 1 when the resolution check finds a split', () => {
    const root = installedRepo();
    installPackage(join(root, 'packages', 'platform-web'), '@mui/material', '9.2.0', true);
    const result = runScript(['--root', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/@mui\/material: workspaces resolve 2 different copies/);
    expect(result.stderr).toContain('packages/platform-web/node_modules/@mui/material');
  });

  it('runs --lockfile-only without node_modules', () => {
    const result = runScript([
      '--root',
      FIXTURE_REPO,
      '--lockfile',
      lockfilePath('clean'),
      '--lockfile-only',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/lockfile only/);
  });

  it('refuses the resolution check when nothing is installed', () => {
    // A temp copy: inside this repository, Node would walk up to its real
    // node_modules.
    const result = runScript(['--root', copyRepo(), '--lockfile', lockfilePath('clean')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/npm ci/);
  });

  it('emits a machine-readable report with --json', () => {
    const result = runScript([
      '--root',
      FIXTURE_REPO,
      '--lockfile',
      lockfilePath('nested-cli'),
      '--lockfile-only',
      '--json',
    ]);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      guarded: string[];
      lockfile: {
        duplicates: {
          name: string;
          instances: { location: string; version: string; fix: string | null }[];
        }[];
      };
      resolution: unknown;
    };
    expect(report.ok).toBe(false);
    expect(report.guarded).toContain('@acme/platform-web');
    expect(report.resolution).toBeNull();
    expect(report.lockfile.duplicates).toEqual([
      {
        name: 'react',
        instances: [
          expect.objectContaining({ location: 'apps/cli/node_modules/react', version: '19.3.0' }),
          expect.objectContaining({ location: 'node_modules/react', version: '19.2.8', fix: null }),
        ],
      },
    ]);
    expect(report.lockfile.duplicates[0]?.instances[0]?.fix).toContain('apps/cli/package.json');
  });

  it('includes the resolution section in --json after an install', () => {
    const root = installedRepo();
    const result = runScript(['--root', root, '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      resolution: { workspaces: string[]; splits: unknown[] };
    };
    expect(report.ok).toBe(true);
    expect(report.resolution.workspaces).toContain('packages/platform-web');
    expect(report.resolution.splits).toEqual([]);
  });

  it.each([
    [['--nope']],
    [['--lockfile']],
    [['--root', '--json']],
    [['--root', join(TMP, 'does-not-exist')]],
    [['--root', FIXTURE_REPO, '--lockfile', join(TMP, 'missing.json'), '--lockfile-only']],
  ])('exits 2 on a usage error: %j', (args) => {
    expect(runScript(args).status).toBe(2);
  });

  it('passes on this repository with --lockfile-only', () => {
    const result = runScript(['--lockfile-only']);
    expect(result.status).toBe(0);
  });
});

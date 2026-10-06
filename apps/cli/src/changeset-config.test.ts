import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// =============================================================================
// Tripwire for the platform release configuration (issue #691)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli
// -----------------------------------------------------------------------------
// Root scripts and repository configuration are tested from this workspace
// (the precedent is `rename-script.test.ts` and `new-project-script.test.ts`):
// it already runs ESM tests that spawn real subprocesses, and CI already runs
// `npm run test:run --workspace=cli`.
//
// WHAT IT GUARDS
// -----------------------------------------------------------------------------
// - `.changeset/config.json`'s single fixed group names exactly the
//   `packages/platform-*` directories: a seventh package is a deliberate edit
//   to both, never an accident of a glob.
// - Every other workspace is private AND ignored by Changesets, so no publish
//   command can push the reference app or `@app/shared` to the registry.
// - Pre-release mode is on with tag `next`.
// - Every platform package copies the root LICENSE in `prepack`, and
//   `scripts/copy-license.mjs` fails loudly (so `npm pack` fails) without it.
// - `.github/workflows/release.yml` keeps its security shape: no npm token,
//   the real publish only in the protected environment with OIDC, the dry run
//   with neither.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const COPY_LICENSE = join(REPO_ROOT, 'scripts', 'copy-license.mjs');

interface Manifest {
  name: string;
  private?: boolean;
  license?: string;
  files?: string[];
  scripts?: Record<string, string>;
  workspaces?: string[];
  publishConfig?: { access?: string };
  repository?: { directory?: string };
}

interface ChangesetConfig {
  fixed: string[][];
  linked: string[][];
  ignore: string[];
  access: string;
  baseBranch: string;
  privatePackages: { version: boolean; tag: boolean };
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as T;
}

/** Every workspace directory (relative path) the root `workspaces` globs (`<dir>/*`) match. */
function workspaceDirs(): string[] {
  const root = readJson<Manifest>('package.json');
  return (root.workspaces ?? []).flatMap((glob) => {
    expect(glob, 'this test only understands "<dir>/*" workspace globs').toMatch(/^[\w-]+\/\*$/);
    const parent = glob.slice(0, -2);
    return readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(REPO_ROOT, parent, d.name, 'package.json')))
      .map((d) => `${parent}/${d.name}`);
  });
}

const PLATFORM_DIR_RE = /^packages\/platform-[\w-]+$/;
const platformDirs = () => workspaceDirs().filter((d) => PLATFORM_DIR_RE.test(d));
const otherDirs = () => workspaceDirs().filter((d) => !PLATFORM_DIR_RE.test(d));

describe('.changeset/config.json', () => {
  const config = readJson<ChangesetConfig>('.changeset/config.json');

  it('has exactly one fixed group, equal to the set of packages/platform-* directories', () => {
    expect(config.fixed).toHaveLength(1);
    const expected = platformDirs().map((d) => {
      const manifest = readJson<Manifest>(`${d}/package.json`);
      // The directory name and the package name stay in step.
      expect(manifest.name).toBe(`@marinoscar/${d.split('/')[1]}`);
      return manifest.name;
    });
    expect(expected.length).toBe(6);
    expect([...config.fixed[0]].sort()).toEqual([...expected].sort());
    expect(new Set(config.fixed[0]).size).toBe(config.fixed[0].length);
  });

  it('ignores every non-platform workspace, and every one of them is private', () => {
    const names = otherDirs().map((d) => {
      const manifest = readJson<Manifest>(`${d}/package.json`);
      expect(manifest.private, `${d}/package.json must declare "private": true`).toBe(true);
      return manifest.name;
    });
    expect([...config.ignore].sort()).toEqual([...names].sort());
  });

  it('never versions or tags private packages, publishes publicly from main, links nothing', () => {
    expect(config.privatePackages).toEqual({ version: false, tag: false });
    expect(config.access).toBe('public');
    expect(config.baseBranch).toBe('main');
    expect(config.linked).toEqual([]);
  });

  it('is in pre-release mode with the next tag', () => {
    const pre = readJson<{ mode: string; tag: string }>('.changeset/pre.json');
    expect(pre.mode).toBe('pre');
    expect(pre.tag).toBe('next');
  });
});

describe('root release scripts', () => {
  const scripts = readJson<Manifest>('package.json').scripts ?? {};

  it('declares changeset, version-packages and release', () => {
    expect(scripts.changeset).toBe('changeset');
    expect(scripts['version-packages']).toBe('changeset version && npm install --package-lock-only');
    expect(scripts.release).toBe('npm run build:packages && changeset publish');
  });

  it('never forces the latest dist-tag', () => {
    for (const body of Object.values(scripts)) expect(body).not.toMatch(/--tag\s+latest/);
  });
});

describe('platform package manifests', () => {
  for (const dir of platformDirs()) {
    it(`${dir} ships LICENSE (prepack copies it) and is publishable`, () => {
      const manifest = readJson<Manifest>(`${dir}/package.json`);
      expect(manifest.scripts?.prepack).toBe('node ../../scripts/copy-license.mjs');
      expect(manifest.files).toContain('LICENSE');
      expect(manifest.license).toBe('MIT');
      expect(manifest.private).not.toBe(true);
      expect(manifest.publishConfig?.access).toBe('public');
      expect(manifest.repository?.directory).toBe(dir);
    });
  }

  it('git-ignores the LICENSE copies', () => {
    expect(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')).toMatch(/^packages\/platform-\*\/LICENSE$/m);
  });
});

describe('scripts/copy-license.mjs', () => {
  const temps: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'copy-license-'));
    temps.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function run(cmd: string, args: string[], cwd: string): { status: number; output: string } {
    try {
      const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, output: out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('copies the root LICENSE into the package directory', () => {
    const root = temp();
    const pkg = join(root, 'packages', 'platform-x');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(root, 'LICENSE'), 'MIT License\n');

    const result = run('node', [COPY_LICENSE, root, pkg], root);

    expect(result.status).toBe(0);
    expect(readFileSync(join(pkg, 'LICENSE'), 'utf8')).toBe('MIT License\n');
  });

  it('exits 1 with a clear message when the root LICENSE is missing', () => {
    const root = temp();
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);

    const result = run('node', [COPY_LICENSE, root, pkg], root);

    expect(result.status).toBe(1);
    expect(result.output).toContain('Root LICENSE missing (see the governance story)');
    expect(existsSync(join(pkg, 'LICENSE'))).toBe(false);
  });

  it('makes npm pack fail when the root LICENSE is missing', () => {
    const root = temp();
    const pkg = join(root, 'pkg');
    mkdirSync(pkg);
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'copy-license-fixture',
        version: '0.0.0',
        files: ['LICENSE'],
        scripts: { prepack: `node ${JSON.stringify(COPY_LICENSE)} ${JSON.stringify(root)}` },
      }),
    );

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = run(npm, ['pack', '--dry-run'], pkg);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Root LICENSE missing');
  });
});

describe('.github/workflows/release.yml', () => {
  const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

  /** The text of one job, from its `  <name>:` line to the next job (jobs are the 2-space keys under `jobs:`). */
  function job(name: string): string {
    const body = workflow.slice(workflow.indexOf('\njobs:\n'));
    const start = body.search(new RegExp(`^  ${name}:$`, 'm'));
    expect(start, `job ${name} exists`).toBeGreaterThan(-1);
    const rest = body.slice(start + 1);
    const next = rest.search(/^  [\w-]+:$/m);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it('references no npm token, ever', () => {
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('publishes only when enabled, from the protected environment, with OIDC and npm >= 11.5.1', () => {
    const publish = job('publish');
    expect(publish).toMatch(/vars\.NPM_PUBLISH_ENABLED == 'true'/);
    expect(publish).toMatch(/^    environment: npm-publish\b/m);
    expect(publish).toMatch(/^      id-token: write\b/m);
    expect(publish).toMatch(/npm install -g npm@\^11\.5\.1/);
    expect(publish).toMatch(/npx changeset publish/);
    expect(publish).not.toMatch(/--tag latest/);
  });

  it('keeps the dry run free of an environment and an id-token', () => {
    const dryRun = job('publish-dry-run');
    expect(dryRun).not.toMatch(/environment:/);
    expect(dryRun).not.toMatch(/id-token/);
    expect(dryRun).toMatch(/npm publish --dry-run --tag next/);
    expect(dryRun).toMatch(/name: platform-tarballs/);
    expect(dryRun).toMatch(/dry run: \$REASON/);
  });

  it('gives no other job an id-token', () => {
    const others = workflow.split('\n').filter((line) => /id-token/.test(line) && !/^\s*#/.test(line));
    // The publish job's permission line and nothing else (comments excluded).
    expect(others.filter((line) => /id-token: write/.test(line))).toHaveLength(1);
  });
});

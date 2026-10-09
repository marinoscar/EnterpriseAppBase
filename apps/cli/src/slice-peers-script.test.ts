import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// `scripts/check-slice-peers.mjs` is real ESM with no build step and guards its
// `main()` behind `isDirectExecution`, so importing it runs nothing; it just
// exposes the pure functions (same pattern as check-single-instance.mjs).
import {
  checkRepository,
  closeOver,
  effectivePeers,
  isTestPath,
  packageOfSpecifier,
} from '../../../scripts/check-slice-peers.mjs';

// =============================================================================
// Guards scripts/check-slice-peers.mjs (issue #914)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli: same reasoning as single-instance-script.test.ts
// beside it (this workspace already runs ESM tests that spawn subprocesses and
// CI already runs `npm run test:run --workspace=cli`).
//
// FIXTURES are written to a temp directory per test: a repository root with
// `packages/platform-slices.json`, `packages/platform-slice-peers.json` and one
// package `platform-x` (peers `a` required and `b` optional unless a test says
// otherwise; a dependency `dep`), so each
// rule fails in isolation and nothing in the real tree can influence a result.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'check-slice-peers.mjs');
const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface FixtureOptions {
  graph?: Record<string, string[]>;
  declared?: Record<string, string[]>;
  universal?: Record<string, string[] | '*'>;
  implies?: Record<string, string[]>;
  runtime?: Record<string, string[]>;
  peers?: Record<string, string>;
  optional?: string[];
  files: Record<string, string>;
}

function fixture(options: FixtureOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'slice-peers-'));
  created.push(root);
  const peers = options.peers ?? { a: '^1', b: '^1' };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    'packages/platform-x/package.json',
    JSON.stringify({
      name: '@acme/platform-x',
      dependencies: { dep: '^1' },
      peerDependencies: peers,
      peerDependenciesMeta: Object.fromEntries((options.optional ?? ['b']).map((n) => [n, { optional: true }])),
    }),
  );
  write('packages/platform-slices.json', JSON.stringify({ 'platform-x': options.graph ?? { core: [], feature: ['core'] } }));
  write(
    'packages/platform-slice-peers.json',
    JSON.stringify({
      $universal: { 'platform-x': ['core'], ...options.universal },
      $implies: { 'platform-x': options.implies ?? {} },
      $runtime: { 'platform-x': options.runtime ?? {} },
      'platform-x': options.declared ?? { core: ['a'], feature: ['b'] },
    }),
  );
  for (const [path, text] of Object.entries(options.files)) write(`packages/platform-x/src/${path}`, text);
  return root;
}

const CLEAN_FILES = {
  'core/index.ts': "import { x } from 'a';\nimport { y } from 'dep/sub';\nimport { z } from 'node:fs';\nimport 'path';\nexport { x, y, z };\n",
  'feature/index.ts': "import { x } from 'b';\nimport '../core/index.js';\nexport { x };\n",
};

const violationsOf = (root: string) => checkRepository(root).violations;

describe('packageOfSpecifier', () => {
  it('reduces a specifier to its npm package and drops relative paths and builtins', () => {
    expect(packageOfSpecifier('@nestjs/common')).toBe('@nestjs/common');
    expect(packageOfSpecifier('@nestjs/common/sub/path')).toBe('@nestjs/common');
    expect(packageOfSpecifier('rxjs/operators')).toBe('rxjs');
    expect(packageOfSpecifier('./local.js')).toBeNull();
    expect(packageOfSpecifier('../up')).toBeNull();
    expect(packageOfSpecifier('node:fs')).toBeNull();
    expect(packageOfSpecifier('fs/promises')).toBeNull();
    expect(packageOfSpecifier('path')).toBeNull();
  });
});

describe('isTestPath', () => {
  it('treats specs, tests, fixtures, test folders and declarations as test sources, and testing/ as published source', () => {
    for (const p of ['core/a.spec.ts', 'core/a.test.tsx', 'core/__tests__/a.ts', 'core/__fixtures__/a.ts', 'core/test/a.ts', 'core/a.d.ts']) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ['core/a.ts', 'core/testing/a.ts', 'core/ui/B.tsx', 'index.ts']) expect(isTestPath(p), p).toBe(false);
  });
});

describe('closeOver and effectivePeers', () => {
  it('follows implications transitively and inherits through slice dependencies', () => {
    expect([...closeOver(['a'], { a: ['b'], b: ['c'] })].sort()).toEqual(['a', 'b', 'c']);
    const graph = { core: [], mid: ['core'], top: ['mid'] };
    const declared = { core: ['a'], mid: ['b'], top: [] as string[] };
    expect([...effectivePeers('top', graph, declared)].sort()).toEqual(['a', 'b']);
    expect([...effectivePeers('core', graph, declared)]).toEqual(['a']);
  });

  it('gives a <slice>/testing sub-slice its slice and adds its own peers', () => {
    const graph = { core: [] as string[] };
    const declared = { core: ['a'], 'core/testing': ['d'] };
    expect([...effectivePeers('core/testing', graph, declared)].sort()).toEqual(['a', 'd']);
    expect([...effectivePeers('core', graph, declared)]).toEqual(['a']);
  });
});

describe('checkRepository on a fixture', () => {
  it('passes a consistent package, ignoring dependencies, builtins and relative imports', () => {
    expect(violationsOf(fixture({ files: CLEAN_FILES }))).toEqual([]);
  });

  it('fails an uncovered import and names the slice, the file and the specifier', () => {
    const root = fixture({ files: { ...CLEAN_FILES, 'feature/extra.ts': "import q from 'zzz/deep';\nexport default q;\n" } });
    const [v, ...rest] = violationsOf(root);
    expect(rest).toEqual([]);
    expect(v).toMatchObject({ rule: 'coverage', slice: 'feature', specifier: 'zzz' });
    expect(v.file).toBe('packages/platform-x/src/feature/extra.ts');
    expect(v.message).toContain("slice 'feature'");
    expect(v.message).toContain('packages/platform-x/src/feature/extra.ts');
    expect(v.message).toContain("'zzz'");
  });

  it('covers an import with the peers of a slice dependency, transitively', () => {
    const root = fixture({
      graph: { core: [], mid: ['core'], top: ['mid'] },
      declared: { core: ['a'], mid: ['b'], top: [] },
      files: {
        'core/index.ts': "import 'a';\n",
        'mid/index.ts': "import 'b';\n",
        'top/index.ts': "import 'a';\nimport 'b';\n",
      },
    });
    expect(violationsOf(root)).toEqual([]);
  });

  it('does not let a slice use the peers of a slice it does not depend on', () => {
    const root = fixture({
      graph: { core: [], one: ['core'], two: ['core'] },
      declared: { core: ['a'], one: ['b'], two: [] },
      files: { 'core/index.ts': "import 'a';\n", 'one/index.ts': "import 'b';\n", 'two/index.ts': "import 'b';\n" },
    });
    expect(violationsOf(root).map((v) => [v.rule, v.slice, v.specifier])).toEqual([['coverage', 'two', 'b']]);
  });

  it('ignores test files and imports that only appear in comments and strings', () => {
    const root = fixture({
      files: {
        ...CLEAN_FILES,
        'core/a.spec.ts': "import 'zzz';\n",
        'core/__tests__/b.ts': "import 'zzz';\n",
        'core/c.ts': "// import x from 'zzz';\n/** @example import y from 'zzz'; */\nexport const s = \"from 'zzz'\";\nexport const t = `import 'zzz'`;\n",
      },
    });
    expect(violationsOf(root)).toEqual([]);
  });

  it('counts require(), dynamic import() and re-exports', () => {
    const root = fixture({
      files: {
        ...CLEAN_FILES,
        'feature/more.ts': "const r = require('r1');\nexport const l = () => import('r2');\nexport * from 'r3';\n",
      },
    });
    expect(violationsOf(root).map((v) => v.specifier).sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('flags a declared peer the slice does not import (stale), a name that is not a package peer, and a slice with no entry', () => {
    const stale = fixture({ peers: { a: '^1', b: '^1', c: '^1' }, optional: ['b', 'c'], declared: { core: ['a'], feature: ['b', 'c'] }, files: CLEAN_FILES });
    expect(violationsOf(stale).map((v) => [v.rule, v.slice, v.specifier])).toEqual([['stale', 'feature', 'c']]);

    const notPeer = fixture({ declared: { core: ['a'], feature: ['b', 'nope'] }, files: CLEAN_FILES });
    expect(violationsOf(notPeer).some((v) => v.rule === 'unknown' && v.specifier === 'nope')).toBe(true);

    const missing = fixture({ declared: { core: ['a'] }, files: CLEAN_FILES });
    expect(violationsOf(missing).some((v) => v.rule === 'unknown' && v.slice === 'feature')).toBe(true);
  });

  it('flags a peerDependency no slice declares (orphan)', () => {
    const root = fixture({ files: CLEAN_FILES });
    writeFileSync(
      join(root, 'packages/platform-x/package.json'),
      JSON.stringify({
        name: '@acme/platform-x',
        dependencies: { dep: '^1' },
        peerDependencies: { a: '^1', b: '^1', orphan: '^1' },
        peerDependenciesMeta: { b: { optional: true }, orphan: { optional: true } },
      }),
    );
    expect(violationsOf(root).map((v) => [v.rule, v.specifier])).toEqual([['orphan', 'orphan']]);
  });

  it('requires exactly the peers of the universal slices to be non-optional', () => {
    const optionalButUniversal = fixture({ optional: ['a', 'b'], files: CLEAN_FILES });
    expect(violationsOf(optionalButUniversal).map((v) => [v.rule, v.specifier])).toEqual([['optionality', 'a']]);

    const requiredButNotUniversal = fixture({ optional: [], files: CLEAN_FILES });
    expect(violationsOf(requiredButNotUniversal).map((v) => [v.rule, v.specifier])).toEqual([['optionality', 'b']]);
  });

  it('treats universal "*" as every slice', () => {
    const root = fixture({ universal: { 'platform-x': '*' }, optional: [], files: CLEAN_FILES });
    expect(violationsOf(root)).toEqual([]);
  });

  it('lets an implied peer be covered by its outer peer, never orphaned, and required with it', () => {
    const root = fixture({
      peers: { a: '^1', b: '^1', c: '^1', d: '^1' },
      implies: { a: ['c'] },
      optional: ['b', 'd'],
      files: { ...CLEAN_FILES, 'core/uses-c.ts': "import 'c';\n" },
    });
    // `c` is imported by core, covered by `a`'s implication, required because core is universal.
    expect(violationsOf(root).map((v) => [v.rule, v.specifier])).toEqual([['orphan', 'd']]);
  });

  it('checks $runtime peers against a string literal in the slice sources', () => {
    const present = fixture({
      peers: { a: '^1', b: '^1', d: '^1' },
      optional: ['b', 'd'],
      runtime: { feature: ['d'] },
      files: { ...CLEAN_FILES, 'feature/load.ts': "export const load = (req: (n: string) => unknown) => req('d');\n" },
    });
    expect(violationsOf(present)).toEqual([]);

    const absent = fixture({ peers: { a: '^1', b: '^1', d: '^1' }, optional: ['b', 'd'], runtime: { feature: ['d'] }, files: CLEAN_FILES });
    expect(violationsOf(absent).map((v) => [v.rule, v.slice, v.specifier])).toEqual([['stale', 'feature', 'd']]);
  });

  it('keeps a <slice>/testing peer out of the slice and of its dependants', () => {
    const files = {
      ...CLEAN_FILES,
      'feature/testing/index.ts': "import 'd';\nexport {};\n",
    };
    const withD = { peers: { a: '^1', b: '^1', d: '^1' }, optional: ['b', 'd'] };
    const root = fixture({ ...withD, declared: { core: ['a'], feature: ['b'], 'feature/testing': ['d'] }, files });
    expect(violationsOf(root)).toEqual([]);

    const leaked = fixture({ ...withD, declared: { core: ['a'], feature: ['b'] }, files });
    // The import is uncovered, and `d` is then declared by nobody.
    expect(violationsOf(leaked).map((v) => [v.rule, v.slice, v.specifier])).toEqual([
      ['coverage', 'feature/testing', 'd'],
      ['orphan', '*', 'd'],
    ]);

    const effective = checkRepository(root).effective as unknown as Record<string, Record<string, string[]>>;
    expect(effective['platform-x']?.feature).not.toContain('d');
    expect(effective['platform-x']?.['feature/testing']).toEqual(expect.arrayContaining(['a', 'b', 'd']));
  });

  it('fails a slice directory that is not in the slice graph', () => {
    const root = fixture({ files: { ...CLEAN_FILES, 'rogue/index.ts': "import 'a';\n" } });
    expect(violationsOf(root).some((v) => v.rule === 'unknown' && v.slice === 'rogue')).toBe(true);
  });
});

describe('command line', () => {
  it('exits 0 on a clean tree and 1 with slice, file and specifier on stderr for a violation', () => {
    const clean = spawnSync(process.execPath, [SCRIPT, '--root', fixture({ files: CLEAN_FILES })], { encoding: 'utf8' });
    expect(clean.status).toBe(0);

    const bad = fixture({ files: { ...CLEAN_FILES, 'feature/extra.ts': "import 'zzz';\n" } });
    const failed = spawnSync(process.execPath, [SCRIPT, '--root', bad], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("slice 'feature'");
    expect(failed.stderr).toContain('feature/extra.ts');
    expect(failed.stderr).toContain("'zzz'");
  });

  it('exits 2 on an unknown argument', () => {
    expect(spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' }).status).toBe(2);
  });
});

describe('the repository', () => {
  it('passes its own check', () => {
    expect(checkRepository(REAL_ROOT).violations.map((v) => v.message)).toEqual([]);
  });
});

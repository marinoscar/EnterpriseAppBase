import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { CATALOG_COLUMNS, HEADINGS } from '../../../scripts/check-package-docs.mjs';

// =============================================================================
// Guards scripts/check-package-docs.mjs and the TypeDoc validation (#693)
// =============================================================================
//
// Same home as rename-script.test.ts: root scripts are tested from apps/cli,
// which already runs ESM tests that spawn real subprocesses in CI.
//
// THE FIXTURE
// -----------------------------------------------------------------------------
// `__fixtures__/package-docs/passing/` is a mini repository: one package
// (`packages/platform-demo`, root entry point plus a `./widgets` slice), its
// two READMEs, a `docs-api/api.json` that real TypeDoc wrote from the
// fixture's own `src/` with the repository's typedoc.base.json, and the
// reference-app files its Example links point at. Each failing case copies it
// to a temp directory and breaks exactly one thing, so the fixture on disk
// never changes and every case starts from a tree the checker accepts.
//
// The last block runs TypeDoc itself over the copied fixture: once as is (and
// then the checker over TypeDoc's fresh JSON, which proves the committed
// api.json is the shape TypeDoc really writes), once with an undocumented
// export, which TypeDoc validation must reject.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-package-docs.mjs');
const FIXTURE = join(HERE, '__fixtures__', 'package-docs', 'passing');
const PKG = 'packages/platform-demo';
const TYPEDOC_BIN = join(REPO_ROOT, 'node_modules', 'typedoc', 'bin', 'typedoc');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of the passing fixture; `mutate` breaks one thing in it. */
function fixture(mutate?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'package-docs-'));
  temps.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  mutate?.(root);
  return root;
}

function check(root: string, extra: string[] = []): RunResult {
  const child = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' });
  return { status: child.status ?? 1, stdout: child.stdout, stderr: child.stderr };
}

/** Rewrite one fixture file in place. */
function edit(root: string, rel: string, change: (text: string) => string): void {
  const path = join(root, rel);
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`fixture edit of ${rel} changed nothing`);
  writeFileSync(path, after);
}

const README = `${PKG}/README.md`;
const SLICE_README = `${PKG}/src/widgets/README.md`;
const API_JSON = `${PKG}/docs-api/api.json`;
const ROW = '| `DemoRegistry.register()` | registry | `register(id: string): void` | Add a check | stable | [example](../../apps/api/src/demo-registry.example.txt#L1) |';

/** 1-based line of the first line of a fixture file containing `needle`. */
function lineOf(root: string, rel: string, needle: string): number {
  return readFileSync(join(root, rel), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;
}

describe('the README templates', () => {
  it.each(['package-README.md', 'slice-README.md'])('%s has the 15 headings in order and the catalog header', (name) => {
    const text = readFileSync(join(REPO_ROOT, 'docs', 'templates', name), 'utf8');
    let inFence = false;
    const headings = text
      .split('\n')
      .filter((line) => {
        if (/^\s*```/.test(line)) inFence = !inFence;
        return !inFence && /^##\s/.test(line);
      })
      .map((line) => line.replace(/^##\s+/, '').trim());
    expect(headings).toEqual(HEADINGS);
    expect(text).toContain(`| ${CATALOG_COLUMNS.join(' | ')} |`);
  });
});

describe('scripts/check-package-docs.mjs', () => {
  it('accepts the passing fixture', () => {
    const result = check(fixture());
    expect(result.stdout).toContain('1 packages, 2 READMEs, 2 extension points OK');
    expect(result.status).toBe(0);
  });

  it('accepts the six real platform packages', () => {
    // docs-api/ is generated: only meaningful after `npm run docs:packages`,
    // which `npm run check:package-docs` runs first. Here, check the README
    // half against the repository and skip the api.json-missing lines.
    const result = check(REPO_ROOT, ['--json']);
    const problems = (JSON.parse(result.stdout) as { file: string; message: string }[]).filter(
      (p) => !p.file.endsWith('docs-api/api.json'),
    );
    expect(problems).toEqual([]);
  });

  describe('fails with a file:line message on', () => {
    it('a missing heading', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('## Data\n', '')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${README}:1 missing heading "## Data"`);
    });

    it('an out-of-order heading', () => {
      const root = fixture((r) =>
        edit(r, README, (t) => t.replace('## Data\n', '## __UI__\n').replace('## UI\n', '## Data\n').replace('## __UI__\n', '## UI\n')),
      );
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${README}:${lineOf(root, README, '## Data')} heading "## Data" is out of order`);
    });

    it('an unexpected level-2 heading', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('## Links\n', '## Status\n\nScaffold.\n\n## Links\n')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${README}:${lineOf(root, README, '## Status')} unexpected level-2 heading "## Status"`);
    });

    it('an empty section', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace(/## Infra\n\n[^\n]+\n/, '## Infra\n\n')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${README}:${lineOf(root, README, '## Infra')} section "## Infra" is empty`);
    });

    it('an @extensionPoint symbol missing from the catalog', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace(`${ROW}\n`, '')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${README}:${lineOf(root, README, '## Extension-point catalog')} \`DemoRegistry.register\` (@extensionPoint registry, ${PKG}/src/index.ts:16) is missing from the Extension-point catalog`,
      );
    });

    it('a catalog row naming a non-exported symbol', () => {
      const root = fixture((r) => edit(r, SLICE_README, (t) => t.replace('`WIDGET_SLOT`', '`GHOST_SLOT`')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${SLICE_README}:${lineOf(root, SLICE_README, 'GHOST_SLOT')} catalog row \`GHOST_SLOT\` names no exported symbol of this entry point`,
      );
      // ...and the real symbol is now uncatalogued.
      expect(result.stdout).toContain('`WIDGET_SLOT` (@extensionPoint slot');
    });

    it('a catalog row naming an exported symbol without @extensionPoint', () => {
      const root = fixture((r) =>
        edit(r, README, (t) =>
          t.replace(ROW, `${ROW}\n| \`DEMO_NAME\` | option | \`'demo'\` | Never | experimental | [example](../../apps/api/src/demo-registry.example.txt) |`),
        ),
      );
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${README}:${lineOf(root, README, 'DEMO_NAME')} catalog row \`DEMO_NAME\` names an exported symbol without an @extensionPoint tag`,
      );
    });

    it('a Kind mismatch', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('| registry |', '| token |')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${README}:${lineOf(root, README, 'DemoRegistry.register')} catalog row \`DemoRegistry.register\` has Kind "token" but ${PKG}/src/index.ts:16 says "@extensionPoint registry"`,
      );
    });

    it('a Kind outside the vocabulary', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('| registry |', '| plugin |')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('catalog row `DemoRegistry.register` has Kind "plugin"; one of option, registry');
    });

    it('a Stability mismatch', () => {
      const root = fixture((r) => edit(r, SLICE_README, (t) => t.replace('| experimental |', '| stable |')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${SLICE_README}:${lineOf(root, SLICE_README, 'WIDGET_SLOT')} catalog row \`WIDGET_SLOT\` has Stability "stable" but ${PKG}/src/widgets/index.ts:7 says "@stability experimental"`,
      );
    });

    it('an Example link to a missing file', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('demo-registry.example.txt#L1', 'gone.ts#L1')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${README}:${lineOf(root, README, 'DemoRegistry.register')} catalog row \`DemoRegistry.register\`: Example "../../apps/api/src/gone.ts#L1" does not resolve to a file`,
      );
    });

    it('an Example link into packages/', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('../../apps/api/src/demo-registry.example.txt#L1', 'src/index.ts')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${README}:${lineOf(root, README, 'DemoRegistry.register')} catalog row \`DemoRegistry.register\`: Example "src/index.ts" points into packages/`,
      );
    });

    it('a catalog row without an Example link', () => {
      const root = fixture((r) => edit(r, README, (t) => t.replace('[example](../../apps/api/src/demo-registry.example.txt#L1)', 'see the app')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('catalog row `DemoRegistry.register` has no Example link to the reference app');
    });

    it('an exported symbol without @stability', () => {
      const root = fixture((r) =>
        edit(r, API_JSON, (t) => {
          const api = JSON.parse(t);
          const index = api.children.find((m: { name: string }) => m.name === 'index');
          const demoName = index.children.find((c: { name: string }) => c.name === 'DEMO_NAME');
          demoName.comment.blockTags = [];
          return JSON.stringify(api, null, 2);
        }),
      );
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${PKG}/src/index.ts:27 exported symbol \`DEMO_NAME\` has no @stability tag`);
    });

    it('@stability internal on an exported symbol', () => {
      const root = fixture((r) =>
        edit(r, API_JSON, (t) => t.replace(/"text": "experimental"/, '"text": "internal"')),
      );
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/has "@stability internal"; an exported symbol is stable or experimental/);
    });

    it('an exported slice without a README', () => {
      const root = fixture((r) => rmSync(join(r, SLICE_README)));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${SLICE_README}:1 missing README (copy docs/templates/slice-README.md)`);
    });

    it('an exported slice missing from typedoc.json entryPoints', () => {
      const root = fixture((r) => edit(r, `${PKG}/typedoc.json`, (t) => t.replace(', "src/widgets/index.ts"', '')));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${PKG}/typedoc.json:1 slice "./widgets" is exported but src/widgets/index.ts is not in entryPoints`);
    });

    it('a nested subpath (./<slice>/<part>) missing from typedoc.json entryPoints, catalogued by the slice README', () => {
      // `./doctor/headless` and `./doctor/ui` (#696) are two entry points of
      // ONE slice: each needs its own typedoc entry point, and both are
      // catalogued in src/doctor/README.md, never in a README of their own.
      const root = fixture((r) => {
        edit(r, `${PKG}/package.json`, (t) =>
          t.replace('"./package.json"', '"./widgets/extra": { "types": "./dist/widgets/extra/index.d.ts", "default": "./dist/widgets/extra/index.js" },\n    "./package.json"'),
        );
        mkdirSync(join(r, PKG, 'src', 'widgets', 'extra'), { recursive: true });
        writeFileSync(join(r, PKG, 'src', 'widgets', 'extra', 'index.ts'), 'export {};\n');
      });
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `${PKG}/typedoc.json:1 slice "./widgets/extra" is exported but src/widgets/extra/index.ts is not in entryPoints`,
      );
      expect(result.stdout).not.toContain('src/widgets/extra/README.md');
    });

    it('a missing api.json', () => {
      const root = fixture((r) => rmSync(join(r, API_JSON)));
      const result = check(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`${API_JSON}:1 missing; run \`npm run docs:packages\` first`);
    });
  });

  it('prints the problems as JSON with --json', () => {
    const root = fixture((r) => edit(r, README, (t) => t.replace('## Data\n', '')));
    const result = check(root, ['--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual([
      { file: README, line: 1, message: 'missing heading "## Data" (see docs/templates/package-README.md)' },
    ]);
  });
});

describe('TypeDoc over the fixture with typedoc.base.json', () => {
  /** Copy the fixture without its api.json and point its typedoc.json at the real base config. */
  function typedocFixture(mutate?: (root: string) => void): string {
    return fixture((r) => {
      rmSync(join(r, PKG, 'docs-api'), { recursive: true, force: true });
      const config = JSON.parse(readFileSync(join(r, PKG, 'typedoc.json'), 'utf8')) as Record<string, unknown>;
      config.extends = [join(REPO_ROOT, 'typedoc.base.json')];
      writeFileSync(join(r, PKG, 'typedoc.json'), JSON.stringify(config));
      mutate?.(r);
    });
  }

  function typedoc(root: string): RunResult {
    const child = spawnSync(process.execPath, [TYPEDOC_BIN, '--options', 'typedoc.json'], {
      cwd: join(root, PKG),
      encoding: 'utf8',
    });
    return { status: child.status ?? 1, stdout: child.stdout, stderr: child.stderr };
  }

  it('writes an api.json the checker accepts', () => {
    const root = typedocFixture();
    const result = typedoc(root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const checked = check(root);
    expect(checked.stdout).toContain('2 extension points OK');
    expect(checked.status).toBe(0);
  }, 120_000);

  it('fails validation on an exported symbol without TSDoc', () => {
    const root = typedocFixture((r) =>
      edit(r, `${PKG}/src/index.ts`, (t) => `${t}\nexport const undocumentedExport = 1;\n`),
    );
    const result = typedoc(root);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/undocumentedExport \(Variable\).*does not have any documentation/);
  }, 120_000);
});

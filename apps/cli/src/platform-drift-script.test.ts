import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// `scripts/platform-drift.mjs` is real ESM with no build step and guards its
// `main()` behind `isDirectExecution`, so importing it runs nothing; it just
// exposes the pure functions (same pattern as rename.mjs in
// `template-identity.test.ts`).
import {
  applyReplacements,
  buildReplacements,
  classify,
  deriveIdentity,
  lineDiff,
  matchMigrations,
  normaliseCode,
  normaliseText,
  parsePrismaModels,
  summarise,
} from '../../../scripts/platform-drift.mjs';

// =============================================================================
// Guards scripts/platform-drift.mjs, the cross-repo drift report (issue #674)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli
// -----------------------------------------------------------------------------
// Same reasoning as `rename-script.test.ts` beside this file: this workspace
// already runs ESM tests that spawn real subprocesses, and CI already runs
// `npm run test:run --workspace=cli`. There is no separate "repo tooling"
// test workspace.
//
// HOW
// -----------------------------------------------------------------------------
// Each end-to-end test builds two small repository trees in os.tmpdir(), runs
// `node scripts/platform-drift.mjs --base <tmpBase> --app <tmpApp> --out
// <tmpOut> --format json`, and asserts on the JSON. The fixture identities are
// invented on purpose (never this repository's own identity), so a fork that
// renames itself does not have to touch this file.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src -> apps/cli -> apps -> <repo root>
const REPO_ROOT = join(HERE, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'platform-drift.mjs');

const TMP = mkdtempSync(join(tmpdir(), 'platform-drift-test-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let counter = 0;
function tmpDir(label: string): string {
  const dir = join(TMP, `${label}-${++counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

type Tree = Record<string, string | Buffer>;

interface FixtureIdentity {
  productName?: string;
  repoSlug?: string;
  cliName?: string;
}

const BASE_ID: FixtureIdentity = {
  productName: 'Base Product',
  repoSlug: 'acme/base-repo',
  cliName: 'appctl',
};
const APP_ID: FixtureIdentity = {
  productName: 'EvoPath',
  repoSlug: 'acme/evopath',
  cliName: 'evopathcli',
};

/** Write a repository tree; `identity` adds identity.json and the CLI's package.json. */
function makeRepo(label: string, files: Tree, identity: FixtureIdentity | null): string {
  const root = tmpDir(label);
  const all: Tree = { ...files };
  if (identity?.productName !== undefined || identity?.repoSlug !== undefined) {
    all['packages/shared/identity.json'] = JSON.stringify({
      productName: identity.productName,
      repoSlug: identity.repoSlug,
    });
  }
  if (identity?.cliName !== undefined) {
    all['apps/cli/package.json'] = JSON.stringify({ bin: { [identity.cliName]: './dist/cli.js' } });
  }
  for (const [rel, content] of Object.entries(all)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(
  args: string[],
  options: { script?: string; env?: NodeJS.ProcessEnv } = {}
): RunResult {
  try {
    const stdout = execFileSync('node', [options.script ?? SCRIPT, ...args], {
      cwd: TMP,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
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

interface FileEntry {
  area: string;
  module: string;
  path: string;
  status: string;
  linesAdded?: number | null;
  linesRemoved?: number | null;
  diffSkipped?: boolean;
  binary?: boolean;
}

interface Summary {
  files: number;
  identical: number;
  normalisedIdentical: number;
  modified: number;
  baseOnly: number;
  appOnly: number;
  linesAdded: number;
  linesRemoved: number;
  identicalPercent: number | null;
}

interface Report {
  schemaVersion: number;
  generatedAt: string;
  replacements: {
    placeholder: string;
    base: string | null;
    app: string | null;
    applied: boolean;
    token: string | null;
  }[];
  areas: Record<string, Summary>;
  modules: (Summary & { area: string; module: string })[];
  files: FileEntry[];
  migrations: {
    shared: number;
    renamed: number;
    sameNameDifferentSql: number;
    baseOnly: number;
    appOnly: number;
    entries: { status: string; base: string | null; app: string | null }[];
  } | null;
  prismaModels: {
    base: number;
    app: number;
    presentInApp: string[];
    missingFromApp: string[];
    appOnly: string[];
    changed: { model: string; addedFields: string[]; removedFields: string[] }[];
  } | null;
}

/** Build both trees, run the script, return the parsed JSON report. */
function drift(
  baseFiles: Tree,
  appFiles: Tree,
  {
    baseId = BASE_ID,
    appId = APP_ID,
    args = [] as string[],
  }: {
    baseId?: FixtureIdentity | null;
    appId?: FixtureIdentity | null;
    args?: string[];
  } = {}
): Report {
  const base = makeRepo('base', baseFiles, baseId);
  const app = makeRepo('app', appFiles, appId);
  const out = tmpDir('out');
  const result = run(['--base', base, '--app', app, '--out', out, '--format', 'json', ...args]);
  expect(result.status, `exit ${result.status}; stderr:\n${result.stderr}`).toBe(0);
  return JSON.parse(readFileSync(join(out, 'drift-report.json'), 'utf8')) as Report;
}

function fileEntry(report: Report, path: string): FileEntry {
  const entry = report.files.find((f) => f.path === path);
  if (!entry)
    throw new Error(`no entry for ${path}; have: ${report.files.map((f) => f.path).join(', ')}`);
  return entry;
}

const API = 'apps/api/src';

// =============================================================================
// End to end
// =============================================================================

describe('the base against itself', () => {
  it('reports 100% identical for every area and exits 0', () => {
    const out = tmpDir('self');
    const result = run(['--app', REPO_ROOT, '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(out, 'drift-report.json'), 'utf8')) as Report;
    const areas = Object.entries(report.areas);
    // Non-vacuity: this repository has at least api, web and cli.
    expect(areas.length).toBeGreaterThanOrEqual(3);
    for (const [id, area] of areas) {
      expect(area.identicalPercent, id).toBe(100);
      expect(area.identical, id).toBe(area.files);
    }
    expect(report.migrations?.shared).toBeGreaterThan(0);
    expect(report.prismaModels?.missingFromApp).toEqual([]);
    // The Markdown report is written too (default --format both).
    expect(readFileSync(join(out, 'drift-report.md'), 'utf8')).toMatch(/^# Platform drift report/);
  });
});

describe('comment noise', () => {
  it('treats a file whose only change is an issue number inside a comment as normalised-identical', () => {
    const body = (n: number) =>
      `// Application metrics (issue ${n})\n/**\n * Registered in app.module.ts (#${n}).\n */\nexport const x = 1; /* see #${n} */\n`;
    const report = drift(
      { [`${API}/common/m.ts`]: body(600) },
      { [`${API}/common/m.ts`]: body(125) }
    );
    expect(fileEntry(report, `${API}/common/m.ts`).status).toBe('normalised-identical');
  });

  it('ignores an added comment, indentation and blank lines', () => {
    const report = drift(
      { [`${API}/a/a.ts`]: 'export function f() {\n  return 1;\n}\n' },
      {
        [`${API}/a/a.ts`]:
          '// New header comment.\n\nexport function f() {\n\n    return 1;   \n}\r\n',
      }
    );
    expect(fileEntry(report, `${API}/a/a.ts`).status).toBe('normalised-identical');
  });

  it('ignores an issue number inside a test name string, which forks renumber too', () => {
    const report = drift(
      { [`${API}/a/a.spec.ts`]: "describe('trace context (#607)', () => {});\n" },
      { [`${API}/a/a.spec.ts`]: "describe('trace context (#132)', () => {});\n" }
    );
    expect(fileEntry(report, `${API}/a/a.spec.ts`).status).toBe('normalised-identical');
  });
});

describe('identity renames', () => {
  it('treats appctl -> evopathcli and APPCTL_ -> EVOPATHCLI_ in code and strings as normalised-identical', () => {
    const source = (cli: string, upper: string, product: string, repo: string) =>
      [
        `export const CLI_NAME = '${cli}';`,
        `const token = process.env.${upper}_TOKEN;`,
        `const dir = \`\${home}/.${cli}\`;`,
        `const banner = '${product} (${repo})';`,
        `export function help() { return 'run ${cli} --help'; }`,
      ].join('\n');
    const report = drift(
      { 'apps/cli/src/branding.ts': source('appctl', 'APPCTL', 'Base Product', 'acme/base-repo') },
      { 'apps/cli/src/branding.ts': source('evopathcli', 'EVOPATHCLI', 'EvoPath', 'acme/evopath') }
    );
    expect(fileEntry(report, 'apps/cli/src/branding.ts').status).toBe('normalised-identical');
    // The table the reader sees in the Markdown header.
    const cli = report.replacements.find((r) => r.placeholder === '__CLI__');
    expect(cli).toMatchObject({ base: 'appctl', app: 'evopathcli', applied: true });
  });

  it('keeps a stale base literal in the fork equal to the base (the table applies symmetrically)', () => {
    const line = "const cli = { name: 'appctl', repo: 'base-repo' };\n";
    const report = drift(
      { [`${API}/a/a.ts`]: line },
      { [`${API}/a/a.ts`]: `${line}// fork comment\n` }
    );
    expect(fileEntry(report, `${API}/a/a.ts`).status).toBe('normalised-identical');
  });

  it('resolves a missing identity.json on the app side through --app-product-name', () => {
    const files = (product: string) => ({
      [`${API}/a/title.ts`]: `export const TITLE = '${product}';\n`,
    });
    // No identity.json in the app, only a CLI package.json.
    const withFlag = drift(files('Base Product'), files('Memoria Hub'), {
      appId: { cliName: 'memoriahub' },
      args: ['--app-product-name', 'Memoria Hub'],
    });
    expect(fileEntry(withFlag, `${API}/a/title.ts`).status).toBe('normalised-identical');
    const product = withFlag.replacements.find((r) => r.placeholder === '__PRODUCT__');
    expect(product).toMatchObject({ base: 'Base Product', app: 'Memoria Hub', applied: true });
    // The repository slug is still unknown on the app side: shown, not applied.
    const repo = withFlag.replacements.find((r) => r.placeholder === '__REPO_SLUG__');
    expect(repo).toMatchObject({ app: null, applied: false });

    const withoutFlag = drift(files('Base Product'), files('Memoria Hub'), {
      appId: { cliName: 'memoriahub' },
    });
    expect(fileEntry(withoutFlag, `${API}/a/title.ts`).status).toBe('modified');
  });
});

describe('strings are not comments', () => {
  it('reports a changed URL in a string literal as modified', () => {
    const report = drift(
      { [`${API}/a/url.ts`]: "export const URL = 'https://a.example.test/path';\n" },
      { [`${API}/a/url.ts`]: "export const URL = 'https://b.example.test/path';\n" }
    );
    expect(fileEntry(report, `${API}/a/url.ts`)).toMatchObject({
      status: 'modified',
      linesAdded: 1,
      linesRemoved: 1,
    });
  });

  it('reports a changed URL in a template literal as modified', () => {
    const report = drift(
      { [`${API}/a/url.ts`]: 'export const u = (h: string) => `https://${h}/v1//x`;\n' },
      { [`${API}/a/url.ts`]: 'export const u = (h: string) => `https://${h}/v2//x`;\n' }
    );
    expect(fileEntry(report, `${API}/a/url.ts`)).toMatchObject({
      status: 'modified',
      linesAdded: 1,
      linesRemoved: 1,
    });
  });
});

describe('real changes', () => {
  it('reports a code change as modified with correct linesAdded and linesRemoved', () => {
    const report = drift(
      { [`${API}/a/a.ts`]: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n' },
      {
        [`${API}/a/a.ts`]:
          'const a = 1;\nconst b = 20;\nconst c = 3;\nconst e = 5;\nconst f = 6;\nconst d = 4;\n',
      }
    );
    expect(fileEntry(report, `${API}/a/a.ts`)).toMatchObject({
      status: 'modified',
      linesAdded: 3,
      linesRemoved: 1,
    });
  });

  it('reports a file present on one side only as base-only or app-only', () => {
    const report = drift(
      { [`${API}/a/gone.ts`]: 'export {};\n', [`${API}/a/same.ts`]: 'export {};\n' },
      { [`${API}/a/new.ts`]: 'export {};\n', [`${API}/a/same.ts`]: 'export {};\n' }
    );
    expect(fileEntry(report, `${API}/a/gone.ts`).status).toBe('base-only');
    expect(fileEntry(report, `${API}/a/new.ts`).status).toBe('app-only');
    expect(fileEntry(report, `${API}/a/same.ts`).status).toBe('identical');
  });

  it('compares binary files by hash only', () => {
    const png = (last: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, last]);
    const report = drift(
      { 'apps/web/src/assets/same.png': png(1), 'apps/web/src/assets/diff.png': png(1) },
      { 'apps/web/src/assets/same.png': png(1), 'apps/web/src/assets/diff.png': png(2) }
    );
    expect(fileEntry(report, 'apps/web/src/assets/same.png').status).toBe('identical');
    expect(fileEntry(report, 'apps/web/src/assets/diff.png')).toMatchObject({
      status: 'modified',
      binary: true,
      linesAdded: null,
      linesRemoved: null,
    });
  });

  it('skips node_modules, dist and build output', () => {
    const report = drift(
      {
        [`${API}/a/a.ts`]: 'x\n',
        [`${API}/node_modules/p/i.js`]: 'x\n',
        [`${API}/dist/a.js`]: 'x\n',
      },
      {
        [`${API}/a/a.ts`]: 'x\n',
        'apps/web/src/coverage/c.json': '{}',
        'apps/web/src/t.tsbuildinfo': '{}',
      }
    );
    // packages/ holds the fixtures' identity.json, which is its own area.
    expect(report.files.filter((f) => f.area !== 'packages').map((f) => f.path)).toEqual([
      `${API}/a/a.ts`,
    ]);
  });
});

describe('aggregation', () => {
  it('computes module and area summaries with the base as the denominator', () => {
    const report = drift(
      {
        [`${API}/users/a.ts`]: 'a\n',
        [`${API}/users/b.ts`]: '// one\nb\n',
        [`${API}/users/c.ts`]: 'c\nc2\n',
        [`${API}/users/d.ts`]: 'd\n',
        [`${API}/main.ts`]: 'm\n',
      },
      {
        [`${API}/users/a.ts`]: 'a\n',
        [`${API}/users/b.ts`]: '// two\nb\n',
        [`${API}/users/c.ts`]: 'c\nc3\nc4\n',
        [`${API}/users/e.ts`]: 'e\n',
        [`${API}/main.ts`]: 'm\n',
      }
    );
    const users = report.modules.find((m) => m.area === 'api' && m.module === 'users');
    expect(users).toMatchObject({
      files: 5,
      identical: 1,
      normalisedIdentical: 1,
      modified: 1,
      baseOnly: 1,
      appOnly: 1,
      linesAdded: 2,
      linesRemoved: 1,
      // (1 + 1) / (1 + 1 + 1 modified + 1 base-only): app-only is not a base file.
      identicalPercent: 50,
    });
    expect(report.modules.find((m) => m.module === '(root)')).toMatchObject({
      files: 1,
      identicalPercent: 100,
    });
    // (2 + 1 root) / (4 + 1)
    expect(report.areas['api']).toMatchObject({ files: 6, identicalPercent: 60 });
  });

  it('maps web components and pages to two-segment modules', () => {
    const report = drift(
      {
        'apps/web/src/components/settings/Hub.tsx': 'x\n',
        'apps/web/src/pages/Admin/Users.tsx': 'x\n',
        'apps/web/src/main.tsx': 'x\n',
      },
      {
        'apps/web/src/components/settings/Hub.tsx': 'x\n',
        'apps/web/src/pages/Admin/Users.tsx': 'x\n',
        'apps/web/src/main.tsx': 'x\n',
      }
    );
    expect(report.modules.filter((m) => m.area === 'web').map((m) => m.module)).toEqual([
      '(root)',
      'components/settings',
      'pages/Admin',
    ]);
  });

  it('produces identical JSON on two consecutive runs, apart from generatedAt', () => {
    const base = makeRepo('base', { [`${API}/a/a.ts`]: 'a\n', [`${API}/b/b.ts`]: 'b\n' }, BASE_ID);
    const app = makeRepo('app', { [`${API}/a/a.ts`]: 'a2\n', [`${API}/c/c.ts`]: 'c\n' }, APP_ID);
    const outputs = [tmpDir('run'), tmpDir('run')].map((out) => {
      expect(run(['--base', base, '--app', app, '--out', out, '--format', 'json']).status).toBe(0);
      return readFileSync(join(out, 'drift-report.json'), 'utf8').replace(
        /"generatedAt": "[^"]+"/,
        ''
      );
    });
    expect(outputs[0]).toBe(outputs[1]);
  });
});

describe('migrations', () => {
  const MIG = 'apps/api/prisma/migrations';
  it('reports identical SQL under different timestamps as renamed', () => {
    const vitals = 'ALTER TABLE "nodes" ADD COLUMN "vitals" JSONB;\n';
    const report = drift(
      {
        [`${MIG}/20260101000000_init/migration.sql`]: 'CREATE TABLE "a" ("id" TEXT);\n',
        [`${MIG}/20260928100000_add_worker_node_vitals/migration.sql`]: vitals,
        [`${MIG}/20260929000000_tweak/migration.sql`]: 'ALTER TABLE "a" ADD COLUMN "b" TEXT;\n',
        [`${MIG}/20260929100000_base_thing/migration.sql`]: 'CREATE TABLE "base_thing" ();\n',
      },
      {
        [`${MIG}/20260101000000_init/migration.sql`]:
          '-- a comment\nCREATE TABLE "a" ("id" TEXT);\n',
        [`${MIG}/20260930100000_add_worker_node_vitals/migration.sql`]: vitals,
        [`${MIG}/20261001000000_tweak/migration.sql`]: 'ALTER TABLE "a" ADD COLUMN "c" TEXT;\n',
        [`${MIG}/20261002000000_app_thing/migration.sql`]: 'CREATE TABLE "app_thing" ();\n',
      }
    );
    expect(report.migrations).toMatchObject({
      shared: 1,
      renamed: 1,
      sameNameDifferentSql: 1,
      baseOnly: 1,
      appOnly: 1,
    });
    expect(report.migrations?.entries).toContainEqual({
      status: 'renamed',
      base: '20260928100000_add_worker_node_vitals',
      app: '20260930100000_add_worker_node_vitals',
    });
  });
});

describe('Prisma models', () => {
  it('reports models missing on one side and fields added or removed on a shared model', () => {
    const report = drift(
      {
        'apps/api/prisma/schema.prisma': [
          'model User {',
          '  id    String @id',
          '  name  String // display name',
          '  @@map("users")',
          '}',
          '',
          'model AuditEvent {',
          '  id String @id',
          '}',
        ].join('\n'),
      },
      {
        'apps/api/prisma/schema.prisma': [
          '/// The account.',
          'model User {',
          '  id    String @id',
          '  email String',
          '  @@index([email])',
          '}',
          '',
          'model Gym {',
          '  id String @id',
          '}',
        ].join('\n'),
      }
    );
    expect(report.prismaModels).toMatchObject({
      base: 2,
      app: 2,
      presentInApp: ['User'],
      missingFromApp: ['AuditEvent'],
      appOnly: ['Gym'],
      changed: [{ model: 'User', addedFields: ['email'], removedFields: ['name'] }],
    });
  });
});

describe('exit codes', () => {
  it('exits 2 with a clear message for a bad --app path', () => {
    const result = run(['--app', join(TMP, 'does-not-exist'), '--out', tmpDir('out')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--app .*not a readable directory/);
  });

  it('exits 2 for a missing --app, an unknown flag, a bad --format or an unknown area', () => {
    const app = makeRepo('app', {}, APP_ID);
    expect(run([]).stderr).toMatch(/--app is required/);
    expect(run([]).status).toBe(2);
    expect(run(['--app', app, '--nope', 'x']).status).toBe(2);
    expect(run(['--app', app, '--format', 'xml']).status).toBe(2);
    const areas = run(['--app', app, '--areas', 'api,nope']);
    expect(areas.status).toBe(2);
    expect(areas.stderr).toMatch(/unknown area\(s\) nope/);
  });

  it('exits 2 with "run npm ci first" when typescript cannot be resolved', () => {
    // A copy of the script in a directory with no node_modules anywhere above it.
    const isolated = mkdtempSync(join(tmpdir(), 'platform-drift-nots-'));
    try {
      mkdirSync(join(isolated, 'scripts'));
      copyFileSync(SCRIPT, join(isolated, 'scripts', 'platform-drift.mjs'));
      copyFileSync(
        join(REPO_ROOT, 'scripts', 'rename.mjs'),
        join(isolated, 'scripts', 'rename.mjs')
      );
      const app = makeRepo('app', {}, APP_ID);
      const result = run(['--app', app, '--base', app, '--out', tmpDir('out')], {
        script: join(isolated, 'scripts', 'platform-drift.mjs'),
        // No global module folders either.
        env: { PATH: process.env['PATH'] ?? '', HOME: isolated, NODE_PATH: '' },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/typescript.*run npm ci first/s);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('prints usage for --help and exits 0', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/--app <path>/);
  });
});

// =============================================================================
// Pure functions
// =============================================================================

describe('normaliseCode', () => {
  it('removes line, block and JSDoc comments but never a // inside a string or template', () => {
    const src = [
      '/** Doc. */',
      "const a = 'http://x.test/a'; // trailing",
      'const b = `//not-a-comment ${a /* inner */}`;',
      'const c = "/* not a comment */";',
      'const re = /\\/\\/ regex/;',
    ].join('\n');
    expect(normaliseCode(src, '.ts')).toBe(
      [
        "const a = 'http://x.test/a';",
        'const b = `//not-a-comment ${a }`;',
        'const c = "/* not a comment */";',
        'const re = /\\/\\/ regex/;',
      ].join('\n')
    );
  });

  it('turns a JSX comment into {} and keeps // inside JSX text', () => {
    const src =
      'export const A = () => (\n  <div>\n    {/* a note */}\n    <a>https://x.test</a>\n  </div>\n);\n';
    const out = normaliseCode(src, '.tsx');
    expect(out).toContain('{}');
    expect(out).not.toContain('a note');
    expect(out).toContain('<a>https://x.test</a>');
  });
});

describe('normaliseText', () => {
  it('strips # comments in YAML but not inside quotes', () => {
    const yml = 'image: "nginx:1#stable" # pinned\n# whole line\nport: 80\n';
    expect(normaliseText(yml, 'base.compose.yml')).toBe('image: "nginx:1#stable"\nport: 80');
  });

  it('strips SQL -- and block comments, Prisma // and ///', () => {
    expect(normaliseText("-- head\nSELECT '--x' /* c */ FROM t; -- tail\n", 'migration.sql')).toBe(
      "SELECT '--x'  FROM t;"
    );
    expect(normaliseText('/// doc\nmodel A {\n  id String // c\n}\n', 'schema.prisma')).toBe(
      'model A {\nid String\n}'
    );
  });

  it('compares Markdown as text, keeping one blank line between paragraphs', () => {
    expect(normaliseText('# T\n\n\n\n// not a comment\n', 'README.md')).toBe(
      '# T\n\n// not a comment'
    );
  });
});

describe('replacements', () => {
  const table = buildReplacements(
    deriveIdentity({ productName: 'Base Product', repoSlug: 'acme/base-repo', cliName: 'appctl' }),
    deriveIdentity({ productName: 'EvoPath', repoSlug: 'acme/evopath', cliName: 'evopathcli' })
  );

  it('replaces only on letter/digit boundaries, so appctl does not eat appctlx', () => {
    expect(applyReplacements('appctl appctlx APPCTL_TOKEN .appctl-deploy.json', table)).toBe(
      '__CLI__ appctlx __CLI_UPPER___TOKEN .__CLI__-deploy.json'
    );
  });

  it('replaces the longest value first and merges placeholders that share a value', () => {
    // evopath is both the app's slug and its repository name: one token.
    expect(table.find((r) => r.placeholder === '__REPO_NAME__')?.token).toBe('__SLUG__');
    expect(applyReplacements('base-product-api evopath-api base-repo evopath', table)).toBe(
      '__SERVICE__ __SERVICE__ __SLUG__ __SLUG__'
    );
  });
});

describe('classify', () => {
  it('classifies each status', () => {
    expect(classify('a', null, 'x.ts')).toEqual({ status: 'base-only' });
    expect(classify(null, 'a', 'x.ts')).toEqual({ status: 'app-only' });
    expect(classify('a\n', 'a\n', 'x.ts')).toEqual({ status: 'identical' });
    expect(classify('a\n', '  a  // c\n', 'x.ts')).toEqual({ status: 'normalised-identical' });
    expect(classify('a\nb\n', 'a\nc\n', 'x.ts')).toEqual({
      status: 'modified',
      linesAdded: 1,
      linesRemoved: 1,
    });
  });

  it('skips the line diff above 20 000 normalised lines', () => {
    const big = (tag: string) => Array.from({ length: 20_001 }, (_, i) => `${tag}${i}`).join('\n');
    expect(classify(big('a'), big('b'), 'x.txt')).toEqual({
      status: 'modified',
      linesAdded: null,
      linesRemoved: null,
      diffSkipped: true,
    });
  });
});

describe('lineDiff', () => {
  /** Reference LCS by dynamic programming. */
  function lcs(a: string[], b: string[]): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0)
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const row = dp[i] as number[];
        const prev = dp[i - 1] as number[];
        row[j] =
          a[i - 1] === b[j - 1]
            ? (prev[j - 1] as number) + 1
            : Math.max(prev[j] as number, row[j - 1] as number);
      }
    }
    return (dp[a.length] as number[])[b.length] as number;
  }

  it('agrees with a reference LCS on pseudo-random inputs', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rand() * 30) }, () =>
        String(Math.floor(rand() * 5))
      );
      const b = Array.from({ length: Math.floor(rand() * 30) }, () =>
        String(Math.floor(rand() * 5))
      );
      const common = lcs(a, b);
      expect(lineDiff(a, b)).toEqual({
        linesAdded: b.length - common,
        linesRemoved: a.length - common,
      });
    }
  });
});

describe('matchMigrations', () => {
  it('matches by SQL first, then by name suffix', () => {
    const result = matchMigrations(
      [
        { id: '20260101000000_a', sql: 'A;' },
        { id: '20260102000000_b', sql: 'B;' },
        { id: '20260103000000_c', sql: 'C;' },
        { id: '20260104000000_d', sql: 'D;' },
      ],
      [
        { id: '20260101000000_a', sql: '-- note\nA;' },
        { id: '20260202000000_b', sql: 'B;' },
        { id: '20260203000000_c', sql: 'C2;' },
        { id: '20260205000000_e', sql: 'E;' },
      ]
    );
    expect(result).toMatchObject({
      base: 4,
      app: 4,
      shared: 1,
      renamed: 1,
      sameNameDifferentSql: 1,
      baseOnly: 1,
      appOnly: 1,
    });
    expect(result.entries.map((e: { status: string }) => e.status)).toEqual([
      'shared',
      'renamed',
      'same-name-different-sql',
      'base-only',
      'app-only',
    ]);
  });
});

describe('parsePrismaModels', () => {
  it('returns models with sorted field names, ignoring @@ lines and comments', () => {
    const schema =
      'model B {\n  z Int\n  a Int // c\n  @@id([a, z])\n}\n\n// model Fake {\nmodel A {\n  id String @id\n}\n';
    expect(parsePrismaModels(schema)).toEqual({ A: ['id'], B: ['a', 'z'] });
  });
});

describe('summarise', () => {
  it('counts every status and sums line changes', () => {
    const { areas } = summarise([
      { area: 'api', module: 'm', path: 'a', status: 'identical' },
      { area: 'api', module: 'm', path: 'b', status: 'modified', linesAdded: 2, linesRemoved: 3 },
      {
        area: 'api',
        module: 'm',
        path: 'c',
        status: 'modified',
        linesAdded: null,
        linesRemoved: null,
        binary: true,
      },
      { area: 'api', module: 'm', path: 'd', status: 'app-only' },
    ]);
    expect((areas as Record<string, Summary>)['api']).toMatchObject({
      files: 4,
      identical: 1,
      modified: 2,
      appOnly: 1,
      linesAdded: 2,
      linesRemoved: 3,
      identicalPercent: 33.3,
    });
  });
});

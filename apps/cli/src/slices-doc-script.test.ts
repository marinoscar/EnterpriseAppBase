import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// `scripts/generate-slices-doc.mjs` is real ESM with no build step and guards
// its `main()` behind `isDirectExecution`, so importing it runs nothing; it
// exposes the pure functions (same pattern as check-slice-peers.mjs).
import {
  closureDeps,
  compactPermissions,
  declaredPermissions,
  firstParagraph,
  generate,
  loadInputs,
  packagedCards,
  purposeOf,
  slicePeers,
  subpathsOf,
  validateNotes,
} from '../../../scripts/generate-slices-doc.mjs';

// =============================================================================
// Guards scripts/generate-slices-doc.mjs (docs/SLICES.md generator and check)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli: same reasoning as slice-peers-script.test.ts
// beside it (this workspace already runs ESM tests that spawn subprocesses and
// CI already runs `npm run test:run --workspace=cli`).
//
// FIXTURES are written to a temp directory per test: a repository root with a
// two-slice graph (`core`, `feature`) in `platform-api` and `platform-web`, the
// notes file, a minimal consumer and the sources the generator scans, so each
// rule fails in isolation and nothing in the real tree can influence a result.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'generate-slices-doc.mjs');
const REAL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

const GOOD_NOTES = {
  $example: { dir: 'tests/consumer-smoke/slim', package: 'platform-api', slices: ['core', 'feature'] },
  slices: {
    core: { group: 'foundation', gives: 'The base of everything.', standalone: { level: 'yes', note: 'Imports nothing.' } },
    testing: { group: 'foundation', gives: 'The harness.', standalone: { level: 'yes', note: 'Imports core.' } },
    feature: {
      group: 'feature',
      gives: 'A feature with a page.',
      standalone: { level: 'with-slices', note: 'Imports core.' },
      appCards: ['/admin/settings/extra'],
    },
  },
};

interface FixtureOptions {
  notes?: unknown;
  files?: Record<string, string>;
}

function fixture(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'slices-doc-'));
  created.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('package.json', JSON.stringify({ name: 'fixture' }));
  write(
    'packages/platform-slices.json',
    JSON.stringify({
      'platform-api': { core: [], testing: ['core'], feature: ['core', 'testing'] },
      'platform-web': { core: [], feature: ['core'] },
    }),
  );
  write(
    'packages/platform-slice-peers.json',
    JSON.stringify({
      $universal: { 'platform-api': ['core'], 'platform-web': ['core'] },
      $implies: { 'platform-api': { '@nestjs/common': ['rxjs'] } },
      'platform-api': { core: ['@nestjs/common'], testing: [], feature: ['fastify'] },
      'platform-web': { core: ['react'], feature: ['react-router-dom'] },
    }),
  );
  write(
    'packages/platform-api/package.json',
    JSON.stringify({
      name: '@marinoscar/platform-api',
      exports: {
        '.': './dist/index.js',
        './core': './dist/core/index.js',
        './feature': './dist/feature/index.js',
        './feature/testing': './dist/feature/testing/index.js',
        './featured': './dist/featured.js',
      },
    }),
  );
  write('packages/platform-web/package.json', JSON.stringify({ name: '@marinoscar/platform-web', exports: { './core': './x.js', './feature/ui': './y.js' } }));
  write(
    'packages/platform-api/src/core/README.md',
    '# @marinoscar/platform-api/core\n\n`@marinoscar/platform-api/core`: the base layer (issue #12). It carries the [registry](./x.md) and more. Second sentence.\n\n## Next\n',
  );
  write(
    'packages/platform-api/src/feature/README.md',
    '# feature\n\n> A note that is not prose.\n\nThe feature slice, see #55 for history.\n',
  );
  write(
    'packages/platform-api/src/feature/permissions.ts',
    [
      "export const A = { id: 'things:read', scope: 'system', defaultGrants: ['admin'] };",
      "export const B = { id: 'things:write', scope: 'system', defaultGrants: ['admin'] };",
      "export const C = { id: 'things:own', scope: 'org', defaultGrants: [] };",
      "export const NOT_A_PERMISSION = { id: 'plain-id', scope: 'system', defaultGrants: [] };",
      "export const NO_GRANTS = { id: 'x:y', scope: 'system' };",
    ].join('\n'),
  );
  write(
    'packages/platform-api/src/feature/permissions.spec.ts',
    "export const T = { id: 'test:only', scope: 'system', defaultGrants: [] };",
  );
  write(
    'packages/platform-web/src/feature/sections.tsx',
    [
      "const TITLE = 'Things';",
      "export const featureAdminSections = [",
      "  { title: TITLE, path: '/admin/settings/things', permission: 'things:read' },",
      "  { title: 'Gated', path: '/admin/settings/things/gated', permission: ['things:read', 'things:write'], feature: 'things' },",
      "  { title: 'Not a card', path: '/somewhere/else' },",
      '] as const;',
    ].join('\n'),
  );
  write(
    'apps/web/src/config/adminSections.tsx',
    "export const ADMIN_SECTIONS = [{ title: 'Extra', path: '/admin/settings/extra', permission: 'system_settings:read' }];\n",
  );
  write('tests/consumer-smoke/slim/package.json', JSON.stringify({ dependencies: { '@marinoscar/platform-api': 'next', '@nestjs/common': '^1', rxjs: '^7', fastify: '^5' } }));
  write('tests/consumer-smoke/slim/src/main.ts', "// leading comment\n\nimport { x } from '@marinoscar/platform-api/core';\nexport { x };\n");
  write('packages/platform-slice-notes.json', JSON.stringify(options.notes ?? GOOD_NOTES));
  for (const [path, text] of Object.entries(options.files ?? {})) write(path, text);
  return root;
}

const problemsOf = (root: string) => validateNotes(loadInputs(root)) as string[];

describe('firstParagraph and purposeOf', () => {
  it('takes the first prose paragraph after the H1, skipping quotes, tables and fences', () => {
    const md = '# T\n\n> quote\n\n| a | b |\n\nFirst line\nsecond line.\n\nOther paragraph.\n';
    expect(firstParagraph(md)).toBe('First line second line.');
  });

  it('drops the package label, issue references and links, and keeps the first sentence', () => {
    const paragraph = '`@marinoscar/platform-api/core`: the base layer (issue #12). It carries the [registry](./x.md) and more. Second sentence.';
    expect(purposeOf(paragraph)).toBe('The base layer.');
  });

  it('never leaves an issue or epic reference behind', () => {
    for (const text of ['Does a thing (epic #528, packaged by #703).', 'Does a thing, new with issue #12.', 'Does a thing PP-8.3 here.', 'Does a thing #55.']) {
      expect(purposeOf(text)).not.toMatch(/#\d|PP-\d/);
    }
  });

  it('cuts a long sentence at a clause boundary outside parentheses and code', () => {
    const long = `The list: ${'one (a, b), `c, d`, two, three, '.repeat(20)}end.`;
    const out = purposeOf(long, 120);
    expect(out.length).toBeLessThan(140);
    expect(out.split('(').length).toBe(out.split(')').length);
    expect(out.split('`').length % 2).toBe(1);
  });
});

describe('graph and exports helpers', () => {
  it('lists a slice\'s subpaths, shortest first, and not those of a slice sharing its prefix', () => {
    const manifest = JSON.parse(readFileSync(join(fixture(), 'packages/platform-api/package.json'), 'utf8'));
    expect(subpathsOf(manifest, 'feature')).toEqual(['/feature', '/feature/testing']);
    expect(subpathsOf(manifest, 'core')).toEqual(['/core']);
    expect(subpathsOf(undefined, 'core')).toEqual([]);
  });

  it('computes the transitive slice dependencies without testing or the slice itself', () => {
    const graph = { core: [], mid: ['core', 'testing'], top: ['mid'], testing: ['core'] };
    expect(closureDeps(graph, 'top' as never, 'top')).toEqual([]);
    expect(closureDeps({ 'platform-api': graph }, 'platform-api', 'top')).toEqual(['core', 'mid']);
  });

  it('separates the peers a slice adds beyond the required ones, and those only its testing entry adds', () => {
    const graph = { 'platform-api': { core: [], feature: ['core'] } };
    const peers = {
      $universal: { 'platform-api': ['core'] },
      $implies: { 'platform-api': { '@nestjs/common': ['rxjs'] } },
      'platform-api': { core: ['@nestjs/common'], feature: ['fastify'], 'feature/testing': ['supertest'] },
    };
    expect(slicePeers('platform-api', 'feature', graph, peers)).toEqual({ extra: ['fastify'], testing: ['supertest'] });
    expect(slicePeers('platform-api', 'core', graph, peers)).toEqual({ extra: [], testing: [] });
  });
});

describe('source scans', () => {
  it('reads the cards a web slice declares, resolving constants, and ignores non-settings paths', () => {
    const cards = packagedCards(fixture(), 'feature');
    expect(cards.map((card: { path: string }) => card.path)).toEqual(['/admin/settings/things', '/admin/settings/things/gated']);
    expect(cards[0]).toMatchObject({ title: 'Things', permission: ['things:read'], feature: null, declaredBy: 'package' });
    expect(cards[1]).toMatchObject({ permission: ['things:read', 'things:write'], feature: 'things' });
  });

  it('reads the permissions an API slice declares with default grants, skipping tests and non-permission ids', () => {
    const permissions = declaredPermissions(fixture(), 'feature');
    expect(permissions).toEqual([
      { id: 'things:read', scope: 'system' },
      { id: 'things:write', scope: 'system' },
      { id: 'things:own', scope: 'org' },
    ]);
  });

  it('groups actions of one resource and tags the org-scoped ones', () => {
    expect(compactPermissions([{ id: 'a:read', scope: 'system' }, { id: 'a:write', scope: 'system' }, { id: 'b:read', scope: 'org' }])).toEqual([
      '`a:{read,write}`',
      '`b:read` (org)',
    ]);
  });
});

describe('validateNotes', () => {
  it('passes complete notes', () => {
    expect(problemsOf(fixture())).toEqual([]);
  });

  it('names a slice of the graph that has no entry', () => {
    const notes = { ...GOOD_NOTES, slices: { core: GOOD_NOTES.slices.core } };
    expect(problemsOf(fixture({ notes })).join('\n')).toMatch(/slice "feature" is in packages\/platform-slices\.json but has no entry/);
  });

  it('names an entry that is no slice of the graph', () => {
    const notes = { ...GOOD_NOTES, slices: { ...GOOD_NOTES.slices, ghost: GOOD_NOTES.slices.core } };
    expect(problemsOf(fixture({ notes })).join('\n')).toMatch(/describes "ghost", which is no slice/);
  });

  it('rejects a bad group, a missing gives, a bad level and an issue reference', () => {
    const notes = {
      ...GOOD_NOTES,
      slices: {
        core: { group: 'nope', gives: '', standalone: { level: 'maybe', note: 'See #12.' } },
        feature: GOOD_NOTES.slices.feature,
      },
    };
    const text = problemsOf(fixture({ notes })).join('\n');
    expect(text).toMatch(/"core": group must be one of/);
    expect(text).toMatch(/"core": "gives" must be a non-empty one-line string/);
    expect(text).toMatch(/"core": standalone\.level must be one of/);
    expect(text).toMatch(/"core": standalone\.note must not carry issue references/);
  });

  it('rejects an appCards path the app registries do not declare', () => {
    const notes = { ...GOOD_NOTES, slices: { ...GOOD_NOTES.slices, feature: { ...GOOD_NOTES.slices.feature, appCards: ['/admin/settings/missing'] } } };
    expect(problemsOf(fixture({ notes })).join('\n')).toMatch(/appCards path \/admin\/settings\/missing is declared by neither/);
  });

  it('requires the minimal consumer', () => {
    const { $example: _omitted, ...notes } = GOOD_NOTES;
    expect(problemsOf(fixture({ notes })).join('\n')).toMatch(/has no "\$example"/);
  });

  it('fails a minimal consumer that misses a peer, installs a stray one or imports an unlisted slice', () => {
    const root = fixture({
      files: {
        'tests/consumer-smoke/slim/package.json': JSON.stringify({ dependencies: { '@marinoscar/platform-api': 'next', '@nestjs/common': '^1', rxjs: '^7', stray: '^1' } }),
        'tests/consumer-smoke/slim/src/main.ts': "import { x } from '@marinoscar/platform-api/core';\nimport { y } from '@marinoscar/platform-api/testing';\nexport { x, y };\n",
      },
    });
    const text = problemsOf(root).join('\n');
    expect(text).toMatch(/does not install fastify/);
    expect(text).toMatch(/installs stray, which none of core, feature needs/);
  });
});

describe('generate', () => {
  it('throws every problem when the notes are incomplete', () => {
    const notes = { ...GOOD_NOTES, slices: { core: GOOD_NOTES.slices.core } };
    expect(() => generate(fixture({ notes }))).toThrow(/2 problem\(s\)/);
  });

  it('renders every slice with its parts, imports, peers, cards, permissions and standalone note', () => {
    const page: string = generate(fixture());
    expect(page).toMatch(/^# Platform slices\n/);
    expect(page).toContain('### feature');
    expect(page).toContain('**What it gives you.** A feature with a page.');
    expect(page).toContain('| API (`platform-api`) | `/feature`, `/feature/testing` | `core` | `fastify` |');
    expect(page).toContain('| Web (`platform-web`) | `/feature/ui` |');
    expect(page).toContain('| Things | `/admin/settings/things` | `things:read` | none | the package');
    expect(page).toContain('| Extra | `/admin/settings/extra` | `system_settings:read` | none | the app\'s registry |');
    expect(page).toContain('**Permissions it adds.** `things:{read,write}`, `things:own` (org)');
    expect(page).toContain('## Using one slice on its own');
    expect(page).toContain('import { x } from \'@marinoscar/platform-api/core\';');
    expect(page).not.toContain('leading comment');
    expect(page).not.toMatch(/#\d{2,4}/);
  });

  it('is deterministic', () => {
    const root = fixture();
    expect(generate(root)).toBe(generate(root));
  });
});

describe('the command line', () => {
  const run = (root: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });

  it('writes the page, then --check passes', () => {
    const root = fixture();
    mkdirSync(join(root, 'docs'), { recursive: true });
    expect(run(root, '--write').status).toBe(0);
    expect(readFileSync(join(root, 'docs', 'SLICES.md'), 'utf8')).toMatch(/^# Platform slices/);
    expect(run(root, '--check').status).toBe(0);
  });

  it('fails --check when the page is missing or stale and says to run npm run docs:slices', () => {
    const root = fixture();
    mkdirSync(join(root, 'docs'), { recursive: true });
    const missing = run(root, '--check');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/missing.*npm run docs:slices/);
    run(root, '--write');
    writeFileSync(join(root, 'docs', 'SLICES.md'), `${readFileSync(join(root, 'docs', 'SLICES.md'), 'utf8')}\nhand edit\n`);
    const stale = run(root, '--check');
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/out of date.*npm run docs:slices/);
  });

  it('fails --check when the notes do not cover a slice', () => {
    const root = fixture({ notes: { ...GOOD_NOTES, slices: { core: GOOD_NOTES.slices.core } } });
    const result = run(root, '--check');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/has no entry in packages\/platform-slice-notes\.json/);
  });

  it('exits 2 on an unknown argument', () => {
    expect(run(fixture(), '--nope').status).toBe(2);
  });
});

describe('the repository', () => {
  it('has a notes entry for every slice and a docs/SLICES.md that is up to date', () => {
    expect(problemsOf(REAL_ROOT)).toEqual([]);
    expect(readFileSync(join(REAL_ROOT, 'docs', 'SLICES.md'), 'utf8')).toBe(generate(REAL_ROOT));
  });
});

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Proves the TSDoc syntax rule in the root eslint.config.mjs (issue #693):
 * `tsdoc/syntax` runs over `packages/platform-*\/src/**` with the repository's
 * tsdoc.json, so the platform tags `@stability` and `@extensionPoint` parse,
 * and a malformed or unknown tag fails `npm run lint:packages`.
 *
 * Same runner as boundaries.spec.ts (the ESLint Node API in a child process,
 * over a throwaway fixture workspace), so the test does not depend on what
 * the real packages export.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUNNER = join(__dirname, 'support', 'run-eslint.mjs');

const FIXTURE_FILES: Record<string, string> = {
  'packages/platform-api/tsconfig.json': '{ "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext" } }',
  'packages/platform-api/src/index.ts': 'export const index = 1;\n',
};

type LintCase = { name: string; filePath: string; code: string };
type LintResult = { filePath: string; messages: { ruleId: string | null; message: string }[] };

const doc = (body: string) => `/**\n${body
  .split('\n')
  .map((line) => ` * ${line}`.trimEnd())
  .join('\n')}\n */\nexport function register(id: string): void {\n  void id;\n}\n`;

const CASES: LintCase[] = [
  {
    name: 'well-formed with the platform tags',
    filePath: 'packages/platform-api/src/good.ts',
    code: doc(
      [
        'Adds a check to the report. Throws on a duplicate id.',
        '',
        '@param id - The id; unique across the application.',
        '@returns Nothing.',
        '@stability stable',
        '@extensionPoint registry',
        '@example',
        '```ts',
        "register('db');",
        '```',
      ].join('\n'),
    ),
  },
  {
    name: 'unknown tag',
    filePath: 'packages/platform-api/src/unknown.ts',
    code: doc('Adds a check.\n\n@stabilty stable'),
  },
  {
    name: 'unclosed inline tag',
    filePath: 'packages/platform-api/src/inline.ts',
    code: doc('Adds a check, see {@link register\n\n@stability stable'),
  },
  {
    name: 'param without hyphen',
    filePath: 'packages/platform-api/src/param.ts',
    code: doc('Adds a check.\n\n@param id the id\n@stability stable'),
  },
  {
    name: 'outside the platform packages',
    filePath: 'apps/api/src/anything.ts',
    code: doc('Adds a check.\n\n@stabilty stable'),
  },
];

describe('TSDoc syntax lint (eslint.config.mjs)', () => {
  let results: Map<string, LintResult>;
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'platform-tsdoc-'));
    for (const [path, content] of Object.entries(FIXTURE_FILES)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const child = spawnSync(process.execPath, [RUNNER], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({
        eslint: require.resolve('eslint', { paths: [REPO_ROOT] }),
        config: join(REPO_ROOT, 'eslint.config.mjs'),
        rootPath: root,
        graph: { 'platform-api': {} },
        cases: CASES.map(({ filePath, code }) => ({ filePath, code })),
      }),
    });
    if (child.status !== 0) throw new Error(`ESLint runner failed:\n${child.stderr}`);
    const parsed = JSON.parse(child.stdout) as LintResult[];
    results = new Map(CASES.map((c, i) => [c.name, parsed[i]!]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const tsdocMessages = (name: string) =>
    results
      .get(name)!
      .messages.filter((m) => m.ruleId === 'tsdoc/syntax')
      .map((m) => m.message);

  it('accepts @stability and @extensionPoint from the repository tsdoc.json', () => {
    expect(results.get('well-formed with the platform tags')!.messages).toEqual([]);
  });

  it.each([
    ['unknown tag', /tsdoc-undefined-tag/],
    ['unclosed inline tag', /tsdoc-inline-tag-missing-right-brace|tsdoc-malformed-inline-tag/],
    ['param without hyphen', /tsdoc-param-tag-missing-hyphen/],
  ])('reports %s as tsdoc/syntax', (name, message) => {
    expect(tsdocMessages(name).join('\n')).toMatch(message);
  });

  it('does not lint files outside packages/platform-*/src', () => {
    expect(tsdocMessages('outside the platform packages')).toEqual([]);
  });
});

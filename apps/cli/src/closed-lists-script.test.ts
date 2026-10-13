import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// `scripts/check-closed-lists.mjs` is real ESM with no build step and guards its
// `main()` behind `isDirectExecution`, so importing it runs nothing; it just
// exposes the pure functions (same pattern as check-slice-peers.mjs).
import {
  HINT,
  checkClosedLists,
  checkRepository,
  findClosedLists,
  isBuiltinName,
  isFlaggedConstName,
  isFlaggedTypeName,
  scanSource,
} from '../../../scripts/check-closed-lists.mjs';

// =============================================================================
// Guards scripts/check-closed-lists.mjs (issue #946)
// =============================================================================
//
// WHY THIS LIVES IN apps/cli: same reasoning as slice-peers-script.test.ts
// beside it (this workspace already runs ESM tests of repository scripts and CI
// already runs `npm run test:run --workspace=cli`).
//
// FIXTURES are written to a temp directory per test: a repository root with
// `packages/platform-<pkg>/src/...` files and an optional allowlist, so each
// rule fails in isolation and nothing in the real tree can influence a result.
// The last block runs the check on the real repository, so a new closed list
// fails this suite as well as CI's `check:closed-lists` step.

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', '..', 'scripts', 'check-closed-lists.mjs');
const REAL_ROOT = join(HERE, '..', '..', '..');

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface AllowEntry {
  file: string;
  symbol: string;
  reason: string;
}

/** `files` maps `platform-<pkg>/src/<path>` to its text. */
function fixture(files: Record<string, string>, allow: AllowEntry[] | null = []): string {
  const root = mkdtempSync(join(tmpdir(), 'closed-lists-'));
  created.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(`packages/${path}`, text);
  if (allow) write('packages/closed-lists.allowlist.json', JSON.stringify({ entries: allow }));
  return root;
}

const symbolsOf = (root: string) => findClosedLists(root).map((f: { symbol: string }) => f.symbol).sort();
const rulesOf = (root: string) => checkRepository(root).violations.map((v: { rule: string }) => v.rule);

const A = 'platform-api/src/feature';
const C = 'platform-contract/src/feature';
const W = 'platform-web/src/feature';

describe('name rules', () => {
  it('covers the documented suffixes only', () => {
    for (const n of ['A_IDS', 'A_KINDS', 'A_TYPES', 'A_PROVIDERS', 'A_ADAPTERS', 'A_CHANNELS', 'A_ROLES', 'A_MODES', 'A_GROUPS', 'A_UNITS', 'A_NAMES']) {
      expect(isFlaggedConstName(n), n).toBe(true);
    }
    for (const n of ['A_ID', 'A_STATUSES', 'A_CODES', 'IDS_A', 'A_Ids']) expect(isFlaggedConstName(n), n).toBe(false);
    for (const n of ['XId', 'XKind', 'XType', 'XName', 'XMode', 'XRole']) expect(isFlaggedTypeName(n), n).toBe(true);
    for (const n of ['XStatus', 'XIds', 'Identifier', 'Typed']) expect(isFlaggedTypeName(n), n).toBe(false);
  });

  it('recognises the built-in subset of an open vocabulary', () => {
    expect(isBuiltinName('BUILTIN_X_IDS')).toBe(true);
    expect(isBuiltinName('BuiltinXId')).toBe(true);
    expect(isBuiltinName('X_IDS')).toBe(false);
    expect(isBuiltinName('BuiltinsXId')).toBe(false);
  });
});

describe('(a) exported as const id arrays', () => {
  it('flags an exported string array with 2+ items and a covered name', () => {
    const root = fixture({
      [`${A}/ids.ts`]: [
        "export const WIDGET_KINDS = ['a', 'b'] as const;",
        "export const SPARE_IDS = ['a', 'b', 'c'] as const satisfies readonly string[];",
        "export const GADGET_PROVIDERS = <const>['a', 'b'];",
      ].join('\n'),
    });
    // The angle-bracket assertion is not an `as const`; only the other two count.
    expect(symbolsOf(root)).toEqual(['SPARE_IDS', 'WIDGET_KINDS']);
  });

  it('ignores one item, other names, a plain array, a non-string item and a non-exported array', () => {
    const root = fixture({
      [`${A}/ids.ts`]: [
        "export const ONE_IDS = ['a'] as const;",
        "export const WIDGET_CODES = ['a', 'b'] as const;",
        "export const PLAIN_IDS = ['a', 'b'];",
        'export const MIXED_IDS = [1, 2] as const;',
        "const LOCAL_IDS = ['a', 'b'] as const;",
        "export const DYNAMIC_IDS = ['a', other] as const;",
        'void LOCAL_IDS;',
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual([]);
  });

  it('never flags BUILTIN_ constants, but flags a deprecated alias beside one', () => {
    const root = fixture({
      [`${A}/ids.ts`]: [
        "export const BUILTIN_WIDGET_IDS = ['a', 'b'] as const;",
        '/** @deprecated Use BUILTIN_WIDGET_IDS. */',
        "export const WIDGET_IDS = ['a', 'b'] as const;",
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual(['WIDGET_IDS']);
  });
});

describe('(b) exported literal unions', () => {
  it('flags a union of 2+ literals with a covered name', () => {
    const root = fixture({
      [`${A}/types.ts`]: [
        "export type WidgetKind = 'a' | 'b';",
        "export type SpareMode =\n  | 'x'\n  | 'y'\n  | 'z';",
        "export type MixedRole = 'a' | 'b' | undefined;",
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual(['MixedRole', 'SpareMode', 'WidgetKind']);
  });

  it('passes an open union, a single literal, another suffix, a non-exported and a Builtin type', () => {
    const root = fixture({
      [`${A}/types.ts`]: [
        "export type OpenKind = 'a' | 'b' | (string & {});",
        "export type OpenId = BuiltinOpenId | (string & {});",
        "export type OneKind = 'a';",
        "export type WidgetStatus = 'a' | 'b';",
        "type LocalKind = 'a' | 'b';",
        "export type BuiltinWidgetId = 'a' | 'b';",
        'export type Alias = LocalKind;',
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual([]);
  });
});

describe('(c) z.enum over a flagged const in the contract', () => {
  const consts = "export const WIDGET_KINDS = ['a', 'b'] as const;\n";

  it('flags z.enum(<flagged const>) in the contract, also across files', () => {
    const root = fixture({
      [`${C}/constants.ts`]: consts,
      [`${C}/schemas.ts`]: "import { z } from 'zod';\nimport { WIDGET_KINDS } from './constants.js';\nexport const widgetKind = z.enum(WIDGET_KINDS);\nexport const again = (z.enum(WIDGET_KINDS) as unknown);\n",
    });
    expect(symbolsOf(root)).toEqual(['WIDGET_KINDS', 'z.enum(WIDGET_KINDS)']);
    expect(findClosedLists(root).find((f: { rule: string }) => f.rule === 'z.enum')).toMatchObject({ file: `packages/${C}/schemas.ts` });
  });

  it('flags a z.enum over a BUILTIN constant: it would close the vocabulary again', () => {
    const root = fixture({
      [`${C}/schemas.ts`]: "import { z } from 'zod';\nexport const BUILTIN_WIDGET_IDS = ['a', 'b'] as const;\nexport const s = z.enum(BUILTIN_WIDGET_IDS);\n",
    });
    expect(symbolsOf(root)).toEqual(['z.enum(BUILTIN_WIDGET_IDS)']);
  });

  it('ignores a z.enum over an unflagged list, an inline list, and one outside the contract', () => {
    const root = fixture({
      [`${C}/schemas.ts`]: "import { z } from 'zod';\nconst STATUSES = ['a', 'b'] as const;\nexport const s = z.enum(STATUSES);\nexport const t = z.enum(['a', 'b']);\n",
      [`${A}/schemas.ts`]: "import { z } from 'zod';\nimport { WIDGET_KINDS } from '../x';\nexport const s = z.enum(WIDGET_KINDS);\n",
      [`${A}/consts.ts`]: consts,
    });
    expect(symbolsOf(root)).toEqual(['WIDGET_KINDS']);
  });
});

describe('(d) Record over a flagged union in a web ui folder', () => {
  const union = "export type WidgetKind = 'a' | 'b';\n";

  it('flags a constant typed Record<flagged union, ...> under ui/ (annotation, satisfies, as)', () => {
    const root = fixture({
      [`${W}/headless/types.ts`]: union,
      [`${W}/ui/Labels.tsx`]: [
        "import type { WidgetKind } from '../headless/types.js';",
        "const LABELS: Record<WidgetKind, string> = { a: 'A', b: 'B' };",
        "export const ICONS = { a: 1, b: 2 } satisfies Record<WidgetKind, number>;",
        "export const COLORS = { a: 'x', b: 'y' } as Record<WidgetKind, string>;",
        'export function Labels() { return LABELS.a + ICONS.a + COLORS.a; }',
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual(['COLORS', 'ICONS', 'LABELS', 'WidgetKind']);
  });

  it('follows an alias derived from a flagged const', () => {
    const root = fixture({
      [`${W}/headless/types.ts`]: "export const WIDGET_KINDS = ['a', 'b'] as const;\nexport type Wanted = (typeof WIDGET_KINDS)[number];\n",
      [`${W}/ui/Labels.tsx`]: "import type { Wanted } from '../headless/types.js';\nexport const LABELS: Record<Wanted, string> = { a: 'A', b: 'B' };\n",
    });
    expect(symbolsOf(root)).toEqual(['LABELS', 'WIDGET_KINDS']);
  });

  it('ignores a Record outside ui/, a Record<string, ...>, an unflagged key type and a Record in another package', () => {
    const root = fixture({
      [`${W}/headless/types.ts`]: union + "export type Level = 'lo' | 'hi';\n",
      [`${W}/headless/labels.ts`]: "import type { WidgetKind } from './types.js';\nexport const LABELS: Record<WidgetKind, string> = { a: 'A', b: 'B' };\n",
      [`${W}/ui/Other.tsx`]: [
        "import type { Level } from '../headless/types.js';",
        'export const BY_NAME: Record<string, string> = {};',
        "export const LEVELS: Record<Level, string> = { lo: 'a', hi: 'b' };",
      ].join('\n'),
      [`${A}/ui/Labels.ts`]: "import type { WidgetKind } from '../x';\nexport const L: Record<WidgetKind, string> = { a: 'A', b: 'B' };\n",
    });
    expect(symbolsOf(root)).toEqual(['WidgetKind']);
  });
});

describe('which files are scanned', () => {
  it('skips tests, fixtures, declarations, dist, docs-api and other directories than platform-*/src', () => {
    const body = "export const WIDGET_KINDS = ['a', 'b'] as const;\n";
    const root = fixture({
      [`${A}/a.spec.ts`]: body,
      [`${A}/a.test.tsx`]: body,
      [`${A}/__tests__/a.ts`]: body,
      [`${A}/__fixtures__/a.ts`]: body,
      [`${A}/test/a.ts`]: body,
      [`${A}/a.d.ts`]: body,
      [`${A}/docs-api/a.ts`]: body,
      'platform-api/dist/a.ts': body,
      'platform-api/test/a.ts': body,
      'shared/src/a.ts': body,
      [`${A}/notes.md`]: body,
    });
    expect(symbolsOf(root)).toEqual([]);
  });

  it('scans a testing/ folder: it is published source', () => {
    const root = fixture({ [`${A}/testing/kit.ts`]: "export const KIT_CHECK_IDS = ['a', 'b'] as const;\n" });
    expect(symbolsOf(root)).toEqual(['KIT_CHECK_IDS']);
  });

  it('is not fooled by comments and strings (the compiler parses, nothing is matched by regex)', () => {
    const root = fixture({
      [`${A}/doc.ts`]: [
        "// export const FAKE_IDS = ['a', 'b'] as const;",
        "/** export type FakeKind = 'a' | 'b'; */",
        "export const text = \"export const FAKE_IDS = ['a', 'b'] as const;\";",
        "export const tpl = `export type FakeKind = 'a' | 'b';`;",
      ].join('\n'),
    });
    expect(symbolsOf(root)).toEqual([]);
  });
});

describe('scanSource', () => {
  it('reads a .tsx file', () => {
    const out = scanSource('x.tsx', "export const A_IDS = ['a', 'b'] as const;\nexport const el = <div />;\n");
    expect(out.consts.map((c: { name: string }) => c.name)).toEqual(['A_IDS']);
  });
});

describe('the allowlist', () => {
  const body = "export const WIDGET_KINDS = ['a', 'b'] as const;\n";
  const FILE = `packages/${A}/ids.ts`;
  const entry = (over: Partial<AllowEntry> = {}): AllowEntry => ({ file: FILE, symbol: 'WIDGET_KINDS', reason: 'fixed by the widget protocol', ...over });

  it('fails a new closed list, printing the file, the symbol and the hint', () => {
    const root = fixture({ [`${A}/ids.ts`]: body });
    const violations = checkRepository(root).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('new');
    expect(violations[0].message).toContain(FILE);
    expect(violations[0].message).toContain('WIDGET_KINDS');
    expect(violations[0].message).toContain(HINT);
    expect(HINT).toBe('open it with a registry, see docs/EXTENDING.md#open-an-id-vocabulary, or allowlist it with a reason');
  });

  it('treats a missing allowlist file as empty', () => {
    expect(rulesOf(fixture({ [`${A}/ids.ts`]: body }, null))).toEqual(['new']);
  });

  it('passes a listed closed list', () => {
    expect(rulesOf(fixture({ [`${A}/ids.ts`]: body }, [entry()]))).toEqual([]);
  });

  it('fails a stale entry: the symbol was removed, renamed or opened', () => {
    expect(rulesOf(fixture({ [`${A}/other.ts`]: 'export const x = 1;\n' }, [entry()]))).toEqual(['stale']);
    const opened = fixture({ [`${A}/ids.ts`]: "export type WidgetKind = 'a' | 'b' | (string & {});\n" }, [entry({ symbol: 'WidgetKind' })]);
    expect(rulesOf(opened)).toEqual(['stale']);
    const renamed = fixture({ [`${A}/ids.ts`]: body.replace('WIDGET_KINDS', 'GADGET_KINDS') }, [entry()]);
    expect(rulesOf(renamed).sort()).toEqual(['new', 'stale']);
  });

  it('keys an entry by file and symbol: the same symbol in another file is not covered', () => {
    const root = fixture({ [`${A}/ids.ts`]: body, [`${A}/more.ts`]: body }, [entry()]);
    const [v, ...rest] = checkRepository(root).violations;
    expect(rest).toEqual([]);
    expect(v.message).toContain('more.ts');
  });

  it('requires a real reason, and rejects a duplicate or a malformed entry', () => {
    const files = { [`${A}/ids.ts`]: body };
    expect(rulesOf(fixture(files, [entry({ reason: 'misc' })]))).toEqual(['entry']);
    expect(rulesOf(fixture(files, [entry({ reason: '   ' })]))).toEqual(['entry']);
    expect(rulesOf(fixture(files, [entry(), entry()]))).toEqual(['entry']);
    expect(rulesOf(fixture(files, [{ file: FILE, symbol: 'WIDGET_KINDS' } as AllowEntry]))).toContain('entry');
  });

  it('requires "deprecated alias of ..." as the reason of a @deprecated list', () => {
    const files = { [`${A}/ids.ts`]: `/** @deprecated Use BUILTIN_WIDGET_IDS. */\n${body}` };
    expect(rulesOf(fixture(files, [entry()]))).toEqual(['deprecated']);
    expect(rulesOf(fixture(files, [entry({ reason: 'deprecated alias of BUILTIN_WIDGET_IDS' })]))).toEqual([]);
  });

  it('checkClosedLists compares findings with entries without touching the disk', () => {
    const findings = [{ file: 'f.ts', symbol: 'X_IDS', rule: 'const', deprecated: false }];
    expect(checkClosedLists(findings, []).map((v: { rule: string }) => v.rule)).toEqual(['new']);
    expect(checkClosedLists([], [{ file: 'f.ts', symbol: 'X_IDS', reason: 'because it is closed' }]).map((v: { rule: string }) => v.rule)).toEqual(['stale']);
  });
});

describe('the command line', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exits 0 on a clean fixture and 1 with the documented message on a planted closed list', () => {
    const clean = fixture({ [`${A}/ok.ts`]: "export type OpenKind = 'a' | (string & {});\n" });
    expect(run(['--root', clean]).status).toBe(0);

    const planted = fixture({ [`${A}/ids.ts`]: "export const WIDGET_KINDS = ['a', 'b'] as const;\n" });
    const result = run(['--root', planted]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WIDGET_KINDS');
    expect(result.stderr).toContain(`packages/${A}/ids.ts`);
    expect(result.stderr).toContain('open it with a registry, see docs/EXTENDING.md#open-an-id-vocabulary, or allowlist it with a reason');
  });

  it('--print lists the findings as allowlist entries and exits 0', () => {
    const planted = fixture({ [`${A}/ids.ts`]: "export const WIDGET_KINDS = ['a', 'b'] as const;\n" });
    const result = run(['--root', planted, '--print']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([{ file: `packages/${A}/ids.ts`, symbol: 'WIDGET_KINDS', reason: 'TODO' }]);
  });

  it('exits 2 on an unknown argument or a missing root', () => {
    expect(run(['--nope']).status).toBe(2);
    expect(run(['--root', join(tmpdir(), 'closed-lists-does-not-exist')]).status).toBe(2);
  });
});

describe('the real repository', () => {
  it('has no closed list outside the reviewed allowlist, and no stale entry', { timeout: 60_000 }, () => {
    const { violations, findings } = checkRepository(REAL_ROOT);
    expect(violations.map((v: { message: string }) => v.message)).toEqual([]);
    expect(findings.length).toBeGreaterThan(0);
  });
});

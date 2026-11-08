import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Text } from 'ink';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { resetCliConformanceSuitesForTests, runPlatformConformance, type ConformanceTestApi } from '../conformance.js';
import {
  checkDashboardReducer,
  checkTuiLabels,
  checkTuiLazy,
  checkTuiLoginGate,
  checkTuiMenu,
  checkTuiNoInkImport,
  checkTuiScreenRender,
  registerTuiConformance,
  type TuiConformanceOptions,
} from './conformance.js';
import { registerTuiMenuNode, resetTuiMenuRegistryForTests, type TuiMenuNode } from './menu-registry.js';
import { registerTuiScreen, resetTuiScreenRegistryForTests, type TuiScreenRegistration } from './screen-registry.js';

// =============================================================================
// The `tui` conformance suite  (RETRO-G1.5, #1069): green on a sound
// registration, and a precise message on each broken fixture.
// =============================================================================

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test', 'fixtures');

afterEach(() => {
  resetTuiMenuRegistryForTests();
  resetTuiScreenRegistryForTests();
  resetCliConformanceSuitesForTests();
});

function Fine(): ReactNode {
  return <Text>fine</Text>;
}
function Blank(): ReactNode {
  return <Text> </Text>;
}
function Crashes(): ReactNode {
  throw new Error('boom');
}
function Colourful(): ReactNode {
  return <Text color="red">colour</Text>;
}

const lazy = (route: string, component: () => ReactNode = Fine): TuiScreenRegistration => ({
  route,
  label: route,
  order: 100,
  load: async () => component,
});

describe('checkTuiMenu', () => {
  const screens = [lazy('reset'), lazy('inspect')];

  it('accepts a sound tree', () => {
    const nodes: TuiMenuNode[] = [
      { kind: 'section', id: 'tools', label: 'Tools', order: 1 },
      { kind: 'entry', id: 'tools-reset', parent: 'tools', route: 'reset', label: 'Reset', order: 1 },
    ];
    expect(checkTuiMenu(nodes, screens)).toEqual([]);
  });

  it('names an unknown route', () => {
    const nodes: TuiMenuNode[] = [{ kind: 'entry', id: 'bad', route: 'nowhere', label: 'Bad', order: 1 }];
    expect(checkTuiMenu(nodes, screens)).toEqual(['TUI menu entry "bad" opens unknown screen route "nowhere"; register it with registerTuiScreen.']);
  });

  it('names an unknown parent and a cycle, each once', () => {
    const nodes: TuiMenuNode[] = [
      { kind: 'section', id: 'a', parent: 'b', label: 'A', order: 1 },
      { kind: 'section', id: 'b', parent: 'a', label: 'B', order: 1 },
      { kind: 'entry', id: 'orphan', parent: 'ghost', route: 'reset', label: 'O', order: 1 },
    ];
    const problems = checkTuiMenu(nodes, screens);
    expect(problems.some((problem) => /cycle/.test(problem))).toBe(true);
    expect(problems).toContain('TUI menu node "orphan" has unknown parent "ghost".');
  });

  it('names nesting deeper than the cap', () => {
    const nodes: TuiMenuNode[] = [
      { kind: 'section', id: 's1', label: 'S1', order: 1 },
      { kind: 'section', id: 's2', parent: 's1', label: 'S2', order: 1 },
      { kind: 'section', id: 's3', parent: 's2', label: 'S3', order: 1 },
      { kind: 'section', id: 's4', parent: 's3', label: 'S4', order: 1 },
      { kind: 'section', id: 's5', parent: 's4', label: 'S5', order: 1 },
    ];
    expect(checkTuiMenu(nodes, screens).some((problem) => /nests 5 sections deep; the limit is 4/.test(problem))).toBe(true);
  });

  it('names a section nothing visible reaches', () => {
    const nodes: TuiMenuNode[] = [{ kind: 'section', id: 'empty', label: 'Empty', order: 1 }];
    expect(checkTuiMenu(nodes, screens)).toEqual([
      'TUI menu section "empty" is unreachable: it has no entry visible to a logged-in or a logged-out user.',
    ]);
  });
});

describe('checkTuiLazy', () => {
  it('names an eager screen and an eager section, and accepts allowEager', () => {
    const eager: TuiScreenRegistration = { route: 'eager', label: 'Eager', order: 1, component: Fine };
    const sections = [{ screen: 'node', id: 'note', component: Fine }];
    const problems = checkTuiLazy([eager, lazy('ok')], [], sections);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/TUI screen "eager" is registered with `component`.*Use `load/);
    expect(problems[1]).toMatch(/TUI section "node:note"/);
    expect(checkTuiLazy([eager], ['eager'], [])).toEqual([]);
  });
});

describe('checkTuiLabels', () => {
  it('names an empty and a throwing label for the login state that triggers it', () => {
    const nodes: TuiMenuNode[] = [{ kind: 'section', id: 'tools', label: ({ loggedIn }) => (loggedIn ? 'Tools' : ' '), order: 1 }];
    const screens: TuiScreenRegistration[] = [
      { route: 'x', label: () => { throw new Error('no label'); }, order: 1, load: async () => Fine },
    ];
    expect(checkTuiLabels(nodes, screens)).toEqual([
      'TUI menu section "tools" has an empty label when logged out.',
      `TUI screen "x"'s label function throws when logged in: no label`,
      `TUI screen "x"'s label function throws when logged out: no label`,
    ]);
  });
});

describe('checkDashboardReducer', () => {
  const base = {
    initial: () => ({ list: [] as number[], n: 0 }),
    hydrate: (state: { list: number[]; n: number }) => state,
    parseEvent: (frame: unknown) => frame as number,
  };

  it('accepts a pure reducer', () => {
    const reducer = { ...base, reduce: (state: { list: number[]; n: number }, event: number) => ({ list: [...state.list, event], n: state.n + 1 }) };
    expect(checkDashboardReducer({ id: 'pure', reducer, events: [1, 2] })).toEqual([]);
  });

  it('names a reducer that mutates its input', () => {
    const reducer = {
      ...base,
      reduce: (state: { list: number[]; n: number }, event: number) => {
        state.list.push(event);
        return state;
      },
    };
    const problems = checkDashboardReducer({ id: 'bad', reducer, events: [1] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Dashboard reducer "bad": reduce\(initial\(\), events\[0\]\) threw on a frozen input/);
  });

  it('names an initial() that returns a shared object', () => {
    const shared = { list: [] as number[], n: 0 };
    const reducer = { ...base, initial: () => shared, reduce: (state: typeof shared) => state };
    expect(checkDashboardReducer({ id: 'shared', reducer })[0]).toMatch(/initial\(\) returns the same object every call/);
  });
});

describe('checkTuiNoInkImport', () => {
  it('passes for a module that does not import ink', async () => {
    expect(await checkTuiNoInkImport([join(FIXTURES, 'pure.mjs')])).toEqual([]);
  });

  it('names a module that imports ink', async () => {
    const problems = await checkTuiNoInkImport([join(FIXTURES, 'imports-ink.mjs')]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/loads ink\. Registration modules must not import ink/);
  });

  it('reports an entry that cannot be resolved', async () => {
    expect((await checkTuiNoInkImport(['no-such-package-xyz']))[0]).toMatch(/Cannot resolve a no-ink entry/);
  });
});

describe('the render checks', () => {
  it('pass for a sound screen', async () => {
    expect(await checkTuiScreenRender(lazy('fine'), 24, undefined, undefined)).toEqual([]);
    expect(await checkTuiScreenRender(lazy('fine'), 80, 'mono', undefined)).toEqual([]);
  });

  it('name an empty frame and a crash', async () => {
    expect((await checkTuiScreenRender(lazy('blank', Blank), 80, undefined, undefined))[0]).toBe('TUI screen "blank" at 80 columns: rendered an empty frame.');
    expect((await checkTuiScreenRender(lazy('crash', Crashes), 40, undefined, undefined))[0]).toMatch(/TUI screen "crash" at 40 columns: crashed: boom/);
  });

  it('accept a colourful screen under the default theme (colour is the screen\'s to choose)', async () => {
    expect(await checkTuiScreenRender(lazy('c', Colourful), 80, undefined, undefined)).toEqual([]);
  });

  it('login gate: passes for a gated entry, names a route with no gate notice', async () => {
    registerTuiScreen(lazy('secret'));
    registerTuiMenuNode({ kind: 'entry', id: 'secret-entry', route: 'secret', label: 'Secret', order: 1 });
    expect(await checkTuiLoginGate('secret')).toEqual([]);
    // No entry gates it: the screen itself shows, which is the finding.
    registerTuiScreen(lazy('open'));
    expect((await checkTuiLoginGate('open'))[0]).toMatch(/TUI route "open" requires a login but showed no "not logged in" notice/);
  });
});

/** Runs a suite's cases the way the test runner would, collecting failures by case name. */
async function runCases(options: TuiConformanceOptions): Promise<Map<string, string | undefined>> {
  const cases: Array<[string, () => unknown]> = [];
  const api: ConformanceTestApi = {
    describe: (_name, body) => body(),
    it: (name, body) => void cases.push([name, body]),
    expect: (actual) => ({
      toEqual: (expected) => expect(actual).toEqual(expected),
    }),
  };
  registerTuiConformance(api, options);
  const results = new Map<string, string | undefined>();
  for (const [name, body] of cases) {
    try {
      await body();
      results.set(name, undefined);
    } catch (error) {
      results.set(name, (error as Error).message);
    }
  }
  return results;
}

describe('the tui suite', () => {
  it('is green on a sound set of registrations', async () => {
    const results = await runCases({
      screens: [lazy('one')],
      importEntries: [join(FIXTURES, 'pure.mjs')],
      nodes: [{ kind: 'entry', id: 'one-entry', route: 'one', label: 'One', order: 1, loggedOut: true }],
    });
    const failed = [...results].filter(([, message]) => message !== undefined);
    expect(failed).toEqual([]);
    expect([...results.keys()]).toEqual(
      expect.arrayContaining([
        'menu-references: every entry opens a registered screen, every section is reachable, no cycles, depth within the cap',
        'lazy-screens: every app screen and section loads lazily',
        'no-ink-import: importing the TUI entries loads no ink',
        'labels: every label is non-empty logged in and logged out',
        'screens-render: screen "one" renders at 80 columns',
        'no-color: screen "one" draws no colour under the monochrome theme',
      ]),
    );
  }, 60_000);

  it('fails each broken fixture with a precise message', async () => {
    const results = await runCases({
      screens: [{ route: 'eager', label: 'Eager', order: 1, component: Fine }, lazy('crash', Crashes)],
      nodes: [{ kind: 'entry', id: 'bad', route: 'nowhere', label: 'Bad', order: 1 }],
    });
    const message = (prefix: string): string | undefined => [...results].find(([name]) => name.startsWith(prefix))?.[1];
    expect(message('menu-references')).toContain('opens unknown screen route "nowhere"');
    expect(message('lazy-screens')).toContain('TUI screen "eager" is registered with `component`');
    expect(message('screens-render: screen "crash" renders at 80')).toContain('crashed: boom');
  }, 60_000);

  it('skips a check with a reason, and rejects a skip without one', async () => {
    const results = await runCases({ screens: [lazy('crash', Crashes)], skip: { 'screens-render': 'the screen needs a live server' } });
    expect([...results.keys()]).toContain('screens-render: skipped by the app (the screen needs a live server)');
    expect(() => registerTuiConformance({ describe: () => undefined, it: () => undefined, expect: () => ({ toEqual: () => undefined }) }, { skip: { labels: ' ' } })).toThrow(/skipped without a reason/);
    expect(() => registerTuiConformance({ describe: () => undefined, it: () => undefined, expect: () => ({ toEqual: () => undefined }) }, { skip: { nope: 'x' } as never })).toThrow(/unknown check "nope"/);
  });

  it('runs through runPlatformConformance under the key `tui`', () => {
    const names: string[] = [];
    runPlatformConformance({
      suites: { tui: { screens: [], nodes: [] } },
      testApi: { describe: (_name, body) => body(), it: (name) => void names.push(name), expect: () => ({ toEqual: () => undefined }) },
    });
    expect(names).toContain('labels: every label is non-empty logged in and logged out');
  });
});

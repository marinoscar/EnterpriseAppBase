import { Text } from 'ink';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { resetCliForTests, TEST_CLI_IDENTITY, useTestCliIdentity } from '../test-support.js';
import { createCli } from '../create-cli.js';
import { allTuiScreens } from './builtin-screens.js';
import {
  getTuiRootMenuSlots,
  registerTuiMenuNode,
  resetTuiMenuRegistryForTests,
  setTuiRootMenuSlots,
  type TuiMenuSlots,
} from './menu-registry.js';
import { buildTuiMenuTree, resolveTuiMenuSlot, visibleTuiMenuChildren } from './menu-tree.js';
import {
  freezeTuiScreenRegistry,
  hideTuiScreen,
  listHiddenTuiScreens,
  registerTuiScreen,
  resetTuiScreenRegistryForTests,
  tuiMenuScreens,
  type TuiScreenProps,
} from './screen-registry.js';
import { cleanup, frameLines, hasAnsi, renderTuiMenu, stripAnsi } from './testing/harness.js';

// =============================================================================
// Seam #1115: hide or replace a built-in screen, and the menu banner/footnote.
// (The per-check `tui` skip is in conformance.test.tsx, `pollFeed.refresh` in
// dashboard/source.test.ts.)
// =============================================================================

afterEach(() => {
  cleanup();
  resetCliForTests();
  // The menu frame needs an identity; the setup file's is gone after the reset.
  useTestCliIdentity(TEST_CLI_IDENTITY, '1.0.0');
  resetTuiMenuRegistryForTests();
  resetTuiScreenRegistryForTests();
});

function AppLogin(_props: TuiScreenProps): ReactNode {
  return <Text>Product X sign-in</Text>;
}

const rootRoutes = (): string[] =>
  visibleTuiMenuChildren('root', { loggedIn: true }, buildTuiMenuTree([], allTuiScreens())).map((node) =>
    node.kind === 'entry' ? node.route : node.id,
  );

describe('hiding a screen', () => {
  it('keeps a hidden built-in off the root menu but routable', () => {
    hideTuiScreen('jobs');
    hideTuiScreen('invoke');
    expect(listHiddenTuiScreens()).toEqual(['jobs', 'invoke']);
    expect(rootRoutes()).toEqual(['login', 'status', 'node', 'deploy', 'logout']);
    // The router still finds it, flagged hidden, so nav.push('jobs') works.
    expect(allTuiScreens().find((screen) => screen.route === 'jobs')).toMatchObject({ hidden: true });
  });

  it('lists a hidden screen where an entry opens it, once', () => {
    hideTuiScreen('status');
    const tree = buildTuiMenuTree(
      [
        { kind: 'section', id: 'tools', label: 'Tools', order: 5, loggedOut: true },
        { kind: 'entry', id: 'tools-status', parent: 'tools', route: 'status', label: 'Server status', order: 1 },
      ],
      allTuiScreens(),
    );
    expect(tree.entries.filter((entry) => entry.route === 'status').map((entry) => entry.id)).toEqual(['tools-status']);
  });

  it('honours `hidden: true` on an app registration', () => {
    registerTuiScreen({ route: 'wizard', label: 'Wizard', order: 70, hidden: true, load: async () => AppLogin });
    expect(rootRoutes()).not.toContain('wizard');
    expect(tuiMenuScreens().find((screen) => screen.route === 'wizard')).toMatchObject({ hidden: true });
  });

  it('rejects a malformed or reserved route, and an unknown one when createCli freezes', () => {
    expect(() => hideTuiScreen('Bad Route')).toThrow(/invalid/);
    expect(() => hideTuiScreen('menu')).toThrow(/reserved/);
    hideTuiScreen('nowhere');
    expect(() => freezeTuiScreenRegistry('createCli')).toThrow(/"nowhere" is hidden, but no built-in or registered screen/);
  });

  it('is an option of createCli', () => {
    createCli({ identity: TEST_CLI_IDENTITY, version: '1.0.0', tuiHiddenScreens: ['login', 'invoke', 'status', 'jobs', 'node', 'logout'] });
    expect(rootRoutes()).toEqual(['deploy']);
    expect(() => hideTuiScreen('deploy')).toThrow(/after createCli/);
  });
});

describe('replacing a built-in screen', () => {
  it('mounts the app screen under the built-in route, listed once', () => {
    registerTuiScreen({ route: 'login', label: 'Sign in', order: 10, replaceBuiltin: true, load: async () => AppLogin });
    const logins = allTuiScreens().filter((screen) => screen.route === 'login');
    expect(logins).toHaveLength(1);
    expect(logins[0]?.label).toBe('Sign in');
    expect(tuiMenuScreens().filter((screen) => screen.route === 'login')).toHaveLength(1);
    expect(rootRoutes().filter((route) => route === 'login')).toHaveLength(1);
  });

  it('still refuses a built-in route without the flag, and the flag on a non-built-in route', () => {
    expect(() => registerTuiScreen({ route: 'login', label: 'Sign in', order: 10, load: async () => AppLogin })).toThrow(/replaceBuiltin: true/);
    expect(() => registerTuiScreen({ route: 'about', label: 'About', order: 70, replaceBuiltin: true, load: async () => AppLogin })).toThrow(
      /no built-in screen has that route/,
    );
  });
});

describe('menu banner and footnote slots', () => {
  const screens = [{ route: 'status', label: 'Status', order: 10 }];
  const slots: TuiMenuSlots = {
    banner: { content: ({ columns }) => (columns >= 40 ? ['== Product X ==================================', 'control panel'] : 'Product X') },
    footnote: { content: ({ state }) => (state['update'] === undefined ? undefined : 'An update is available.'), color: 'warning' },
  };

  it('resolves content: strings, lists, newlines, functions; a throwing function draws nothing', () => {
    const context = { loggedIn: false, columns: 80, sectionId: 'root', state: {} };
    expect(resolveTuiMenuSlot(undefined, context)).toEqual([]);
    expect(resolveTuiMenuSlot({ content: 'one\ntwo' }, context)).toEqual(['one', 'two']);
    expect(resolveTuiMenuSlot({ content: ['a', 'b'] }, context)).toEqual(['a', 'b']);
    expect(resolveTuiMenuSlot({ content: ({ loggedIn }) => (loggedIn ? 'in' : 'out') }, context)).toEqual(['out']);
    expect(
      resolveTuiMenuSlot(
        {
          content: () => {
            throw new Error('boom');
          },
        },
        context,
      ),
    ).toEqual([]);
  });

  for (const columns of [80, 40, 24]) {
    for (const mono of [false, true]) {
      it(`renders the banner and footnote at ${columns} columns${mono ? ' in monochrome' : ''}`, async () => {
        const menu = await renderTuiMenu({
          screens,
          loggedIn: false,
          columns,
          rootSlots: slots,
          appState: { update: { version: '2.0.0' } },
          ...(mono ? { theme: 'mono' as const } : {}),
        });
        await menu.waitForFrame((frame) => frame.includes('Status'));
        const frame = menu.lastFrame() ?? '';
        const lines = frameLines(frame);
        const text = stripAnsi(frame);
        expect(text).toContain(columns >= 40 ? 'control panel' : 'Product X');
        expect(text).toContain(columns >= 40 ? 'An update' : 'An update');
        // Truncated, never wider than the terminal.
        for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
        // Order: banner, then the entries, then the footnote.
        const bannerAt = lines.findIndex((line) => line.includes('Product X') || line.includes('== Product'));
        const entryAt = lines.findIndex((line) => line.includes('Status'));
        const footAt = lines.findIndex((line) => line.includes('An update'));
        expect(bannerAt).toBeGreaterThan(-1);
        expect(bannerAt).toBeLessThan(entryAt);
        expect(footAt).toBeGreaterThan(entryAt);
        if (mono) expect(hasAnsi(frame)).toBe(false);
        menu.unmount();
      });
    }
  }

  it('draws nothing when the content function returns undefined', async () => {
    const menu = await renderTuiMenu({ screens, loggedIn: false, rootSlots: slots, appState: {}, theme: 'mono' });
    await menu.waitForFrame((frame) => frame.includes('Status'));
    expect(stripAnsi(menu.lastFrame() ?? '')).not.toContain('update');
    menu.unmount();
  });

  it('a section carries its own slots', async () => {
    const menu = await renderTuiMenu({
      screens,
      loggedIn: true,
      section: 'tools',
      nodes: [
        { kind: 'section', id: 'tools', label: 'Tools', order: 1, banner: { content: 'TOOLS BANNER' }, footnote: { content: 'Tools footnote' } },
        { kind: 'entry', id: 'tools-status', parent: 'tools', route: 'status', label: 'Status', order: 1 },
      ],
      theme: 'mono',
    });
    await menu.waitForFrame((frame) => frame.includes('Home › Tools'));
    const text = stripAnsi(menu.lastFrame() ?? '');
    expect(text).toContain('TOOLS BANNER');
    expect(text).toContain('Tools footnote');
    menu.unmount();
  });

  it('setTuiRootMenuSlots validates and freezes with createCli', () => {
    expect(() => setTuiRootMenuSlots({ banner: { content: 42 as never } })).toThrow(/invalid banner/);
    expect(() =>
      registerTuiMenuNode({ kind: 'section', id: 'bad', label: 'Bad', order: 1, footnote: {} as never }),
    ).toThrow(/invalid footnote/);
    createCli({ identity: TEST_CLI_IDENTITY, version: '1.0.0', tuiMenuRoot: { footnote: { content: 'hello' } } });
    expect(resolveTuiMenuSlot(getTuiRootMenuSlots().footnote, { loggedIn: false, columns: 80, sectionId: 'root', state: {} })).toEqual(['hello']);
    expect(() => setTuiRootMenuSlots({})).toThrow(/after createCli/);
  });
});

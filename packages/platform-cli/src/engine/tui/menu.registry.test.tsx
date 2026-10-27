import { Text } from 'ink';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { allTuiScreens, builtinTuiScreens } from './builtin-screens.js';
import { buildMenuItems } from './screens/menu.js';
import {
  BUILTIN_TUI_SCREENS,
  registerTuiScreen,
  resetTuiScreenRegistryForTests,
  sortTuiScreens,
  type TuiScreenProps,
} from './screen-registry.js';

// =============================================================================
// The TUI menu reads the screen registry  (PP-8.9, #715)
// =============================================================================

function AboutScreen({ onDone }: TuiScreenProps): ReactNode {
  void onDone;
  return <Text>About</Text>;
}

afterEach(() => resetTuiScreenRegistryForTests());

describe('the built-in screens', () => {
  it('register first, in the order the menu has always had', () => {
    expect(allTuiScreens().map((screen) => screen.route)).toEqual(['login', 'invoke', 'status', 'node', 'deploy', 'logout']);
  });

  it('each have a component and a label, from the one id list duplicates are checked against', () => {
    expect(builtinTuiScreens().map((screen) => screen.route)).toEqual(BUILTIN_TUI_SCREENS.map((screen) => screen.route));
    for (const screen of builtinTuiScreens()) expect(typeof screen.component).toBe('function');
  });

  it('keep the logged-in annotations, and Quit stays last', () => {
    expect(buildMenuItems(allTuiScreens(), { loggedIn: false }).map((item) => item.label)).toEqual([
      'Login',
      'Call an endpoint  (not logged in)',
      'Status',
      'Worker node  (this machine)',
      'Deploy  (this server)',
      'Logout  (nothing stored)',
      'Quit',
    ]);
    expect(buildMenuItems(allTuiScreens(), { loggedIn: true }).map((item) => item.label)).toEqual([
      'Login  (replace the stored token)',
      'Call an endpoint',
      'Status',
      'Worker node  (this machine)',
      'Deploy  (this server)',
      'Logout',
      'Quit',
    ]);
  });
});

describe('a registered screen', () => {
  it('appears in the menu at its order, before Quit, and its route selects it', () => {
    registerTuiScreen({ route: 'about', label: 'About this app', order: 35, component: AboutScreen });
    const items = buildMenuItems(allTuiScreens(), { loggedIn: false });
    expect(items.map((item) => item.value)).toEqual(['login', 'invoke', 'status', 'about', 'node', 'deploy', 'logout', 'quit']);
    expect(allTuiScreens().find((screen) => screen.route === 'about')?.component).toBe(AboutScreen);
  });

  it('can label itself from the login state', () => {
    registerTuiScreen({ route: 'sync', label: ({ loggedIn }) => (loggedIn ? 'Sync' : 'Sync  (not logged in)'), order: 70, component: AboutScreen });
    expect(buildMenuItems(allTuiScreens(), { loggedIn: false }).at(-2)?.label).toBe('Sync  (not logged in)');
  });

  it('may be loaded lazily, so ink stays out of every non-TUI run, but not both ways at once', async () => {
    registerTuiScreen({ route: 'lazy', label: 'Lazy', order: 80, load: async () => AboutScreen });
    const lazy = allTuiScreens().find((screen) => screen.route === 'lazy');
    expect(lazy?.component).toBeUndefined();
    expect(await lazy?.load?.()).toBe(AboutScreen);
    expect(() => registerTuiScreen({ route: 'both', label: 'x', order: 1, component: AboutScreen, load: async () => AboutScreen })).toThrow(
      /exactly one of component or load/,
    );
    expect(() => registerTuiScreen({ route: 'none', label: 'x', order: 1 })).toThrow(/exactly one of component or load/);
  });

  it('ties on order sort by route id, deterministically', () => {
    const sorted = sortTuiScreens([
      { route: 'b', order: 70 },
      { route: 'a', order: 70 },
      { route: 'c', order: 5 },
    ]);
    expect(sorted.map((screen) => screen.route)).toEqual(['c', 'a', 'b']);
  });

  it('is refused with a malformed, reserved, built-in or duplicate route', () => {
    const screen = { label: 'x', order: 1, component: AboutScreen };
    expect(() => registerTuiScreen({ ...screen, route: 'Bad Route' })).toThrow(/invalid/);
    expect(() => registerTuiScreen({ ...screen, route: 'menu' })).toThrow(/reserved/);
    expect(() => registerTuiScreen({ ...screen, route: 'quit' })).toThrow(/reserved/);
    expect(() => registerTuiScreen({ ...screen, route: 'login' })).toThrow(/built-in/);
    registerTuiScreen({ ...screen, route: 'about' });
    expect(() => registerTuiScreen({ ...screen, route: 'about' })).toThrow(/already registered/);
    expect(() => registerTuiScreen({ ...screen, route: 'nan', order: Number.NaN })).toThrow(/order/);
  });
});

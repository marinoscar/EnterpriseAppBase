import { createCli } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import {
  buildTuiMenuTree,
  listTuiMenuNodes,
  tuiBreadcrumb,
  tuiMenuItemLabel,
  tuiRouteRequiresLogin,
  visibleTuiMenuChildren,
  BUILTIN_TUI_SCREENS,
  listRegisteredTuiScreens,
} from '@marinoscar/platform-cli/tui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { nestedMenuNodes, nestedMenuScreens } from './nested-menu.tui.js';

// The registerTuiMenuNode example (RETRO-G1.1): registered, the screens it
// opens move under a "Tools" section, and a CLI without it is unchanged.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const tree = () =>
  buildTuiMenuTree(listTuiMenuNodes(), [
    ...BUILTIN_TUI_SCREENS.map(({ route, order }) => ({ route, order, label: route })),
    ...listRegisteredTuiScreens(),
  ]);

describe('nestedMenuNodes', () => {
  it('is not in the shipped menu', () => {
    createCli(APP_CLI_OPTIONS);
    expect(listTuiMenuNodes()).toEqual([]);
  });

  it('nests Inspect and Reset under Tools once passed in tuiMenu', () => {
    createCli({ ...APP_CLI_OPTIONS, tuiScreens: nestedMenuScreens, tuiMenu: nestedMenuNodes });
    const t = tree();
    expect(t.root.children.map((node) => node.id)).toEqual(['screen:login', 'screen:invoke', 'screen:status', 'screen:jobs', 'screen:node', 'screen:deploy', 'screen:logout', 'tools']);
    expect(visibleTuiMenuChildren('tools', { loggedIn: false }, t).map((node) => node.id)).toEqual(['tools-inspect', 'tools-reset']);
    expect(tuiBreadcrumb('tools', { loggedIn: false }, t)).toBe('Home › Tools');
    expect(tuiMenuItemLabel(t.entries.find((e) => e.id === 'tools-reset')!, 2)).toBe('2. Reset…');
  });

  it('gates only Reset behind a login', () => {
    createCli({ ...APP_CLI_OPTIONS, tuiScreens: nestedMenuScreens, tuiMenu: nestedMenuNodes });
    const t = tree();
    expect(tuiRouteRequiresLogin('tools-reset', t)).toBe(true);
    expect(tuiRouteRequiresLogin('tools-inspect', t)).toBe(false);
  });

  it('a node pointing at a missing screen fails createCli, naming the node', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, tuiMenu: nestedMenuNodes })).toThrow(/"tools-inspect" opens unknown screen route/);
  });
});

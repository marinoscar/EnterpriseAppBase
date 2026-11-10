import { createCli } from '@marinoscar/platform-cli';
import {
  buildTuiMenuTree,
  getTuiRootMenuSlots,
  listRegisteredTuiScreens,
  listTuiMenuNodes,
  resolveTuiMenuSlot,
  tuiMenuScreens,
  visibleTuiMenuChildren,
} from '@marinoscar/platform-cli/tui';
import { checkTuiLabels, checkTuiMenu, resetCliForTests } from '@marinoscar/platform-cli/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { customShellOptions } from './custom-shell.tui.js';

// The seam #1115 example: a replaced Login, hidden built-ins and a root banner.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const rootLabels = (loggedIn: boolean): string[] =>
  visibleTuiMenuChildren('root', { loggedIn }, buildTuiMenuTree(listTuiMenuNodes(), tuiMenuScreens())).map((node) =>
    typeof node.label === 'function' ? node.label({ loggedIn }) : node.label,
  );

describe('customShellOptions', () => {
  it('is not in the shipped CLI', () => {
    createCli(APP_CLI_OPTIONS);
    expect(rootLabels(false)).toEqual(expect.arrayContaining(['login', 'invoke', 'jobs']));
    expect(getTuiRootMenuSlots()).toEqual({});
  });

  it('lists the app sign-in in place of Login and hides invoke and jobs', () => {
    createCli({ ...APP_CLI_OPTIONS, ...customShellOptions });
    const labels = rootLabels(false);
    expect(labels[0]).toBe('Sign in');
    expect(labels).not.toContain('login');
    expect(labels).not.toContain('invoke');
    expect(labels).not.toContain('jobs');
    expect(labels).toEqual(expect.arrayContaining(['status', 'node', 'deploy', 'logout']));
  });

  it('draws a short banner on a narrow terminal and the footnote only with an update', () => {
    createCli({ ...APP_CLI_OPTIONS, ...customShellOptions });
    const { banner, footnote } = getTuiRootMenuSlots();
    const at = (columns: number, state: Record<string, unknown> = {}) => ({ loggedIn: false, columns, sectionId: 'root', state });
    expect(resolveTuiMenuSlot(banner, at(80))).toHaveLength(3);
    expect(resolveTuiMenuSlot(banner, at(24))).toEqual(['Product X']);
    expect(resolveTuiMenuSlot(footnote, at(80))).toEqual([]);
    expect(resolveTuiMenuSlot(footnote, at(80, { update: { version: '2.0.0' } }))[0]).toMatch(/update is available/);
  });

  it('passes the tui suite menu and label checks', () => {
    createCli({ ...APP_CLI_OPTIONS, ...customShellOptions });
    expect(checkTuiMenu(listTuiMenuNodes(), listRegisteredTuiScreens())).toEqual([]);
    expect(checkTuiLabels(listTuiMenuNodes(), listRegisteredTuiScreens())).toEqual([]);
  });
});

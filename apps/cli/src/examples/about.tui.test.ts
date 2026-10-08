import { createCli } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import { listRegisteredTuiScreens, registerTuiScreen, sortTuiScreens, BUILTIN_TUI_SCREENS } from '@marinoscar/platform-cli/tui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from '../app.js';

import { AboutScreen } from './about.screen.js';
import { aboutScreen } from './about.tui.js';

// The registerTuiScreen example (#715): registered, it is in the TUI menu
// after the built-ins, and its component loads on demand.

beforeEach(() => resetCliForTests());
afterEach(() => resetCliForTests());

const menu = (): string[] => sortTuiScreens([...BUILTIN_TUI_SCREENS, ...listRegisteredTuiScreens()]).map((s) => s.route);

describe('aboutScreen', () => {
  it('is not in the shipped menu', () => {
    createCli(APP_CLI_OPTIONS);
    expect(menu()).not.toContain('about');
  });

  it('appears in the TUI menu after Logout once passed in tuiScreens', () => {
    createCli({ ...APP_CLI_OPTIONS, tuiScreens: [aboutScreen] });
    expect(menu()).toEqual(['login', 'invoke', 'status', 'node', 'deploy', 'logout', 'about']);
  });

  it('is the same menu when registered with registerTuiScreen instead', () => {
    registerTuiScreen(aboutScreen);
    createCli(APP_CLI_OPTIONS);
    expect(menu().at(-1)).toBe('about');
  });

  it('loads its component lazily', async () => {
    expect(aboutScreen.component).toBeUndefined();
    expect(await aboutScreen.load?.()).toBe(AboutScreen);
  });

  it('a duplicate route throws at createCli', () => {
    expect(() => createCli({ ...APP_CLI_OPTIONS, tuiScreens: [aboutScreen, aboutScreen] })).toThrow(/already registered/);
  });
});

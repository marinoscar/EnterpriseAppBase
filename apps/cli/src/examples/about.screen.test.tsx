import { renderTuiScreen, stripAnsi } from '@marinoscar/platform-cli/tui/testing';
import { describe, expect, it } from 'vitest';

import { CLI_IDENTITY } from '../branding.js';

import { AboutScreen } from './about.screen.js';

// The TUI testing kit on an app screen (RETRO-G1.5): `renderTuiScreen` mounts the
// screen in a TuiAppProvider in test mode (an in-memory session, no real CLI
// config or token), `press` sends keys, `nav.stack` shows where Esc went.

describe('AboutScreen', () => {
  it('shows the app identity', async () => {
    const screen = await renderTuiScreen(AboutScreen);
    const frame = stripAnsi(screen.lastFrame() ?? '');
    expect(frame).toContain(CLI_IDENTITY.displayName);
    expect(frame).toContain(`https://github.com/${CLI_IDENTITY.repoSlug}`);
    screen.unmount();
  });

  it.each(['esc', 'q'] as const)('returns to the menu on %s', async (key) => {
    const screen = await renderTuiScreen(AboutScreen);
    expect(screen.nav.stack.map((frame) => frame.kind)).toEqual(['menu', 'screen']);
    await screen.press(key);
    await screen.waitForFrame((frame) => frame.includes('[back at the menu]'));
    expect(screen.nav.stack.map((frame) => frame.kind)).toEqual(['menu']);
    screen.unmount();
  });

  it('renders without colour under the monochrome theme and at a narrow width', async () => {
    const screen = await renderTuiScreen(AboutScreen, { theme: 'mono', columns: 24 });
    expect(screen.app().theme.color).toBe(false);
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain(CLI_IDENTITY.displayName);
    screen.unmount();
  });
});

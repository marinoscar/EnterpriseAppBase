// The shell's theme modes (PP-14.25): an open mode id, `registerThemeMode`, the
// provider's extra `themes`, and the tie to the stored `theme` user setting.

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { createTestPlatformHost } from '../../src/testing/index.js';
import { useUserSettings } from '../../src/settings/headless/index.js';
import { createShellTheme, registerThemeMode, useShellTheme } from '../../src/shell/headless/index.js';
import { listThemeModes, resetThemeModesForTests } from '../../src/shell/headless/theme.js';
import { ShellThemeProvider } from '../../src/shell/ui/index.js';

const light = createShellTheme('light');
const dark = createShellTheme('dark');
const highContrast = createShellTheme('dark', { palette: { primary: { main: '#ffff00' } } });
const sepia = createShellTheme('light', { palette: { primary: { main: '#704214' } } });

function Probe() {
  const { mode, isDarkMode, theme, modes } = useShellTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="dark">{String(isDarkMode)}</span>
      <span data-testid="primary">{theme.palette.primary.main}</span>
      <span data-testid="modes">{(modes ?? []).map((m) => `${m.id}=${m.label}`).join(',')}</span>
    </div>
  );
}

function Controls() {
  const { setMode, toggleMode } = useShellTheme();
  return (
    <>
      <button type="button" onClick={() => setMode('high-contrast')}>choose high contrast</button>
      <button type="button" onClick={() => setMode('ghost')}>choose ghost</button>
      <button type="button" onClick={toggleMode}>toggle</button>
    </>
  );
}

function mount(children: ReactNode = null, themes: Parameters<typeof ShellThemeProvider>[0]['themes'] = { light, dark }) {
  return render(
    <ShellThemeProvider themes={themes}>
      <Probe />
      <Controls />
      {children}
    </ShellThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetThemeModesForTests();
});
afterEach(() => resetThemeModesForTests());

describe('registerThemeMode', () => {
  it('lists the registered modes in registration order', () => {
    registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme: highContrast });
    registerThemeMode({ id: 'sepia', label: ' Sepia ', theme: sepia });
    expect(listThemeModes().map((mode) => `${mode.id}:${mode.label}`)).toEqual(['high-contrast:High contrast', 'sepia:Sepia']);
  });

  it.each([
    ['a built-in id', { id: 'dark', label: 'Dark', theme: dark }, /built-in/],
    ['a malformed id', { id: 'High Contrast', label: 'x', theme: dark }, /not a valid theme id/],
    ['a prototype key', { id: '__proto__', label: 'x', theme: dark }, /not a valid theme id/],
    ['no label', { id: 'sepia', label: '  ', theme: sepia }, /needs a label/],
    ['no theme', { id: 'sepia', label: 'Sepia', theme: undefined as never }, /needs a MUI theme/],
  ])('refuses %s', (_name, definition, message) => {
    expect(() => registerThemeMode(definition)).toThrow(message);
  });

  it('refuses a duplicate id', () => {
    registerThemeMode({ id: 'sepia', label: 'Sepia', theme: sepia });
    expect(() => registerThemeMode({ id: 'sepia', label: 'Again', theme: sepia })).toThrow(/already registered/);
  });
});

describe('ShellThemeProvider with extra modes', () => {
  it('keeps light, dark and system exactly as they were when nothing else is registered', async () => {
    mount();
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
    expect(screen.getByTestId('modes')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme_mode')).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'choose ghost' }));
    // An id nobody registered changes nothing.
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme_mode')).toBe('dark');
  });

  it('resolves a registered mode to its theme, counts as dark by the theme palette, and persists', async () => {
    registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme: highContrast });
    mount();
    expect(screen.getByTestId('modes')).toHaveTextContent('high-contrast=High contrast');
    await userEvent.click(screen.getByRole('button', { name: 'choose high contrast' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('high-contrast');
    expect(screen.getByTestId('primary')).toHaveTextContent('#ffff00');
    expect(screen.getByTestId('dark')).toHaveTextContent('true');
    expect(localStorage.getItem('theme_mode')).toBe('high-contrast');
    // The toggle flips from what is showing: a dark custom theme goes to light.
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('takes extra modes from the provider themes too, and they win over a registered mode of the same id', async () => {
    registerThemeMode({ id: 'high-contrast', label: 'Registered', theme: sepia });
    mount(null, { light, dark, 'high-contrast': highContrast });
    await userEvent.click(screen.getByRole('button', { name: 'choose high contrast' }));
    expect(screen.getByTestId('primary')).toHaveTextContent('#ffff00');
  });

  it('restores a stored custom mode on the next visit, and falls back to system for one it no longer has', () => {
    registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme: highContrast });
    localStorage.setItem('theme_mode', 'high-contrast');
    const first = mount();
    expect(screen.getByTestId('mode')).toHaveTextContent('high-contrast');
    first.unmount();

    localStorage.setItem('theme_mode', 'retired-theme');
    mount();
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
  });

  it('never reads a prototype member as a stored mode', () => {
    localStorage.setItem('theme_mode', 'constructor');
    mount();
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
  });
});

describe('the stored theme setting reaches the shell (registerThemePreference tie)', () => {
  it('applies a theme the document lists, through the shell setMode, and ignores one it does not', async () => {
    registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme: highContrast });
    const host = createTestPlatformHost({
      responses: {
        'GET /user-settings': {
          theme: 'high-contrast',
          themeOptions: [{ id: 'high-contrast', label: 'High contrast' }],
          profile: { imageSource: 'none', imageObjectId: null },
          version: 1,
          updatedAt: '',
        },
      },
    });
    let setModeRef: ((mode: string) => void) | undefined;
    function Capture() {
      setModeRef = useShellTheme().setMode;
      return null;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ShellThemeProvider themes={{ light, dark }}>
        <Probe />
        <Capture />
        {children}
      </ShellThemeProvider>
    );
    const { result } = renderHook(
      () => useUserSettings({ api: host.api, applyTheme: (theme) => setModeRef?.(theme) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.settings?.theme).toBe('high-contrast'));
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('high-contrast'));

    // An id with no registered theme is a no-op even if something forced it through.
    act(() => setModeRef?.('ghost'));
    expect(screen.getByTestId('mode')).toHaveTextContent('high-contrast');
  });
});

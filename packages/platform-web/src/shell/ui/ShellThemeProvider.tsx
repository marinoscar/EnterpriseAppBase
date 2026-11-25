// The shell's theme context (issue #868; moved from the reference app's
// `contexts/ThemeContext.tsx`): the viewer's light / dark / system choice,
// persisted in this browser, resolved against `prefers-color-scheme`.

import { useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ShellThemeContext, isBuiltinThemeMode, listThemeModes, useShellTheme } from '../headless/theme.js';
import type { ShellThemeContextValue, ShellThemeMode } from '../headless/theme.js';

/** The `localStorage` key the reference app has always used. */
const DEFAULT_STORAGE_KEY = 'theme_mode';

/** `mode` when it is built in or names a theme in `extra`, else `system`. */
function readStoredMode(storageKey: string, extra: Readonly<Record<string, Theme>>): ShellThemeMode {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null && (isBuiltinThemeMode(saved) || Object.prototype.hasOwnProperty.call(extra, saved))) return saved;
  } catch {
    // Storage blocked (a private window): fall through to the default.
  }
  return 'system';
}

/**
 * The app's themes: light and dark, and any number of further modes by id.
 *
 * The extra keys are theme MODES the viewer can choose (`setMode('high-contrast')`);
 * they are added to the ones registered with `registerThemeMode`, and a key here
 * wins over a registered mode of the same id. `light`, `dark` and `system` are
 * reserved: `system` has no entry because it picks `light` or `dark`.
 *
 * @stability experimental
 */
export interface ShellThemes {
  /** Shown for `light`, and for `system` when the OS prefers light. */
  light: Theme;
  /** Shown for `dark`, and for `system` when the OS prefers dark. */
  dark: Theme;
  /** Further modes by id. */
  [mode: string]: Theme;
}

/**
 * Props of {@link ShellThemeProvider}.
 *
 * @stability experimental
 */
export interface ShellThemeProviderProps {
  /** The two themes (`createShellTheme('light' | 'dark', ...)`); keep them module constants. */
  themes: ShellThemes;
  /** Where the choice is kept in `localStorage`. Default `'theme_mode'`. */
  storageKey?: string;
  /** The app. */
  children: ReactNode;
}

/**
 * Holds the viewer's theme choice (default `system`, persisted in
 * `localStorage`) and resolves it to one of `themes`. Read it with
 * `useShellTheme()`; it renders no MUI `ThemeProvider` itself (see
 * {@link ShellRoot} for both).
 *
 * @param props - see {@link ShellThemeProviderProps}.
 * @returns the provider element.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ShellThemeProvider({ themes, storageKey = DEFAULT_STORAGE_KEY, children }: ShellThemeProviderProps): ReactElement {
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  // The modes beyond light and dark: the registered ones, then the provider's own
  // (which win). Registered at module scope, so the registry is complete by the first render.
  const extraThemes = useMemo(() => {
    const extra = Object.create(null) as Record<string, Theme>;
    const labels = new Map<string, string>();
    for (const registered of listThemeModes()) {
      extra[registered.id] = registered.theme;
      labels.set(registered.id, registered.label);
    }
    for (const [id, extraTheme] of Object.entries(themes)) {
      if (id === 'light' || id === 'dark' || isBuiltinThemeMode(id)) continue;
      extra[id] = extraTheme;
      if (!labels.has(id)) labels.set(id, id);
    }
    return { themes: extra, modes: [...labels].map(([id, label]) => ({ id, label })) };
  }, [themes]);

  const [mode, setModeState] = useState<ShellThemeMode>(() => readStoredMode(storageKey, extraThemes.themes));

  const setMode = useCallback(
    (next: ShellThemeMode) => {
      // Only a built-in mode or a known theme can be chosen; anything else (a stored
      // preference for a theme this app does not ship) leaves the choice alone.
      if (!isBuiltinThemeMode(next) && !Object.prototype.hasOwnProperty.call(extraThemes.themes, next)) return;
      setModeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
    },
    [storageKey, extraThemes],
  );

  const custom = isBuiltinThemeMode(mode) ? undefined : extraThemes.themes[mode];
  // `system` follows the OS; so does a mode whose theme is no longer known.
  // A custom theme counts as dark by its own palette.
  const isDarkMode = custom ? custom.palette.mode === 'dark' : mode === 'dark' || (mode !== 'light' && prefersDarkMode);
  const resolved = custom ?? (isDarkMode ? themes.dark : themes.light);
  const toggleMode = useCallback(() => setMode(isDarkMode ? 'light' : 'dark'), [isDarkMode, setMode]);

  const modes = extraThemes.modes;
  const value = useMemo<ShellThemeContextValue>(
    () => ({ mode, theme: resolved, setMode, toggleMode, isDarkMode, modes }),
    [mode, resolved, setMode, toggleMode, isDarkMode, modes],
  );

  return <ShellThemeContext.Provider value={value}>{children}</ShellThemeContext.Provider>;
}

/** Applies the theme in context. */
function ShellMuiTheme({ children }: { children: ReactNode }): ReactElement {
  const { theme } = useShellTheme();
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

/**
 * The shell's root: {@link ShellThemeProvider} plus MUI's `ThemeProvider` and
 * `CssBaseline` for the resolved theme. Mount it once, around the router.
 *
 * @param props - see {@link ShellThemeProviderProps}.
 * @returns the root element.
 *
 * @example
 * ```tsx
 * <ShellRoot themes={{ light: lightTheme, dark: darkTheme }}>
 *   <BrowserRouter><App /></BrowserRouter>
 * </ShellRoot>
 * ```
 *
 * @stability experimental
 */
export function ShellRoot(props: ShellThemeProviderProps): ReactElement {
  const { children, ...rest } = props;
  return (
    <ShellThemeProvider {...rest}>
      <ShellMuiTheme>{children}</ShellMuiTheme>
    </ShellThemeProvider>
  );
}

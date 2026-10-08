// The shell's theme context (issue #868; moved from the reference app's
// `contexts/ThemeContext.tsx`): the viewer's light / dark / system choice,
// persisted in this browser, resolved against `prefers-color-scheme`.

import { useMediaQuery } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ShellThemeContext, useShellTheme } from '../headless/theme.js';
import type { ShellThemeContextValue, ShellThemeMode } from '../headless/theme.js';

/** The `localStorage` key the reference app has always used. */
const DEFAULT_STORAGE_KEY = 'theme_mode';

function readStoredMode(storageKey: string): ShellThemeMode {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Storage blocked (a private window): fall through to the default.
  }
  return 'system';
}

/**
 * The app's two themes.
 *
 * @stability experimental
 */
export interface ShellThemes {
  /** Shown for `light`, and for `system` when the OS prefers light. */
  light: Theme;
  /** Shown for `dark`, and for `system` when the OS prefers dark. */
  dark: Theme;
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
  const [mode, setModeState] = useState<ShellThemeMode>(() => readStoredMode(storageKey));

  const setMode = useCallback(
    (next: ShellThemeMode) => {
      setModeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
    },
    [storageKey],
  );

  const isDarkMode = mode === 'system' ? prefersDarkMode : mode === 'dark';
  const theme = isDarkMode ? themes.dark : themes.light;
  const toggleMode = useCallback(() => setMode(isDarkMode ? 'light' : 'dark'), [isDarkMode, setMode]);

  const value = useMemo<ShellThemeContextValue>(
    () => ({ mode, theme, setMode, toggleMode, isDarkMode }),
    [mode, theme, setMode, toggleMode, isDarkMode],
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

// =============================================================================
// The shell's theme (issue #868; moved from the reference app's `theme/` and
// `contexts/ThemeContext.tsx`)
// =============================================================================
//
// Two MUI themes (light and dark) built from one base (Inter, 600-weight
// headings, 8px radius, no-uppercase buttons, flat AppBar with a hairline),
// plus the context the AppBar's toggle and the Appearance page read. The app
// keeps its brand: `palette.primary.main` comes from its identity, and
// `extend` lets it add token contracts (the telemetry slice's
// `withTelemetryTokens`) without the shell depending on them.
// =============================================================================

import { createContext, useContext } from 'react';
import { createTheme } from '@mui/material/styles';
import type { Components, PaletteOptions, Theme, ThemeOptions } from '@mui/material/styles';

/**
 * The viewer's theme choice. `system` follows `prefers-color-scheme`.
 *
 * @stability experimental
 */
export type ShellThemeMode = 'light' | 'dark' | 'system';

const LIGHT_PALETTE: PaletteOptions = {
  primary: { main: '#1976d2', light: '#42a5f5', dark: '#1565c0' },
  secondary: { main: '#9c27b0', light: '#ba68c8', dark: '#7b1fa2' },
  background: { default: '#f5f5f5', paper: '#ffffff' },
  text: { primary: 'rgba(0, 0, 0, 0.87)', secondary: 'rgba(0, 0, 0, 0.6)' },
};

const DARK_PALETTE: PaletteOptions = {
  primary: { main: '#90caf9', light: '#e3f2fd', dark: '#42a5f5' },
  secondary: { main: '#ce93d8', light: '#f3e5f5', dark: '#ab47bc' },
  background: { default: '#121212', paper: '#1e1e1e' },
  text: { primary: '#ffffff', secondary: 'rgba(255, 255, 255, 0.7)' },
};

const BASE_THEME: ThemeOptions = {
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 8,
  },
};

type PaletteGroup = 'primary' | 'secondary' | 'background' | 'text';
const MERGED_GROUPS: readonly PaletteGroup[] = ['primary', 'secondary', 'background', 'text'];

/**
 * The shell's palette for `mode`, with `overrides` merged one level deep into
 * `primary`, `secondary`, `background` and `text` (so `{ primary: { main } }`
 * keeps the hand-picked `light` and `dark` tints) and shallowly elsewhere.
 *
 * @param mode - `light` or `dark`.
 * @param overrides - the app's palette changes (its brand colour).
 * @returns the palette options.
 *
 * @stability experimental
 */
export function shellPalette(mode: 'light' | 'dark', overrides: PaletteOptions = {}): PaletteOptions {
  const base = mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
  const merged: Record<string, unknown> = { ...base, ...overrides };
  for (const group of MERGED_GROUPS) {
    const override = overrides[group];
    if (override !== undefined && typeof override === 'object') {
      merged[group] = { ...(base[group] as object), ...(override as object) };
    }
  }
  return merged as PaletteOptions;
}

/**
 * The shell's component overrides for `mode`: no-uppercase 500-weight
 * buttons, a soft card shadow, and a flat AppBar with a 1px bottom border.
 *
 * @param mode - `light` or `dark`.
 * @returns the MUI component overrides.
 *
 * @stability experimental
 */
export function shellComponentOverrides(mode: 'light' | 'dark'): Components<Theme> {
  return {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: mode === 'light' ? '0 2px 8px rgba(0, 0, 0, 0.1)' : '0 2px 8px rgba(0, 0, 0, 0.3)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderBottom: `1px solid ${mode === 'light' ? '#e0e0e0' : '#333333'}`,
        },
      },
    },
  };
}

/**
 * Options of {@link createShellTheme}.
 *
 * @stability experimental
 */
export interface ShellThemeOptions {
  /** Palette changes, merged by {@link shellPalette} (the app's brand colour). */
  palette?: PaletteOptions;
  /** Applied to the built theme last (e.g. the telemetry slice's `withTelemetryTokens`). */
  extend?: (theme: Theme) => Theme;
}

/**
 * Build the shell's MUI theme for `mode`.
 *
 * @param mode - `light` or `dark`.
 * @param options - the app's palette changes and a final `extend` step.
 * @returns the theme.
 *
 * @example
 * ```ts
 * export const lightTheme = createShellTheme('light', { palette: { primary: { main: THEME_COLOR } }, extend: withTelemetryTokens });
 * export const darkTheme = createShellTheme('dark', { extend: withTelemetryTokens });
 * ```
 *
 * @extensionPoint theme-token
 * @stability experimental
 */
export function createShellTheme(mode: 'light' | 'dark', options: ShellThemeOptions = {}): Theme {
  const theme = createTheme({
    ...BASE_THEME,
    palette: {
      mode,
      ...shellPalette(mode, options.palette),
    },
    components: shellComponentOverrides(mode),
  });
  return options.extend ? options.extend(theme) : theme;
}

/**
 * What the shell's theme context holds.
 *
 * @stability experimental
 */
export interface ShellThemeContextValue {
  /** The viewer's choice. */
  mode: ShellThemeMode;
  /** The resolved MUI theme. */
  theme: Theme;
  /** Choose a mode (persisted in this browser). */
  setMode(mode: ShellThemeMode): void;
  /** Flip between light and dark (from whatever is showing now). */
  toggleMode(): void;
  /** Whether the dark theme is showing. */
  isDarkMode: boolean;
}

/**
 * The context `ShellThemeProvider` (`@marinoscar/platform-web/shell/ui`) fills.
 *
 * @stability experimental
 */
export const ShellThemeContext = createContext<ShellThemeContextValue | null>(null);
ShellThemeContext.displayName = 'ShellThemeContext';

/**
 * The shell's theme context, or `null` outside a `ShellThemeProvider` (the
 * AppBar then draws no theme toggle).
 *
 * @returns the context value, or `null`.
 *
 * @stability experimental
 */
export function useOptionalShellTheme(): ShellThemeContextValue | null {
  return useContext(ShellThemeContext);
}

/**
 * The shell's theme context: the mode, the resolved theme and the setters.
 *
 * @returns the context value.
 * @throws Error outside a `ShellThemeProvider`.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useShellTheme(): ShellThemeContextValue {
  const context = useContext(ShellThemeContext);
  if (!context) {
    throw new Error(
      'useShellTheme must be used within a ShellThemeProvider (@marinoscar/platform-web/shell/ui).',
    );
  }
  return context;
}

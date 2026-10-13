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

import { THEME_PREFERENCE_ID_PATTERN } from '@marinoscar/platform-contract/settings';
import { createContext, useContext } from 'react';
import { createTheme } from '@mui/material/styles';
import type { Components, PaletteOptions, Theme, ThemeOptions } from '@mui/material/styles';

/**
 * The viewer's theme choice: `light`, `dark`, `system` (follows
 * `prefers-color-scheme`), or the id of a theme the app registered with
 * {@link registerThemeMode} or passed to the provider's `themes` (a
 * `high-contrast` theme, a brand skin). The id is the same one the API accepts
 * for the `theme` user setting when the app registered it there with
 * `registerThemePreference`.
 *
 * @stability experimental
 */
export type ShellThemeMode = 'light' | 'dark' | 'system' | (string & {});

/**
 * The three modes the shell always has: `light`, `dark` and `system`. A theme
 * registered under one of these ids is refused.
 *
 * @stability experimental
 */
export const BUILTIN_SHELL_THEME_MODES = ['light', 'dark', 'system'] as const;

/**
 * Whether `mode` is one of {@link BUILTIN_SHELL_THEME_MODES}.
 *
 * @param mode - a mode id.
 * @returns whether it is built in.
 *
 * @stability experimental
 */
export function isBuiltinThemeMode(mode: string): mode is (typeof BUILTIN_SHELL_THEME_MODES)[number] {
  return (BUILTIN_SHELL_THEME_MODES as readonly string[]).includes(mode);
}

/**
 * One theme an app added to the shell's modes.
 *
 * @stability experimental
 */
export interface ShellThemeModeDefinition {
  /** The mode id: lower-case, starting with a letter, 2 to 48 characters (the API's theme id pattern). */
  id: string;
  /** What a theme picker calls it. */
  label: string;
  /** The MUI theme shown while the mode is chosen. Its `palette.mode` decides whether the app counts as dark (the AppBar toggle's icon). */
  theme: Theme;
}

const themeModes = new Map<string, ShellThemeModeDefinition>();

/**
 * Add a theme mode to the shell: after this, `setMode(id)` of the theme context
 * chooses it, the stored choice is restored on the next visit, and
 * `ShellThemeProvider` resolves it to `theme`. Register at module scope, before
 * the first render, next to the app's own themes.
 *
 * To let a user pick it on the Appearance page, register the same id on the API
 * with `registerThemePreference` (`@marinoscar/platform-api/settings`): the
 * settings document then lists it in `themeOptions`, and the packaged settings
 * hook hands a stored value to the host's `applyTheme` (the app's `setMode`).
 *
 * @param definition - the id, label and theme.
 * @throws Error when the id is malformed, built in or already registered, the label is empty or the theme is missing.
 *
 * @example
 * ```ts
 * registerThemeMode({ id: 'high-contrast', label: 'High contrast', theme: highContrastTheme });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerThemeMode(definition: ShellThemeModeDefinition): void {
  const { id, label, theme } = definition;
  if (typeof id !== 'string' || !THEME_PREFERENCE_ID_PATTERN.test(id)) {
    throw new Error(`registerThemeMode: "${String(id)}" is not a valid theme id (lower-case, starts with a letter, 2 to 48 characters of a-z, 0-9 and -)`);
  }
  if (isBuiltinThemeMode(id)) throw new Error(`registerThemeMode: "${id}" is a built-in mode`);
  if (themeModes.has(id)) throw new Error(`registerThemeMode: a theme mode "${id}" is already registered`);
  if (typeof label !== 'string' || label.trim() === '') throw new Error(`registerThemeMode: the theme mode "${id}" needs a label`);
  if (!theme || typeof theme !== 'object' || !theme.palette) throw new Error(`registerThemeMode: the theme mode "${id}" needs a MUI theme`);
  themeModes.set(id, { id, label: label.trim(), theme });
}

/**
 * The theme modes registered with {@link registerThemeMode}, in registration order.
 *
 * @returns a fresh array.
 *
 * @stability experimental
 */
export function listThemeModes(): ShellThemeModeDefinition[] {
  return [...themeModes.values()];
}

/**
 * Forget every registered theme mode. For tests only.
 *
 * @internal
 */
export function resetThemeModesForTests(): void {
  themeModes.clear();
}

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
 * One theme mode beyond light, dark and system, as a picker lists it.
 *
 * @stability experimental
 */
export interface ShellThemeModeOption {
  /** The mode id, what `setMode` takes. */
  id: string;
  /** What a picker calls it. */
  label: string;
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
  /**
   * The themes beyond light, dark and system that can be chosen (the provider's
   * extra `themes` and the registered ones), for a picker. Absent from a context
   * value built by hand.
   */
  modes?: readonly ShellThemeModeOption[];
  /**
   * Choose a mode (persisted in this browser). An id that is neither built in
   * nor a known theme is ignored.
   */
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

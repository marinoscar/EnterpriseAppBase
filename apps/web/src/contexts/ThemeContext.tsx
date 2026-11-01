/**
 * The app's theme context — a binding of the packaged shell's
 * `ShellThemeProvider` (`@marinoscar/platform-web/shell/ui`, issue #868) over
 * this app's two themes (`theme/index.ts`). The viewer's light / dark /
 * system choice is kept in `localStorage` (`theme_mode`), `system` follows
 * `prefers-color-scheme`, and the AppBar's toggle and the Appearance page read
 * the same context.
 */
import type { ReactNode } from 'react';
import { ShellThemeProvider } from '@marinoscar/platform-web/shell/ui';
import { useOptionalShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellThemeContextValue } from '@marinoscar/platform-web/shell/headless';

import { APP_THEMES } from '../theme';

type ThemeContextValue = ShellThemeContextValue;

interface ThemeContextProviderProps {
  children: ReactNode;
}

export function ThemeContextProvider({ children }: ThemeContextProviderProps) {
  return <ShellThemeProvider themes={APP_THEMES}>{children}</ShellThemeProvider>;
}

export function useThemeContext(): ThemeContextValue {
  const context = useOptionalShellTheme();
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeContextProvider');
  }
  return context;
}

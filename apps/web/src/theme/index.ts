import { THEME_COLOR } from '@app/shared';
import { createShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellThemeMode } from '@marinoscar/platform-web/shell/headless';
// The telemetry token contract (#686) and its MUI augmentation ship with the
// telemetry slice (#704); importing it brings the `palette.status` and
// `palette.chart` types with it.
import { withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';

/**
 * The app's two themes: the packaged shell's (`createShellTheme`, issue #868:
 * Inter, 600-weight headings, 8px radius, the shell's palettes and component
 * overrides) with this app's brand colour, and both carrying the telemetry
 * token contract (`palette.status`, `palette.chart.series`, issue #686).
 *
 * Issue #216: the brand colour is `THEME_COLOR` in `packages/shared/index.js`,
 * not a literal here, so a rebrand restyles the app and the installed-app
 * surfaces together. Only `primary.main` is replaced: the hand-picked `light`
 * and `dark` tints stay (MUI would otherwise derive a different pair).
 */
export const lightTheme = createShellTheme('light', {
  palette: { primary: { main: THEME_COLOR } },
  extend: withTelemetryTokens,
});

export const darkTheme = createShellTheme('dark', { extend: withTelemetryTokens });

/** Both, for `ThemeContextProvider`. */
export const APP_THEMES = { light: lightTheme, dark: darkTheme } as const;

export type ThemeMode = ShellThemeMode;

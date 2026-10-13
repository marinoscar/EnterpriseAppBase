/**
 * Reference example (PP-14.25): an app adds a high-contrast theme mode to the
 * shell, and the stored user setting reaches it.
 *
 * Two halves share one id, `high-contrast`:
 *
 *   - the API lists it as a theme the user setting accepts
 *     (`registerThemePreference` in `apps/api/src/platform-extensions/settings/examples/profile-timezone.ts`),
 *     so the Appearance page offers it from the settings document's `themeOptions`;
 *   - the web registers the MUI theme under the same id with `registerThemeMode`,
 *     so `setMode('high-contrast')` of the shell's theme context shows it, the
 *     choice is restored on the next visit, and the packaged settings hook hands
 *     a stored `high-contrast` to the host's `applyTheme` (the app's `setMode`).
 *
 * Call `registerHighContrastTheme()` at module scope next to the app's themes
 * (`theme/index.ts`), before the first render. The reference app does not: it
 * ships compiled and tested, like the other web examples.
 */
import { createTheme } from '@mui/material/styles';
import { createShellTheme, registerThemeMode } from '@marinoscar/platform-web/shell/headless';
// Every theme the app ships carries the telemetry token contract (`palette.status`, `palette.chart`), or the telemetry pages cannot draw under it.
import { withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';

/** The mode id, the same one the API registers. */
export const HIGH_CONTRAST_MODE_ID = 'high-contrast';

/** White text on black at AAA contrast, a yellow accent and strong borders. Built on the shell's dark theme, so the surfaces are black. */
export const highContrastTheme = createShellTheme('dark', {
  palette: {
    primary: { main: '#ffeb3b', light: '#fff59d', dark: '#fbc02d' },
    secondary: { main: '#00e5ff' },
    background: { default: '#000000', paper: '#000000' },
    text: { primary: '#ffffff', secondary: '#ffffff' },
  },
  extend: (theme) =>
    createTheme(withTelemetryTokens(theme), {
      components: {
        MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700, border: '2px solid currentColor' } } },
        MuiOutlinedInput: { styleOverrides: { notchedOutline: { borderWidth: 2, borderColor: '#ffffff' } } },
      },
    }),
});

/** Registers the mode with the shell. Call once, at module scope. */
export function registerHighContrastTheme(): void {
  registerThemeMode({ id: HIGH_CONTRAST_MODE_ID, label: 'High contrast', theme: highContrastTheme });
}

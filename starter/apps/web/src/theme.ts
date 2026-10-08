import { BACKGROUND_COLOR, THEME_COLOR } from '@app/shared';
import { createTheme, type Theme } from '@mui/material/styles';
import { withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';

/**
 * The app owns its theme. The brand colour comes from identity.json; the
 * platform's telemetry tokens (used by the packaged pages) take their defaults.
 */
export function createAppTheme(mode: 'light' | 'dark' = 'light'): Theme {
  return withTelemetryTokens(
    createTheme({
      palette: {
        mode,
        primary: { main: THEME_COLOR },
        ...(mode === 'light' ? { background: { default: BACKGROUND_COLOR, paper: '#ffffff' } } : {}),
      },
      shape: { borderRadius: 10 },
    }),
  );
}

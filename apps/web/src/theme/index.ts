import { createTheme, ThemeOptions } from '@mui/material/styles';
import { lightPalette } from './light';
import { darkPalette } from './dark';
import { componentOverrides } from './components';
// The telemetry token contract (#686) and its MUI augmentation ship with the
// telemetry slice (#704); importing it brings the `palette.status` and
// `palette.chart` types with it.
import { withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';

const baseTheme: ThemeOptions = {
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

// Both themes carry the telemetry token contract (`palette.status`,
// `palette.chart.series`, issue #686); see `@marinoscar/platform-web/telemetry`.
export const lightTheme = withTelemetryTokens(createTheme({
  ...baseTheme,
  palette: {
    mode: 'light',
    ...lightPalette,
  },
  components: componentOverrides('light'),
}));

export const darkTheme = withTelemetryTokens(createTheme({
  ...baseTheme,
  palette: {
    mode: 'dark',
    ...darkPalette,
  },
  components: componentOverrides('dark'),
}));

export type ThemeMode = 'light' | 'dark' | 'system';

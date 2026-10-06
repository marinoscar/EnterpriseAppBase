import { createTheme, ThemeOptions } from '@mui/material/styles';
import { lightPalette } from './light';
import { darkPalette } from './dark';
import { componentOverrides } from './components';
import './augment';
import { withTelemetryTokens } from './telemetryTokens';

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
// `palette.chart.series`, issue #686); see `telemetryTokens.ts`.
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

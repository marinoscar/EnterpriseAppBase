/**
 * The telemetry UI's theme-token contract (issue #686, platform-packages
 * PP-1.15): `palette.status.{ok,warn,crit,info,neutral}` and
 * `palette.chart.series`, declared in `augment.ts`.
 *
 * Packages own structure, apps own appearance: the telemetry UI never reads a
 * raw MUI palette role (`success`, `error`, `warning`, `info`, `secondary`,
 * `grey`) to mean "status" or "chart series". It reads these tokens, and an
 * app restyles it by setting them in its own theme.
 *
 * Rule: series tokens are never used for status, and status tokens are never
 * used as a series colour.
 *
 * Defaults derive from the theme's own palette, so a theme that sets nothing
 * looks exactly as it did before the tokens existed:
 *
 * | Token            | Default                                                    |
 * |------------------|------------------------------------------------------------|
 * | `status.ok`      | `palette.success.main`                                     |
 * | `status.warn`    | `palette.warning.main`                                     |
 * | `status.crit`    | `palette.error.main`                                       |
 * | `status.info`    | `palette.info.main`                                        |
 * | `status.neutral` | `palette.grey[500]`                                        |
 * | `chart.series`   | `primary, secondary, warning, success, error, info` `.main`, then `grey[500]`, `text.primary` |
 *
 * Kept under `theme/` so it moves with the telemetry UI into its package (#704).
 */
import './augment';
import { useMemo } from 'react';
import { useTheme, type PaletteChart, type PaletteStatus, type Theme } from '@mui/material/styles';

export interface TelemetryTokens {
  status: PaletteStatus;
  chart: PaletteChart;
}

type MaybeTokens = { status?: Partial<PaletteStatus>; chart?: Partial<PaletteChart> };

function defaultStatus(theme: Theme): PaletteStatus {
  const { palette } = theme;
  return {
    ok: palette.success.main,
    warn: palette.warning.main,
    crit: palette.error.main,
    info: palette.info.main,
    neutral: palette.grey[500],
  };
}

function defaultSeries(theme: Theme): string[] {
  const { palette } = theme;
  // Distinct hues first (primary and info are both blue in the base theme).
  return [
    palette.primary.main,
    palette.secondary.main,
    palette.warning.main,
    palette.success.main,
    palette.error.main,
    palette.info.main,
    palette.grey[500],
    palette.text.primary,
  ];
}

/**
 * Pure accessor: the theme's telemetry tokens, with every missing token
 * derived from its palette. For code that receives a theme which may not
 * have been through {@link withTelemetryTokens} (a test's `createTheme()`,
 * MUI's default theme outside any provider). Never mutates `theme`.
 */
export function telemetryTokens(theme: Theme): TelemetryTokens {
  const own = theme.palette as unknown as MaybeTokens;
  const status: PaletteStatus = { ...defaultStatus(theme) };
  for (const [key, value] of Object.entries(own.status ?? {})) {
    if (typeof value === 'string' && value !== '') status[key as keyof PaletteStatus] = value;
  }
  const series = own.chart?.series;
  return {
    status,
    chart: {
      ...own.chart,
      series: Array.isArray(series) && series.length > 0 ? [...series] : defaultSeries(theme),
    },
  };
}

/**
 * Pure and idempotent: a copy of `theme` whose `palette.status` and
 * `palette.chart` are complete. Tokens the app already set win; missing ones
 * derive from the theme's own palette (see the table above). The input theme
 * is not mutated, and nothing else in it changes.
 */
export function withTelemetryTokens(theme: Theme): Theme {
  const tokens = telemetryTokens(theme);
  return {
    ...theme,
    palette: {
      ...theme.palette,
      status: tokens.status,
      chart: tokens.chart,
    },
  };
}

/** The telemetry tokens of the theme in context (`useTheme()` + {@link telemetryTokens}). */
export function useTelemetryTokens(): TelemetryTokens {
  const theme = useTheme();
  return useMemo(() => telemetryTokens(theme), [theme]);
}

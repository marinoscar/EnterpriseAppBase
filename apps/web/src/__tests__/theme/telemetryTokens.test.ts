/**
 * The app's two themes go through the packaged token contract (#686, #704):
 * `withTelemetryTokens` from `@marinoscar/platform-web/telemetry/headless`
 * fills `palette.status` and `palette.chart.series` from each theme's own
 * palette, so the telemetry UI renders exactly the colours it did before the
 * tokens existed (the visual baselines depend on it).
 */
import { describe, expect, it } from 'vitest';
import type { Theme } from '@mui/material/styles';
import { telemetryTokens } from '@marinoscar/platform-web/telemetry/headless';

import { darkTheme, lightTheme } from '../../theme';

function legacyReads(theme: Theme) {
  const p = theme.palette;
  return {
    status: { ok: p.success.main, warn: p.warning.main, crit: p.error.main, info: p.info.main, neutral: p.grey[500] },
    series: [p.primary.main, p.secondary.main, p.warning.main, p.success.main, p.error.main, p.info.main, p.grey[500], p.text.primary],
  };
}

describe.each([
  ['lightTheme', lightTheme],
  ['darkTheme', darkTheme],
])('%s', (_name, theme) => {
  it('carries complete telemetry tokens, typed by the package augmentation', () => {
    expect(Object.keys(theme.palette.status).sort()).toEqual(['crit', 'info', 'neutral', 'ok', 'warn']);
    expect(theme.palette.chart.series.length).toBe(8);
  });

  it('defaults every token to the palette read it replaced', () => {
    const legacy = legacyReads(theme);
    expect(theme.palette.status).toEqual(legacy.status);
    expect(theme.palette.chart.series).toEqual(legacy.series);
    expect(telemetryTokens(theme)).toEqual({ status: legacy.status, chart: { series: legacy.series } });
  });
});

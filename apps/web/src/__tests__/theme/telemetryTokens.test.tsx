/**
 * The telemetry theme-token contract (issue #686): `palette.status` and
 * `palette.chart.series` exist on both app themes, default to the exact
 * palette reads the telemetry UI used before the tokens (so nothing renders
 * differently), let an app's own values win, and are applied purely.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { darkTheme, lightTheme } from '../../theme';
import { telemetryTokens, useTelemetryTokens, withTelemetryTokens } from '../../theme/telemetryTokens';

/** What the telemetry UI read before #686, straight off the palette. */
function legacyReads(theme: Theme) {
  const p = theme.palette;
  return {
    status: {
      ok: p.success.main,
      warn: p.warning.main,
      crit: p.error.main,
      info: p.info.main,
      neutral: p.grey[500],
    },
    series: [
      p.primary.main,
      p.secondary.main,
      p.warning.main,
      p.success.main,
      p.error.main,
      p.info.main,
      p.grey[500],
      p.text.primary,
    ],
  };
}

/** Every serialisable part of a theme except the two token roles. */
function withoutTokens(theme: Theme): unknown {
  const { status: _status, chart: _chart, ...palette } = theme.palette as Theme['palette'] & Record<string, unknown>;
  return JSON.parse(JSON.stringify({ ...theme, palette }));
}

describe.each([
  ['lightTheme', lightTheme],
  ['darkTheme', darkTheme],
])('%s', (_name, theme) => {
  it('carries the tokens on its palette, typed', () => {
    const { status, chart } = theme.palette;
    expect(Object.keys(status).sort()).toEqual(['crit', 'info', 'neutral', 'ok', 'warn']);
    expect(chart.series.length).toBeGreaterThan(0);
  });

  it('defaults every token to the palette read it replaces', () => {
    const legacy = legacyReads(theme);
    expect(theme.palette.status).toEqual(legacy.status);
    expect(theme.palette.chart.series).toEqual(legacy.series);
    expect(telemetryTokens(theme)).toEqual({ status: legacy.status, chart: { series: legacy.series } });
  });
});

describe('withTelemetryTokens', () => {
  it('derives missing tokens from the theme it is given', () => {
    const base = createTheme({ palette: { success: { main: '#00aa00' }, primary: { main: '#0000aa' } } });
    const themed = withTelemetryTokens(base);
    expect(themed.palette.status.ok).toBe('#00aa00');
    expect(themed.palette.chart.series[0]).toBe('#0000aa');
  });

  it('keeps tokens the app already set and fills the rest', () => {
    const base = createTheme({
      palette: { status: { crit: '#b00020' }, chart: { series: ['#111111', '#222222'] } },
    });
    const themed = withTelemetryTokens(base);
    expect(themed.palette.status.crit).toBe('#b00020');
    expect(themed.palette.status.ok).toBe(base.palette.success.main);
    expect(themed.palette.status.warn).toBe(base.palette.warning.main);
    expect(themed.palette.chart.series).toEqual(['#111111', '#222222']);
  });

  it('is idempotent', () => {
    const once = withTelemetryTokens(createTheme({ palette: { status: { warn: '#ff8800' } } }));
    const twice = withTelemetryTokens(once);
    expect(telemetryTokens(twice)).toEqual(telemetryTokens(once));
    expect(twice.palette.status).toEqual(once.palette.status);
    expect(twice.palette.chart).toEqual(once.palette.chart);
  });

  it('does not mutate its input', () => {
    const base = createTheme();
    const paletteBefore = base.palette;
    const before = JSON.stringify(base);
    const themed = withTelemetryTokens(base);
    expect(JSON.stringify(base)).toBe(before);
    expect(base.palette).toBe(paletteBefore);
    expect('chart' in base.palette).toBe(false);
    expect(themed).not.toBe(base);
    expect(themed.palette).not.toBe(base.palette);
  });

  it('changes nothing else in the theme', () => {
    const base = createTheme({ palette: { mode: 'dark' }, shape: { borderRadius: 8 } });
    expect(withoutTokens(withTelemetryTokens(base))).toEqual(withoutTokens(base));
    // Methods still work against the copy.
    expect(withTelemetryTokens(base).spacing(2)).toBe(base.spacing(2));
  });

  it('hands out copies, so a caller cannot edit the theme through the tokens', () => {
    const tokens = telemetryTokens(lightTheme);
    tokens.chart.series.push('#000000');
    tokens.status.ok = '#000000';
    expect(lightTheme.palette.chart.series).not.toContain('#000000');
    expect(lightTheme.palette.status.ok).not.toBe('#000000');
  });
});

describe('telemetryTokens', () => {
  it('derives every token for a theme that never went through withTelemetryTokens', () => {
    const base = createTheme();
    const legacy = legacyReads(base);
    expect(telemetryTokens(base)).toEqual({ status: legacy.status, chart: { series: legacy.series } });
  });
});

describe('useTelemetryTokens', () => {
  it("reads the tokens of the theme in context, the app's overrides included", () => {
    const theme = withTelemetryTokens(createTheme({ palette: { status: { crit: '#b00020' } } }));
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider theme={theme}>{children}</ThemeProvider>;
    const { result } = renderHook(() => useTelemetryTokens(), { wrapper });
    expect(result.current.status.crit).toBe('#b00020');
    expect(result.current.chart.series).toEqual(theme.palette.chart.series);
  });

  it("falls back to derived defaults outside any provider (MUI's default theme)", () => {
    const { result } = renderHook(() => useTelemetryTokens());
    expect(result.current.status.ok).toBe(createTheme().palette.success.main);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { defaultTuiTheme, resetTuiThemeForTests, resolveTuiTheme, setTuiThemeOverrides, textColor } from './theme.js';

afterEach(() => resetTuiThemeForTests());

const COLOR_ENV = { TERM: 'xterm-256color' };

describe('resolveTuiTheme', () => {
  it('gives the default tokens and glyphs with colour on', () => {
    const theme = resolveTuiTheme({ env: COLOR_ENV, noColor: false });
    expect(theme.color).toBe(true);
    expect(theme).toMatchObject({ primary: 'cyan', success: 'green', warning: 'yellow', error: 'red', info: 'blue', dim: 'gray' });
    expect(theme.accent).toBeDefined();
    expect(theme.banner).toBeDefined();
    expect(theme.glyphs.check).toBe('✔');
    expect(theme.glyphs.meter.full).toBe('█');
    expect(theme.glyphs.ellipsis).toBe('…');
    expect(defaultTuiTheme.primary).toBe('cyan');
  });

  it('drops every colour under NO_COLOR but keeps the glyphs', () => {
    const theme = resolveTuiTheme({ env: { ...COLOR_ENV, NO_COLOR: '1' }, noColor: false });
    expect(theme.color).toBe(false);
    for (const token of ['primary', 'success', 'warning', 'error', 'info', 'dim', 'accent', 'banner'] as const) {
      expect(theme[token]).toBeUndefined();
    }
    expect(theme.glyphs.check).toBe('✔');
  });

  it('treats an empty NO_COLOR as unset, like the rest of the CLI', () => {
    expect(resolveTuiTheme({ env: { ...COLOR_ENV, NO_COLOR: '' }, noColor: false }).color).toBe(true);
  });

  it('drops colour for --no-color', () => {
    expect(resolveTuiTheme({ env: COLOR_ENV, noColor: true }).color).toBe(false);
  });

  it('applies overrides, and colour-off still wins over them', () => {
    const overrides = { primary: '#4285f4', brand: ['#4285f4', '#ea4335'], glyphs: { bullet: '*', meter: { full: '#' } } };
    const on = resolveTuiTheme({ env: COLOR_ENV, noColor: false, overrides });
    expect(on.primary).toBe('#4285f4');
    expect(on.success).toBe('green');
    expect(on.brand).toEqual(['#4285f4', '#ea4335']);
    expect(on.glyphs.bullet).toBe('*');
    expect(on.glyphs.meter).toMatchObject({ full: '#', light: '░' });

    const off = resolveTuiTheme({ env: { ...COLOR_ENV, NO_COLOR: '1' }, noColor: false, overrides });
    expect(off.primary).toBeUndefined();
    expect(off.brand).toEqual([]);
  });

  it('uses the overrides createCli recorded', () => {
    setTuiThemeOverrides({ primary: 'magenta' });
    expect(resolveTuiTheme({ env: COLOR_ENV, noColor: false }).primary).toBe('magenta');
    resetTuiThemeForTests();
    expect(resolveTuiTheme({ env: COLOR_ENV, noColor: false }).primary).toBe('cyan');
  });

  it('rejects a token that is not a colour string', () => {
    expect(() => setTuiThemeOverrides({ primary: 3 as unknown as string })).toThrow(/primary/);
    expect(() => setTuiThemeOverrides({ brand: [1] as unknown as string[] })).toThrow(/brand/);
  });
});

describe('textColor', () => {
  it('spreads a colour, or nothing when colour is off', () => {
    expect(textColor('cyan')).toEqual({ color: 'cyan' });
    expect(textColor(undefined)).toEqual({});
  });
});

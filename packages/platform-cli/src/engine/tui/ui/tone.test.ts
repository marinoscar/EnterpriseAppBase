import { describe, expect, it } from 'vitest';

import { defaultTuiTheme, resolveTuiTheme } from '../theme.js';
import { middleTruncate, toneProps } from './tone.js';

describe('middleTruncate', () => {
  it('leaves short text alone', () => {
    expect(middleTruncate('abc', 5)).toBe('abc');
  });

  it('keeps the start and the end and never exceeds the limit', () => {
    const out = middleTruncate('/very/long/path/to/photo-1234.jpg', 16);
    expect(Array.from(out)).toHaveLength(16);
    expect(out.startsWith('/very/l')).toBe(true);
    expect(out.endsWith('234.jpg')).toBe(true);
    expect(out).toContain('…');
  });

  it('handles tiny limits and does not split a surrogate pair', () => {
    expect(middleTruncate('abcdef', 0)).toBe('');
    expect(middleTruncate('abcdef', 1)).toBe('…');
    const out = middleTruncate('😀😀😀😀😀😀', 4);
    expect(Array.from(out)).toHaveLength(4);
  });
});

describe('toneProps', () => {
  it('maps a tone to the theme colour', () => {
    expect(toneProps(defaultTuiTheme, 'error')).toEqual({ color: 'red' });
  });

  it('keeps dim dimmed with no colour at all', () => {
    const mono = resolveTuiTheme({ env: { NO_COLOR: '1' }, noColor: false, overrides: undefined });
    expect(toneProps(mono, 'dim')).toEqual({ dimColor: true });
    expect(toneProps(mono, 'error')).toEqual({});
    expect(toneProps(mono, undefined)).toEqual({});
  });
});

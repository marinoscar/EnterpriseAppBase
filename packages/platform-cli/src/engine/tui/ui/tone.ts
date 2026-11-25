import type { TuiTheme } from '../theme.js';

// =============================================================================
// Tones and text helpers shared by the component kit  (RETRO-G1.4, #1068)
// =============================================================================
//
// A kit component never names a colour. It names a TONE, and the theme (the
// app's, or the default one) decides what that looks like, including nothing at
// all under `NO_COLOR`. Pure and ink-free so the helpers are cheap to test.
// =============================================================================

/**
 * A semantic colour role. The theme maps each to a colour (or to none under
 * `NO_COLOR`).
 *
 * @stability experimental
 */
export type TuiTone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'dim' | 'accent';

/**
 * The props to spread onto an ink `Text` for a tone.
 *
 * @stability experimental
 */
export interface TuiToneProps {
  /** The theme colour, absent when colour is off or the tone is unset. */
  color?: string;
  /** True for the `dim` tone. */
  dimColor?: boolean;
}

/**
 * The `Text` props for a tone under a theme.
 *
 * `dim` always also sets `dimColor`, so secondary text stays secondary when
 * colour is off.
 *
 * @param theme - The active theme.
 * @param tone - The tone; none means the default text style.
 * @returns Props to spread onto `<Text>`.
 * @stability experimental
 */
export function toneProps(theme: TuiTheme, tone: TuiTone | undefined): TuiToneProps {
  if (tone === undefined) return {};
  const color = theme[tone];
  return {
    ...(color === undefined ? {} : { color }),
    ...(tone === 'dim' ? { dimColor: true } : {}),
  };
}

/**
 * Shorten a string to at most `max` cells, keeping its start and its end.
 *
 * A path's useful parts are its root and its file name, so the middle goes.
 * Works on code points, so a surrogate pair is never cut in half. The input is
 * never resolved or normalised.
 *
 * @param value - The text.
 * @param max - The most cells to use; below 1 yields an empty string.
 * @param ellipsis - The mark that replaces the middle.
 * @returns The text, or a shortened copy ending in the same characters.
 * @stability experimental
 */
export function middleTruncate(value: string, max: number, ellipsis = '…'): string {
  const chars = Array.from(value);
  const limit = Math.floor(max);
  if (limit < 1) return '';
  if (chars.length <= limit) return value;
  if (limit <= ellipsis.length) return Array.from(ellipsis).slice(0, limit).join('');
  const keep = limit - ellipsis.length;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return chars.slice(0, head).join('') + ellipsis + (tail > 0 ? chars.slice(chars.length - tail).join('') : '');
}

import { shouldUseColour } from '../output.js';

// =============================================================================
// TUI theme tokens  (RETRO-G1.2, #1066)
// =============================================================================
//
// Colours were inline in every screen (`color="cyan"`, `color="green"`), so an
// app could not restyle the TUI and `NO_COLOR` was honoured only by accident.
// The tokens below are ink `Text` colour names (a named colour, a hex string or
// `undefined`), NOT chalk functions: ink owns rendering, and `undefined` is
// "the terminal's default colour", which is how colour is switched off.
//
// PURE ON PURPOSE, like screen-registry.ts: no React and no ink import, so
// `createCli({ tuiTheme })` records an override without loading the UI.
// =============================================================================

/**
 * A colour for an ink `Text`: a name (`cyan`), a hex string (`#4285f4`), or
 * `undefined` for the terminal's default colour.
 *
 * @stability experimental
 */
export type TuiColor = string | undefined;

/**
 * The glyphs the TUI draws with.
 *
 * @stability experimental
 */
export interface TuiGlyphs {
  /** A selection pointer, e.g. in a breadcrumb. */
  chevron: string;
  /** A truncation mark. */
  ellipsis: string;
  /** A list bullet. */
  bullet: string;
  /** A success mark. */
  check: string;
  /** A failure mark. */
  cross: string;
  /** Meter blocks, from a filled cell to an empty one. */
  meter: { full: string; dense: string; light: string; medium: string; empty: string };
}

/**
 * The semantic colour tokens and glyphs every TUI screen draws with.
 *
 * @stability experimental
 */
export interface TuiTheme {
  /** Whether colour is on. False under `NO_COLOR` / `--no-color`: every colour token is then `undefined`. */
  readonly color: boolean;
  /** Headings and the active element. */
  readonly primary: TuiColor;
  /** Done states. */
  readonly success: TuiColor;
  /** Retries and warnings. */
  readonly warning: TuiColor;
  /** Failures. */
  readonly error: TuiColor;
  /** Informational or skipped. */
  readonly info: TuiColor;
  /** Secondary text and separators. */
  readonly dim: TuiColor;
  /** A highlight, e.g. the selection chip. */
  readonly accent: TuiColor;
  /** The banner title. */
  readonly banner: TuiColor;
  /** Brand hues for a banner, left to right; empty by default. */
  readonly brand: readonly string[];
  /** Glyphs. */
  readonly glyphs: TuiGlyphs;
}

/**
 * What an app may override: any colour token, the brand hues and the glyphs.
 *
 * @stability experimental
 */
export interface TuiThemeOverrides {
  primary?: TuiColor;
  success?: TuiColor;
  warning?: TuiColor;
  error?: TuiColor;
  info?: TuiColor;
  dim?: TuiColor;
  accent?: TuiColor;
  banner?: TuiColor;
  brand?: readonly string[] | undefined;
  glyphs?: Partial<Omit<TuiGlyphs, 'meter'>> & { meter?: Partial<TuiGlyphs['meter']> | undefined };
}

const DEFAULT_GLYPHS: TuiGlyphs = Object.freeze({
  chevron: '›',
  ellipsis: '…',
  bullet: '•',
  check: '✔',
  cross: '✖',
  meter: Object.freeze({ full: '█', dense: '▓', light: '░', medium: '▒', empty: ' ' }),
});

const COLOR_TOKENS = ['primary', 'success', 'warning', 'error', 'info', 'dim', 'accent', 'banner'] as const;

const DEFAULT_COLORS: Record<(typeof COLOR_TOKENS)[number], TuiColor> = {
  primary: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  dim: 'gray',
  accent: 'magenta',
  banner: 'cyanBright',
};

/**
 * The default theme, with colour on. Use {@link resolveTuiTheme} for one that
 * honours `NO_COLOR` and the app's overrides.
 *
 * @stability experimental
 */
export const defaultTuiTheme: TuiTheme = Object.freeze({
  color: true,
  ...DEFAULT_COLORS,
  brand: Object.freeze([]) as readonly string[],
  glyphs: DEFAULT_GLYPHS,
});

/**
 * Inputs of {@link resolveTuiTheme}, injectable so it is testable without a TTY.
 *
 * @stability experimental
 */
export interface ResolveTuiThemeInput {
  /** The app's overrides; defaults to the ones `createCli({ tuiTheme })` recorded. */
  overrides?: TuiThemeOverrides | undefined;
  /** Defaults to `process.env` (`NO_COLOR`, `FORCE_COLOR`, `TERM`). */
  env?: NodeJS.ProcessEnv | undefined;
  /** True forces colour off, like `--no-color`. Defaults to whether `--no-color` is in `process.argv`. */
  noColor?: boolean | undefined;
}

let appOverrides: TuiThemeOverrides | undefined;

/**
 * Records the app's theme overrides; `createCli({ tuiTheme })` calls it.
 *
 * @param overrides - Colour tokens, brand hues and glyphs to replace, or `undefined` to clear.
 * @throws Error when a colour token is not a string or `undefined`, or `brand` is not a list of strings.
 * @stability experimental
 */
export function setTuiThemeOverrides(overrides: TuiThemeOverrides | undefined): void {
  if (overrides !== undefined) {
    for (const token of COLOR_TOKENS) {
      const value = overrides[token];
      if (value !== undefined && typeof value !== 'string') {
        throw new Error(`TUI theme token "${token}" must be a colour string.`);
      }
    }
    if (overrides.brand !== undefined && !overrides.brand.every((hue) => typeof hue === 'string')) {
      throw new Error('TUI theme "brand" must be a list of colour strings.');
    }
  }
  appOverrides = overrides;
}

/**
 * Resolves the theme: the defaults, then the app's overrides, then colour off
 * when `NO_COLOR` is set (non-empty), `--no-color` was passed, or the terminal
 * is `TERM=dumb`. With colour off every colour token is `undefined`; the
 * glyphs and the brand list are unaffected except that `brand` is emptied.
 *
 * @param input - Overrides, environment and the no-colour switch (all optional).
 * @returns A frozen theme.
 * @stability experimental
 */
export function resolveTuiTheme(input: ResolveTuiThemeInput = {}): TuiTheme {
  const overrides = input.overrides ?? appOverrides;
  const env = input.env ?? process.env;
  const noColor = input.noColor ?? process.argv.includes('--no-color');
  const color = shouldUseColour({ requested: noColor ? false : undefined, env, isTTY: true });

  const colors = {} as Record<(typeof COLOR_TOKENS)[number], TuiColor>;
  for (const token of COLOR_TOKENS) {
    const chosen = overrides !== undefined && token in overrides ? overrides[token] : DEFAULT_COLORS[token];
    colors[token] = color ? chosen : undefined;
  }

  return Object.freeze({
    color,
    ...colors,
    brand: Object.freeze(color ? [...(overrides?.brand ?? [])] : []),
    glyphs: Object.freeze({
      ...DEFAULT_GLYPHS,
      ...overrides?.glyphs,
      meter: Object.freeze({ ...DEFAULT_GLYPHS.meter, ...overrides?.glyphs?.meter }),
    }),
  });
}

/** Clears the recorded overrides. Tests only. */
export function resetTuiThemeForTests(): void {
  appOverrides = undefined;
}

/**
 * Spreads a colour token into ink `Text` props: `{ color }` when set, `{}`
 * when colour is off (ink's `color` does not accept `undefined` under
 * `exactOptionalPropertyTypes`).
 *
 * @param token - A theme colour token.
 * @returns Props to spread onto `<Text>` or `<Box borderColor>`.
 * @stability experimental
 */
export function textColor(token: TuiColor): { color?: string } {
  return token === undefined ? {} : { color: token };
}

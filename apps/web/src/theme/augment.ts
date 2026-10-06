/**
 * MUI module augmentation for the telemetry UI's theme-token contract
 * (issue #686, platform-packages PP-1.15).
 *
 * Two palette roles beyond MUI's defaults, the first entries of the telemetry
 * package's extension-point catalog (theme tokens, see #704):
 *
 * - `palette.status` — what a value MEANS: `ok`, `warn`, `crit`, `info` and
 *   `neutral`. Used for status codes, severities, outcomes, up/down cells.
 * - `palette.chart.series` — categorical colours for chart lines and series
 *   that carry no meaning beyond "a different series", in assignment order.
 *
 * Rule: series colours are never used for status, and status colours are
 * never used as a generic series colour.
 *
 * `withTelemetryTokens` (`telemetryTokens.ts`) fills both from the theme's own
 * palette when the app did not set them, so an app overrides a token simply by
 * passing it in its `createTheme` options:
 *
 * ```ts
 * createTheme({ palette: { status: { crit: '#b00020' }, chart: { series: ['#0057b8', '#ffd700'] } } });
 * ```
 *
 * The interface name `PaletteChart` with `series: string[]` and
 * `Palette.chart: PaletteChart` are deliberate: TypeScript merges identical
 * interface declarations, so an app that already augments MUI with the same
 * shape keeps compiling. Do not change the shape.
 *
 * A MODULE (`export {}`), not a `.d.ts` script: a script's `declare module`
 * would redeclare the package instead of augmenting it, and a `.d.ts` is only
 * seen by programs whose `include` happens to cover it. `theme/index.ts` and
 * `theme/telemetryTokens.ts` import this file for its side effect, so every
 * program that compiles the theme (the app, the visual harness, vitest) gets
 * the augmentation with it.
 */

export {};

declare module '@mui/material/styles' {
  /** Status colours: what a value means. Never used as a series colour. */
  interface PaletteStatus {
    /** Healthy, succeeded, 2xx, up. */
    ok: string;
    /** Needs attention: 4xx, warnings, a highlighted tile. */
    warn: string;
    /** Failed: 5xx, error logs, down. */
    crit: string;
    /** Informational: 3xx, info logs. */
    info: string;
    /** No particular status: "other" log records. */
    neutral: string;
  }

  /** Chart colours. Series colours are never used for status. */
  interface PaletteChart {
    /** Categorical series colours, in assignment order. */
    series: string[];
  }

  interface Palette {
    status: PaletteStatus;
    chart: PaletteChart;
  }

  interface PaletteOptions {
    status?: Partial<PaletteStatus>;
    chart?: Partial<PaletteChart>;
  }
}

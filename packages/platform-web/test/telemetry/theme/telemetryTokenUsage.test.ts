import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// Tripwire: the telemetry UI reads status and series colours from theme tokens
// =============================================================================
//
// Issue #686. The telemetry UI will become a package (#704), and a package
// owns structure while the app owns appearance. So a status colour (a 5xx bar,
// an error count, a "Down" cell) or a chart series colour is read from the
// theme's telemetry tokens — `useTelemetryTokens()` / `telemetryTokens(theme)`
// (`palette.status`, `palette.chart.series`, `theme/telemetryTokens.ts`) —
// never straight off an MUI palette role, and never as a colour literal. An
// app restyles the tokens; it cannot restyle a raw `theme.palette.error.main`
// without forking the component.
//
// Allowed: neutral chrome (`text.*`, `action.*`, `background.*`, `divider`),
// `primary` as a selection / accent colour (the zoom brush, the user's chat
// bubble), and MUI's own semantic props (`<Alert severity>`, `<Chip color>`),
// which are themed through the palette already. `theme/telemetryTokens.ts`,
// which derives the defaults, lives outside the scanned directories (`theme/`).
// =============================================================================

// The slice's UI and headless sources; `theme/` (which derives the defaults)
// is the one directory not scanned.
const sliceSrc = resolve(__dirname, '..', '..', '..', 'src', 'telemetry');

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /theme\.palette\.(success|error|warning|info|secondary|grey)\b/, what: 'a raw status/series palette read' },
  { pattern: /['"`](success|error|warning|info|secondary)\.(main|light|dark)['"`]/, what: 'a status/series palette path' },
  { pattern: /#[0-9a-fA-F]{3,8}\b/, what: 'a hex colour literal' },
  { pattern: /\b(rgba?|hsla?)\(/, what: 'a colour function literal' },
];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The telemetry UI: every file under the slice's `ui/` and `headless/` (#704). */
function scannedFiles(): string[] {
  return [...listFiles(join(sliceSrc, 'ui')), ...listFiles(join(sliceSrc, 'headless'))];
}

/**
 * Comments removed (block, then line), so an issue reference (`#686`) or
 * prose naming a palette role does not count. Line comments are only those
 * that start a line or follow whitespace, so a `//` inside a URL string stays.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function forbiddenColourReads(source: string): { line: number; text: string; what: string }[] {
  return stripComments(source)
    .split('\n')
    .flatMap((text, index) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ what }) => ({ line: index + 1, text: text.trim(), what })),
    );
}

describe('telemetry UI colour reads (#686)', () => {
  it('scans the telemetry components and pages', () => {
    const files = scannedFiles().map((file) => relative(sliceSrc, file));
    expect(files).toContain(join('ui', 'components', 'dashboard', 'ApiTimelineChart.tsx'));
    expect(files).toContain(join('ui', 'components', 'dashboard', 'metrics', 'MetricSeriesChart.tsx'));
    expect(files).toContain(join('ui', 'pages', 'TelemetryDashboardPage.tsx'));
    expect(files).toContain(join('headless', 'services', 'client.ts'));
  });

  it('reads status and series colours only through the telemetry tokens', () => {
    const offences = scannedFiles().flatMap((file) =>
      forbiddenColourReads(readFileSync(file, 'utf8')).map(
        ({ line, text, what }) => `${relative(sliceSrc, file)}:${line}: ${what}: ${text}`,
      ),
    );
    expect(
      offences,
      'use `useTelemetryTokens()` (palette.status / palette.chart.series) instead of:\n' + offences.join('\n'),
    ).toEqual([]);
  });

  it('catches each forbidden form, and ignores comments and allowed chrome', () => {
    expect(forbiddenColourReads('color: theme.palette.error.main,')).toHaveLength(1);
    expect(forbiddenColourReads('const c = theme.palette.grey[500];')).toHaveLength(1);
    expect(forbiddenColourReads("sx={{ color: 'warning.main' }}")).toHaveLength(1);
    expect(forbiddenColourReads("const c = '#ff0000';")).toHaveLength(1);
    expect(forbiddenColourReads("fill: 'rgba(0, 0, 0, 0.5)'")).toHaveLength(1);
    expect(forbiddenColourReads('// issue #602: theme.palette.error.main')).toEqual([]);
    expect(forbiddenColourReads('/* #686 */ const x = 1;')).toEqual([]);
    expect(forbiddenColourReads("sx={{ color: 'text.secondary', bgcolor: 'primary.main' }}")).toEqual([]);
    expect(forbiddenColourReads('fill={theme.palette.primary.main}')).toEqual([]);
    expect(forbiddenColourReads('color: tokens.status.crit,')).toEqual([]);
  });
});

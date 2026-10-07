/**
 * The telemetry slice's import boundaries (issue #704), as a test beside the
 * ESLint rules (`eslint.config.mjs`: `WEB_HEADLESS_SOURCE_FILES`, rule A):
 *
 *   - `/headless` (and the token folder it exports) imports no `@mui/*`
 *     component module: `@mui/material/styles` only (theme types,
 *     `useTheme`), no `@emotion/*`, no x-charts / x-data-grid, and nothing
 *     from `/ui`;
 *   - nothing in the slice imports an app (`apps/`), `@app/shared`, or another
 *     platform package by path.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SLICE = resolve(__dirname, '..', '..', 'src', 'telemetry');

function files(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file));
}

/** Every module specifier of `source` (static imports, re-exports and `import()`). */
export function specifiers(source: string): string[] {
  const found = [
    ...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];
  return found.map((match) => match[1]!);
}

const HEADLESS_ALLOWED_MUI = new Set(['@mui/material/styles']);

describe('telemetry slice import boundaries', () => {
  const headless = [...files(join(SLICE, 'headless')), ...files(join(SLICE, 'theme'))];
  const everything = files(SLICE);

  it('scans the headless entry and its token folder', () => {
    const names = headless.map((file) => relative(SLICE, file));
    expect(names).toContain(join('headless', 'index.ts'));
    expect(names).toContain(join('theme', 'telemetryTokens.ts'));
  });

  it('/headless imports no MUI component module, no emotion and nothing from /ui', () => {
    const offences = headless.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter(
          (spec) =>
            (spec.startsWith('@mui/') && !HEADLESS_ALLOWED_MUI.has(spec)) ||
            spec.startsWith('@emotion/') ||
            /(^|\/)ui(\/|$)/.test(spec),
        )
        .map((spec) => `${relative(SLICE, file)}: ${spec}`),
    );
    expect(offences).toEqual([]);
  });

  it('nothing in the slice imports an app or another package by path', () => {
    const offences = everything.flatMap((file) =>
      specifiers(readFileSync(file, 'utf8'))
        .filter((spec) => /(^|\/)apps\//.test(spec) || spec.startsWith('@app/') || /packages\/platform-/.test(spec))
        .map((spec) => `${relative(SLICE, file)}: ${spec}`),
    );
    expect(offences).toEqual([]);
  });

  it('the scanner sees each import form', () => {
    expect(
      specifiers(
        "import { Box } from '@mui/material';\nimport './augment.js';\nexport { x } from '../ui/admin.js';\nconst P = lazy(() => import('./page.js'));",
      ),
    ).toEqual(['@mui/material', '../ui/admin.js', './augment.js', './page.js']);
  });
});

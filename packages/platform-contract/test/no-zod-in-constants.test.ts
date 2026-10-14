// Contract convention (issue #701; README -> Purpose and scope): every
// `src/<slice>/constants.ts` holds plain values and string-literal unions and
// NEVER imports zod, so a consumer that needs only a constant or a type (the
// web app) never pulls zod into its bundle.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const slices = readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory());

/** Every module specifier a file imports or re-exports (static and dynamic). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

describe('contract constants are zod-free', () => {
  it('finds at least the doctor slice', () => {
    expect(slices).toContain('doctor');
  });

  it('gives every slice the three-file layout: schemas.ts, constants.ts, index.ts', () => {
    for (const slice of slices) {
      for (const file of ['schemas.ts', 'constants.ts', 'index.ts']) {
        expect(existsSync(join(SRC, slice, file)), `src/${slice}/${file}`).toBe(true);
      }
    }
  });

  it.each(slices)('src/%s/constants.ts imports no zod and no schema module', (slice) => {
    const source = readFileSync(join(SRC, slice, 'constants.ts'), 'utf8');
    const imported = specifiers(source);
    expect(imported.filter((s) => s === 'zod' || s.startsWith('zod/'))).toEqual([]);
    // Importing schemas.ts would bring zod in through the back door.
    expect(imported.filter((s) => /(^|\/)schemas(\.js)?$/.test(s))).toEqual([]);
  });

  it('detects a zod import (the scan itself works)', () => {
    expect(specifiers("import { z } from 'zod';\nexport type { X } from './schemas.js';")).toEqual(['zod', './schemas.js']);
    expect(specifiers("import 'zod/v4';")).toEqual(['zod/v4']);
  });
});

// The narrow, per-provider pin for `@google/genai` (#447): it is imported
// ONLY under `gemini/` of this package (moved from `@marinoscar/platform-api`'s
// `ai/providers/gemini/` in #991). the `ai-no-sdk-leak` conformance suite
// already keeps every provider SDK inside SOME provider directory; this adds
// the stricter claim that no OTHER provider's directory (or anything else)
// reaches for Google's Gen AI SDK — each adapter owns exactly one SDK.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const OWN_DIR = 'gemini/';
const PACKAGE = '@google/genai';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) return sourceFiles(full);

    return full.endsWith('.ts') ? [full] : [];
  });
}

function importsPackage(source: string): boolean {
  const pattern = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];

    if (specifier === PACKAGE || specifier.startsWith(`${PACKAGE}/`)) return true;
  }

  return false;
}

describe(`${PACKAGE} stays inside ${OWN_DIR}`, () => {
  const files = sourceFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).split('\\').join('/') }));

  it('finds the adapter importing it, so this cannot pass vacuously', () => {
    expect(files.some((f) => f.rel.startsWith(OWN_DIR) && importsPackage(readFileSync(f.path, 'utf8')))).toBe(true);
  });

  it('is imported nowhere else in @marinoscar/platform-ai-providers', () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith(OWN_DIR))
      .filter((f) => importsPackage(readFileSync(f.path, 'utf8')))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });
});

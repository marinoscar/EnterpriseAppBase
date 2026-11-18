// The narrow, per-provider pin for the `openai` package (#448): it is imported
// ONLY by the OpenAI wire family — `openai/` of this package (which also holds
// the mappers, engines and client helpers the family shares) and the two
// adapters composed from them, `openai/azure/` and `openai/compatible/`
// (moved from `@marinoscar/platform-api`'s `ai/providers/` in #991; the
// platform's own provider folders now import no SDK at all, which its
// `ai-no-sdk-leak` conformance run enforces). The conformance suite already
// keeps every provider SDK inside SOME provider directory; this adds the
// stricter claim that no other provider's directory (or anything else)
// reaches for OpenAI's SDK.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
/** The family's root, which holds the other two. */
const OWN_ROOT = 'openai/';
const OWN_DIRS = [OWN_ROOT, 'openai/azure/', 'openai/compatible/'];
const PACKAGE = 'openai';

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

describe(`${PACKAGE} stays inside the OpenAI wire family`, () => {
  const files = sourceFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).split('\\').join('/') }));
  const own = (rel: string) => rel.startsWith(OWN_ROOT);

  it.each(OWN_DIRS)('finds %s importing it, so this cannot pass vacuously', (dir) => {
    expect(files.some((f) => f.rel.startsWith(dir) && importsPackage(readFileSync(f.path, 'utf8')))).toBe(true);
  });

  it('is imported nowhere else in @marinoscar/platform-ai-providers', () => {
    const offenders = files
      .filter((f) => !own(f.rel))
      .filter((f) => importsPackage(readFileSync(f.path, 'utf8')))
      .map((f) => f.rel);

    expect(offenders).toEqual([]);
  });
});

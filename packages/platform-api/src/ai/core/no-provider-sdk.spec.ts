// The AI core is provider-agnostic by contract (#424): nothing under
// `ai/core` may import a provider SDK, or any package beyond the short list
// below. A provider's SDK belongs in `ai/providers/<id>/` only. This spec is
// the executable form of that rule, so a new import has to be argued for here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CORE_DIR = __dirname;

/**
 * Bare module specifiers `ai/core` may import. Everything else must be relative.
 * `@marinoscar/platform-api/jobs` is the queue's public subpath since #734
 * (`ai-error.ts` reads `RateLimitError` from it, as it read `../../jobs/` before).
 * `@marinoscar/platform-contract/ai` is the slice's own wire contract: the id
 * patterns of the open capability and operation vocabularies (PP-14.17, #935).
 * `@marinoscar/platform-ai-providers` (root entry only) is where the
 * provider-agnostic core moved (#991); its root is SDK-free by construction
 * (the SDKs load only from its `./openai`, `./anthropic` and `./gemini`
 * subpaths, which `ai/core` never imports).
 */
const ALLOWED_PACKAGES = new Set([
  'zod',
  '@marinoscar/platform-ai-providers',
  '@nestjs/common',
  '@marinoscar/platform-api/jobs',
  '@marinoscar/platform-contract/ai',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) return sourceFiles(full);

    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const pattern = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const specifiers: string[] = [];

  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }

  return specifiers;
}

describe('ai/core imports', () => {
  const files = sourceFiles(CORE_DIR);

  it('finds the core sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [relative(CORE_DIR, file), file]))(
    '%s imports no provider SDK',
    (_name, file) => {
      const external = importSpecifiers(readFileSync(file, 'utf8')).filter(
        (specifier) => !specifier.startsWith('.'),
      );

      for (const specifier of external) {
        expect([...ALLOWED_PACKAGES]).toContain(specifier);
      }
    },
  );
});

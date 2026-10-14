import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The seed slice compiles against types only: no Prisma client, no Nest, and no
// other package (spec "Rules": packages never bundle a client). It may use
// Node built-ins, and its own files.
const SEED_SRC = join(__dirname, '..', '..', 'src', 'seed');

describe('seed slice sources', () => {
  const sources = readdirSync(SEED_SRC)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(join(SEED_SRC, name), 'utf8') }));

  it('imports only Node built-ins and its own files', () => {
    const specifiers = sources.flatMap(({ name, text }) =>
      [...text.matchAll(/\b(?:import|export)\b[^;'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => ({ file: name, specifier: m[1] as string })),
    );
    const foreign = specifiers.filter(({ specifier }) => !specifier.startsWith('./') && !specifier.startsWith('node:'));
    expect(foreign).toEqual([]);
    expect(specifiers.length).toBeGreaterThan(0);
  });

  it('never calls a destructive client method', () => {
    for (const { name, text } of sources.filter((s) => s.name !== 'README.md')) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ file: name, hit: code.match(/\.(delete|deleteMany|truncate|\$executeRaw|\$queryRaw)\b/)?.[0] }).toEqual({ file: name, hit: undefined });
    }
  });
});

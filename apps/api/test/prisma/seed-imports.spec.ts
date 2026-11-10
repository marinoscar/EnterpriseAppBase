import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// =============================================================================
// The seed script stays standalone and Nest-free (issue #712, PP-5.5)
// =============================================================================
//
// `prisma/seed.ts` runs under `ts-node --transpile-only` (prisma.config.ts) in a
// production image that carries `prisma/` and `dist/` but not `src/`. Anything
// in its import graph that is Nest, or lives in `src/`, either fails there or
// drags the framework (and its memory) into a deploy step. This walks the graph
// from `seed.ts` through every relative import and fails on a bare specifier
// outside the allow-list, so a convenient `import { X } from '../src/...'` (or a
// `@nestjs/*` import in the data modules) is caught here, not on a VPS.
//
// Not covered: the platform package's own seed slice. Its sources are checked by
// `packages/platform-db/test/seed/boundary.spec.ts`.
// =============================================================================

const PRISMA_DIR = resolve(__dirname, '..', '..', 'prisma');
const ENTRY = join(PRISMA_DIR, 'seed.ts');

/** The only packages the seed may import (Node built-ins are always allowed). */
const ALLOWED_PACKAGES = new Set(['@prisma/client', '@prisma/adapter-pg', '@marinoscar/platform-db/seed']);

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Strip comments so a specifier mentioned in prose is not mistaken for an import. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function specifiersOf(file: string): string[] {
  const source = withoutComments(readFileSync(file, 'utf8'));
  return IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] as string));
}

function resolveRelative(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  throw new Error(`${relative(PRISMA_DIR, from)} imports ${specifier}, which is not a TypeScript file the seed can load`);
}

/** Every file reachable from `entry` by relative imports, and every bare specifier met on the way. */
function walk(entry: string): { files: string[]; packages: Map<string, string> } {
  const files: string[] = [];
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.includes(file)) continue;
    files.push(file);
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) queue.push(resolveRelative(file, specifier));
      else if (!specifier.startsWith('node:')) packages.set(specifier, relative(PRISMA_DIR, file));
    }
  }
  return { files, packages };
}

describe('prisma/seed.ts import graph', () => {
  const { files, packages } = walk(ENTRY);

  it('reaches the data module, the app seed and nothing outside prisma/', () => {
    const names = files.map((file) => relative(PRISMA_DIR, file)).sort();
    expect(names).toEqual(['seed-app.ts', 'seed-data.ts', 'seed.ts']);
  });

  it('imports nothing from @nestjs/*', () => {
    const nest = [...packages.entries()].filter(([specifier]) => specifier.startsWith('@nestjs/'));
    expect(nest).toEqual([]);
  });

  it('imports only the allowed packages (the client, its adapter, the platform seed) and Node built-ins', () => {
    const unexpected = [...packages.entries()].filter(([specifier]) => !ALLOWED_PACKAGES.has(specifier));
    expect(unexpected).toEqual([]);
  });

  it('imports the platform seed from its subpath, not the package root', () => {
    expect(packages.has('@marinoscar/platform-db/seed')).toBe(true);
    expect(packages.has('@marinoscar/platform-db')).toBe(false);
  });
});

describe('prisma/tsconfig.json', () => {
  it('type-checks every seed file (prisma:typecheck is what --transpile-only gave up at run time)', () => {
    const tsconfig = JSON.parse(readFileSync(join(PRISMA_DIR, 'tsconfig.json'), 'utf8')) as { include: string[] };
    expect([...tsconfig.include].sort()).toEqual(['seed-app.ts', 'seed-data.ts', 'seed.ts']);
  });
});

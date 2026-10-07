import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * `core` is the bottom of the slice graph (packages/platform-slices.json:
 * `"core": []`, docs/specs/platform-packages.md "Dependency graph"). It is
 * code only: no tables, so no generated Prisma client and no model types, and
 * it imports no other slice. The one Prisma module it may name is the
 * schema-independent `@prisma/client/extension`, and only from `data-access/`
 * (scoped data access, issue #699); `@opentelemetry/api` likewise, for the
 * `asSystem()` span attributes. The root eslint boundary rule enforces the slice
 * direction for relative paths; this spec pins the whole allowed set of
 * specifiers for every file of the slice, including the external ones
 * (issue #698).
 */

const CORE = join(__dirname, '..', '..', 'src', 'core');

/** The only non-relative specifiers core may import. */
const ALLOWED_EXTERNAL = [
  /^@nestjs\/common$/,
  /^@nestjs\/swagger$/,
  /^nestjs-zod$/,
  /^fastify$/,
  /^node:[a-z_/]+$/,
  /^@prisma\/client\/extension$/,
  /^@opentelemetry\/api$/,
];

/** The schema-independent Prisma entry point, and the only directory allowed to import it. */
const PRISMA_EXTENSION = '@prisma/client/extension';
const DATA_ACCESS = 'data-access';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? tsFiles(full) : entry.endsWith('.ts') ? [full] : [];
  });
}

/** Every module specifier of a source, comments stripped so TSDoc examples never count. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /(?<![.\w$])(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

describe('the core slice imports nothing but Nest, nestjs-zod, node built-ins, the Prisma extension entry, the OTel API and itself', () => {
  const files = tsFiles(CORE);

  it('finds the slice (guards against a path that matches nothing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.flatMap(specifiersOf)).toEqual(expect.arrayContaining(['@nestjs/common', '@nestjs/swagger', 'node:crypto']));
  });

  it('never imports @prisma/client (generated model types) or any other Prisma module', () => {
    const offenders = files.flatMap((file) =>
      specifiersOf(file)
        .filter((specifier) => /prisma/i.test(specifier) && specifier !== PRISMA_EXTENSION)
        .map((specifier) => `${relative(CORE, file)}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it('imports @prisma/client/extension only from data-access/, and does import it there', () => {
    const importers = files
      .filter((file) => specifiersOf(file).includes(PRISMA_EXTENSION))
      .map((file) => relative(CORE, file).split(sep).join('/'));

    expect(importers.length).toBeGreaterThanOrEqual(1);
    expect(importers.filter((file) => !file.startsWith(`${DATA_ACCESS}/`))).toEqual([]);
  });

  it("has no `from '@prisma/client'` anywhere in src/core, comments included", () => {
    const offenders = files.filter((file) => /from\s+['"]@prisma\/client['"]/.test(readFileSync(file, 'utf8')));

    expect(offenders.map((file) => relative(CORE, file))).toEqual([]);
  });

  it('relative imports stay inside src/core (no other slice, no package barrel)', () => {
    const offenders = files.flatMap((file) =>
      specifiersOf(file)
        .filter((specifier) => specifier.startsWith('.'))
        .filter((specifier) => {
          const target = relative(CORE, resolve(dirname(file), specifier));
          return target.startsWith('..') || target.split(sep)[0] === '';
        })
        .map((specifier) => `${relative(CORE, file)}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it('external imports are only @nestjs/common, @nestjs/swagger, nestjs-zod, fastify, node: built-ins, @prisma/client/extension and @opentelemetry/api', () => {
    const offenders = files.flatMap((file) =>
      specifiersOf(file)
        .filter((specifier) => !specifier.startsWith('.'))
        .filter((specifier) => !ALLOWED_EXTERNAL.some((re) => re.test(specifier)))
        .map((specifier) => `${relative(CORE, file)}: ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });
});

// A published package never depends on an app's generated Prisma client
// (issue #727): the packages are built, type-checked and tested before any
// `prisma generate` (CI's packages workflow), and a consumer's client is its
// own. Core reaches Prisma only through `@prisma/client/extension`
// (core/data-access/scoped-client.ts); a slice that owns models declares
// them structurally (identity/data/identity-db.ts, sharing/data/sharing-tx.ts).
// This is the executable form, for src/ and test/ alike: a file that imports
// the generated client passes wherever an app happened to generate one, and
// fails in CI.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACKAGE_ROOT = join(__dirname, '..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * A statement (not a string or a comment quoting one) that loads `@prisma/client`
 * or any subpath but `/extension`: `from '...'`, `require('...')`, `import('...')`.
 */
const GENERATED_CLIENT =
  /^[^\n'"`/*]*(?:from\s+|require\(\s*|import\(\s*)['"]@prisma\/client(?!\/extension['"])(?:\/[^'"]*)?['"]/m;

describe('no generated Prisma client in @marinoscar/platform-api', () => {
  const files = [...tsFiles(join(PACKAGE_ROOT, 'src')), ...tsFiles(join(PACKAGE_ROOT, 'test'))].filter(
    (file) => !file.endsWith('no-generated-client.spec.ts'),
  );

  it('scans the package', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('imports @prisma/client only as @prisma/client/extension, in src/ and test/', () => {
    const offenders = files
      .filter((file) => GENERATED_CLIENT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(PACKAGE_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('recognises the forms it forbids, and allows the extension entry point', () => {
    for (const line of [
      "import { Prisma } from '@prisma/client';",
      "import type { User } from '@prisma/client';",
      "const { PrismaClient } = require('@prisma/client');",
      "import { x } from '@prisma/client/runtime/library';",
    ]) {
      expect(GENERATED_CLIENT.test(line)).toBe(true);
    }
    expect(GENERATED_CLIENT.test("import { Prisma } from '@prisma/client/extension';")).toBe(false);
  });
});

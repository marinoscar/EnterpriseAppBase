import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The API's permission constants, read off the API workspace on disk, for the
 * settings-registry parity tests (CLAUDE.md Settings UI Pattern rule 3: a
 * card's `permission` is the exact string the API controller enforces).
 *
 * Since #676 `apps/api/src/common/constants/roles.constants.ts` holds no
 * literals: it DERIVES `PERMISSIONS` by spreading `permissionIds(<MAP>)` over
 * each module's declaration file (`<module>.permissions.ts`), where each entry
 * reads `JOBS_READ: { id: 'jobs:read', ... }`. This helper follows that
 * derivation exactly (the maps `roles.constants.ts` imports and spreads),
 * checks every id is in the generated seed catalog
 * (`apps/api/prisma/catalog/permissions.json`, what the database gets), and
 * returns one `KEY: 'id'` line per permission, so a test can assert
 * `toContain("JOBS_READ: 'jobs:read'")` against the real source of truth.
 *
 * A slice packaged as `@marinoscar/platform-api/<slice>` (telemetry, #703)
 * exports its declarations as data; `roles.constants.ts` imports the map from
 * the package, and this helper reads it from the package's source
 * (`packages/platform-api/src/<slice>/`), the same file the build publishes.
 *
 * It throws when the derivation cannot be followed (a map imported but not
 * spread, a declaration file with no entries, an id missing from the catalog),
 * so a refactor on the API side fails loudly here instead of letting the parity
 * checks compare against nothing.
 */

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../api');
const API_SRC = resolve(API_ROOT, 'src');
const ROLES_CONSTANTS = 'common/constants/roles.constants.ts';
const PLATFORM_API_SRC = resolve(API_ROOT, '../../packages/platform-api/src');

/** The source file (anywhere under the slice) of a platform-api slice that declares `export const <name>`. */
function packageDeclarationFile(slice: string, name: string): string {
  const dir = resolve(PLATFORM_API_SRC, slice);
  const candidates = (readdirSync(dir, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
  );
  for (const file of candidates) {
    const path = resolve(dir, file);
    if (new RegExp(`export const ${name}\\b`).test(readFileSync(path, 'utf8'))) return path;
  }
  throw new Error(`@marinoscar/platform-api/${slice}: no file under packages/platform-api/src/${slice} declares ${name}`);
}

let cached: string | undefined;

export function readApiPermissionConstants(): string {
  if (cached !== undefined) return cached;

  const rolesConstants = readFileSync(resolve(API_SRC, ROLES_CONSTANTS), 'utf8');
  const catalog = JSON.parse(
    readFileSync(resolve(API_ROOT, 'prisma/catalog/permissions.json'), 'utf8'),
  ) as { permissions: Array<{ name: string }> };
  const seeded = new Set(catalog.permissions.map((permission) => permission.name));

  const imports: Array<[mapName: string, file: string, label: string]> = [
    ...[...rolesConstants.matchAll(/import \{ (\w+_PERMISSIONS) \} from '\.\.\/\.\.\/([^']+)';/g)].map(
      ([, mapName, modulePath]): [string, string, string] => [mapName, resolve(API_SRC, `${modulePath}.ts`), `${modulePath}.ts`],
    ),
    // One statement may import several maps from a slice (identity, #727).
    ...[...rolesConstants.matchAll(/import \{([^}]*)\} from '@marinoscar\/platform-api\/([\w-]+)';/g)].flatMap(
      ([, names, slice]) =>
        [...names.matchAll(/\b(\w+_PERMISSION(?:S|_DECLARATIONS))\b/g)].map(([, mapName]): [string, string, string] => [
          mapName,
          packageDeclarationFile(slice, mapName),
          `@marinoscar/platform-api/${slice}`,
        ]),
    ),
  ];
  if (imports.length === 0) {
    throw new Error(`${ROLES_CONSTANTS}: found no *_PERMISSIONS declaration imports`);
  }

  const lines: string[] = [];
  for (const [mapName, file, modulePath] of imports) {
    if (!rolesConstants.includes(`...permissionIds(${mapName})`)) {
      throw new Error(`${ROLES_CONSTANTS} imports ${mapName} but does not spread permissionIds(${mapName})`);
    }
    const declarations = readFileSync(file, 'utf8');
    const entries = [...declarations.matchAll(/^\s*(\w+): \{\s*id: '([^']+)'/gm)];
    if (entries.length === 0) {
      throw new Error(`${modulePath}: found no permission declarations`);
    }
    for (const [, key, id] of entries) {
      if (!seeded.has(id)) {
        throw new Error(`${modulePath} declares ${id}, which prisma/catalog/permissions.json does not seed`);
      }
      lines.push(`${key}: '${id}'`);
    }
  }

  cached = lines.join('\n');
  return cached;
}

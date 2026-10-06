import { readFileSync } from 'node:fs';
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
 * It throws when the derivation cannot be followed (a map imported but not
 * spread, a declaration file with no entries, an id missing from the catalog),
 * so a refactor on the API side fails loudly here instead of letting the parity
 * checks compare against nothing.
 */

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../api');
const API_SRC = resolve(API_ROOT, 'src');
const ROLES_CONSTANTS = 'common/constants/roles.constants.ts';

let cached: string | undefined;

export function readApiPermissionConstants(): string {
  if (cached !== undefined) return cached;

  const rolesConstants = readFileSync(resolve(API_SRC, ROLES_CONSTANTS), 'utf8');
  const catalog = JSON.parse(
    readFileSync(resolve(API_ROOT, 'prisma/catalog/permissions.json'), 'utf8'),
  ) as { permissions: Array<{ name: string }> };
  const seeded = new Set(catalog.permissions.map((permission) => permission.name));

  const imports = [
    ...rolesConstants.matchAll(/import \{ (\w+_PERMISSIONS) \} from '\.\.\/\.\.\/([^']+)';/g),
  ];
  if (imports.length === 0) {
    throw new Error(`${ROLES_CONSTANTS}: found no *_PERMISSIONS declaration imports`);
  }

  const lines: string[] = [];
  for (const [, mapName, modulePath] of imports) {
    if (!rolesConstants.includes(`...permissionIds(${mapName})`)) {
      throw new Error(`${ROLES_CONSTANTS} imports ${mapName} but does not spread permissionIds(${mapName})`);
    }
    const declarations = readFileSync(resolve(API_SRC, `${modulePath}.ts`), 'utf8');
    const entries = [...declarations.matchAll(/^\s*(\w+): \{\s*id: '([^']+)'/gm)];
    if (entries.length === 0) {
      throw new Error(`${modulePath}.ts: found no permission declarations`);
    }
    for (const [, key, id] of entries) {
      if (!seeded.has(id)) {
        throw new Error(`${modulePath}.ts declares ${id}, which prisma/catalog/permissions.json does not seed`);
      }
      lines.push(`${key}: '${id}'`);
    }
  }

  cached = lines.join('\n');
  return cached;
}

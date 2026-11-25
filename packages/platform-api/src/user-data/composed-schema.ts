// Finding the app's composed Prisma schema folder at runtime (issue #880).
//
// The purge planner orders deletes from the parsed schema (`onDelete` is not in
// the generated client's DMMF), so the API image ships `prisma/schema/`. Where
// it sits relative to a compiled file differs between `src/` under ts-jest and
// `dist/` in the image, so the lookup walks up from a directory.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readSchemaDatamodel } from '../testing/index';
import type { PurgeDatamodel } from './purge/purge-planner';

/** How many directories up the lookup goes. */
const MAX_DEPTH = 6;

/**
 * The composed schema folder: the first `prisma/schema` found walking up from
 * `fromDir`.
 *
 * @param fromDir - where to start (an app passes `__dirname`).
 * @returns the folder's absolute path.
 * @throws Error when none exists within a few levels.
 *
 * @stability experimental
 */
export function findComposedSchemaPath(fromDir: string): string {
  let dir = fromDir;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = join(dir, 'prisma', 'schema');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`user-data: cannot find prisma/schema above ${fromDir}`);
}

/**
 * The `datamodel` option for `UserDataModule.forRoot`: parses the composed
 * schema folder found above `fromDir`, once, when the plan is first computed.
 *
 * @param fromDir - where to start looking (an app passes `__dirname`).
 * @returns a function for `UserDataModuleOptions.datamodel`.
 *
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * UserDataModule.forRoot({ imports: [UserDataHostModule], datamodel: composedSchemaDatamodel(__dirname) });
 * ```
 */
export function composedSchemaDatamodel(fromDir: string): () => PurgeDatamodel {
  return () => readSchemaDatamodel(findComposedSchemaPath(fromDir));
}

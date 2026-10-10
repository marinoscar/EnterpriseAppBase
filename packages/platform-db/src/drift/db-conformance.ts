import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseLock, parseManifest } from '../lock/index.js';
import { checkLock } from '../sync/index.js';
import { assertRawSqlIndexes } from './raw-sql-tripwire.js';
import { assertRlsPolicies } from './rls-policies.js';

/**
 * The slice of a test runner {@link runDbConformance} needs; Jest and Vitest
 * (`globals: true`) both fit, and neither is imported here.
 *
 * @stability experimental
 */
export interface DbConformanceTestApi {
  /** Registers a group of tests. */
  describe(name: string, fn: () => void): void;
  /** Registers one test; a thrown error fails it. */
  it(name: string, fn: () => void): void;
}

/**
 * What an app passes to {@link runDbConformance}.
 *
 * @stability experimental
 */
export interface DbConformanceOptions {
  /** The app directory that holds `prisma/` (`prisma/platform.lock`, `prisma/migrations`). */
  appRoot: string;
  /** The `@marinoscar/platform-db` package directory; default: the one this code runs from. */
  packageDir?: string;
  /** Defaults to the globals `describe` and `it` (Jest, or Vitest with `globals: true`). */
  testApi?: DbConformanceTestApi;
}

function globalTestApi(): DbConformanceTestApi {
  const g = globalThis as unknown as Partial<DbConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function') {
    throw new Error('runDbConformance: no global describe/it. Run it under Jest, under Vitest with `globals: true`, or pass `testApi`.');
  }
  return { describe: g.describe, it: g.it };
}

/**
 * Registers the `db` conformance suite: the invariants of the platform's data
 * layer that an app proves in its own CI, offline (no database needed).
 *
 * - **raw-SQL index tripwire**: every partial or expression index the package's migrations create is listed in `RAW_SQL_INDEXES`, every listed one exists, and no schema fragment tries to "fix" one with `@@unique`/`@@index` (see {@link assertRawSqlIndexes}).
 * - **rls-policies tripwire**: every row-level-security policy the package's migrations leave behind is listed in `RLS_POLICIES`, every listed one is created, and its table both enables and forces row-level security (see {@link assertRlsPolicies}).
 * - **platform.lock**: the app's installed migrations are byte-identical to the package's, every package migration is installed, and nothing is edited (see {@link checkLock}).
 *
 * Call it at the top level of a spec file. It is the data-layer counterpart of
 * `runPlatformConformance()` in `@marinoscar/platform-api/testing`, which scans
 * TypeScript source roots and so cannot run a check over SQL and Prisma files.
 *
 * @param options - See {@link DbConformanceOptions}.
 * @throws Error when no test API is available.
 *
 * @example
 * ```ts
 * // apps/api/test/prisma/platform-db-conformance.spec.ts
 * runDbConformance({ appRoot: join(__dirname, '..', '..') });
 * ```
 *
 * @stability experimental
 */
export function runDbConformance(options: DbConformanceOptions): void {
  const api = options.testApi ?? globalTestApi();
  const appRoot = resolve(options.appRoot);
  // `src/drift` and `dist/drift` are both two levels below the package root.
  const packageDir = resolve(options.packageDir ?? join(__dirname, '..', '..'));
  const migrationsDir = join(packageDir, 'migrations');
  const manifest = (): ReturnType<typeof parseManifest> => {
    const file = join(migrationsDir, 'manifest.json');
    return parseManifest(readFileSync(file, 'utf8'), file);
  };

  api.describe('platform-db conformance', () => {
    api.it('raw-sql-indexes: every raw-SQL index is listed, present in the migrations, and not redeclared in a fragment', () => {
      assertRawSqlIndexes({ manifest: manifest(), migrationsDir, fragmentsDir: join(packageDir, 'schema') });
    });

    api.it('rls-policies: every policy the migrations leave is listed in RLS_POLICIES, and each listed table enables and forces row-level security', () => {
      assertRlsPolicies({ manifest: manifest(), migrationsDir });
    });

    api.it('platform.lock: installed migrations are byte-identical to the package, none missing or edited', () => {
      const lockFile = join(appRoot, 'prisma', 'platform.lock');
      if (!existsSync(lockFile)) throw new Error(`${lockFile} does not exist; run \`platform db sync\``);
      const lock = parseLock(readFileSync(lockFile, 'utf8'), lockFile);
      const read = (file: string): Uint8Array | undefined => (existsSync(file) ? readFileSync(file) : undefined);
      const installed = join(appRoot, 'prisma', 'migrations');
      const result = checkLock(
        manifest(),
        lock,
        (dir) => read(join(installed, dir, 'migration.sql')),
        (dir) => read(join(migrationsDir, dir, 'migration.sql')),
      );
      if (!result.ok) throw new Error(`platform.lock check failed:\n${result.problems.map((p) => `  ${p.code}  ${p.message}`).join('\n')}`);
    });
  });
}

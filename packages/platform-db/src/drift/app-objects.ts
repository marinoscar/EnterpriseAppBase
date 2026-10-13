import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformLock } from '../lock/index.js';
import { RAW_SQL_INDEXES } from './raw-sql-indexes.js';
import { columnsOfDefinition, scanAllIndexes } from './raw-sql-tripwire.js';
import { RLS_POLICIES, scanRlsPolicies } from './rls-policies.js';
import { sqlExpressionSha256 } from './sql-expression.js';

/**
 * The class of an app schema-object failure.
 *
 * - `APP_INDEX_NOT_FOUND`: `platform.lock` `rawSqlIndexes` lists an index no migration creates, or a later migration drops it.
 * - `APP_INDEX_MISMATCH`: the listed `definition` names another table, uniqueness or key columns than the migrations leave.
 * - `UNLISTED_APP_RAW_INDEX`: the migrations leave a partial or expression index that neither the package nor `platform.lock` lists.
 * - `APP_POLICY_NOT_FOUND`: `platform.lock` `rlsPolicies` lists a policy no migration creates, or a later migration drops it.
 * - `APP_POLICY_EXPRESSION_MISMATCH`: the listed `usingSha256` or `checkSha256` differs from the expression the migrations leave.
 * - `UNLISTED_APP_POLICY`: the migrations leave a policy that neither the package nor `platform.lock` lists.
 * - `APP_POLICY_TABLE_NOT_ENABLED` / `APP_POLICY_TABLE_NOT_FORCED`: a listed policy's table does not `ENABLE` / `FORCE ROW LEVEL SECURITY` in the migrations.
 *
 * @stability experimental
 */
export type AppObjectProblemCode =
  | 'APP_INDEX_NOT_FOUND'
  | 'APP_INDEX_MISMATCH'
  | 'UNLISTED_APP_RAW_INDEX'
  | 'APP_POLICY_NOT_FOUND'
  | 'APP_POLICY_EXPRESSION_MISMATCH'
  | 'UNLISTED_APP_POLICY'
  | 'APP_POLICY_TABLE_NOT_ENABLED'
  | 'APP_POLICY_TABLE_NOT_FORCED';

/**
 * One app schema-object failure.
 *
 * @stability experimental
 */
export interface AppObjectProblem {
  /** The class of failure. */
  code: AppObjectProblemCode;
  /** The index or policy name. */
  name: string;
  /** A one-line explanation naming the migration or lock entry and the fix. */
  message: string;
}

/**
 * What {@link checkAppSchemaObjects} reads.
 *
 * @stability experimental
 */
export interface AppSchemaObjectsInput {
  /** The app's `platform.lock`. */
  lock: Pick<PlatformLock, 'rawSqlIndexes' | 'rlsPolicies'>;
  /** Every migration of the app's history, installed or app-authored, as `[directory, sql]` in history (directory name) order. */
  migrations: ReadonlyArray<readonly [string, string]>;
  /** The package's raw-SQL indexes; default {@link RAW_SQL_INDEXES}. Only the names are read. */
  packageIndexes?: ReadonlyArray<{ name: string }>;
  /** The package's policies; default {@link RLS_POLICIES}. Only the name and table are read. */
  packagePolicies?: ReadonlyArray<{ name: string; table: string }>;
}

const DEFINITION = /^CREATE\s+(UNIQUE\s+)?INDEX\s+("[^"]+"|[\w$]+)\s+ON\s+(?:ONLY\s+)?((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s+USING\b/i;
const strip = (ident: string): string => (ident.startsWith('"') ? ident.slice(1, -1) : ident.toLowerCase());

/** The uniqueness, table and key columns a `pg_indexes.indexdef` string states. */
function readDefinition(definition: string): { unique: boolean; table: string; columns: string[] | undefined } | undefined {
  const match = DEFINITION.exec(definition.trim());
  if (!match) return undefined;
  const parts = match[3]!.match(/"[^"]+"|[\w$]+/g) ?? [match[3]!];
  return { unique: Boolean(match[1]), table: strip(parts[parts.length - 1]!), columns: columnsOfDefinition(definition) };
}

const sameColumns = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((c, i) => c === b[i]);

/**
 * The offline check of the schema objects an app owns beyond the package's:
 * the raw-SQL indexes and the row-level-security policies listed in its
 * `platform.lock`. Prisma cannot express either, and `platform db drift`
 * asserts them only against a live database; this reads the migration SQL.
 *
 * It fails when
 *
 * - a listed index or policy is not created by some migration, or a later migration drops it,
 * - a listed index's `definition` states another table, uniqueness or key columns than the migrations leave,
 * - a listed policy carries a `usingSha256` or `checkSha256` that differs from the expression the migrations leave (a weakened policy is caught without a database),
 * - a listed policy's table does not both `ENABLE` and `FORCE ROW LEVEL SECURITY`,
 * - the migrations leave a partial or expression index, or a policy, that neither the package's lists nor the lock lists (the lock is the app's allow-list, as `raw-sql-indexes.json` and `rls-policies.json` are the package's).
 *
 * The package's own entries are read, never judged: they are the package
 * tripwires' business (`assertRawSqlIndexes`, `assertRlsPolicies`).
 *
 * @param input - See {@link AppSchemaObjectsInput}.
 * @returns Every problem found, in a stable order; empty when the lock and the migrations agree.
 * @example
 * ```ts
 * const problems = checkAppSchemaObjects({ lock, migrations: [['20270101000000_add_notes', sql]] });
 * ```
 * @stability experimental
 */
export function checkAppSchemaObjects(input: AppSchemaObjectsInput): AppObjectProblem[] {
  const problems: AppObjectProblem[] = [];
  const indexes = scanAllIndexes(input.migrations);
  const byName = new Map(indexes.map((index) => [index.name, index]));
  const packageIndexNames = new Set((input.packageIndexes ?? RAW_SQL_INDEXES).map((index) => index.name));
  const listedIndexes = input.lock.rawSqlIndexes ?? [];
  const listedIndexNames = new Set(listedIndexes.map((index) => index.name));

  for (const listed of listedIndexes) {
    if (packageIndexNames.has(listed.name)) continue;
    const actual = byName.get(listed.name);
    if (!actual) {
      problems.push({
        code: 'APP_INDEX_NOT_FOUND',
        name: listed.name,
        message: `${listed.name}: platform.lock rawSqlIndexes lists it but no migration leaves an index of that name (not created, or dropped by a later migration)`,
      });
      continue;
    }
    const stated = readDefinition(listed.definition);
    if (!stated) {
      problems.push({
        code: 'APP_INDEX_MISMATCH',
        name: listed.name,
        message: `${listed.name}: the lock's definition is not a "CREATE [UNIQUE] INDEX ... ON table USING method (...)" statement as pg_indexes.indexdef prints it`,
      });
      continue;
    }
    const differences: string[] = [];
    if (stated.table !== actual.table) differences.push(`table ${actual.table} (lock ${stated.table})`);
    if (stated.unique !== actual.unique) differences.push(`unique=${actual.unique} (lock ${stated.unique})`);
    if (stated.columns && actual.columns && !sameColumns(stated.columns, actual.columns)) {
      differences.push(`key (${actual.columns.join(', ')}) (lock (${stated.columns.join(', ')}))`);
    }
    if (differences.length) {
      problems.push({ code: 'APP_INDEX_MISMATCH', name: listed.name, message: `${listed.name}: ${actual.createdIn} says ${differences.join(', ')}` });
    }
  }
  for (const index of indexes) {
    if (index.raw && !packageIndexNames.has(index.name) && !listedIndexNames.has(index.name)) {
      problems.push({
        code: 'UNLISTED_APP_RAW_INDEX',
        name: index.name,
        message: `${index.name}: ${index.createdIn} creates a partial or expression index on ${index.table} that platform.lock rawSqlIndexes does not list; add { name, definition } (the definition is pg_indexes.indexdef, printed by \`platform db drift\` when it is wrong)`,
      });
    }
  }

  const scanned = scanRlsPolicies(input.migrations);
  const key = (policy: { table: string; name: string }): string => `${policy.table}\u0000${policy.name}`;
  const byKey = new Map(scanned.policies.map((policy) => [key(policy), policy]));
  const packageKeys = new Set((input.packagePolicies ?? RLS_POLICIES).map(key));
  const listedPolicies = input.lock.rlsPolicies ?? [];
  const listedKeys = new Set(listedPolicies.map(key));

  for (const listed of listedPolicies) {
    if (packageKeys.has(key(listed))) continue;
    const actual = byKey.get(key(listed));
    if (!actual) {
      problems.push({
        code: 'APP_POLICY_NOT_FOUND',
        name: listed.name,
        message: `${listed.name}: platform.lock rlsPolicies lists it on ${listed.table} but no migration leaves a policy of that name there (not created, or dropped by a later migration)`,
      });
      continue;
    }
    for (const [label, want, got] of [
      ['USING', listed.usingSha256, actual.using],
      ['WITH CHECK', listed.checkSha256, actual.check],
    ] as const) {
      if (want === undefined) continue;
      const actualHash = got === undefined ? undefined : sqlExpressionSha256(got);
      if (actualHash !== want) {
        problems.push({
          code: 'APP_POLICY_EXPRESSION_MISMATCH',
          name: listed.name,
          message: `${listed.name}: the lock records ${label} ${want.slice(0, 12)} but the migrations leave ${actualHash ? actualHash.slice(0, 12) : `no ${label} expression`}; a policy changed after it was locked (\`platform db policies\` prints the current hashes)`,
        });
      }
    }
    if (!scanned.enabled.includes(listed.table)) {
      problems.push({ code: 'APP_POLICY_TABLE_NOT_ENABLED', name: listed.name, message: `${listed.name}: no migration leaves ${listed.table} with ENABLE ROW LEVEL SECURITY` });
    }
    if (!scanned.forced.includes(listed.table)) {
      problems.push({
        code: 'APP_POLICY_TABLE_NOT_FORCED',
        name: listed.name,
        message: `${listed.name}: no migration leaves ${listed.table} with FORCE ROW LEVEL SECURITY, so the application role would bypass the policy`,
      });
    }
  }
  for (const policy of scanned.policies) {
    if (!packageKeys.has(key(policy)) && !listedKeys.has(key(policy))) {
      problems.push({
        code: 'UNLISTED_APP_POLICY',
        name: policy.name,
        message: `${policy.name}: ${policy.createdIn} creates a policy on ${policy.table} that platform.lock rlsPolicies does not list; add { name, table } (and usingSha256/checkSha256 from \`platform db policies\`)`,
      });
    }
  }
  return problems;
}

/**
 * Reads every migration of an app's `prisma/migrations`, in directory-name
 * order, as `[directory, sql]`. A directory without a `migration.sql` is
 * skipped. Shared by the conformance suite and {@link assertAppSchemaObjects}.
 *
 * @param migrationsDir - The app's `prisma/migrations` directory; a missing directory means none.
 * @returns The migrations in history order.
 * @stability experimental
 */
export function readAppMigrations(migrationsDir: string): Array<[string, string]> {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((dir): Array<[string, string]> => {
      const file = join(migrationsDir, dir, 'migration.sql');
      return existsSync(file) ? [[dir, readFileSync(file, 'utf8')]] : [];
    });
}

/**
 * What {@link assertAppSchemaObjects} reads from disk.
 *
 * @stability experimental
 */
export interface AssertAppSchemaObjectsOptions {
  /** The app's `platform.lock`, parsed. */
  lock: Pick<PlatformLock, 'rawSqlIndexes' | 'rlsPolicies'>;
  /** The app's `prisma/migrations` directory. */
  migrationsDir: string;
  /** The package's raw-SQL indexes; default {@link RAW_SQL_INDEXES}. */
  packageIndexes?: ReadonlyArray<{ name: string }>;
  /** The package's policies; default {@link RLS_POLICIES}. */
  packagePolicies?: ReadonlyArray<{ name: string; table: string }>;
}

/**
 * Runs {@link checkAppSchemaObjects} against the migrations on disk and
 * throws, listing every problem, when the lock and the migrations disagree.
 * This is the entry the conformance suite and an app's CI call.
 *
 * @param options - See {@link AssertAppSchemaObjectsOptions}.
 * @throws Error naming each problem.
 * @stability experimental
 */
export function assertAppSchemaObjects(options: AssertAppSchemaObjectsOptions): void {
  const problems = checkAppSchemaObjects({
    lock: options.lock,
    migrations: readAppMigrations(options.migrationsDir),
    ...(options.packageIndexes ? { packageIndexes: options.packageIndexes } : {}),
    ...(options.packagePolicies ? { packagePolicies: options.packagePolicies } : {}),
  });
  if (problems.length > 0) {
    throw new Error(`the app schema-object check failed (${problems.length}):\n${problems.map((p) => `  ${p.code}  ${p.message}`).join('\n')}`);
  }
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ManifestEntry } from '../lock/index.js';
import { splitSqlStatements } from './raw-sql-tripwire.js';

const policySchema = z
  .object({
    name: z.string().min(1),
    table: z.string().min(1),
    reason: z.string().min(1),
    doc: z.string().min(1),
    createdIn: z.string().regex(/^\d{4}_[a-z0-9][a-z0-9_]*$/, 'expected a platform migration id, NNNN_slug'),
  })
  .strict();

const listSchema = z.object({ policies: z.array(policySchema) }).strict();

/**
 * A row-level-security policy the package ships, with why it exists. Prisma's
 * schema language cannot express a policy and `prisma migrate diff` ignores it
 * in both directions, so the list is an intentional-drift allow-list like
 * {@link RAW_SQL_INDEXES}: the drift test asserts each policy exists (and that
 * its table has row-level security enabled and forced) and that no other
 * policy does.
 *
 * @stability experimental
 */
export interface PackageRlsPolicy {
  /** The policy name (`<table>_org_isolation`). */
  name: string;
  /** The table it protects (the database name, not the Prisma model). */
  table: string;
  /** One line: what the policy enforces. */
  reason: string;
  /** The repository document that explains the invariant, relative to the repository root. */
  doc: string;
  /** The platform migration id (`NNNN_slug`) that first creates it. */
  createdIn: string;
}

/**
 * Reads the package's `rls-policies.json`.
 *
 * @param file - Path of the JSON file.
 * @returns The policies, in file order.
 * @throws Error when the file is not valid.
 * @stability experimental
 */
export function readPackageRlsPolicies(file: string): PackageRlsPolicy[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${file} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data.policies;
}

/**
 * The package's row-level-security policies: the allow-list of intentional
 * drift that `platform db drift` asserts against `pg_policies` and that
 * {@link assertRlsPolicies} checks against the migrations. Read from the
 * shipped `rls-policies.json`.
 *
 * @stability experimental
 */
export const RLS_POLICIES: ReadonlyArray<PackageRlsPolicy> = Object.freeze(
  // `src/drift` and `dist/drift` are both two levels below the package root.
  readPackageRlsPolicies(join(__dirname, '..', '..', 'rls-policies.json')).map((policy) => Object.freeze(policy)),
);

/**
 * A policy an app lists in its own `platform.lock` (`rlsPolicies`).
 *
 * @stability experimental
 */
export interface RlsPolicyRef {
  /** The policy name. */
  name: string;
  /** The table it protects. */
  table: string;
}

/**
 * A row of `pg_policies`.
 *
 * @stability experimental
 */
export interface PolicyRow {
  /** `tablename`. */
  table: string;
  /** `policyname`. */
  name: string;
}

/**
 * The row-level-security flags of one table (`pg_class.relrowsecurity` and `relforcerowsecurity`).
 *
 * @stability experimental
 */
export interface TableRlsRow {
  /** The table name. */
  table: string;
  /** `relrowsecurity`. */
  enabled: boolean;
  /** `relforcerowsecurity`. */
  forced: boolean;
}

/**
 * The class of a policy failure.
 *
 * - `POLICY_MISSING`: a listed policy is not in `pg_policies`.
 * - `POLICY_UNLISTED`: `pg_policies` holds a policy no list names.
 * - `RLS_NOT_ENABLED`: a listed policy's table does not have row-level security enabled.
 * - `RLS_NOT_FORCED`: a listed policy's table does not FORCE it, so the owner (the application role) bypasses the policy.
 * - `RLS_FORCED_WITHOUT_POLICY`: a table forces row-level security but no listed policy protects it (everything would be denied).
 *
 * @stability experimental
 */
export type RlsProblemCode =
  | 'POLICY_MISSING'
  | 'POLICY_UNLISTED'
  | 'RLS_NOT_ENABLED'
  | 'RLS_NOT_FORCED'
  | 'RLS_FORCED_WITHOUT_POLICY';

/**
 * One row-level-security problem.
 *
 * @stability experimental
 */
export interface RlsProblem {
  /** The class of failure. */
  code: RlsProblemCode;
  /** The policy name, or the table for a table-level problem. */
  name: string;
  /** A one-line explanation. */
  message: string;
}

/**
 * The positive assertion of the drift test for policies: every expected policy
 * exists, its table has row-level security enabled AND forced, and nothing else
 * exists (`migrate diff` ignores policies, so a dropped, weakened-by-hand or
 * extra one is invisible to it).
 *
 * @param expected - The package's list plus the app's (`platform.lock` `rlsPolicies`).
 * @param livePolicies - Rows of `pg_policies` for the `public` schema.
 * @param liveTables - Row-level-security flags of every table in the `public` schema.
 * @returns Every problem found.
 * @stability experimental
 */
export function checkRlsPolicies(
  expected: ReadonlyArray<RlsPolicyRef>,
  livePolicies: readonly PolicyRow[],
  liveTables: readonly TableRlsRow[],
): RlsProblem[] {
  const problems: RlsProblem[] = [];
  const liveKey = new Set(livePolicies.map((row) => `${row.table}\u0000${row.name}`));
  const expectedKey = new Set(expected.map((policy) => `${policy.table}\u0000${policy.name}`));
  const tables = new Map(liveTables.map((row) => [row.table, row]));

  for (const policy of expected) {
    if (!liveKey.has(`${policy.table}\u0000${policy.name}`)) {
      problems.push({ code: 'POLICY_MISSING', name: policy.name, message: `${policy.name}: not in pg_policies on ${policy.table}` });
    }
    const table = tables.get(policy.table);
    if (!table?.enabled) {
      problems.push({ code: 'RLS_NOT_ENABLED', name: policy.table, message: `${policy.table}: row-level security is not enabled, so ${policy.name} does nothing` });
    } else if (!table.forced) {
      problems.push({
        code: 'RLS_NOT_FORCED',
        name: policy.table,
        message: `${policy.table}: row-level security is enabled but not FORCED, so the table owner (the application role) ignores ${policy.name}`,
      });
    }
  }
  for (const row of livePolicies) {
    if (!expectedKey.has(`${row.table}\u0000${row.name}`)) {
      problems.push({
        code: 'POLICY_UNLISTED',
        name: row.name,
        message: `${row.name}: a policy on ${row.table} that RLS_POLICIES (or platform.lock rlsPolicies) does not list; add it with its reason or drop it`,
      });
    }
  }
  const protectedTables = new Set(expected.map((policy) => policy.table));
  for (const table of liveTables) {
    if (table.forced && !protectedTables.has(table.table)) {
      problems.push({
        code: 'RLS_FORCED_WITHOUT_POLICY',
        name: table.table,
        message: `${table.table}: row-level security is forced but no listed policy protects it`,
      });
    }
  }
  return problems;
}

/**
 * A policy found by reading migration SQL.
 *
 * @stability experimental
 */
export interface ScannedPolicy {
  /** The policy name. */
  name: string;
  /** The table, unquoted and without a schema. */
  table: string;
  /** The migration id that first creates a policy of this name on the table. */
  createdIn: string;
}

/**
 * What a migration history leaves behind for row-level security.
 *
 * @stability experimental
 */
export interface ScannedRls {
  /** Policies that survive the whole history, in creation order. */
  policies: ScannedPolicy[];
  /** Tables whose row-level security is enabled at the end of the history. */
  enabled: string[];
  /** Tables whose row-level security is forced at the end of the history. */
  forced: string[];
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)';
const QUALIFIED = `${IDENT}(?:\\.${IDENT})?`;
const CREATE_POLICY = new RegExp(`^CREATE\\s+POLICY\\s+(${IDENT})\\s+ON\\s+(${QUALIFIED})`, 'i');
const DROP_POLICY = new RegExp(`^DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(${QUALIFIED})`, 'i');
const ALTER_RLS = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${QUALIFIED})\\s+(ENABLE|DISABLE|FORCE|NO\\s+FORCE)\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
const DROP_TABLE = new RegExp(`^DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED})`, 'i');

const unquote = (ident: string): string => (ident.startsWith('"') ? ident.slice(1, -1) : ident.toLowerCase());
const unqualify = (qualified: string): string => {
  const parts = qualified.match(new RegExp(IDENT, 'g')) ?? [qualified];
  return unquote(parts[parts.length - 1]!);
};

/**
 * Reads the row-level security a migration history leaves behind, in
 * statement order: `CREATE POLICY` adds a policy, `DROP POLICY` removes it,
 * `ALTER TABLE ... ENABLE|DISABLE|FORCE|NO FORCE ROW LEVEL SECURITY` sets the
 * flags and `DROP TABLE` forgets everything about the table. Comments are
 * ignored.
 *
 * @param migrations - `[id, sql]` pairs in history order.
 * @returns The policies and the enabled and forced tables at the end.
 * @stability experimental
 */
export function scanRlsPolicies(migrations: ReadonlyArray<readonly [string, string]>): ScannedRls {
  const live = new Map<string, ScannedPolicy>();
  const firstCreated = new Map<string, string>();
  const enabled = new Set<string>();
  const forced = new Set<string>();
  for (const [id, sql] of migrations) {
    for (const statement of splitSqlStatements(sql)) {
      const create = CREATE_POLICY.exec(statement);
      if (create) {
        const name = unquote(create[1]!);
        const table = unqualify(create[2]!);
        const key = `${table}\u0000${name}`;
        if (!firstCreated.has(key)) firstCreated.set(key, id);
        live.set(key, { name, table, createdIn: firstCreated.get(key)! });
        continue;
      }
      const drop = DROP_POLICY.exec(statement);
      if (drop) {
        live.delete(`${unqualify(drop[2]!)}\u0000${unquote(drop[1]!)}`);
        continue;
      }
      const alter = ALTER_RLS.exec(statement);
      if (alter) {
        const table = unqualify(alter[1]!);
        const verb = alter[2]!.toUpperCase().replace(/\s+/g, ' ');
        if (verb === 'ENABLE') enabled.add(table);
        else if (verb === 'DISABLE') enabled.delete(table);
        else if (verb === 'FORCE') forced.add(table);
        else forced.delete(table);
        continue;
      }
      const dropTable = DROP_TABLE.exec(statement);
      if (dropTable) {
        const table = unqualify(dropTable[1]!);
        enabled.delete(table);
        forced.delete(table);
        for (const key of [...live.keys()]) if (key.startsWith(`${table}\u0000`)) live.delete(key);
      }
    }
  }
  return { policies: [...live.values()], enabled: [...enabled], forced: [...forced] };
}

/**
 * The class of a policy tripwire failure.
 *
 * - `UNLISTED_POLICY`: a migration leaves a policy `RLS_POLICIES` does not list.
 * - `LISTED_POLICY_NOT_FOUND`: a listed policy is not left by the migrations.
 * - `LISTED_POLICY_MISMATCH`: the listed `createdIn` disagrees with the migrations.
 * - `POLICY_TABLE_NOT_ENABLED` / `POLICY_TABLE_NOT_FORCED`: a policy's table does not `ENABLE` / `FORCE ROW LEVEL SECURITY` in the migrations.
 *
 * @stability experimental
 */
export type RlsTripwireCode =
  | 'UNLISTED_POLICY'
  | 'LISTED_POLICY_NOT_FOUND'
  | 'LISTED_POLICY_MISMATCH'
  | 'POLICY_TABLE_NOT_ENABLED'
  | 'POLICY_TABLE_NOT_FORCED';

/**
 * One policy tripwire failure.
 *
 * @stability experimental
 */
export interface RlsTripwireProblem {
  /** The class of failure. */
  code: RlsTripwireCode;
  /** The policy name. */
  name: string;
  /** A one-line explanation naming the migration and the fix. */
  message: string;
}

/**
 * What {@link checkRlsPolicySources} reads.
 *
 * @stability experimental
 */
export interface RlsTripwireInput {
  /** The package history, in order. */
  manifest: readonly Pick<ManifestEntry, 'id' | 'dir'>[];
  /** Reads a package migration's SQL by directory; `undefined` when it does not exist. */
  readMigration: (dir: string) => string | undefined;
  /** The list to hold the migrations to; default {@link RLS_POLICIES}. */
  listed?: ReadonlyArray<PackageRlsPolicy>;
}

/**
 * The offline policy tripwire, as a pure function: every policy a migration
 * leaves behind is listed in `RLS_POLICIES`, every listed one is created, and
 * each listed policy's table both enables and forces row-level security.
 *
 * @param input - See {@link RlsTripwireInput}.
 * @returns Every problem found; empty when the tripwire holds.
 * @stability experimental
 */
export function checkRlsPolicySources(input: RlsTripwireInput): RlsTripwireProblem[] {
  const listed = input.listed ?? RLS_POLICIES;
  const problems: RlsTripwireProblem[] = [];
  const migrations: Array<[string, string]> = [];
  for (const entry of input.manifest) {
    const sql = input.readMigration(entry.dir);
    if (sql === undefined) {
      problems.push({ code: 'LISTED_POLICY_NOT_FOUND', name: entry.id, message: `${entry.id}: migrations/${entry.dir}/migration.sql does not exist, so it cannot be scanned` });
      continue;
    }
    migrations.push([entry.id, sql]);
  }
  const found = scanRlsPolicies(migrations);
  const byKey = new Map(found.policies.map((policy) => [`${policy.table}\u0000${policy.name}`, policy]));
  const listedKeys = new Set(listed.map((policy) => `${policy.table}\u0000${policy.name}`));

  for (const policy of found.policies) {
    if (!listedKeys.has(`${policy.table}\u0000${policy.name}`)) {
      problems.push({
        code: 'UNLISTED_POLICY',
        name: policy.name,
        message: `${policy.name}: ${policy.createdIn} creates a policy on ${policy.table} that RLS_POLICIES does not list; add it to rls-policies.json with its reason`,
      });
    }
  }
  for (const policy of listed) {
    const actual = byKey.get(`${policy.table}\u0000${policy.name}`);
    if (!actual) {
      problems.push({ code: 'LISTED_POLICY_NOT_FOUND', name: policy.name, message: `${policy.name}: listed in RLS_POLICIES but no migration leaves a policy of that name on ${policy.table}` });
      continue;
    }
    if (actual.createdIn !== policy.createdIn) {
      problems.push({ code: 'LISTED_POLICY_MISMATCH', name: policy.name, message: `${policy.name}: the migrations say it is created in ${actual.createdIn} (listed ${policy.createdIn})` });
    }
    if (!found.enabled.includes(policy.table)) {
      problems.push({ code: 'POLICY_TABLE_NOT_ENABLED', name: policy.name, message: `${policy.name}: no migration leaves ${policy.table} with ENABLE ROW LEVEL SECURITY` });
    }
    if (!found.forced.includes(policy.table)) {
      problems.push({ code: 'POLICY_TABLE_NOT_FORCED', name: policy.name, message: `${policy.name}: no migration leaves ${policy.table} with FORCE ROW LEVEL SECURITY, so the application role would bypass the policy` });
    }
  }
  return problems;
}

/**
 * What {@link assertRlsPolicies} reads from disk.
 *
 * @stability experimental
 */
export interface AssertRlsPoliciesOptions {
  /** The package history (`migrations/manifest.json`, parsed). */
  manifest: readonly Pick<ManifestEntry, 'id' | 'dir'>[];
  /** The package's `migrations/` directory. */
  migrationsDir: string;
  /** The list to hold the migrations to; default {@link RLS_POLICIES}. */
  listed?: ReadonlyArray<PackageRlsPolicy>;
}

/**
 * Runs the policy tripwire against the migrations on disk and throws, listing
 * every problem, when it does not hold.
 *
 * @param options - See {@link AssertRlsPoliciesOptions}.
 * @throws Error naming each problem.
 * @stability experimental
 */
export function assertRlsPolicies(options: AssertRlsPoliciesOptions): void {
  const problems = checkRlsPolicySources({
    manifest: options.manifest,
    readMigration: (dir) => {
      try {
        return readFileSync(join(options.migrationsDir, dir, 'migration.sql'), 'utf8');
      } catch {
        return undefined;
      }
    },
    ...(options.listed ? { listed: options.listed } : {}),
  });
  if (problems.length > 0) {
    throw new Error(`rls-policies tripwire failed:\n${problems.map((p) => `  ${p.code}  ${p.message}`).join('\n')}`);
  }
}

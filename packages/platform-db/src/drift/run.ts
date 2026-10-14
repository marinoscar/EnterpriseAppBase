import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { RawSqlIndex } from '../lock/index.js';
import type { LedgerRow } from '../sync/index.js';
import { checkRawSqlIndexes, type IndexRow, type RawIndexProblem } from './raw-sql-indexes.js';
import { checkRlsPolicies, type PolicyRow, type RlsPolicyRef, type RlsProblem, type TableRlsRow } from './rls-policies.js';

/**
 * The slice of the `pg` client the platform tools use.
 *
 * @internal
 */
export interface PgClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, string | Date | null>[] }>;
  end(): Promise<void>;
}
type PgClientCtor = new (config: { connectionString: string }) => PgClient;

/**
 * What the drift test needs.
 *
 * @stability experimental
 */
export interface DriftOptions {
  /** Directory holding `prisma.config.ts`; the Prisma CLI runs here. */
  cwd: string;
  /** The app's `prisma/migrations` directory. */
  migrations: string;
  /** The composed schema: a folder or a single `.prisma` file. */
  schema: string;
  /** Connection string of the migrated database (the app's `DATABASE_URL`). */
  databaseUrl: string;
  /** A pre-created, empty shadow database; when omitted one is created and dropped. */
  shadowDatabaseUrl?: string;
  /** Every raw-SQL index to assert (package list plus the app's). */
  rawSqlIndexes: readonly RawSqlIndex[];
  /** Every row-level-security policy to assert (package list plus the app's); omitted: policies are not checked. */
  rlsPolicies?: readonly RlsPolicyRef[];
}

/**
 * The outcome of {@link runDrift}.
 *
 * @stability experimental
 */
export interface DriftResult {
  /** True when both the diff and the index assertion are clean. */
  ok: boolean;
  /** The SQL `prisma migrate diff` printed: statements that are in the schema but in no migration. Empty when clean. */
  schemaDiff: string;
  /** Missing or changed raw-SQL indexes. */
  indexProblems: RawIndexProblem[];
  /** Missing, extra or unforced row-level-security policies. Empty when policies are not checked. */
  policyProblems: RlsProblem[];
}

/**
 * Resolves the `pg` client constructor from the app, falling back to this package's own copy.
 *
 * @internal
 */
export function loadPg(cwd: string): PgClientCtor {
  const req = createRequire(join(resolve(cwd), 'noop.js'));
  try {
    return (req('pg') as { Client: PgClientCtor }).Client;
  } catch {
    // Fall back to this package's own resolution (a workspace hoists it).
    return (createRequire(__filename)('pg') as { Client: PgClientCtor }).Client;
  }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const databaseOf = (url: string): string => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * The path of the `prisma` CLI entry point resolved from the app.
 *
 * @internal
 */
export function prismaCli(cwd: string): string {
  const req = createRequire(join(resolve(cwd), 'noop.js'));
  const found = req.resolve('prisma/build/index.js');
  if (!existsSync(found)) throw new Error('the prisma CLI was not found; install `prisma` in the app');
  return found;
}

/**
 * Runs `prisma migrate diff` from the migration history to the composed
 * schema, with `--exit-code` and `--script`. The diff replays the history in a
 * shadow database, so it needs one: a supplied URL, or a throwaway database next to the live
 * one that is dropped afterwards.
 *
 * @param options - See {@link DriftOptions}.
 * @returns The SQL of the difference; empty when the history equals the schema.
 * @throws Error when Prisma fails for a reason other than a difference.
 * @stability experimental
 */
export async function schemaDiff(options: DriftOptions): Promise<string> {
  return withShadowDatabase(options, async (shadowUrl) => {
    const result = spawnSync(
      process.execPath,
      [
        prismaCli(options.cwd),
        'migrate',
        'diff',
        '--from-migrations',
        options.migrations,
        '--to-schema',
        options.schema,
        '--exit-code',
        '--script',
      ],
      {
        cwd: options.cwd,
        env: { ...process.env, DATABASE_URL: options.databaseUrl, SHADOW_DATABASE_URL: shadowUrl },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    if (result.status === 0) return '';
    if (result.status === 2) return stripBanner(result.stdout);
    throw new Error(`prisma migrate diff failed (exit ${result.status}): ${(result.stderr || result.stdout).trim()}`);
  });
}

/**
 * Runs `body` with a shadow database URL: the supplied one, or a throwaway
 * database created next to the live one (through the `postgres` maintenance
 * database) and dropped afterwards. The live database is never touched.
 *
 * @param options - `cwd` (where `pg` resolves from), the live `databaseUrl` and an optional `shadowDatabaseUrl`.
 * @param body - Receives the shadow database URL.
 * @returns What `body` returns.
 * @internal
 */
export async function withShadowDatabase<T>(
  options: { cwd: string; databaseUrl: string; shadowDatabaseUrl?: string | undefined },
  body: (shadowUrl: string) => Promise<T>,
): Promise<T> {
  const Client = loadPg(options.cwd);
  let shadowUrl = options.shadowDatabaseUrl;
  let created: { admin: PgClient; name: string } | undefined;
  if (!shadowUrl) {
    const name = `${databaseOf(options.databaseUrl)}_drift_shadow_${process.pid}`;
    const admin = new Client({ connectionString: withDatabase(options.databaseUrl, 'postgres') });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    created = { admin, name };
    shadowUrl = withDatabase(options.databaseUrl, name);
  }
  try {
    return await body(shadowUrl);
  } finally {
    if (created) {
      await created.admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(created.name)} WITH (FORCE)`);
      await created.admin.end();
    }
  }
}

/**
 * Removes the Prisma CLI's banner and environment-loader lines from its output.
 *
 * @internal
 */
export function stripBanner(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => !/^(Loaded Prisma config|Prisma schema loaded|Datasource |◇ injected env|\[dotenv)/.test(line))
    .join('\n')
    .trim();
}

/**
 * Reads every index of the `public` schema as `name` and `indexdef`.
 *
 * @param databaseUrl - Connection string.
 * @param cwd - Where to resolve `pg` from.
 * @returns The rows of `pg_indexes`.
 * @stability experimental
 */
export async function readIndexRows(databaseUrl: string, cwd: string): Promise<IndexRow[]> {
  const Client = loadPg(cwd);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname");
    return rows.map((row) => ({ name: String(row.name), definition: String(row.definition) }));
  } finally {
    await client.end();
  }
}

/**
 * Reads Prisma's `_prisma_migrations` ledger, oldest first. A database Prisma
 * never migrated has no such table and yields no rows.
 *
 * @param databaseUrl - Connection string.
 * @param cwd - Where to resolve `pg` from.
 * @returns The ledger rows.
 * @stability experimental
 */
export async function readLedgerRows(databaseUrl: string, cwd: string): Promise<LedgerRow[]> {
  const Client = loadPg(cwd);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at, migration_name',
    );
    return rows.map((row) => ({
      migrationName: String(row.migration_name),
      checksum: String(row.checksum),
      finishedAt: row.finished_at ? new Date(row.finished_at) : null,
      rolledBackAt: row.rolled_back_at ? new Date(row.rolled_back_at) : null,
    }));
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return [];
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * The CI drift test: the migration history replayed in a shadow database must
 * equal the composed schema (`prisma migrate diff --exit-code`), and every
 * raw-SQL index must exist with its recorded definition. There is no
 * allow-list over the diff output: Prisma ignores partial and expression
 * indexes in both directions, so the indexes are asserted positively instead.
 *
 * @param options - See {@link DriftOptions}.
 * @returns The diff SQL and the index problems; `ok` when both are empty.
 * @stability experimental
 */
export async function runDrift(options: DriftOptions): Promise<DriftResult> {
  const diff = await schemaDiff(options);
  const live = await readIndexRows(options.databaseUrl, options.cwd);
  const indexProblems = checkRawSqlIndexes(options.rawSqlIndexes, live);
  let policyProblems: RlsProblem[] = [];
  if (options.rlsPolicies) {
    const policies = await readPolicyRows(options.databaseUrl, options.cwd);
    const tables = await readTableRlsRows(options.databaseUrl, options.cwd);
    policyProblems = checkRlsPolicies(options.rlsPolicies, policies, tables);
  }
  return { ok: diff === '' && indexProblems.length === 0 && policyProblems.length === 0, schemaDiff: diff, indexProblems, policyProblems };
}

const isTrue = (value: unknown): boolean => value === true || value === 't' || value === 'true';

/**
 * Reads every policy of the `public` schema (`pg_policies`).
 *
 * @param databaseUrl - Connection string.
 * @param cwd - Where to resolve `pg` from.
 * @returns The table and name of each policy.
 * @stability experimental
 */
export async function readPolicyRows(databaseUrl: string, cwd: string): Promise<PolicyRow[]> {
  const Client = loadPg(cwd);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT tablename AS tbl, policyname AS name FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname");
    return rows.map((row) => ({ table: String(row.tbl), name: String(row.name) }));
  } finally {
    await client.end();
  }
}

/**
 * Reads the row-level-security flags of every ordinary table of the `public`
 * schema (`pg_class.relrowsecurity`, `relforcerowsecurity`).
 *
 * @param databaseUrl - Connection string.
 * @param cwd - Where to resolve `pg` from.
 * @returns One row per table.
 * @stability experimental
 */
export async function readTableRlsRows(databaseUrl: string, cwd: string): Promise<TableRlsRow[]> {
  const Client = loadPg(cwd);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT c.relname AS tbl, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname",
    );
    return rows.map((row) => ({ table: String(row.tbl), enabled: isTrue(row.enabled), forced: isTrue(row.forced) }));
  } finally {
    await client.end();
  }
}


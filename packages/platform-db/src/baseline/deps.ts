import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPg, prismaCli, stripBanner, withShadowDatabase, readIndexRows, readPolicyRows, readTableRlsRows } from '../drift/index.js';
import type { LedgerRow } from '../sync/index.js';
import type { BaselineDeps, PrismaResult } from './run.js';

/**
 * Inputs of {@link createBaselineDeps}.
 *
 * @stability experimental
 */
export interface BaselineDepsOptions {
  /** The app's directory: where `prisma.config.ts` and `scripts/prisma-env.js` live; the Prisma CLI runs here. */
  root: string;
  /** Connection string of the live database (the app's `DATABASE_URL`). */
  databaseUrl: string;
  /** The environment the Prisma CLI inherits. */
  env: NodeJS.ProcessEnv;
  /** A pre-created empty shadow database for the replay; when omitted a throwaway one is created next to the live one and dropped. */
  shadowDatabaseUrl?: string | undefined;
  /** The script that builds `DATABASE_URL` and runs Prisma (default: `<root>/scripts/prisma-env.js`, else the `prisma` package of the app). */
  prismaScript?: string | undefined;
  /** Logs one action or finding. */
  log: (line: string) => void;
  /** The clock. */
  now: () => Date;
}

/**
 * Builds the real {@link BaselineDeps}: reads through `pg`, and runs every Prisma
 * CLI call through the app's `scripts/prisma-env.js` (never a bare `npx prisma`).
 *
 * @param options - See {@link BaselineDepsOptions}.
 * @returns The dependencies for `runBaseline`.
 * @stability experimental
 */
export function createBaselineDeps(options: BaselineDepsOptions): BaselineDeps {
  const script = options.prismaScript ?? join(options.root, 'scripts', 'prisma-env.js');

  function runPrisma(args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): PrismaResult {
    const entry = existsSync(script) ? script : prismaCli(options.root);
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: options.root,
      env: { ...options.env, DATABASE_URL: options.databaseUrl, ...extraEnv },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  return {
    log: options.log,
    now: options.now,
    async readLedger(): Promise<LedgerRow[] | undefined> {
      const Client = loadPg(options.root);
      const client = new Client({ connectionString: options.databaseUrl });
      await client.connect();
      try {
        const present = await client.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present");
        if (!present.rows[0]?.present) return undefined;
        const { rows } = await client.query(
          'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at, migration_name',
        );
        return rows.map((row) => ({
          migrationName: String(row.migration_name),
          checksum: String(row.checksum),
          finishedAt: row.finished_at ? new Date(row.finished_at) : null,
          rolledBackAt: row.rolled_back_at ? new Date(row.rolled_back_at) : null,
        }));
      } finally {
        await client.end();
      }
    },
    readIndexes: () => readIndexRows(options.databaseUrl, options.root),
    readPolicies: () => readPolicyRows(options.databaseUrl, options.root),
    readTableRls: () => readTableRlsRows(options.databaseUrl, options.root),
    diffReplayToLive: (replayMigrationsDir) =>
      withShadowDatabase(
        { cwd: options.root, databaseUrl: options.databaseUrl, shadowDatabaseUrl: options.shadowDatabaseUrl },
        async (shadowUrl) => {
          const result = runPrisma(
            ['migrate', 'diff', '--from-migrations', replayMigrationsDir, '--to-config-datasource', '--script'],
            { SHADOW_DATABASE_URL: shadowUrl },
          );
          if (result.status !== 0) {
            throw new Error(`prisma migrate diff failed (exit ${result.status}): ${(result.stderr || result.stdout).trim()}`);
          }
          return stripBanner(result.stdout);
        },
      ),
    prisma: async (args) => runPrisma(args),
  };
}

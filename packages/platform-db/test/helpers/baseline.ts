import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BaselineDeps, PrismaResult } from '../../src/baseline/index.js';
import { sha256Hex } from '../../src/lock/index.js';
import type { LedgerRow } from '../../src/sync/index.js';

/** The fixture package history. 0004 and 0005 are the ones a partial adoption installs. */
export const PACKAGE_SQL: Record<string, string> = {
  '0001_initial': '-- CreateTable\nCREATE TABLE "bl_users" (\n    "id" UUID NOT NULL,\n    CONSTRAINT "bl_users_pkey" PRIMARY KEY ("id")\n);\n',
  '0002_add_orgs': '-- CreateTable\nCREATE TABLE "bl_orgs" (\n    "id" UUID NOT NULL,\n    "slug" TEXT NOT NULL,\n    CONSTRAINT "bl_orgs_pkey" PRIMARY KEY ("id")\n);\n',
  '0003_add_org_slug_index': '-- CreateIndex\nCREATE UNIQUE INDEX "bl_orgs_slug_key" ON "bl_orgs"("slug");\n',
  '0004_add_org_name': '-- AlterTable\nALTER TABLE "bl_orgs" ADD COLUMN "name" TEXT;\n',
  '0005_add_org_active_index': '-- CreateIndex\nCREATE UNIQUE INDEX "bl_orgs_active_idx" ON "bl_orgs"("name") WHERE "name" IS NOT NULL;\n',
};

export const ACTIVE_INDEX = {
  name: 'bl_orgs_active_idx',
  definition: 'CREATE UNIQUE INDEX bl_orgs_active_idx ON public.bl_orgs USING btree (name) WHERE (name IS NOT NULL)',
};

/** The 14-digit directory names the fixture app uses for the package migrations it has. */
export const APP_DIRS: Record<string, string> = {
  '0001_initial': '20260101000000_initial',
  '0002_add_orgs': '20260102000000_add_orgs',
  '0003_add_org_slug_index': '20260103000000_add_org_slug_index',
  '0004_add_org_name': '20260104000000_add_org_name',
  '0005_add_org_active_index': '20260105000000_add_org_active_index',
};

export interface BaselineWorkspace {
  root: string;
  packageDir: string;
  appPrismaDir: string;
  migrationsDir: string;
  lockFile: string;
}

/**
 * A package of five migrations plus an app that has the first `appCount` of
 * them (default all five) under its own timestamps, and `extra` directories of
 * its own. `app` overrides the SQL of an app directory.
 */
export function makeBaselineWorkspace(
  options: { app?: Record<string, string>; extra?: Record<string, string>; appCount?: number } = {},
): BaselineWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'platform-baseline-'));
  const packageDir = join(root, 'package');
  const appPrismaDir = join(root, 'app', 'prisma');
  const migrationsDir = join(appPrismaDir, 'migrations');
  mkdirSync(join(packageDir, 'migrations'), { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{ "name": "@marinoscar/platform-db", "version": "0.1.0-next.3" }\n');
  const manifest = Object.entries(PACKAGE_SQL).map(([id, sql]) => {
    mkdirSync(join(packageDir, 'migrations', id));
    writeFileSync(join(packageDir, 'migrations', id, 'migration.sql'), sql);
    return { id, dir: id, sha256: sha256Hex(sql), since: '0.1.0', slice: 'core', requires: [] as string[] };
  });
  writeFileSync(join(packageDir, 'migrations', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(packageDir, 'raw-sql-indexes.json'),
    `${JSON.stringify({ indexes: [{ ...ACTIVE_INDEX, table: 'bl_orgs', unique: true, reason: 'test', doc: 'docs/x.md', createdIn: '0005_add_org_active_index' }] }, null, 2)}\n`,
  );
  writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  for (const [id, dir] of Object.entries(APP_DIRS).slice(0, options.appCount ?? 5)) {
    mkdirSync(join(migrationsDir, dir));
    writeFileSync(join(migrationsDir, dir, 'migration.sql'), options.app?.[dir] ?? PACKAGE_SQL[id]!);
  }
  for (const [dir, sql] of Object.entries(options.extra ?? {})) {
    mkdirSync(join(migrationsDir, dir));
    writeFileSync(join(migrationsDir, dir, 'migration.sql'), sql);
  }
  return { root, packageDir, appPrismaDir, migrationsDir, lockFile: join(appPrismaDir, 'platform.lock') };
}

/** A recursive path-to-content snapshot of a directory, to prove a run wrote nothing. */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[path.slice(dir.length)] = readFileSync(path, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export interface Calls {
  prisma: string[][];
  diff: string[];
  log: string[];
}

export interface FakeDepsOptions {
  /** The ledger rows; `undefined` is a database Prisma never managed. Default: every name in `recorded` finished with the checksum of the file. */
  ledger?: LedgerRow[] | undefined;
  /** The live raw-SQL indexes; default: the fixture package's one. */
  indexes?: { name: string; definition: string }[];
  /** The SQL the replay-to-live diff prints. */
  diff?: string;
  prisma?: (args: readonly string[]) => PrismaResult;
}

export const finished = (migrationName: string, checksum: string): LedgerRow => ({
  migrationName,
  checksum,
  finishedAt: new Date('2026-01-01T00:00:00Z'),
  rolledBackAt: null,
});

/** Ledger rows for the app's directories that exist, as `migrate deploy` would have recorded them. */
export function appLedger(ws: BaselineWorkspace): LedgerRow[] {
  return Object.values(APP_DIRS)
    .filter((dir) => existsSync(join(ws.migrationsDir, dir)))
    .map((dir) => finished(dir, sha256Hex(readFileSync(join(ws.migrationsDir, dir, 'migration.sql')))));
}

/** Takes a directory out of the app after the database recorded it: its effect is in the database under some other name. */
export function dropFromApp(ws: BaselineWorkspace, dir: string): LedgerRow[] {
  const ledger = appLedger(ws).filter((r) => r.migrationName !== dir);
  rmSync(join(ws.migrationsDir, dir), { recursive: true });
  return ledger;
}

export function fakeDeps(options: FakeDepsOptions = {}): BaselineDeps & { calls: Calls } {
  const calls: Calls = { prisma: [], diff: [], log: [] };
  return {
    calls,
    log: (line) => calls.log.push(line),
    now: () => new Date('2026-10-06T10:00:00Z'),
    readLedger: async () => options.ledger,
    readIndexes: async () => options.indexes ?? [ACTIVE_INDEX],
    diffReplayToLive: async (dir) => {
      calls.diff.push(dir);
      return options.diff ?? '-- This is an empty migration.\n';
    },
    prisma: async (args) => {
      calls.prisma.push([...args]);
      return options.prisma ? options.prisma(args) : { status: 0, stdout: 'Database schema is up to date!\n', stderr: '' };
    },
  };
}

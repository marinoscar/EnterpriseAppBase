// =============================================================================
// Real-Postgres test: platform history v1 is a pure relocation (issue #713, PP-5.6)
// =============================================================================
//
// The 22 migrations of the base moved into `@marinoscar/platform-db` as
// `0001_initial` .. `0022_add_retention_created_at_indexes` (later platform
// migrations, such as `0023_add_organizations`, are appended after them and
// are counted from `platform.lock`, so this suite does not change with them), and the app's own
// `prisma/migrations` directories kept their names. Two claims hold that
// together, and a mocked Prisma cannot prove either:
//
//   1. EXISTING DATABASES. A database migrated from the app's directories (what
//      every deployment has) is "up to date" for `prisma migrate status`,
//      `migrate deploy` has nothing to apply, and `platform db check --database`
//      finds every `_prisma_migrations` row matching a locked file and the
//      package hash. Nothing is re-applied or reported modified.
//   2. FRESH DATABASES. Applying the PACKAGE's history from scratch (ids
//      `0001`.. in order) yields the same schema as the app's directories.
//
// A `*.db.spec.ts` file: runs via `npm run test:db`, never `npm test`. Needs
// `npm run build:packages` first (the bin runs dist/).
// =============================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { createDatabase, dropDatabase, resolveAdminConnection, withAdminConnection, type AdminConnection } from '@marinoscar/platform-api/db-backup/testing';
import { resolveDbSuite } from '../jobs/db-test-support';
import { envFor, migrateDeploy, prismaClientFor } from '../helpers/scratch-database.helper';

const { describeWithDb } = resolveDbSuite('platform-history-v1.db.spec');

const API_ROOT = join(__dirname, '..', '..');
const PACKAGE_DIR = join(API_ROOT, '..', '..', 'packages', 'platform-db');
const PLATFORM_BIN = join(PACKAGE_DIR, 'bin', 'platform.js');
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const EXISTING = `platform_history_existing_${process.pid}`;
const FRESH = `platform_history_fresh_${process.pid}`;

interface LockFile {
  migrations: { originId: string; localDir: string; sha256: string }[];
}
const lock = JSON.parse(readFileSync(join(API_ROOT, 'prisma', 'platform.lock'), 'utf8')) as LockFile;

/** Everything the catalogue says about the public schema, minus Prisma's own ledger, in a stable order. */
async function schemaFingerprint(database: string): Promise<Record<string, string[]>> {
  const prisma = prismaClientFor(database);
  try {
    const columns = await prisma.$queryRaw<{ line: string }[]>`
      SELECT format('%s.%s %s null=%s default=%s', table_name, column_name, udt_name, is_nullable, coalesce(column_default, '-')) AS line
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name, column_name`;
    const indexes = await prisma.$queryRaw<{ line: string }[]>`
      SELECT indexdef AS line FROM pg_indexes WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY indexname`;
    const constraints = await prisma.$queryRaw<{ line: string }[]>`
      SELECT format('%s %s %s', conrelid::regclass, conname, pg_get_constraintdef(oid)) AS line
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> '_prisma_migrations'
      ORDER BY conrelid::regclass::text, conname`;
    const enums = await prisma.$queryRaw<{ line: string }[]>`
      SELECT format('%s: %s', t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)) AS line
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace
      GROUP BY t.typname ORDER BY t.typname`;
    // The seeded reference data some migrations write (roles and permissions grants).
    const grants = await prisma.$queryRaw<{ line: string }[]>`
      SELECT format('%s', count(*)) AS line FROM role_permissions`;
    return {
      columns: columns.map((r) => r.line),
      indexes: indexes.map((r) => r.line),
      constraints: constraints.map((r) => r.line),
      enums: enums.map((r) => r.line),
      grants: grants.map((r) => r.line),
    };
  } finally {
    await prisma.$disconnect();
  }
}

describeWithDb('platform history v1 against real Postgres', () => {
  let admin: AdminConnection;
  let created: string[] = [];
  let scratchRoot = '';

  const existingUrl = (): string => buildDatabaseUrl(envFor(EXISTING));

  const prismaCli = (...args: string[]) =>
    spawnSync(process.execPath, ['scripts/prisma-env.js', ...args], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: undefined, POSTGRES_DB: EXISTING },
      encoding: 'utf8',
    });

  beforeAll(async () => {
    if (EXISTING === process.env.POSTGRES_DB || FRESH === process.env.POSTGRES_DB) throw new Error('refusing to use the shared test database');
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    for (const name of [EXISTING, FRESH]) {
      await withAdminConnection(admin, (client) => createDatabase(client, name));
      created.push(name);
    }

    // The existing deployment: migrated from the app's directories, with no platform tooling involved.
    migrateDeploy(EXISTING);

    // A fresh database built from the PACKAGE's history, ids 0001.. in order.
    scratchRoot = mkdtempSync(join(tmpdir(), 'platform-history-v1-'));
    const migrations = join(scratchRoot, 'prisma', 'migrations');
    mkdirSync(migrations, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'migrations', 'manifest.json'), 'utf8')) as { dir: string }[];
    for (const entry of manifest) cpSync(join(PACKAGE_DIR, 'migrations', entry.dir), join(migrations, entry.dir), { recursive: true });
    writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
    writeFileSync(
      join(scratchRoot, 'prisma', 'schema.prisma'),
      'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n',
    );
    writeFileSync(
      join(scratchRoot, 'prisma.config.js'),
      "module.exports = { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } };\n",
    );
    execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
      cwd: scratchRoot,
      env: { ...process.env, DATABASE_URL: buildDatabaseUrl(envFor(FRESH)) },
      stdio: 'pipe',
    });
  }, 180_000);

  afterAll(async () => {
    for (const name of created) await withAdminConnection(admin, (client) => dropDatabase(client, name));
    if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
  });

  it('prisma migrate status says up to date for a database migrated from the app directories', () => {
    const status = prismaCli('migrate', 'status');
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(`${lock.migrations.length} migrations found in prisma/migrations`);
    expect(status.stdout).toContain('Database schema is up to date!');
    expect(`${status.stdout}${status.stderr}`).not.toMatch(/not yet been applied|modified|missing from/i);
  });

  it('prisma migrate deploy applies nothing', () => {
    const deploy = prismaCli('migrate', 'deploy');
    expect(deploy.status).toBe(0);
    expect(deploy.stdout).toContain('No pending migrations to apply.');
  });

  it('platform db check --database passes: every ledger row matches a locked file and the package hash', async () => {
    const check = spawnSync(process.execPath, [PLATFORM_BIN, 'db', 'check', '--database'], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: existingUrl() },
      encoding: 'utf8',
    });
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
    expect(check.stdout).toContain(`${lock.migrations.length} installed platform migration(s)`);
    expect(check.stdout).toContain(`${lock.migrations.length} ledger row(s) match the files`);

    const prisma = prismaClientFor(EXISTING);
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string; checksum: string }[]>`
        SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at, migration_name`;
      expect(rows.map((r) => [r.migration_name, r.checksum])).toEqual(lock.migrations.map((m) => [m.localDir, m.sha256]));
    } finally {
      await prisma.$disconnect();
    }
  });

  it('a fresh database built from the package history has the same schema as the app history', async () => {
    const [existing, fresh] = await Promise.all([schemaFingerprint(EXISTING), schemaFingerprint(FRESH)]);
    expect(fresh).toEqual(existing);
    expect(existing.indexes.some((line) => line.includes('jobs_active_dedup_uniq_idx'))).toBe(true);
  });

  it('platform db drift is green on the existing database: history equals schema, raw-SQL indexes present', () => {
    const drift = spawnSync(process.execPath, [PLATFORM_BIN, 'db', 'drift'], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: existingUrl() },
      encoding: 'utf8',
    });
    expect(`${drift.stdout}${drift.stderr}`).toContain('platform db drift: ok');
    expect(drift.status).toBe(0);
  });
});

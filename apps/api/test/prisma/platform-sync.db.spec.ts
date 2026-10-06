// =============================================================================
// Real-Postgres test: `platform db sync` installs byte copies Prisma accepts
// (issue #710, PP-5.3)
// =============================================================================
//
// `platform.lock` rests on one claim from ADR 0002 (D3): when a package
// migration is copied byte for byte into an app's history under a new
// directory name, Prisma stores the SHA-256 of THOSE bytes in
// `_prisma_migrations.checksum`, which is also the `sha256` the lock records.
// A mocked Prisma cannot prove that, so this suite builds a fixture package
// and a fixture app, runs the real `platform` bin to install, applies the
// result to a scratch database with the real `prisma migrate deploy`, and
// reads the ledger back.
//
// It also pins the reason `platform db check --database` exists: Prisma's
// `migrate deploy` stays silent about an applied migration whose file was
// edited afterwards.
//
// A `*.db.spec.ts` file: runs via `npm run test:db` (the `smoke` job), never
// `npm test`. Needs `npm run build:packages` first (the bin runs dist/).
// =============================================================================

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDatabaseUrl } from '../../src/common/database-url';
import {
  createDatabase,
  dropDatabase,
  resolveAdminConnection,
  withAdminConnection,
  type AdminConnection,
} from '../../src/db-backup/admin-connection.util';
import { resolveDbSuite } from '../jobs/db-test-support';
import { envFor, prismaClientFor } from '../helpers/scratch-database.helper';

const { describeWithDb } = resolveDbSuite('platform-sync.db.spec');

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PLATFORM_BIN = join(REPO_ROOT, 'packages', 'platform-db', 'bin', 'platform.mjs');
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const DATABASE = `platform_sync_${process.pid}`;

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** The fixture package history: the third file has CRLF line endings on purpose. */
const PACKAGE_SQL: Record<string, string> = {
  '0001_initial': '-- CreateTable\nCREATE TABLE "psync_users" (\n    "id" UUID NOT NULL,\n    CONSTRAINT "psync_users_pkey" PRIMARY KEY ("id")\n);\n',
  '0002_add_orgs':
    '-- CreateTable\nCREATE TABLE "psync_orgs" (\n    "id" UUID NOT NULL,\n    "slug" TEXT NOT NULL,\n    CONSTRAINT "psync_orgs_pkey" PRIMARY KEY ("id")\n);\n',
  '0003_add_org_slug_index': '-- CreateIndex\r\nCREATE UNIQUE INDEX "psync_orgs_slug_key" ON "psync_orgs"("slug");\r\n',
};

interface Workspace {
  root: string;
  packageDir: string;
  appDir: string;
  migrationsDir: string;
}

function buildWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'platform-sync-db-'));
  const packageDir = join(root, 'package');
  const appDir = join(root, 'app');
  const migrationsDir = join(appDir, 'prisma', 'migrations');

  mkdirSync(join(packageDir, 'migrations'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), '{ "name": "@marinoscar/platform-db", "version": "0.1.0" }\n');
  const manifest = Object.entries(PACKAGE_SQL).map(([id, sql], i) => {
    mkdirSync(join(packageDir, 'migrations', id));
    writeFileSync(join(packageDir, 'migrations', id, 'migration.sql'), sql);
    return { id, dir: id, sha256: sha256(sql), since: '0.1.0', slice: i === 0 ? 'core' : 'orgs', requires: [] as string[] };
  });
  writeFileSync(join(packageDir, 'migrations', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // An app-authored migration older than anything the sync installs.
  mkdirSync(join(migrationsDir, '20260101000000_app_base'), { recursive: true });
  writeFileSync(
    join(migrationsDir, '20260101000000_app_base', 'migration.sql'),
    'CREATE TABLE "psync_app_things" ("id" UUID NOT NULL, CONSTRAINT "psync_app_things_pkey" PRIMARY KEY ("id"));\n',
  );
  writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"\n');

  // A minimal Prisma project: `migrate deploy` only needs the provider and the migrations path.
  writeFileSync(
    join(appDir, 'prisma', 'schema.prisma'),
    'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n',
  );
  writeFileSync(
    join(appDir, 'prisma.config.js'),
    "module.exports = { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } };\n",
  );
  return { root, packageDir, appDir, migrationsDir };
}

describeWithDb('platform db sync against real Postgres', () => {
  let admin: AdminConnection;
  let ws: Workspace;
  let databaseUrl: string;
  let created = false;

  const platform = (...args: string[]) =>
    spawnSync(process.execPath, [PLATFORM_BIN, 'db', ...args, '--root', ws.appDir, '--package-dir', ws.packageDir], {
      cwd: ws.appDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });

  const prismaDeploy = () =>
    spawnSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
      cwd: ws.appDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    });

  const localDirs = (): string[] => readdirSync(ws.migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();

  beforeAll(async () => {
    if (DATABASE === process.env.POSTGRES_DB) throw new Error('refusing to use the shared test database');
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    await withAdminConnection(admin, (client) => createDatabase(client, DATABASE));
    created = true;
    databaseUrl = buildDatabaseUrl(envFor(DATABASE));

    ws = buildWorkspace();
    const sync = platform('sync');
    if (sync.status !== 0) throw new Error(`platform db sync failed: ${sync.stderr}${sync.stdout}`);
    const deploy = prismaDeploy();
    if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed: ${deploy.stderr}${deploy.stdout}`);
  }, 120_000);

  afterAll(async () => {
    if (created) await withAdminConnection(admin, (client) => dropDatabase(client, DATABASE));
    if (ws) rmSync(ws.root, { recursive: true, force: true });
  });

  it('installs the history after the app-authored migration, and the lock records every hash', () => {
    const dirs = localDirs();
    expect(dirs).toHaveLength(4);
    expect(dirs[0]).toBe('20260101000000_app_base');
    expect(dirs.slice(1).map((d) => d.replace(/^\d{14}_/, ''))).toEqual(['initial', 'add_orgs', 'add_org_slug_index']);

    const lock = JSON.parse(readFileSync(join(ws.appDir, 'prisma', 'platform.lock'), 'utf8'));
    expect(lock.migrations.map((m: { originId: string }) => m.originId)).toEqual([
      'platform:0001_initial',
      'platform:0002_add_orgs',
      'platform:0003_add_org_slug_index',
    ]);
  });

  it('_prisma_migrations.checksum equals the sha256 of the package file, byte for byte', async () => {
    const prisma = prismaClientFor(DATABASE);
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string; checksum: string }[]>`
        SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at, migration_name`;
      expect(rows.map((r) => r.migration_name)).toEqual(localDirs());

      const lock = JSON.parse(readFileSync(join(ws.appDir, 'prisma', 'platform.lock'), 'utf8')) as {
        migrations: { originId: string; localDir: string; sha256: string }[];
      };
      for (const entry of lock.migrations) {
        const packageFile = readFileSync(join(ws.packageDir, 'migrations', entry.originId.replace('platform:', ''), 'migration.sql'));
        const row = rows.find((r) => r.migration_name === entry.localDir);
        expect(row?.checksum).toBe(sha256(packageFile));
        expect(row?.checksum).toBe(entry.sha256);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('check and check --database pass on the applied history', () => {
    expect(platform('check').status).toBe(0);
    const ledger = platform('check', '--database');
    expect(ledger.status).toBe(0);
    expect(ledger.stdout).toContain('4 ledger row(s) match the files');
  });

  it('catches an edit to an applied migration that prisma migrate deploy does not notice', () => {
    const file = join(ws.migrationsDir, localDirs()[2]!, 'migration.sql');
    const original = readFileSync(file);
    try {
      writeFileSync(file, Buffer.concat([Buffer.from('-- harmless-looking comment\n'), original]));

      // Prisma is silent: nothing pending, exit 0.
      const deploy = prismaDeploy();
      expect(deploy.status).toBe(0);
      expect(`${deploy.stdout}${deploy.stderr}`).not.toMatch(/modified|checksum/i);

      // The lock is not.
      const offline = platform('check');
      expect(offline.status).toBe(1);
      expect(offline.stderr).toMatch(/LOCAL_MODIFIED\s+platform:0002_add_orgs/);

      // And neither is the ledger comparison.
      const ledger = platform('check', '--database');
      expect(ledger.status).toBe(1);
      expect(ledger.stderr).toContain('LEDGER_CHECKSUM_MISMATCH');
    } finally {
      writeFileSync(file, original);
    }
    expect(platform('check', '--database').status).toBe(0);
  });

  it('a second sync installs nothing and leaves the history as it was', () => {
    const before = localDirs();
    const run = platform('sync');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('up to date');
    expect(localDirs()).toEqual(before);
  });
});

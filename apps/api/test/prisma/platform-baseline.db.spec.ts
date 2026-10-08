// =============================================================================
// Real-Postgres test: `platform db baseline` adopts the package history in a
// database that already has its schema (issue #711, PP-5.4)
// =============================================================================
//
// ADR 0002 D4 rests on claims a mocked Prisma cannot prove: that the replayed
// package history diffs cleanly against a live database, that `prisma migrate
// resolve --applied` records a migration without running it, that the resolved
// row carries the package file's checksum, and that a FRESH database built from
// the adopted history still deploys (the placement rule). This suite builds
// "fork" databases with the real Prisma CLI and runs the real `platform` bin.
//
// Two scenarios:
//   1. A fixture fork: one directory renamed (matched by hash), one migration
//      the app wrote differently under an app-only name (operator map), one
//      migration whose effect is in the database under an app-only name with no
//      directory for it (installed and resolved), and a partial raw-SQL index.
//   2. The real platform history v1: the base app's 22 migrations with an
//      EvoPath-like renamed `add_worker_node_vitals`, a comment-only edit, a
//      `add_job_trace_context` the fork replaced by its own `IF NOT EXISTS`
//      twin, and a column the app added to `push_subscriptions` (a deviation).
//
// A `*.db.spec.ts` file: runs via `npm run test:db` (the `smoke` job), never
// `npm test`. Needs `npm run build:packages` first (the bin runs dist/).
// =============================================================================

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const { describeWithDb } = resolveDbSuite('platform-baseline.db.spec');

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PLATFORM_DB = join(REPO_ROOT, 'packages', 'platform-db');
const PLATFORM_BIN = join(PLATFORM_DB, 'bin', 'platform.js');
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const SUFFIX = `${process.pid}`;

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const lines = (r: { stdout: string; stderr: string }): string => `${r.stdout}\n${r.stderr}`;

// ---- shared scaffolding ----------------------------------------------------------------------------------------------------

/** A throwaway Prisma project: `prisma.config.js`, a stub `scripts/prisma-env.js` that runs the real CLI, a minimal schema. */
function scaffoldApp(root: string): { appDir: string; prismaDir: string; migrationsDir: string } {
  const appDir = join(root, 'app');
  const prismaDir = join(appDir, 'prisma');
  const migrationsDir = join(prismaDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  mkdirSync(join(appDir, 'scripts'), { recursive: true });
  writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  writeFileSync(
    join(prismaDir, 'schema.prisma'),
    'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n',
  );
  writeFileSync(
    join(appDir, 'prisma.config.js'),
    "module.exports = { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL, shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } };\n",
  );
  // The baseline runs every Prisma call through <root>/scripts/prisma-env.js, exactly as in apps/api.
  writeFileSync(
    join(appDir, 'scripts', 'prisma-env.js'),
    "const { spawnSync } = require('child_process');\nconst r = spawnSync(process.execPath, [process.env.PRISMA_CLI, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });\nprocess.exit(r.status === null ? 1 : r.status);\n",
  );
  return { appDir, prismaDir, migrationsDir };
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
}

describeWithDb('platform db baseline against real Postgres', () => {
  let admin: AdminConnection;
  const created: string[] = [];
  const roots: string[] = [];

  const makeDatabase = async (name: string): Promise<string> => {
    if (name === process.env.POSTGRES_DB) throw new Error('refusing to use the shared test database');
    await withAdminConnection(admin, (client) => createDatabase(client, name));
    created.push(name);
    return buildDatabaseUrl(envFor(name));
  };

  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'platform-baseline-db-'));
    roots.push(dir);
    return dir;
  };

  const cli = (command: string, args: string[], cwd: string, databaseUrl: string) =>
    spawnSync(process.execPath, command === 'platform' ? [PLATFORM_BIN, ...args] : [PRISMA_CLI, ...args], {
      cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_CLI },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  beforeAll(() => {
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
  });

  afterAll(async () => {
    for (const name of created) await withAdminConnection(admin, (client) => dropDatabase(client, name));
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  // ---- 1. the fixture fork ----------------------------------------------------------------------------------------------------

  describe('a fork with a renamed directory, an operator-mapped one and a migration with no directory', () => {
    const PKG: Record<string, string> = {
      '0001_initial': '-- CreateTable\nCREATE TABLE "pbl_users" (\n    "id" UUID NOT NULL,\n    CONSTRAINT "pbl_users_pkey" PRIMARY KEY ("id")\n);\n',
      '0002_add_orgs': '-- CreateTable\nCREATE TABLE "pbl_orgs" (\n    "id" UUID NOT NULL,\n    "slug" TEXT NOT NULL,\n    CONSTRAINT "pbl_orgs_pkey" PRIMARY KEY ("id")\n);\n',
      '0003_add_org_slug_index': '-- CreateIndex\nCREATE UNIQUE INDEX "pbl_orgs_slug_key" ON "pbl_orgs"("slug");\n',
      '0004_add_org_name': '-- AlterTable\nALTER TABLE "pbl_orgs" ADD COLUMN "name" TEXT;\n',
      '0005_add_org_active_index': '-- CreateIndex\nCREATE UNIQUE INDEX "pbl_orgs_active_idx" ON "pbl_orgs"("name") WHERE "name" IS NOT NULL;\n',
    };
    const ACTIVE_INDEX = 'CREATE UNIQUE INDEX pbl_orgs_active_idx ON public.pbl_orgs USING btree (name) WHERE (name IS NOT NULL)';
    const SLUG_TWIN = 'CREATE UNIQUE INDEX IF NOT EXISTS "pbl_orgs_slug_key" ON "pbl_orgs"("slug");\n';
    const NAME_TWIN = 'ALTER TABLE "pbl_orgs" ADD COLUMN IF NOT EXISTS "name" TEXT;\n';
    const APP: Record<string, string> = {
      '20260101000000_initial': PKG['0001_initial']!,
      '20260102000000_orgs_renamed': PKG['0002_add_orgs']!, // 0002 under another name
      '20260103000000_orgs_slug_unique': SLUG_TWIN, // 0003, written differently: needs --map
      '20260104000000_app_add_org_name': NAME_TWIN, // 0004's effect under an app-only name: no directory for it
      '20260105000000_add_org_active_index': PKG['0005_add_org_active_index']!,
    };

    let url: string;
    let appDir: string;
    let prismaDir: string;
    let migrationsDir: string;
    let packageDir: string;
    let mapFile: string;
    let prisma: ReturnType<typeof prismaClientFor>;
    const DATABASE = `platform_baseline_${SUFFIX}`;

    const platform = (...args: string[]) =>
      cli('platform', ['db', 'baseline', ...args, '--root', appDir, '--package-dir', packageDir], appDir, url);
    const status = () => cli('prisma', ['migrate', 'status'], appDir, url);
    const ledger = async () =>
      prisma.$queryRaw<{ migration_name: string; checksum: string; applied_steps_count: number; finished: boolean }[]>`
        SELECT migration_name, checksum, applied_steps_count, finished_at IS NOT NULL AS finished FROM _prisma_migrations ORDER BY migration_name`;
    const localDirs = (): string[] => readdirSync(migrationsDir).filter((d) => /^\d{14}_/.test(d)).sort();
    const tree = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, name.name);
          if (name.isDirectory()) walk(path);
          else out[path.slice(appDir.length)] = readFileSync(path, 'utf8');
        }
      };
      walk(prismaDir);
      return out;
    };

    beforeAll(async () => {
      url = await makeDatabase(DATABASE);
      const root = tmp();
      packageDir = join(root, 'package');
      write(packageDir, 'package.json', '{ "name": "@marinoscar/platform-db", "version": "0.1.0" }\n');
      const manifest = Object.entries(PKG).map(([id, sql]) => {
        write(join(packageDir, 'migrations', id), 'migration.sql', sql);
        return { id, dir: id, sha256: sha256(sql), since: '0.1.0', slice: 'core', requires: [] as string[] };
      });
      write(join(packageDir, 'migrations'), 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
      write(
        packageDir,
        'raw-sql-indexes.json',
        JSON.stringify({ indexes: [{ name: 'pbl_orgs_active_idx', table: 'pbl_orgs', unique: true, definition: ACTIVE_INDEX, reason: 'fixture', doc: 'docs/x.md', createdIn: '0005_add_org_active_index' }] }),
      );

      ({ appDir, prismaDir, migrationsDir } = scaffoldApp(root));
      for (const [dir, sql] of Object.entries(APP)) write(join(migrationsDir, dir), 'migration.sql', sql);
      mapFile = join(root, 'map.json');
      writeFileSync(mapFile, JSON.stringify({ 'platform:0003_add_org_slug_index': '20260103000000_orgs_slug_unique' }));

      const deploy = cli('prisma', ['migrate', 'deploy'], appDir, url);
      if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed: ${lines(deploy)}`);
      prisma = prismaClientFor(DATABASE);
    }, 180_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('a dry run maps by hash and by operator map, finds the diff empty, and changes nothing', async () => {
      const filesBefore = tree();
      const rowsBefore = await ledger();

      const run = platform('--map', mapFile);

      expect(run.status).toBe(0);
      const out = run.stdout;
      expect(out).toContain('DRY RUN (nothing was written)');
      expect(out).toMatch(/platform:0001_initial -> 20260101000000_initial\s+\[sha256\]/);
      expect(out).toMatch(/platform:0002_add_orgs -> 20260102000000_orgs_renamed\s+\[sha256\]/); // a rename is irrelevant
      expect(out).toMatch(/platform:0003_add_org_slug_index -> 20260103000000_orgs_slug_unique\s+\[operator-map, localSha256 recorded\]/);
      expect(out).toMatch(/platform:0004_add_org_name -> \(no local directory\)/);
      expect(out).toContain('app-only: 20260104000000_app_add_org_name');
      expect(out).toContain('B3 diff (package history to platform:0005_add_org_active_index -> live database): 0 blocking');
      expect(out).toContain('B4 raw-SQL indexes: 0 problem(s)');
      expect(out).toContain('would resolve --applied 20260103000001_add_org_name (installed first)');

      expect(tree()).toEqual(filesBefore);
      expect(await ledger()).toEqual(rowsBefore);
      expect(existsSync(join(prismaDir, 'platform.lock'))).toBe(false);
    }, 120_000);

    it('a non-empty diff exits non-zero, prints the blocking statement and writes nothing', async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE "pbl_orgs" ADD COLUMN "extra" TEXT');
      try {
        const filesBefore = tree();
        const rowsBefore = await ledger();
        const run = platform('--map', mapFile, '--apply');
        expect(run.status).toBe(1);
        expect(lines(run)).toContain('BLOCKING: ALTER TABLE "pbl_orgs" ADD COLUMN "extra" TEXT;');
        expect(lines(run)).toContain('DIFF_BLOCKING');
        expect(lines(run)).toContain('nothing was written');
        expect(tree()).toEqual(filesBefore);
        expect(await ledger()).toEqual(rowsBefore);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "pbl_orgs" DROP COLUMN "extra"');
      }
    }, 120_000);

    it('a raw-SQL index dropped by hand is invisible to Prisma but refused by the pg_indexes assertion', async () => {
      await prisma.$executeRawUnsafe('DROP INDEX "pbl_orgs_active_idx"');
      try {
        const run = platform('--map', mapFile, '--apply');
        expect(run.status).toBe(1);
        expect(lines(run)).toContain('B3 diff (package history to platform:0005_add_org_active_index -> live database): 0 blocking');
        expect(lines(run)).toContain('INDEX_MISSING  pbl_orgs_active_idx: not in pg_indexes');
        expect(existsSync(join(prismaDir, 'platform.lock'))).toBe(false);

        // Re-created without its WHERE clause: still refused, by the definition compare.
        await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX "pbl_orgs_active_idx" ON "pbl_orgs"("name")');
        const weak = platform('--map', mapFile, '--apply');
        expect(weak.status).toBe(1);
        expect(lines(weak)).toContain('INDEX_DEFINITION_DIFFERS');
      } finally {
        await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "pbl_orgs_active_idx"');
        await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX "pbl_orgs_active_idx" ON "pbl_orgs"("name") WHERE "name" IS NOT NULL');
      }
    }, 120_000);

    it('a failed _prisma_migrations row blocks --apply and points to the runbook', async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('baseline-test-failed', 'x', '20260106000000_failed', now(), 0)`,
      );
      try {
        const filesBefore = tree();
        const run = platform('--map', mapFile, '--apply');
        expect(run.status).toBe(1);
        expect(lines(run)).toContain('LEDGER_FAILED_ROW');
        expect(lines(run)).toContain('20260106000000_failed: never finished');
        expect(lines(run)).toContain('docs/runbooks/database-baseline.md');
        expect(tree()).toEqual(filesBefore);
      } finally {
        await prisma.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'baseline-test-failed'`);
      }
    }, 120_000);

    it('--apply installs and resolves the missing migration, writes the lock, and migrate status is clean', async () => {
      const rowsBefore = await ledger();
      expect(rowsBefore).toHaveLength(5);

      const run = platform('--map', mapFile, '--apply');

      expect(run.status).toBe(0);
      expect(run.stdout).toContain('baseline applied and verified');
      const created = '20260103000001_add_org_name';
      expect(localDirs()).toEqual([...Object.keys(APP), created].sort());
      expect(readFileSync(join(migrationsDir, created, 'migration.sql'), 'utf8')).toBe(PKG['0004_add_org_name']);

      // The ledger gained exactly the resolved row: the package file's checksum, nothing run.
      const rowsAfter = await ledger();
      expect(rowsAfter).toHaveLength(6);
      expect(rowsAfter.filter((r) => !rowsBefore.some((b) => b.migration_name === r.migration_name))).toEqual([
        { migration_name: created, checksum: sha256(PKG['0004_add_org_name']!), applied_steps_count: 0, finished: true },
      ]);
      for (const before of rowsBefore) expect(rowsAfter).toContainEqual(before);

      const lock = JSON.parse(readFileSync(join(prismaDir, 'platform.lock'), 'utf8')) as {
        migrations: { originId: string; localDir: string; sha256: string; localSha256?: string }[];
      };
      expect(lock.migrations.map((m) => [m.originId, m.localDir])).toEqual([
        ['platform:0001_initial', '20260101000000_initial'],
        ['platform:0002_add_orgs', '20260102000000_orgs_renamed'],
        ['platform:0003_add_org_slug_index', '20260103000000_orgs_slug_unique'],
        ['platform:0004_add_org_name', created],
        ['platform:0005_add_org_active_index', '20260105000000_add_org_active_index'],
      ]);
      expect(lock.migrations[2]!.localSha256).toBe(sha256(SLUG_TWIN));

      const prismaStatus = status();
      expect(prismaStatus.status).toBe(0);
      expect(lines(prismaStatus)).toContain('Database schema is up to date!');
      expect(cli('prisma', ['migrate', 'deploy'], appDir, url).stdout).toContain('No pending migrations to apply.');

      const check = cli('platform', ['db', 'check', '--database', '--root', appDir, '--package-dir', packageDir], appDir, url);
      expect(check.status).toBe(0);
    }, 180_000);

    it('a second run has nothing to do, and --apply is refused without --force-remap', () => {
      const again = platform('--map', mapFile);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain('nothing to do');
      const refused = platform('--map', mapFile, '--apply');
      expect(refused.status).toBe(1);
      expect(lines(refused)).toContain('LOCK_NOT_EMPTY');
    }, 120_000);

    it('a FRESH database built from the adopted history deploys: the baselined directory sorts after its predecessor', async () => {
      const freshUrl = await makeDatabase(`${DATABASE}_fresh`);
      const deploy = cli('prisma', ['migrate', 'deploy'], appDir, freshUrl);
      expect(deploy.status).toBe(0);
      expect(lines(deploy)).toContain('All migrations have been successfully applied.');
      const fresh = prismaClientFor(`${DATABASE}_fresh`);
      try {
        const columns = await fresh.$queryRaw<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns WHERE table_name = 'pbl_orgs' ORDER BY column_name`;
        expect(columns.map((c) => c.column_name)).toEqual(['id', 'name', 'slug']);
      } finally {
        await fresh.$disconnect();
      }
    }, 180_000);
  });

  // ---- 2. the real platform history v1 ------------------------------------------------------------------------------------

  describe('the real platform history v1 (a database migrated from the pre-package history)', () => {
    const DATABASE = `platform_baseline_real_${SUFFIX}`;
    let url: string;
    let appDir: string;
    let prismaDir: string;
    let migrationsDir: string;
    let prisma: ReturnType<typeof prismaClientFor>;

    const platform = (...args: string[]) =>
      cli('platform', ['db', 'baseline', ...args, '--root', appDir, '--package-dir', PLATFORM_DB], appDir, url);

    beforeAll(async () => {
      url = await makeDatabase(DATABASE);
      ({ appDir, prismaDir, migrationsDir } = scaffoldApp(tmp()));
      const source = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations');
      for (const dir of readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory())) {
        cpSync(join(source, dir.name), join(migrationsDir, dir.name), { recursive: true });
      }
      // An EvoPath-like fork: add_worker_node_vitals under another id; a comment-only edit; its own IF NOT EXISTS twin of add_job_trace_context.
      renameSync(join(migrationsDir, '20260928100000_add_worker_node_vitals'), join(migrationsDir, '20260929090000_worker_node_vitals'));
      rmSync(join(migrationsDir, '20260930120000_add_job_trace_context'), { recursive: true });
      write(
        join(migrationsDir, '20260930200000_fork_trace_context'),
        'migration.sql',
        '-- the fork wrote its own version of the same change\nALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "trace_context" text;\n',
      );
      const revoke = join(migrationsDir, '20260927000000_revoke_viewer_ai_use', 'migration.sql');
      writeFileSync(revoke, `-- fork: renumbered issue reference #9999\n${readFileSync(revoke, 'utf8')}`);

      const deploy = cli('prisma', ['migrate', 'deploy'], appDir, url);
      if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed: ${lines(deploy)}`);
      prisma = prismaClientFor(DATABASE);
      await prisma.$executeRawUnsafe('ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT');
    }, 300_000);

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('refuses until the column the app added to a platform table is declared as a deviation, then baselines cleanly', async () => {
      const refused = platform();
      expect(refused.status).toBe(1);
      expect(lines(refused)).toContain('BLOCKING: ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT;');
      expect(existsSync(join(prismaDir, 'platform.lock'))).toBe(false);

      writeFileSync(
        join(prismaDir, 'platform.lock'),
        JSON.stringify({
          lockVersion: 1,
          platformVersion: '1.0.0',
          migrations: [],
          deviations: [
            {
              id: 'fork:push_subscriptions.platform',
              reason: 'the fork stores the push platform',
              expectDiff: ['ALTER TABLE "push_subscriptions" ADD COLUMN "platform" TEXT;'],
            },
          ],
        }),
      );
      const rowsBefore = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM _prisma_migrations`;
      const dry = platform();
      expect(dry.status).toBe(0);
      // 0027_add_grants (#729), 0028_add_org_settings (#733) and 0029_add_org_credentials (#735) are three more matched migrations,
      // and 0030_add_jobs_org_id and 0031_add_jobs_org_id_status_index (#734) two more,
      // and 0032_add_broadcast_target_org (#738) one more.
      expect(dry.stdout).toContain('31 matched, 1 unmatched, 1 app-only');
      expect(dry.stdout).toContain('platform:0017_revoke_viewer_ai_use -> 20260927000000_revoke_viewer_ai_use  [normalised, localSha256 recorded]');
      expect(dry.stdout).toMatch(/platform:0020_add_worker_node_vitals -> 20260929090000_worker_node_vitals\s+\[sha256\]/);
      expect(dry.stdout).toContain('would resolve --applied 20260929090001_add_job_trace_context (installed first)');
      expect(await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM _prisma_migrations`).toEqual(rowsBefore);

      const applied = platform('--apply');
      expect(applied.status).toBe(0);
      expect(applied.stdout).toContain('baseline applied and verified');

      const rows = await prisma.$queryRaw<{ migration_name: string; applied_steps_count: number }[]>`
        SELECT migration_name, applied_steps_count FROM _prisma_migrations WHERE migration_name LIKE '%add_job_trace_context'`;
      expect(rows).toEqual([{ migration_name: '20260929090001_add_job_trace_context', applied_steps_count: 0 }]);
      expect(cli('prisma', ['migrate', 'status'], appDir, url).stdout).toContain('Database schema is up to date!');
      expect(cli('prisma', ['migrate', 'deploy'], appDir, url).stdout).toContain('No pending migrations to apply.');
      const check = cli('platform', ['db', 'check', '--database', '--root', appDir, '--package-dir', PLATFORM_DB], appDir, url);
      expect(check.status).toBe(0);
      const again = platform();
      expect(again.stdout).toContain('nothing to do');
    }, 300_000);

    it('a fresh database built from the adopted history deploys and carries the four raw-SQL indexes', async () => {
      const freshUrl = await makeDatabase(`${DATABASE}_fresh`);
      const deploy = cli('prisma', ['migrate', 'deploy'], appDir, freshUrl);
      expect(deploy.status).toBe(0);
      const fresh = prismaClientFor(`${DATABASE}_fresh`);
      try {
        const indexes = await fresh.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pg_indexes WHERE indexname IN ('jobs_active_dedup_uniq_idx','jobs_attempts_gt1_idx','jobs_succeeded_duration_idx','database_backup_runs_active_uniq_idx')`;
        expect(Number(indexes[0]!.n)).toBe(4);
      } finally {
        await fresh.$disconnect();
      }
    }, 300_000);
  });
});

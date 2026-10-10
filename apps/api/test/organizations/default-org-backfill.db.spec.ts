// =============================================================================
// Real-Postgres test: the organizations migration and its default-org backfill
// (issue #721, PP-6.1)
// =============================================================================
//
// `0023_add_organizations` adds Organization, Membership and Invite, the
// nullable `org_id` on the three token tables, the partial unique index
// `organizations_default_uniq_idx`, and a forward-only backfill. A mocked
// Prisma proves none of it, so two scratch databases do:
//
//   1. BACKFILL. A database migrated to the state of `main` BEFORE this
//      migration (every other app migration applied, this one held back) is
//      given three users, their refresh tokens, a personal access token and a
//      device code. Then the migration is applied. The default org must exist,
//      every user must be an active member, and every credential row must carry
//      the default org id.
//   2. EMPTY DATABASE and the one-default invariant: migrated from scratch, the
//      default org exists exactly once with no memberships, a second default is
//      refused by the partial unique index (not by a findFirst), and a
//      non-default org is accepted.
//
// A `*.db.spec.ts` file: runs via `npm run test:db`, never `npm test`.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { buildDatabaseUrl } from '../../src/common/database-url';
import { createDatabase, dropDatabase, resolveAdminConnection, withAdminConnection, type AdminConnection } from '@marinoscar/platform-api/db-backup/testing';
import { resolveDbSuite } from '../jobs/db-test-support';
import { envFor, migrateDeploy, prismaClientFor } from '../helpers/scratch-database.helper';

const { describeWithDb } = resolveDbSuite('default-org-backfill.db.spec');

const API_ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(API_ROOT, 'prisma', 'migrations');
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const MIGRATION_ORIGIN_ID = 'platform:0023_add_organizations';
const BACKFILL = `org_backfill_${process.pid}`;
const EMPTY = `org_empty_${process.pid}`;

interface LockFile {
  migrations: { originId: string; localDir: string }[];
}
const lock = JSON.parse(readFileSync(join(API_ROOT, 'prisma', 'platform.lock'), 'utf8')) as LockFile;
const orgMigrationDir = lock.migrations.find((m) => m.originId === MIGRATION_ORIGIN_ID)?.localDir;

/** `prisma migrate deploy` in a scratch project holding exactly the migration directories in `scratchRoot`. */
function deployScratch(scratchRoot: string, database: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: scratchRoot,
    env: { ...process.env, DATABASE_URL: buildDatabaseUrl(envFor(database)) },
    stdio: 'pipe',
  });
}

describeWithDb('organizations migration against real Postgres', () => {
  let admin: AdminConnection;
  const created: string[] = [];
  let scratchRoot = '';
  let prisma: PrismaClient;
  let emptyPrisma: PrismaClient;

  const userIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];

  beforeAll(async () => {
    if (!orgMigrationDir) throw new Error(`platform.lock has no ${MIGRATION_ORIGIN_ID}`);
    if ([BACKFILL, EMPTY].includes(process.env.POSTGRES_DB ?? '')) throw new Error('refusing to use the shared test database');
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    for (const name of [BACKFILL, EMPTY]) {
      await withAdminConnection(admin, (client) => createDatabase(client, name));
      created.push(name);
    }

    // The state of main before this change: every app migration that sorts
    // before it (later ones, such as PP-6.3's role split, build on its tables).
    scratchRoot = mkdtempSync(join(tmpdir(), 'org-backfill-'));
    const migrations = join(scratchRoot, 'prisma', 'migrations');
    mkdirSync(migrations, { recursive: true });
    for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (dir.isDirectory() && dir.name < orgMigrationDir) cpSync(join(MIGRATIONS, dir.name), join(migrations, dir.name), { recursive: true });
    }
    writeFileSync(join(migrations, 'migration_lock.toml'), 'provider = "postgresql"\n');
    writeFileSync(
      join(scratchRoot, 'prisma', 'schema.prisma'),
      'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n}\n',
    );
    writeFileSync(
      join(scratchRoot, 'prisma.config.js'),
      "module.exports = { schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' }, datasource: { url: process.env.DATABASE_URL } };\n",
    );
    deployScratch(scratchRoot, BACKFILL);

    prisma = prismaClientFor(BACKFILL);
    // Pre-migration rows, written with raw SQL: the Prisma client already knows `org_id`.
    for (const [i, id] of userIds.entries()) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO users (id, email, updated_at) VALUES ($1::uuid, $2, now())`,
        id,
        `member${i + 1}@example.test`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1::uuid, $2, now() + interval '1 day')`,
        id,
        `refresh-hash-${i + 1}`,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO personal_access_tokens (id, user_id, name, token_hash, token_prefix, duration_value, duration_unit, expires_at)
       VALUES (gen_random_uuid(), $1::uuid, 'ci', 'pat-hash-1', 'pat_', 30, 'days', now() + interval '30 days')`,
      userIds[0],
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO device_codes (id, device_code, user_code, user_id, status, expires_at, updated_at)
       VALUES (gen_random_uuid(), 'device-code-1', 'USER-CODE', $1::uuid, 'approved', now() + interval '15 minutes', now())`,
      userIds[1],
    );
    expect(await prisma.$queryRawUnsafe(`SELECT to_regclass('public.organizations')::text AS t`)).toEqual([{ t: null }]);

    // Now the migration under test.
    cpSync(join(MIGRATIONS, orgMigrationDir), join(migrations, orgMigrationDir), { recursive: true });
    deployScratch(scratchRoot, BACKFILL);

    migrateDeploy(EMPTY);
    emptyPrisma = prismaClientFor(EMPTY);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await emptyPrisma?.$disconnect();
    for (const name of created) await withAdminConnection(admin, (client) => dropDatabase(client, name));
    if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
  });

  describe('backfill on a database migrated from main with existing users and tokens', () => {
    it('creates exactly one default organization named "Default organization" with slug "default"', async () => {
      const orgs = await prisma.$queryRawUnsafe<{ slug: string; name: string; is_default: boolean }[]>(
        `SELECT slug, name, is_default FROM organizations`,
      );
      expect(orgs).toEqual([{ slug: 'default', name: 'Default organization', is_default: true }]);
    });

    it('makes every existing user an active member of it', async () => {
      const rows = await prisma.$queryRawUnsafe<{ user_id: string; status: string; last_active_at: Date | null }[]>(
        `SELECT m.user_id, m.status::text AS status, m.last_active_at
         FROM memberships m JOIN organizations o ON o.id = m.org_id AND o.is_default
         ORDER BY m.user_id`,
      );
      expect(rows.map((r) => [r.user_id, r.status])).toEqual(userIds.map((id) => [id, 'active']));
      expect(rows.every((r) => r.last_active_at instanceof Date)).toBe(true);
      expect(await prisma.membership.count()).toBe(3);
    });

    it('gives every refresh token, personal access token and device code the default org id', async () => {
      const [{ id: defaultOrgId }] = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM organizations WHERE is_default`);
      const counts = await prisma.$queryRawUnsafe<{ table: string; total: bigint; in_default: bigint }[]>(
        `SELECT 'refresh_tokens' AS "table", count(*) AS total, count(*) FILTER (WHERE org_id = $1::uuid) AS in_default FROM refresh_tokens
         UNION ALL SELECT 'personal_access_tokens', count(*), count(*) FILTER (WHERE org_id = $1::uuid) FROM personal_access_tokens
         UNION ALL SELECT 'device_codes', count(*), count(*) FILTER (WHERE org_id = $1::uuid) FROM device_codes
         ORDER BY 1`,
        defaultOrgId,
      );
      expect(counts.map((c) => [c.table, Number(c.total), Number(c.in_default)])).toEqual([
        ['device_codes', 1, 1],
        ['personal_access_tokens', 1, 1],
        ['refresh_tokens', 3, 3],
      ]);
    });

    it('is recorded once in the migrations ledger', async () => {
      const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1`,
        orgMigrationDir,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('on a database migrated from scratch', () => {
    it('has the default organization and no memberships', async () => {
      expect(await emptyPrisma.organization.findMany({ select: { slug: true, isDefault: true } })).toEqual([
        { slug: 'default', isDefault: true },
      ]);
      expect(await emptyPrisma.membership.count()).toBe(0);
    });

    it('refuses a second default organization with a unique violation on organizations_default_uniq_idx', async () => {
      const insert = emptyPrisma.$executeRawUnsafe(
        `INSERT INTO organizations (id, name, slug, is_default, updated_at) VALUES (gen_random_uuid(), 'Second', 'second', true, now())`,
      );
      await expect(insert).rejects.toThrow(/organizations_default_uniq_idx/);

      await expect(
        emptyPrisma.organization.create({ data: { name: 'Second', slug: 'second', isDefault: true } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await emptyPrisma.organization.count({ where: { isDefault: true } })).toBe(1);
    });

    it('accepts any number of non-default organizations', async () => {
      await emptyPrisma.organization.createMany({
        data: [
          { name: 'Acme', slug: 'acme' },
          { name: 'Globex', slug: 'globex' },
        ],
      });
      expect(await emptyPrisma.organization.count()).toBe(3);
      expect(await emptyPrisma.organization.count({ where: { isDefault: true } })).toBe(1);
    });

    it('refuses to promote a second organization to default', async () => {
      await expect(emptyPrisma.organization.update({ where: { slug: 'acme' }, data: { isDefault: true } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('keeps one membership per user and organization, and removes memberships with the user', async () => {
      const org = await emptyPrisma.organization.findFirstOrThrow({ where: { isDefault: true } });
      const user = await emptyPrisma.user.create({ data: { email: 'member@example.test' } });
      // PP-6.3 (#723): a membership carries its org role.
      const viewer = await emptyPrisma.role.findUniqueOrThrow({ where: { name: 'viewer' } });
      await emptyPrisma.membership.create({ data: { orgId: org.id, userId: user.id, roleId: viewer.id } });

      await expect(emptyPrisma.membership.create({ data: { orgId: org.id, userId: user.id, roleId: viewer.id } })).rejects.toMatchObject({ code: 'P2002' });

      await emptyPrisma.user.delete({ where: { id: user.id } });
      expect(await emptyPrisma.membership.count({ where: { userId: user.id } })).toBe(0);
    });

    it('deletes credentials with their organization but leaves users alone', async () => {
      const org = await emptyPrisma.organization.create({ data: { name: 'Temp', slug: 'temp' } });
      const user = await emptyPrisma.user.create({ data: { email: 'temp@example.test' } });
      await emptyPrisma.refreshToken.create({
        data: { userId: user.id, orgId: org.id, tokenHash: 'temp-refresh', expiresAt: new Date(Date.now() + 60_000) },
      });

      await emptyPrisma.organization.delete({ where: { id: org.id } });

      expect(await emptyPrisma.refreshToken.count({ where: { tokenHash: 'temp-refresh' } })).toBe(0);
      expect(await emptyPrisma.user.count({ where: { id: user.id } })).toBe(1);
    });
  });
});

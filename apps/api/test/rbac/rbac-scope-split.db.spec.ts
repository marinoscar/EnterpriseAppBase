// =============================================================================
// Real-Postgres test: the system/org role split and its data migration
// (issue #723, PP-6.3)
// =============================================================================
//
// `0024_split_system_org_roles` adds role and permission scopes and the
// membership and invite org role, and MOVES data: admin's org grants go to the
// new `org_admin`, every membership gets its role from the user's global roles,
// and the `user_roles` rows of org roles go. A mocked Prisma proves none of
// that, so two scratch databases do:
//
//   1. MIGRATED FROM MAIN. A database at the state of `main` before this
//      migration (every earlier app migration applied, the pre-split RBAC rows
//      the old seed wrote) gets users holding admin, contributor, viewer,
//      contributor + viewer, no role, and a contributor with no membership.
//      Their effective permissions are recorded from `user_roles` (the old
//      rule). Then the migration is applied and the current seed runs twice.
//      Each user's membership role, kept system role and EFFECTIVE permission
//      set, computed by `PrincipalFactory` against the real rows, are checked:
//      the same as before, plus the four `org_*` permissions for admins.
//   2. FRESH. Migrated from scratch and seeded twice: the scoped catalog, with
//      no grant crossing a scope.
//
// A `*.db.spec.ts` file: runs via `npm run test:db`, never `npm test`.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { platformSeedInputFrom, seedPlatform } from '@marinoscar/platform-db/seed';

import { buildDatabaseUrl } from '../../src/common/database-url';
import {
  createDatabase,
  dropDatabase,
  resolveAdminConnection,
  withAdminConnection,
  type AdminConnection,
} from '../../src/db-backup/admin-connection.util';
import { PRINCIPAL_USER_INCLUDE, resolveEffectiveAccess } from '../../src/auth/principal.factory';
import { SEED_SNAPSHOT } from '../../prisma/seed-data';
import { resolveDbSuite } from '../jobs/db-test-support';
import { envFor, migrateDeploy, prismaClientFor } from '../helpers/scratch-database.helper';

const { describeWithDb } = resolveDbSuite('rbac-scope-split.db.spec');

const API_ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(API_ROOT, 'prisma', 'migrations');
const PRISMA_CLI = require.resolve('prisma/build/index.js');
const MIGRATION_ORIGIN_ID = 'platform:0024_split_system_org_roles';
const LEGACY = `rbac_split_legacy_${process.pid}`;
const FRESH = `rbac_split_fresh_${process.pid}`;

const ORG_PERMISSIONS = ['org_members:read', 'org_members:write', 'org_invites:read', 'org_invites:write'];
/** Declared after the split (#726, PP-6.7), so absent from the pre-split catalog too. */
const LATER_PERMISSIONS = ['organizations:read', 'organizations:write'];
/** The sharing slice's org permissions (#728, PP-7.1): declared after the split too. */
const SHARING_PERMISSIONS = ['groups:read', 'groups:write', 'groups:admin'];
const SEED_INPUT = platformSeedInputFrom(SEED_SNAPSHOT, {});

interface LockFile {
  migrations: { originId: string; localDir: string }[];
}
const lock = JSON.parse(readFileSync(join(API_ROOT, 'prisma', 'platform.lock'), 'utf8')) as LockFile;
const splitMigrationDir = lock.migrations.find((m) => m.originId === MIGRATION_ORIGIN_ID)?.localDir;

/**
 * The RBAC rows the seed wrote on `main` before the split: the same roles and
 * permissions minus `org_admin` and the four `org_*`, with admin holding every
 * one of them. Reconstructed from today's catalog so it cannot drift from the
 * permission set, and asserted below against the literal pre-split counts.
 */
function preSplitCatalog() {
  const permissions = SEED_INPUT.permissions.filter(
    (p) => !ORG_PERMISSIONS.includes(p.name) && !LATER_PERMISSIONS.includes(p.name) && !SHARING_PERMISSIONS.includes(p.name),
  );
  return {
    roles: SEED_INPUT.roles.filter((r) => r.name !== 'org_admin'),
    permissions,
    grants: {
      admin: permissions.map((p) => p.name),
      contributor: SEED_INPUT.roleGrants.contributor.filter((name) => !SHARING_PERMISSIONS.includes(name)),
      viewer: SEED_INPUT.roleGrants.viewer.filter((name) => !SHARING_PERMISSIONS.includes(name)),
    } as Record<string, string[]>,
  };
}

/** `prisma migrate deploy` in a scratch project holding exactly the migration directories in `scratchRoot`. */
function deployScratch(scratchRoot: string, database: string): void {
  execFileSync(process.execPath, [PRISMA_CLI, 'migrate', 'deploy'], {
    cwd: scratchRoot,
    env: { ...process.env, DATABASE_URL: buildDatabaseUrl(envFor(database)) },
    stdio: 'pipe',
  });
}

const USERS = {
  admin: { id: '10000000-0000-4000-8000-000000000001', roles: ['admin'], member: true },
  contributor: { id: '10000000-0000-4000-8000-000000000002', roles: ['contributor'], member: true },
  viewer: { id: '10000000-0000-4000-8000-000000000003', roles: ['viewer'], member: true },
  contributorViewer: { id: '10000000-0000-4000-8000-000000000004', roles: ['contributor', 'viewer'], member: true },
  none: { id: '10000000-0000-4000-8000-000000000005', roles: [] as string[], member: true },
  noMembership: { id: '10000000-0000-4000-8000-000000000006', roles: ['contributor'], member: false },
} as const;
type UserKey = keyof typeof USERS;

describeWithDb('system/org role split against real Postgres', () => {
  let admin: AdminConnection;
  const created: string[] = [];
  let scratchRoot = '';
  let prisma: PrismaClient;
  let freshPrisma: PrismaClient;
  const before = new Map<UserKey, string[]>();

  async function effective(key: UserKey) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USERS[key].id }, include: PRINCIPAL_USER_INCLUDE });
    return resolveEffectiveAccess(user, 'single');
  }

  beforeAll(async () => {
    if (!splitMigrationDir) throw new Error(`platform.lock has no ${MIGRATION_ORIGIN_ID}`);
    if ([LEGACY, FRESH].includes(process.env.POSTGRES_DB ?? '')) throw new Error('refusing to use the shared test database');
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    for (const name of [LEGACY, FRESH]) {
      await withAdminConnection(admin, (client) => createDatabase(client, name));
      created.push(name);
    }

    // The state of main before this change: every app migration that sorts before it.
    scratchRoot = mkdtempSync(join(tmpdir(), 'rbac-split-'));
    const migrations = join(scratchRoot, 'prisma', 'migrations');
    mkdirSync(migrations, { recursive: true });
    for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (dir.isDirectory() && dir.name < splitMigrationDir) cpSync(join(MIGRATIONS, dir.name), join(migrations, dir.name), { recursive: true });
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
    deployScratch(scratchRoot, LEGACY);

    prisma = prismaClientFor(LEGACY);
    // Pre-split rows, written with raw SQL: the Prisma client already knows `scope` and `role_id`.
    const legacy = preSplitCatalog();
    for (const role of legacy.roles) {
      await prisma.$executeRawUnsafe(`INSERT INTO roles (id, name, description) VALUES (gen_random_uuid(), $1, $2)`, role.name, role.description);
    }
    for (const permission of legacy.permissions) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO permissions (id, name, description) VALUES (gen_random_uuid(), $1, $2)`,
        permission.name,
        permission.description,
      );
    }
    for (const [roleName, names] of Object.entries(legacy.grants)) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = ANY($2::text[]) WHERE r.name = $1`,
        roleName,
        names,
      );
    }
    for (const [key, user] of Object.entries(USERS)) {
      await prisma.$executeRawUnsafe(`INSERT INTO users (id, email, updated_at) VALUES ($1::uuid, $2, now())`, user.id, `${key}@example.test`);
      for (const roleName of user.roles) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO user_roles (user_id, role_id) SELECT $1::uuid, id FROM roles WHERE name = $2`,
          user.id,
          roleName,
        );
      }
      if (user.member) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO memberships (id, org_id, user_id, status, last_active_at, updated_at)
           SELECT gen_random_uuid(), id, $1::uuid, 'active', now(), now() FROM organizations WHERE is_default`,
          user.id,
        );
      }
      // The oracle: what the pre-split rule (user_roles only) granted.
      const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT DISTINCT p.name FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1::uuid ORDER BY p.name`,
        user.id,
      );
      before.set(key as UserKey, rows.map((r) => r.name));
    }

    // Now the migration under test, then the seed twice (as every deploy does).
    cpSync(join(MIGRATIONS, splitMigrationDir), join(migrations, splitMigrationDir), { recursive: true });
    deployScratch(scratchRoot, LEGACY);
    await seedPlatform(prisma, SEED_INPUT);
    await seedPlatform(prisma, SEED_INPUT);

    migrateDeploy(FRESH);
    freshPrisma = prismaClientFor(FRESH);
    await seedPlatform(freshPrisma, SEED_INPUT);
    await seedPlatform(freshPrisma, SEED_INPUT);
  }, 300_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await freshPrisma?.$disconnect();
    for (const name of created) await withAdminConnection(admin, (client) => dropDatabase(client, name));
    if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
  });

  describe('on a database migrated from main with users and roles', () => {
    it('started from the pre-split catalog (31 permissions, admin holding all of them)', () => {
      expect(preSplitCatalog().permissions).toHaveLength(31);
      expect(before.get('admin')).toHaveLength(31);
    });

    it.each<[UserKey, string]>([
      ['admin', 'org_admin'],
      ['contributor', 'contributor'],
      ['viewer', 'viewer'],
      ['contributorViewer', 'contributor'],
      ['none', 'viewer'],
      ['noMembership', 'contributor'],
    ])('gives %s the membership role %s', async (key, roleName) => {
      const memberships = await prisma.membership.findMany({ where: { userId: USERS[key].id }, include: { role: true, org: true } });

      expect(memberships.map((m) => [m.org.isDefault, m.role.name, m.status])).toEqual([[true, roleName, 'active']]);
    });

    it('keeps the admin system role and removes every org-role user_roles row', async () => {
      const rows = await prisma.userRole.findMany({ include: { role: true } });

      expect(rows.map((row) => [row.userId, row.role.name])).toEqual([[USERS.admin.id, 'admin']]);
    });

    it.each<UserKey>(['contributor', 'viewer', 'contributorViewer', 'noMembership'])(
      "keeps %s's effective permission set exactly",
      async (key) => {
        // Plus the sharing grants (#728) the seed after the migration gives
        // the membership role the split assigned (see the table above).
        const role = ({ contributor: 'contributor', viewer: 'viewer', contributorViewer: 'contributor', noMembership: 'contributor' } as Record<string, string>)[key]!;
        const sharing = SEED_INPUT.roleGrants[role]!.filter((name) => SHARING_PERMISSIONS.includes(name));
        expect((await effective(key)).permissions.sort()).toEqual([...before.get(key)!, ...sharing].sort());
      },
    );

    it('keeps the administrator\'s effective permission set, plus the four org_* permissions', async () => {
      const access = await effective('admin');

      // Plus the system permissions declared after the split (#726), which the
      // seed that follows the migration grants to admin, and the sharing org
      // permissions (#728) its org_admin membership receives.
      expect(access.permissions.sort()).toEqual(
        [...before.get('admin')!, ...ORG_PERMISSIONS, ...LATER_PERMISSIONS, ...SHARING_PERMISSIONS].sort(),
      );
      expect(access.roles).toEqual(['admin', 'org_admin']);
    });

    it('gives a user who held no role the default org role (viewer) and nothing more', async () => {
      expect(before.get('none')).toEqual([]);
      expect((await effective('none')).permissions.sort()).toEqual([...SEED_INPUT.roleGrants.viewer].sort());
    });

    it('moved admin\'s org grants to org_admin and scoped the roles and permissions', async () => {
      const roles = await prisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });
      const byName = Object.fromEntries(roles.map((r) => [r.name, r]));

      expect(Object.fromEntries(roles.map((r) => [r.name, r.scope]))).toEqual({
        admin: 'system',
        contributor: 'org',
        viewer: 'org',
        org_admin: 'org',
      });
      for (const role of roles) {
        for (const grant of role.rolePermissions) expect([role.name, grant.permission.scope]).toEqual([role.name, role.scope]);
      }
      expect(byName.admin.rolePermissions.map((g) => g.permission.name).sort()).toEqual([...SEED_INPUT.roleGrants.admin].sort());
      expect(byName.org_admin.rolePermissions.map((g) => g.permission.name).sort()).toEqual([...SEED_INPUT.roleGrants.org_admin].sort());
    });

    it('records the migration once in the ledger', async () => {
      const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
        `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1`,
        splitMigrationDir,
      );
      expect(rows).toHaveLength(1);
    });

    it('refuses to delete a role a membership still uses (onDelete: Restrict)', async () => {
      await expect(prisma.role.delete({ where: { name: 'contributor' } })).rejects.toMatchObject({ code: expect.stringMatching(/^P20/) });
    });

    it('measures the principal load: one query for the shared include', async () => {
      // The extra join per authenticated request (story note "Performance"):
      // one findUnique with PRINCIPAL_USER_INCLUDE, timed on the real database.
      const started = process.hrtime.bigint();
      for (let i = 0; i < 20; i++) await effective('admin');
      const perLoadMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;
      // Generous bound: it guards against an accidental N+1, not a benchmark.
      expect(perLoadMs).toBeLessThan(250);
    });
  });

  describe('on a database migrated from scratch and seeded twice', () => {
    it('seeds the scoped catalog with no grant crossing a scope', async () => {
      const roles = await freshPrisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });

      expect(roles.map((r) => r.name).sort()).toEqual(['admin', 'contributor', 'org_admin', 'viewer']);
      for (const role of roles) {
        expect(role.rolePermissions.map((g) => g.permission.name).sort()).toEqual([...SEED_INPUT.roleGrants[role.name]].sort());
        for (const grant of role.rolePermissions) expect(grant.permission.scope).toBe(role.scope);
      }
      expect(await freshPrisma.permission.count()).toBe(SEED_INPUT.permissions.length);
    });
  });
});

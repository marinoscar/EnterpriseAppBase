// =============================================================================
// Real-Postgres test: the registry-driven seed writes what the old seed wrote
// (issue #712, PP-5.5)
// =============================================================================
//
// `prisma/seed.ts` now builds its input from the registries' catalogs and hands
// it to `seedPlatform` from `@marinoscar/platform-db/seed`. This suite runs the
// REAL script (`prisma db seed`, under ts-node --transpile-only, exactly as
// `npm run prisma:seed` and `appctl deploy update` do) against a migrated
// scratch database, twice, and compares the rows with `fixtures/seed-baseline.json`:
// the roles, permissions, role_permissions (by name), the `global` system
// settings value and the row counts that the seed on `main` before this change
// produced. The second run must change nothing, and neither run may overwrite an
// admin-edited setting or delete a row.
//
// The database is created and dropped by this suite (a run-unique name), so it
// never touches the shared test database.
//
// THIS IS A `*.db.spec.ts` FILE: skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`. Run with `npm run test:db`.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { createDatabase, databaseExists, dropDatabase, resolveAdminConnection, withAdminConnection, type AdminConnection } from '../../src/db-backup/admin-connection.util';
import { envFor, migrateDeploy, prismaClientFor } from '../helpers/scratch-database.helper';
import { resolveDbSuite } from '../jobs/db-test-support';

const { describeWithDb } = resolveDbSuite('seed-platform.db.spec');

const API_ROOT = join(__dirname, '..', '..');
const INITIAL_ADMIN = 'Seed.Admin@Example.TEST';

interface Baseline {
  counts: { roles: number; permissions: number; rolePermissions: number; systemSettings: number; allowedEmails: number };
  roles: Array<{ name: string; description: string }>;
  permissions: Array<{ name: string; description: string }>;
  rolePermissions: Record<string, string[]>;
  systemSettings: { key: string; version: number; value: unknown };
}

const baseline = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'seed-baseline.json'), 'utf8')) as Baseline;

/** The real seed command, against `database`, as an operator runs it. */
function runSeed(database: string, extraEnv: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ['scripts/prisma-env.js', 'db', 'seed'], {
    cwd: API_ROOT,
    env: { ...envFor(database), INITIAL_ADMIN_EMAIL: INITIAL_ADMIN, ...extraEnv } as NodeJS.ProcessEnv,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120_000,
  });
}

async function readRows(prisma: PrismaClient) {
  const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
  const permissions = await prisma.permission.findMany({ orderBy: { name: 'asc' } });
  const grants = await prisma.rolePermission.findMany({ include: { role: true, permission: true } });
  const grantKeys = grants.map((g) => `${g.roleId}|${g.permissionId}`).sort();
  const rolePermissions: Record<string, string[]> = {};
  for (const grant of grants) (rolePermissions[grant.role.name] ??= []).push(grant.permission.name);
  for (const names of Object.values(rolePermissions)) names.sort();
  const settings = await prisma.systemSettings.findMany();
  const allowed = await prisma.allowedEmail.findMany();
  return { roles, permissions, rolePermissions, settings, allowed, grantIds: grantKeys };
}

describeWithDb('platform seed against a migrated scratch database (real Postgres)', () => {
  const dbName = `seed_platform_${process.pid}_${Date.now()}`;
  let admin: AdminConnection;
  let prisma: PrismaClient;
  let firstRun: string;
  let afterFirst: Awaited<ReturnType<typeof readRows>>;
  let afterSecond: Awaited<ReturnType<typeof readRows>>;

  beforeAll(async () => {
    const { DATABASE_URL: _ignored, ...env } = process.env;
    admin = resolveAdminConnection(env);
    await withAdminConnection(admin, (client) => createDatabase(client, dbName));
    migrateDeploy(dbName);
    prisma = prismaClientFor(dbName);

    firstRun = runSeed(dbName);
    afterFirst = await readRows(prisma);
    runSeed(dbName);
    afterSecond = await readRows(prisma);
  }, 240_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await withAdminConnection(admin, async (client) => {
      if (await databaseExists(client, dbName)) await dropDatabase(client, dbName).catch(() => undefined);
    }).catch(() => undefined);
  }, 30_000);

  it('writes the roles, permissions and grants the pre-change seed wrote', () => {
    expect(afterFirst.roles.map(({ name, description }) => ({ name, description }))).toEqual(baseline.roles);
    expect(afterFirst.permissions.map(({ name, description }) => ({ name, description }))).toEqual(baseline.permissions);
    expect(afterFirst.rolePermissions).toEqual(baseline.rolePermissions);
  });

  it('writes each role and permission with its scope (#723)', () => {
    expect(Object.fromEntries(afterFirst.roles.map((r) => [r.name, r.scope]))).toEqual({
      admin: 'system',
      contributor: 'org',
      org_admin: 'org',
      viewer: 'org',
    });
    const orgScoped = afterFirst.permissions.filter((p) => p.scope === 'org').map((p) => p.name);
    expect(orgScoped).toEqual([
      'ai:use',
      'groups:admin',
      'groups:read',
      'groups:write',
      'org_invites:read',
      'org_invites:write',
      'org_members:read',
      'org_members:write',
      'org_settings:read',
      'org_settings:write',
      'sharing:admin',
      'sharing:read',
      'sharing:write',
      'storage:read',
      'storage:write',
      'user_settings:read',
      'user_settings:write',
    ]);
  });

  it('has the baseline row counts, plus the allowlisted administrator', () => {
    expect({
      roles: afterFirst.roles.length,
      permissions: afterFirst.permissions.length,
      rolePermissions: afterFirst.grantIds.length,
      systemSettings: afterFirst.settings.length,
      allowedEmails: afterFirst.allowed.length,
    }).toEqual(baseline.counts);
  });

  it('writes the global system settings row with the baseline value and version 1', () => {
    expect(afterFirst.settings).toHaveLength(1);
    expect(afterFirst.settings[0]).toMatchObject({ key: baseline.systemSettings.key, version: baseline.systemSettings.version, value: baseline.systemSettings.value });
  });

  it('lower-cases the initial administrator into the allowlist', () => {
    expect(afterFirst.allowed.map((row) => row.email)).toEqual([INITIAL_ADMIN.toLowerCase()]);
    expect(afterFirst.allowed[0]?.notes).toBe('Initial admin (auto-seeded)');
  });

  it('keeps the console lines operators read during a deploy', () => {
    // #723 (PP-6.3): org_admin and the four org_* permissions; admin's org
    // grants moved to org_admin, so 4 more grants in all. #726 (PP-6.7): the
    // two system organizations:* permissions, granted to admin. #728 and #729:
    // the six org groups:* and sharing:* permissions, 12 grants in all. #733:
    // the two org_settings:* permissions, granted to org_admin.
    for (const line of ['✓ Seeded 4 roles', '✓ Seeded 45 permissions', '✓ Seeded 59 role-permission mappings', '✓ Seeded default system settings', `✓ Added ${INITIAL_ADMIN} to allowlist`]) {
      expect(firstRun).toContain(line);
    }
  });

  it('a second run changes nothing: same rows, same ids, same counts', () => {
    expect(afterSecond.roles.map((r) => r.id)).toEqual(afterFirst.roles.map((r) => r.id));
    expect(afterSecond.permissions.map((p) => p.id)).toEqual(afterFirst.permissions.map((p) => p.id));
    expect(afterSecond.grantIds).toEqual(afterFirst.grantIds);
    expect(afterSecond.rolePermissions).toEqual(afterFirst.rolePermissions);
    expect(afterSecond.settings).toEqual(afterFirst.settings);
    expect(afterSecond.allowed).toEqual(afterFirst.allowed);
  });

  it('never overwrites an admin-edited setting or allowlist note, and never deletes a row', async () => {
    const edited = { ...(baseline.systemSettings.value as Record<string, unknown>), jobs: { history: { retentionDays: 3, purgeEnabled: false }, stuckThresholdMinutes: 5 } };
    await prisma.systemSettings.update({ where: { key: 'global' }, data: { value: edited as never, version: 9 } });
    await prisma.allowedEmail.update({ where: { email: INITIAL_ADMIN.toLowerCase() }, data: { notes: 'edited by an admin' } });
    // A permission and a grant that left the registry (or never were in it) stay.
    const viewer = await prisma.role.findUniqueOrThrow({ where: { name: 'viewer' } });
    const legacy = await prisma.permission.create({ data: { name: 'legacy:retired', description: 'Left the registry' } });
    await prisma.rolePermission.create({ data: { roleId: viewer.id, permissionId: legacy.id } });

    runSeed(dbName);

    const after = await readRows(prisma);
    expect(after.settings[0]).toMatchObject({ version: 9, value: edited });
    expect(after.allowed[0]?.notes).toBe('edited by an admin');
    expect(after.permissions.map((p) => p.name)).toContain('legacy:retired');
    expect(after.rolePermissions.viewer).toContain('legacy:retired');
    expect(after.grantIds.length).toBe(baseline.counts.rolePermissions + 1);
  });

  it('skips the allowlist when INITIAL_ADMIN_EMAIL is empty', () => {
    const output = runSeed(dbName, { INITIAL_ADMIN_EMAIL: '' });
    expect(output).toContain('⊘ INITIAL_ADMIN_EMAIL not set, skipping allowlist seed');
  });
});

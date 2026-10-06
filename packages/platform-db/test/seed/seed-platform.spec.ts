import { describe, expect, it } from 'vitest';

import { seedPlatform, type PlatformSeedInput } from '../../src/seed/index.js';
import { createFakePrisma } from './fake-prisma.js';

const INPUT: PlatformSeedInput = {
  roles: [
    { name: 'admin', description: 'Admin role' },
    { name: 'viewer', description: 'Viewer role' },
  ],
  permissions: [
    { name: 'a:read', description: 'Read a' },
    { name: 'a:write', description: 'Write a' },
  ],
  roleGrants: { admin: ['a:read', 'a:write'], viewer: ['a:read'] },
  systemSettingsDefaults: { jobs: { stuckThresholdMinutes: 30 } },
  initialAdminEmail: 'Admin@Example.TEST',
};

const lines = (): { info(msg: string): void; lines: string[] } => {
  const out: string[] = [];
  return { info: (msg) => void out.push(msg), lines: out };
};

describe('seedPlatform', () => {
  it('upserts roles and permissions by name and refreshes the description', async () => {
    const { prisma, calls } = createFakePrisma();
    await seedPlatform(prisma, INPUT);

    const roles = calls.filter((c) => c.delegate === 'role' && c.method === 'upsert');
    expect(roles.map((c) => c.args)).toEqual([
      { where: { name: 'admin' }, update: { description: 'Admin role' }, create: { name: 'admin', description: 'Admin role' } },
      { where: { name: 'viewer' }, update: { description: 'Viewer role' }, create: { name: 'viewer', description: 'Viewer role' } },
    ]);
    const permissions = calls.filter((c) => c.delegate === 'permission' && c.method === 'upsert');
    expect(permissions.map((c) => (c.args as { where: unknown }).where)).toEqual([{ name: 'a:read' }, { name: 'a:write' }]);
  });

  it('upserts each grant by roleId_permissionId with an empty update', async () => {
    const { prisma, calls, tables } = createFakePrisma();
    const summary = await seedPlatform(prisma, INPUT);

    const grants = calls.filter((c) => c.delegate === 'rolePermission');
    expect(grants).toHaveLength(3);
    const admin = tables.role!.get('admin')!.id;
    const read = tables.permission!.get('a:read')!.id;
    expect(grants[0]!.args).toEqual({
      where: { roleId_permissionId: { roleId: admin, permissionId: read } },
      update: {},
      create: { roleId: admin, permissionId: read },
    });
    expect(summary).toMatchObject({ roles: 2, permissions: 2, rolePermissions: 3, skippedGrants: [] });
  });

  it('upserts the global settings row with update: {} and version 1', async () => {
    const { prisma, calls } = createFakePrisma();
    await seedPlatform(prisma, INPUT);

    const settings = calls.filter((c) => c.delegate === 'systemSettings');
    expect(settings.map((c) => c.args)).toEqual([
      { where: { key: 'global' }, update: {}, create: { key: 'global', value: { jobs: { stuckThresholdMinutes: 30 } }, version: 1 } },
    ]);
  });

  it('never overwrites an admin-edited settings row or allowlist row', async () => {
    const { prisma, tables } = createFakePrisma();
    await seedPlatform(prisma, INPUT);
    tables.systemSettings!.set('global', { ...tables.systemSettings!.get('global')!, value: { jobs: { stuckThresholdMinutes: 5 } }, version: 7 });
    tables.allowedEmail!.set('admin@example.test', { ...tables.allowedEmail!.get('admin@example.test')!, notes: 'edited by an admin' });

    await seedPlatform(prisma, INPUT);

    expect(tables.systemSettings!.get('global')).toMatchObject({ value: { jobs: { stuckThresholdMinutes: 5 } }, version: 7 });
    expect(tables.allowedEmail!.get('admin@example.test')).toMatchObject({ notes: 'edited by an admin' });
  });

  it('lower-cases the initial admin email, with update: {}', async () => {
    const { prisma, calls } = createFakePrisma();
    const summary = await seedPlatform(prisma, INPUT);

    const allow = calls.filter((c) => c.delegate === 'allowedEmail');
    expect(allow.map((c) => c.args)).toEqual([
      { where: { email: 'admin@example.test' }, update: {}, create: { email: 'admin@example.test', notes: 'Initial admin (auto-seeded)' } },
    ]);
    expect(summary.allowlistedEmail).toBe('admin@example.test');
  });

  it('skips the allowlist when no initial admin email is given', async () => {
    const { prisma, calls } = createFakePrisma();
    const log = lines();
    const { initialAdminEmail: _omitted, ...withoutEmail } = INPUT;
    const summary = await seedPlatform(prisma, withoutEmail, log);

    expect(calls.some((c) => c.delegate === 'allowedEmail')).toBe(false);
    expect(summary.allowlistedEmail).toBeNull();
    expect(log.lines).toContain('⊘ INITIAL_ADMIN_EMAIL not set, skipping allowlist seed');
  });

  it('a second run makes the same calls and leaves the same rows', async () => {
    const { prisma, calls, tables } = createFakePrisma();
    await seedPlatform(prisma, INPUT);
    const first = calls.splice(0).map((c) => ({ delegate: c.delegate, method: c.method, args: normalise(c.args) }));
    const rowsAfterFirst = snapshot(tables);

    await seedPlatform(prisma, INPUT);
    const second = calls.map((c) => ({ delegate: c.delegate, method: c.method, args: normalise(c.args) }));

    expect(second).toEqual(first);
    expect(snapshot(tables)).toEqual(rowsAfterFirst);
  });

  it('only upserts and looks up: nothing is ever deleted, updated or created directly', async () => {
    const { prisma, calls } = createFakePrisma();
    await seedPlatform(prisma, INPUT);

    expect([...new Set(calls.map((c) => c.method))].sort()).toEqual(['findUnique', 'upsert']);
  });

  it('keeps a row that left the input (a removed permission stays)', async () => {
    const { prisma, tables } = createFakePrisma();
    await seedPlatform(prisma, INPUT);
    await seedPlatform(prisma, { ...INPUT, permissions: [INPUT.permissions[0]!], roleGrants: { admin: ['a:read'] } });

    expect([...tables.permission!.keys()].sort()).toEqual(['a:read', 'a:write']);
    expect(tables.rolePermission!.size).toBe(3);
  });

  it('skips, and reports, a grant naming a role or permission with no row', async () => {
    const { prisma, calls } = createFakePrisma();
    const summary = await seedPlatform(prisma, { ...INPUT, roleGrants: { admin: ['a:read', 'ghost:read'], ghost: ['a:read'] } });

    expect(summary.rolePermissions).toBe(1);
    expect(summary.skippedGrants).toEqual(['admin: ghost:read', 'ghost']);
    expect(calls.filter((c) => c.delegate === 'rolePermission')).toHaveLength(1);
  });

  it('runs in a fixed order and logs the lines operators read during a deploy', async () => {
    const { prisma, calls } = createFakePrisma();
    const log = lines();
    await seedPlatform(prisma, INPUT, log);

    expect(log.lines).toEqual([
      'Seeding roles...',
      '✓ Seeded 2 roles',
      'Seeding permissions...',
      '✓ Seeded 2 permissions',
      'Seeding role-permission mappings...',
      '✓ Seeded 3 role-permission mappings',
      'Seeding system settings...',
      '✓ Seeded default system settings',
      'Seeding initial admin allowlist...',
      '✓ Added Admin@Example.TEST to allowlist',
    ]);
    const order = [...new Set(calls.map((c) => c.delegate))];
    expect(order).toEqual(['role', 'permission', 'rolePermission', 'systemSettings', 'allowedEmail']);
  });

  it('is silent without a logger', async () => {
    const { prisma } = createFakePrisma();
    await expect(seedPlatform(prisma, INPUT)).resolves.toBeDefined();
  });
});

function normalise(value: unknown): unknown {
  // Row ids are generated per fake instance but are deterministic per insert order, so a second run on the same fake sees the same ids.
  return JSON.parse(JSON.stringify(value));
}

function snapshot(tables: Record<string, Map<string, Record<string, unknown>>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, [...table.entries()]]));
}

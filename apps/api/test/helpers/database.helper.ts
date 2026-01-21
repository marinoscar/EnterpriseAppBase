import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Cleans all data from test database
 * Preserves table structure, only truncates data
 */
export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('cleanDatabase can only be called in test environment');
  }

  // Delete in order respecting foreign key constraints
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.userSettings.deleteMany(),
    prisma.systemSettings.deleteMany(),
    prisma.userRole.deleteMany(),
    prisma.userIdentity.deleteMany(),
    prisma.user.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
  ]);
}

/**
 * Seeds the database with base data (roles, permissions)
 */
export async function seedBaseData(prisma: PrismaService): Promise<void> {
  // Create permissions
  const permissions = [
    { name: 'system_settings:read', description: 'Read system settings' },
    { name: 'system_settings:write', description: 'Modify system settings' },
    { name: 'user_settings:read', description: 'Read user settings' },
    { name: 'user_settings:write', description: 'Modify user settings' },
    { name: 'users:read', description: 'Read user data' },
    { name: 'users:write', description: 'Modify user data' },
    { name: 'rbac:manage', description: 'Manage roles and permissions' },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  // Create roles
  const roles = [
    { name: 'admin', description: 'Full system access' },
    { name: 'contributor', description: 'Standard user capabilities' },
    { name: 'viewer', description: 'Read-only access' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
  }

  // Assign permissions to roles
  const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
  const contributorRole = await prisma.role.findUnique({ where: { name: 'contributor' } });
  const viewerRole = await prisma.role.findUnique({ where: { name: 'viewer' } });

  const allPermissions = await prisma.permission.findMany();

  // Admin gets all permissions
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole!.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: adminRole!.id, permissionId: perm.id },
    });
  }

  // Contributor permissions
  const contributorPerms = ['user_settings:read', 'user_settings:write'];
  for (const permName of contributorPerms) {
    const perm = allPermissions.find((p) => p.name === permName);
    if (perm) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: contributorRole!.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: contributorRole!.id, permissionId: perm.id },
      });
    }
  }

  // Viewer permissions
  const viewerPerms = ['user_settings:read'];
  for (const permName of viewerPerms) {
    const perm = allPermissions.find((p) => p.name === permName);
    if (perm) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: viewerRole!.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: viewerRole!.id, permissionId: perm.id },
      });
    }
  }

  // Create default system settings
  await prisma.systemSettings.upsert({
    where: { key: 'default' },
    update: {},
    create: {
      key: 'default',
      value: {
        ui: { allowUserThemeOverride: true },
        security: { jwtAccessTtlMinutes: 15, refreshTtlDays: 14 },
        features: {},
      },
      version: 1,
    },
  });
}

/**
 * Resets database to clean state with base data
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await cleanDatabase(prisma);
  await seedBaseData(prisma);
}

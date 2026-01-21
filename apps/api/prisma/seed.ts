import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Seed Data Definitions
// =============================================================================

const ROLES = [
  {
    name: 'admin',
    description: 'Full system access - manage users, roles, and all settings',
  },
  {
    name: 'contributor',
    description: 'Standard user - can manage own settings and future features',
  },
  {
    name: 'viewer',
    description: 'Read-only access - can view content and manage own settings',
  },
] as const;

const PERMISSIONS = [
  // System settings
  { name: 'system_settings:read', description: 'Read system settings' },
  { name: 'system_settings:write', description: 'Modify system settings' },

  // User settings
  { name: 'user_settings:read', description: 'Read own user settings' },
  { name: 'user_settings:write', description: 'Modify own user settings' },

  // Users management
  { name: 'users:read', description: 'View user list and details' },
  { name: 'users:write', description: 'Modify user accounts' },

  // RBAC management
  { name: 'rbac:manage', description: 'Manage roles and permissions' },
] as const;

// Role to permissions mapping
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'system_settings:read',
    'system_settings:write',
    'user_settings:read',
    'user_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
  ],
  contributor: [
    'user_settings:read',
    'user_settings:write',
  ],
  viewer: [
    'user_settings:read',
    'user_settings:write',
  ],
};

// Default system settings
const DEFAULT_SYSTEM_SETTINGS = {
  ui: {
    allowUserThemeOverride: true,
  },
  security: {
    jwtAccessTtlMinutes: 15,
    refreshTtlDays: 14,
  },
  features: {},
};

// =============================================================================
// Seed Functions
// =============================================================================

async function seedRoles() {
  console.log('Seeding roles...');

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  console.log(`✓ Seeded ${ROLES.length} roles`);
}

async function seedPermissions() {
  console.log('Seeding permissions...');

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description },
      create: permission,
    });
  }

  console.log(`✓ Seeded ${PERMISSIONS.length} permissions`);
}

async function seedRolePermissions() {
  console.log('Seeding role-permission mappings...');

  let count = 0;

  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;

    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({
        where: { name: permissionName },
      });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
      count++;
    }
  }

  console.log(`✓ Seeded ${count} role-permission mappings`);
}

async function seedSystemSettings() {
  console.log('Seeding system settings...');

  await prisma.systemSettings.upsert({
    where: { key: 'global' },
    update: {}, // Don't overwrite existing settings
    create: {
      key: 'global',
      value: DEFAULT_SYSTEM_SETTINGS,
      version: 1,
    },
  });

  console.log('✓ Seeded default system settings');
}

// =============================================================================
// Main Seed Function
// =============================================================================

async function main() {
  console.log('Starting database seed...\n');

  await seedRoles();
  await seedPermissions();
  await seedRolePermissions();
  await seedSystemSettings();

  console.log('\n✓ Database seeding completed successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

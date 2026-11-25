// `scope` (#723): `admin` is the system role; the others are org roles.
export const roleFixtures = {
  admin: {
    name: 'admin',
    description: 'Full system access',
    scope: 'system' as const,
  },
  contributor: {
    name: 'contributor',
    description: 'Standard user capabilities',
    scope: 'org' as const,
  },
  viewer: {
    name: 'viewer',
    description: 'Read-only access',
    scope: 'org' as const,
  },
  orgAdmin: {
    name: 'org_admin',
    description: 'Organization administrator',
    scope: 'org' as const,
  },
};

export const permissionFixtures = {
  systemSettingsRead: {
    name: 'system_settings:read',
    description: 'Read system settings',
  },
  systemSettingsWrite: {
    name: 'system_settings:write',
    description: 'Modify system settings',
  },
  userSettingsRead: {
    name: 'user_settings:read',
    description: 'Read user settings',
  },
  userSettingsWrite: {
    name: 'user_settings:write',
    description: 'Modify user settings',
  },
  usersRead: {
    name: 'users:read',
    description: 'Read user data',
  },
  usersWrite: {
    name: 'users:write',
    description: 'Modify user data',
  },
  rbacManage: {
    name: 'rbac:manage',
    description: 'Manage roles and permissions',
  },
};

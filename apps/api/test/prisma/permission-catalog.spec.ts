import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../../prisma/seed-data';

// =============================================================================
// Seeded RBAC baseline (issue #676, PP-1.4)
// =============================================================================
//
// The literal roles, permissions (names, descriptions AND order) and default
// role grants that `prisma/seed.ts` wrote on `main` before permissions moved
// into a registry. The refactor is proven against this copy: it must seed
// exactly the same rows, in exactly the same order.
//
// ⚠ This baseline is deliberately NOT derived from anything. When a permission
// or grant changes on purpose, edit the literal here in the same commit, so the
// change is visible in review as a change to seeded RBAC data.
// =============================================================================

const BASELINE_ROLES = [
  { name: 'admin', description: 'Full system access - manage users, roles, and all settings' },
  { name: 'contributor', description: 'Standard user - can manage own settings and future features' },
  { name: 'viewer', description: 'Read-only access - can view content and manage own settings' },
];

const BASELINE_PERMISSIONS = [
  { name: 'system_settings:read', description: 'Read system settings' },
  { name: 'system_settings:write', description: 'Modify system settings' },
  { name: 'user_settings:read', description: 'Read own user settings' },
  { name: 'user_settings:write', description: 'Modify own user settings' },
  { name: 'users:read', description: 'View user list and details' },
  { name: 'users:write', description: 'Modify user accounts' },
  { name: 'rbac:manage', description: 'Manage roles and permissions' },
  { name: 'allowlist:read', description: 'View allowlisted emails' },
  { name: 'allowlist:write', description: 'Manage allowlisted emails' },
  { name: 'storage:read', description: 'Read object metadata, get download URLs' },
  { name: 'storage:write', description: 'Upload, update metadata' },
  { name: 'storage:delete_any', description: 'Admin: delete any object' },
  { name: 'jobs:read', description: 'View queued, running and completed jobs' },
  { name: 'jobs:write', description: 'Enqueue, retry and cancel jobs' },
  { name: 'nodes:read', description: 'View worker nodes and their health' },
  { name: 'nodes:write', description: 'Register, drain and remove worker nodes' },
  { name: 'db_backup:read', description: 'View backup schedule, history and status' },
  { name: 'db_backup:write', description: 'Configure the backup schedule and run a backup' },
  { name: 'db_backup:restore', description: 'Restore the database from a backup' },
  { name: 'broadcasts:read', description: 'View notification broadcasts and their delivery history' },
  { name: 'broadcasts:write', description: 'Compose, schedule, cancel and send notification broadcasts' },
  { name: 'push:read', description: 'View Web Push (VAPID) configuration' },
  { name: 'push:write', description: 'Generate, rotate, enable/disable and remove Web Push VAPID keys' },
  { name: 'storage_config:read', description: 'View the object-storage configuration and the masked status of its stored secret key' },
  { name: 'storage_config:write', description: 'Change the object-storage provider, bucket, endpoint and credential, test a configuration, and provision a bucket' },
  { name: 'ai_config:read', description: 'View the deployment-wide AI platform policy' },
  { name: 'ai_config:write', description: 'Change whether AI is enabled, the key policy, per-provider configuration and the deployment-wide defaults' },
  { name: 'ai:use', description: 'Call AI models using a saved key' },
  { name: 'telemetry:read', description: 'View telemetry settings and status' },
  { name: 'telemetry:write', description: 'Change telemetry settings' },
  { name: 'telemetry:query', description: 'Run SQL, export and use the AI assistant against telemetry' },
];

const BASELINE_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    'system_settings:read',
    'system_settings:write',
    'user_settings:read',
    'user_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
    'allowlist:read',
    'allowlist:write',
    'storage:read',
    'storage:write',
    'storage:delete_any',
    'jobs:read',
    'jobs:write',
    'nodes:read',
    'nodes:write',
    'db_backup:read',
    'db_backup:write',
    'db_backup:restore',
    'broadcasts:read',
    'broadcasts:write',
    'push:read',
    'push:write',
    'storage_config:read',
    'storage_config:write',
    'ai_config:read',
    'ai_config:write',
    'ai:use',
    'telemetry:read',
    'telemetry:write',
    'telemetry:query',
  ],
  contributor: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'storage:write',
    'ai:use',
  ],
  viewer: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
  ],
};

describe('seeded RBAC baseline', () => {
  it('seeds the baseline roles', () => {
    expect(ROLES.map((role) => ({ ...role }))).toEqual(BASELINE_ROLES);
  });

  it('seeds the baseline permissions, in the baseline order', () => {
    expect(PERMISSIONS.map((permission) => ({ ...permission }))).toEqual(BASELINE_PERMISSIONS);
  });

  it('seeds the baseline role grants', () => {
    expect(ROLE_PERMISSIONS).toEqual(BASELINE_ROLE_PERMISSIONS);
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(Object.keys(BASELINE_ROLE_PERMISSIONS));
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../../prisma/seed-data';
import {
  PERMISSION_CATALOG_PATH,
  buildPermissionCatalog,
  checkPermissionCatalog,
  permissionRegistry,
  renderPermissionCatalog,
  roleRegistry,
} from '../../src/common/permissions';
import { withTemporaryEntries } from '../../src/common/registry';

// =============================================================================
// Seeded RBAC baseline (issue #676, PP-1.4)
// =============================================================================
//
// The literal roles, permissions (names, descriptions AND order) and default
// role grants that `prisma/seed.ts` wrote on `main` before permissions moved
// into a registry. The refactor is proven against this copy: it must seed
// exactly the same rows, in exactly the same order.
//
// Also here: the committed catalog (`prisma/catalog/permissions.json`, what
// the seed reads) is not stale, an app entry lands after the platform entries,
// and the permission matrix in docs/ARCHITECTURE.md §7.2 agrees with the grants.
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

const apiRoot = resolve(__dirname, '..', '..');

function committedCatalog(): string {
  return readFileSync(resolve(apiRoot, PERMISSION_CATALOG_PATH), 'utf8');
}

describe('prisma/catalog/permissions.json', () => {
  it('equals the baseline', () => {
    const { $comment, ...catalog } = JSON.parse(committedCatalog()) as Record<string, unknown>;

    expect($comment).toBe('Generated by npm run catalog:permissions --workspace=api. Do not edit.');
    expect(catalog).toEqual({
      roles: BASELINE_ROLES,
      permissions: BASELINE_PERMISSIONS,
      rolePermissions: BASELINE_ROLE_PERMISSIONS,
    });
  });

  it('is what the registries generate now (run npm run catalog:permissions --workspace=api)', () => {
    // The same comparison `npm run catalog:permissions -- --check` makes: byte
    // for byte against the generator's output, so formatting drift fails too.
    expect(checkPermissionCatalog(committedCatalog())).toBeNull();
  });

  it('reports a declaration changed without regenerating, naming the fix', async () => {
    const committed = committedCatalog();

    await withTemporaryEntries(
      permissionRegistry,
      [{ id: 'stale_check:read', description: 'Added without regenerating', defaultGrants: ['admin'] }],
      () => {
        expect(checkPermissionCatalog(committed)).toContain(
          'run npm run catalog:permissions --workspace=api',
        );
      },
    );
    expect(checkPermissionCatalog(undefined)).toMatch(/missing: run npm run catalog:permissions --workspace=api/);
  });

  it('ends with a trailing newline and 2-space indentation', () => {
    const committed = committedCatalog();

    expect(committed.endsWith('}\n')).toBe(true);
    expect(committed).toBe(renderPermissionCatalog());
    expect(committed.split('\n')[1]).toMatch(/^ {2}"\$comment"/);
  });
});

describe('an app permission (app-registrations/permissions.ts)', () => {
  it('appears after every platform entry, with its grants', async () => {
    const platform = buildPermissionCatalog();

    await withTemporaryEntries(roleRegistry, [{ id: 'coach', description: 'Coaches athletes' }], () =>
      withTemporaryEntries(
        permissionRegistry,
        [
          { id: 'workouts:read', description: 'Read own workouts', defaultGrants: ['admin', 'contributor', 'viewer', 'coach'] },
          { id: 'workouts:write', description: 'Log own workouts', defaultGrants: ['admin', 'coach'] },
        ],
        () => {
          const catalog = buildPermissionCatalog();

          expect(catalog.roles).toEqual([...platform.roles, { name: 'coach', description: 'Coaches athletes' }]);
          expect(catalog.permissions).toEqual([
            ...platform.permissions,
            { name: 'workouts:read', description: 'Read own workouts' },
            { name: 'workouts:write', description: 'Log own workouts' },
          ]);
          expect(catalog.rolePermissions).toEqual({
            admin: [...platform.rolePermissions.admin, 'workouts:read', 'workouts:write'],
            contributor: [...platform.rolePermissions.contributor, 'workouts:read'],
            viewer: [...platform.rolePermissions.viewer, 'workouts:read'],
            coach: ['workouts:read', 'workouts:write'],
          });
        },
      ),
    );

    // Restored: the committed catalog is the platform's alone.
    expect(buildPermissionCatalog()).toEqual(platform);
  });
});

describe('docs/ARCHITECTURE.md §7.2 permission matrix', () => {
  // A cheap docs tripwire: every registered permission has a row, and its
  // Admin/Contributor/Viewer ticks match the default grants the seed writes.
  const architecture = readFileSync(resolve(apiRoot, '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8');
  const start = architecture.indexOf('### 7.2 Permission matrix');
  const end = architecture.indexOf('\n## ', start);
  const section = architecture.slice(start, end);

  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const match = /^\| `([^`]+)` \|(.*)$/.exec(line);
    if (!match) continue;
    const cells = match[2].split('|').map((cell) => cell.trim());
    const granted = (['admin', 'contributor', 'viewer'] as const).filter((_role, index) => cells[index] === '✓');
    rows.set(match[1], [...granted]);
  }

  it('finds the section', () => {
    expect(start).toBeGreaterThan(-1);
    expect(rows.size).toBeGreaterThan(0);
  });

  it('lists every registered permission in backticks', () => {
    const missing = permissionRegistry.ids().filter((id) => !rows.has(id));

    expect(missing).toEqual([]);
  });

  it('ticks exactly the roles each permission is granted by default', () => {
    const catalog = buildPermissionCatalog();
    const mismatched = permissionRegistry.ids().filter((id) => {
      const expected = ['admin', 'contributor', 'viewer'].filter((role) => catalog.rolePermissions[role]?.includes(id));
      return JSON.stringify(rows.get(id)) !== JSON.stringify(expected);
    });

    expect(mismatched).toEqual([]);
  });
});

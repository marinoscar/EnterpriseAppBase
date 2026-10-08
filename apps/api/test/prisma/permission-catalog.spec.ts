import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PERMISSIONS, ROLES, ROLE_GRANTS, ROLE_PERMISSIONS } from '../../prisma/seed-data';
import {
  PERMISSION_CATALOG_PATH,
  buildPermissionCatalog,
  checkPermissionCatalog,
  permissionRegistry,
  renderPermissionCatalog,
  roleRegistry,
} from '../../src/common/permissions';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';

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
// Issue #723 (PP-6.3) changed it on purpose: every role and permission gained
// a `scope`; `org_admin` and the four `org_*` permissions were added; the
// org-scoped permissions moved from `admin` (now system-only) to `org_admin`.
// The admin + org_admin union is the old admin set plus the four new ids.
//
// ⚠ This baseline is deliberately NOT derived from anything. When a permission
// or grant changes on purpose, edit the literal here in the same commit, so the
// change is visible in review as a change to seeded RBAC data.
// =============================================================================

const BASELINE_ROLES = [
  { name: 'admin', description: 'System administrator - operate the deployment: users, roles and all system settings', scope: 'system' },
  { name: 'contributor', description: 'Organization member - manage own settings and storage objects, use AI', scope: 'org' },
  { name: 'viewer', description: 'Read-only organization member - view content and manage own settings', scope: 'org' },
  { name: 'org_admin', description: 'Organization administrator - everything a contributor can do, plus manage the organization members and invites', scope: 'org' },
];

const BASELINE_PERMISSIONS = [
  { name: 'system_settings:read', description: 'Read system settings', scope: 'system' },
  { name: 'system_settings:write', description: 'Modify system settings', scope: 'system' },
  { name: 'user_settings:read', description: 'Read own user settings', scope: 'org' },
  { name: 'user_settings:write', description: 'Modify own user settings', scope: 'org' },
  { name: 'users:read', description: 'View user list and details', scope: 'system' },
  { name: 'users:write', description: 'Modify user accounts', scope: 'system' },
  { name: 'rbac:manage', description: 'Manage roles and permissions', scope: 'system' },
  { name: 'allowlist:read', description: 'View allowlisted emails', scope: 'system' },
  { name: 'allowlist:write', description: 'Manage allowlisted emails', scope: 'system' },
  { name: 'storage:read', description: 'Read object metadata, get download URLs', scope: 'org' },
  { name: 'storage:write', description: 'Upload, update metadata', scope: 'org' },
  { name: 'storage:delete_any', description: 'Admin: delete any object', scope: 'system' },
  { name: 'jobs:read', description: 'View queued, running and completed jobs', scope: 'system' },
  { name: 'jobs:write', description: 'Enqueue, retry and cancel jobs', scope: 'system' },
  { name: 'nodes:read', description: 'View worker nodes and their health', scope: 'system' },
  { name: 'nodes:write', description: 'Register, drain and remove worker nodes', scope: 'system' },
  { name: 'db_backup:read', description: 'View backup schedule, history and status', scope: 'system' },
  { name: 'db_backup:write', description: 'Configure the backup schedule and run a backup', scope: 'system' },
  { name: 'db_backup:restore', description: 'Restore the database from a backup', scope: 'system' },
  { name: 'broadcasts:read', description: 'View notification broadcasts and their delivery history', scope: 'system' },
  { name: 'broadcasts:write', description: 'Compose, schedule, cancel and send notification broadcasts', scope: 'system' },
  { name: 'push:read', description: 'View Web Push (VAPID) configuration', scope: 'system' },
  { name: 'push:write', description: 'Generate, rotate, enable/disable and remove Web Push VAPID keys', scope: 'system' },
  { name: 'storage_config:read', description: 'View the object-storage configuration and the masked status of its stored secret key', scope: 'system' },
  { name: 'storage_config:write', description: 'Change the object-storage provider, bucket, endpoint and credential, test a configuration, and provision a bucket', scope: 'system' },
  { name: 'ai_config:read', description: 'View the deployment-wide AI platform policy', scope: 'system' },
  { name: 'ai_config:write', description: 'Change whether AI is enabled, the key policy, per-provider configuration and the deployment-wide defaults', scope: 'system' },
  { name: 'ai:use', description: 'Call AI models using a saved key', scope: 'org' },
  { name: 'telemetry:read', description: 'View telemetry settings and status', scope: 'system' },
  { name: 'telemetry:write', description: 'Change telemetry settings', scope: 'system' },
  { name: 'telemetry:query', description: 'Run SQL, export and use the AI assistant against telemetry', scope: 'system' },
  { name: 'org_members:read', description: 'View the members of the organization and their organization roles', scope: 'org' },
  { name: 'org_members:write', description: 'Change organization members: their organization role, suspend or remove them', scope: 'org' },
  { name: 'org_invites:read', description: 'View pending and past invitations to the organization', scope: 'org' },
  { name: 'org_invites:write', description: 'Invite people to the organization and revoke invitations', scope: 'org' },
  { name: 'organizations:read', description: "List the deployment's organizations and their member counts", scope: 'system' },
  { name: 'organizations:write', description: 'Create organizations (with a first administrator invitation) and rename them', scope: 'system' },
  // The sharing slice (#728, PP-7.1): groups inside an organization.
  { name: 'groups:read', description: 'View the groups you belong to, answer your group invitations and leave a group', scope: 'org' },
  { name: 'groups:write', description: 'Create groups and manage the members and invitations of groups you administer', scope: 'org' },
  { name: 'groups:admin', description: 'View and administer every group of the organization, including groups you do not belong to', scope: 'org' },
  // Grants (#729, PP-7.2): records shared inside an organization.
  { name: 'sharing:read', description: 'View what is shared with you and who a record you can share is shared with, and remove your own access', scope: 'org' },
  { name: 'sharing:write', description: 'Share records you are allowed to share with people and groups of the organization, and change or revoke those shares', scope: 'org' },
  { name: 'sharing:admin', description: 'Manage the shares of every record of the organization, including records you do not own', scope: 'org' },
];

const BASELINE_ROLE_GRANTS: Record<string, string[]> = {
  admin: [
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
    'allowlist:read',
    'allowlist:write',
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
    'telemetry:read',
    'telemetry:write',
    'telemetry:query',
    'organizations:read',
    'organizations:write',
  ],
  contributor: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'storage:write',
    'ai:use',
    'groups:read',
    'groups:write',
    'sharing:read',
    'sharing:write',
  ],
  viewer: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'groups:read',
    'sharing:read',
  ],
  org_admin: [
    'user_settings:read',
    'user_settings:write',
    'storage:read',
    'storage:write',
    'ai:use',
    'org_members:read',
    'org_members:write',
    'org_invites:read',
    'org_invites:write',
    'groups:read',
    'groups:write',
    'groups:admin',
    'sharing:read',
    'sharing:write',
    'sharing:admin',
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
    expect(ROLE_GRANTS).toEqual(BASELINE_ROLE_GRANTS);
    expect(Object.keys(ROLE_GRANTS)).toEqual(Object.keys(BASELINE_ROLE_GRANTS));
  });
});

describe('ROLE_PERMISSIONS, the effective view the RBAC matrix suites use (#723)', () => {
  it('gives admin the system admin grants plus the org_admin grants', () => {
    expect([...ROLE_PERMISSIONS.admin].sort()).toEqual(
      [...BASELINE_ROLE_GRANTS.admin, ...BASELINE_ROLE_GRANTS.org_admin].sort(),
    );
  });

  it('gives every other role exactly its own grants', () => {
    for (const role of ['contributor', 'viewer', 'org_admin']) {
      expect(ROLE_PERMISSIONS[role]).toEqual(BASELINE_ROLE_GRANTS[role]);
    }
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
      rolePermissions: BASELINE_ROLE_GRANTS,
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
      [{ id: 'stale_check:read', description: 'Added without regenerating', scope: 'system', defaultGrants: ['admin'] }],
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

    await withTemporaryEntries(roleRegistry, [{ id: 'coach', description: 'Coaches athletes', scope: 'org' }], () =>
      withTemporaryEntries(
        permissionRegistry,
        [
          { id: 'workouts:read', description: 'Read own workouts', scope: 'org', defaultGrants: ['org_admin', 'contributor', 'viewer', 'coach'] },
          { id: 'workouts:write', description: 'Log own workouts', scope: 'org', defaultGrants: ['org_admin', 'coach'] },
        ],
        () => {
          const catalog = buildPermissionCatalog();

          expect(catalog.roles).toEqual([...platform.roles, { name: 'coach', description: 'Coaches athletes', scope: 'org' }]);
          expect(catalog.permissions).toEqual([
            ...platform.permissions,
            { name: 'workouts:read', description: 'Read own workouts', scope: 'org' },
            { name: 'workouts:write', description: 'Log own workouts', scope: 'org' },
          ]);
          expect(catalog.rolePermissions).toEqual({
            admin: platform.rolePermissions.admin,
            contributor: [...platform.rolePermissions.contributor, 'workouts:read'],
            viewer: [...platform.rolePermissions.viewer, 'workouts:read'],
            org_admin: [...platform.rolePermissions.org_admin, 'workouts:read', 'workouts:write'],
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
  // A cheap docs tripwire: every registered permission has a row, its scope
  // cell names its registry scope, and its Admin/Org admin/Contributor/Viewer
  // ticks match the default grants the seed writes (issue #723).
  const architecture = readFileSync(resolve(apiRoot, '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8');
  const start = architecture.indexOf('### 7.2 Permission matrix');
  const end = architecture.indexOf('\n## ', start);
  const section = architecture.slice(start, end);

  const MATRIX_ROLES = ['admin', 'org_admin', 'contributor', 'viewer'] as const;
  const rows = new Map<string, string[]>();
  const scopes = new Map<string, string>();
  for (const line of section.split('\n')) {
    const match = /^\| `([^`]+)` \|(.*)$/.exec(line);
    if (!match) continue;
    const [scope, ...cells] = match[2].split('|').map((cell) => cell.trim());
    const granted = MATRIX_ROLES.filter((_role, index) => cells[index] === '✓');
    rows.set(match[1], [...granted]);
    scopes.set(match[1], scope);
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
      const expected = MATRIX_ROLES.filter((role) => catalog.rolePermissions[role]?.includes(id));
      return JSON.stringify(rows.get(id)) !== JSON.stringify(expected);
    });

    expect(mismatched).toEqual([]);
  });

  it('names each permission\'s scope in the Scope column', () => {
    const mismatched = permissionRegistry
      .list()
      .filter((entry) => scopes.get(entry.id) !== entry.scope)
      .map((entry) => `${entry.id}: ${scopes.get(entry.id)} (registry: ${entry.scope})`);

    expect(mismatched).toEqual([]);
  });
});

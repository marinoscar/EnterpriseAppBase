import { join } from 'node:path';

import { RegistryError, permissionIds } from '../../src/core';
import type { PermissionCatalog } from '../../src/core';
import {
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_SETS,
  PLATFORM_PERMISSION_SLICES,
  PLATFORM_ROLES,
  PLATFORM_USER_OWNED_MODELS,
  platformPermissionCatalog,
} from '../../src/manifest';
import { readSchemaDatamodel } from '../../src/testing/prisma-schema';
import { checkUserOwnedModels } from '../../src/testing/suites/user-owned-data';

// =============================================================================
// The platform manifest (issue #866)
// =============================================================================
//
// What this pins: the platform's roles and permission sets compose into one
// valid catalog in seed order (the reference app pins that catalog to a
// literal baseline, `apps/api/test/prisma/permission-catalog.spec.ts`);
// registering them fills core's registries with exactly that catalog; the
// `slices` filter keeps seed order; and the user-owned inventory agrees with
// the platform's own schema fragments, so an app that composes them and
// registers the inventory passes `userOwnedData` for every platform model.
// =============================================================================

const PLATFORM_SCHEMA = join(__dirname, '..', '..', '..', 'platform-db', 'schema');

/** Loads a fresh copy of core and the manifest, so the static registries start empty. */
function isolated(): { core: typeof import('../../src/core'); manifest: typeof import('../../src/manifest') } {
  let loaded: { core: typeof import('../../src/core'); manifest: typeof import('../../src/manifest') } | undefined;
  jest.isolateModules(() => {
    loaded = { core: require('../../src/core'), manifest: require('../../src/manifest') };
  });
  return loaded!;
}

const scopeOf = (catalog: PermissionCatalog, scope: 'system' | 'org') =>
  catalog.permissions.filter((entry) => entry.scope === scope).map((entry) => entry.name);

describe('the platform permission sets', () => {
  const catalog = platformPermissionCatalog();

  it('compose into one catalog: four roles, 51 permissions, each once', () => {
    expect(catalog.roles.map((role) => role.name)).toEqual(['admin', 'contributor', 'viewer', 'org_admin']);
    expect(catalog.permissions).toHaveLength(51);
    expect(new Set(catalog.permissions.map((entry) => entry.name)).size).toBe(51);
  });

  it('list the permissions in set order, then key order', () => {
    const flattened = PLATFORM_PERMISSION_SETS.flatMap((set) => Object.values(set.permissions).map((entry) => entry.id));
    expect(catalog.permissions.map((entry) => entry.name)).toEqual(flattened);
  });

  it('keep PLATFORM_PERMISSIONS equal to the sets, with no key shadowed by a later set', () => {
    const keys = PLATFORM_PERMISSION_SETS.flatMap((set) => Object.keys(set.permissions));
    expect(Object.keys(PLATFORM_PERMISSIONS)).toEqual(keys);
    expect(Object.values(permissionIds(PLATFORM_PERMISSIONS))).toEqual(catalog.permissions.map((entry) => entry.name));
  });

  it('name only slices from PLATFORM_PERMISSION_SLICES, each at least once', () => {
    expect(new Set(PLATFORM_PERMISSION_SETS.map((set) => set.slice))).toEqual(new Set(PLATFORM_PERMISSION_SLICES));
  });

  it('grant the system admin every system permission and org_admin every org permission', () => {
    expect(catalog.rolePermissions.admin).toEqual(scopeOf(catalog, 'system'));
    expect(catalog.rolePermissions.org_admin).toEqual(scopeOf(catalog, 'org'));
  });

  it('take the roles from the identity slice', () => {
    expect(Object.values(PLATFORM_ROLES).map((role) => role.id)).toEqual(catalog.roles.map((role) => role.name));
  });
});

describe('registerPlatformPermissions', () => {
  it('fills core registries with exactly the composed catalog, app entries last', () => {
    const { core, manifest } = isolated();
    const app = {
      roles: [[{ id: 'coach', description: 'Coaches athletes', scope: 'org' as const }]],
      permissions: [{ WORKOUTS_READ: { id: 'workouts:read', description: 'Read own workouts', scope: 'org' as const, defaultGrants: ['org_admin', 'coach'] } }],
    };

    manifest.registerPlatformPermissions({ app });

    const registered = core.buildPermissionCatalog();
    expect(registered).toEqual(manifest.platformPermissionCatalog({ app }));
    expect(registered.roles.at(-1)?.name).toBe('coach');
    expect(registered.permissions.at(-1)?.name).toBe('workouts:read');
    expect(registered.rolePermissions.coach).toEqual(['workouts:read']);
    expect(core.buildPermissionCatalog({ roles: core.roleRegistry, permissions: core.permissionRegistry })).toEqual(registered);
  });

  it('refuses an app permission that collides with a platform one, naming it', () => {
    const { manifest } = isolated();
    let error: unknown;
    try {
      manifest.registerPlatformPermissions({
        app: { permissions: [[{ id: 'jobs:read', description: 'Again', scope: 'system', defaultGrants: ['admin'] }]] },
      });
    } catch (err) {
      error = err;
    }
    expect((error as RegistryError).name).toBe('RegistryError');
    expect((error as RegistryError).code).toBe('DUPLICATE_ID');
    expect((error as RegistryError).id).toBe('jobs:read');
  });
});

describe('the slices filter', () => {
  it('keeps only the listed slices, in seed order whatever the list order', () => {
    const catalog = platformPermissionCatalog({ slices: ['nodes', 'jobs', 'settings', 'identity'] });
    expect(catalog.permissions.map((entry) => entry.name)).toEqual([
      'system_settings:read',
      'system_settings:write',
      'user_settings:read',
      'user_settings:write',
      'users:read',
      'users:write',
      'rbac:manage',
      'allowlist:read',
      'allowlist:write',
      'jobs:read',
      'jobs:write',
      'nodes:read',
      'nodes:write',
      'org_members:read',
      'org_members:write',
      'org_invites:read',
      'org_invites:write',
      'organizations:read',
      'organizations:write',
      'org_settings:read',
      'org_settings:write',
    ]);
    expect(catalog.roles).toHaveLength(4);
  });

  it('requires identity and refuses an unknown slice', () => {
    expect(() => platformPermissionCatalog({ slices: ['settings'] })).toThrow(/must include 'identity'/);
    expect(() => platformPermissionCatalog({ slices: ['identity', 'ghost' as never] })).toThrow(/unknown slice\(s\) "ghost"/);
  });
});

describe('PLATFORM_USER_OWNED_MODELS', () => {
  const datamodel = readSchemaDatamodel(PLATFORM_SCHEMA);

  it('reads the platform schema fragments at all', () => {
    expect(datamodel.length).toBeGreaterThan(20);
  });

  it('registers every foreign key to User in the platform fragments, with purge policies that match onDelete', () => {
    expect(checkUserOwnedModels(datamodel, PLATFORM_USER_OWNED_MODELS)).toEqual([]);
  });

  it('holds exactly the platform models with a foreign key to User', () => {
    const withUserKeys = datamodel
      .filter((model) => model.fields.some((field) => field.type === 'User' && (field.relation?.fields.length ?? 0) > 0))
      .map((model) => model.name);
    expect(new Set(PLATFORM_USER_OWNED_MODELS.map((def) => def.model))).toEqual(new Set(withUserKeys));
    expect(PLATFORM_USER_OWNED_MODELS).toHaveLength(withUserKeys.length);
  });

  it('registers the platform inventory first and the app models after it', () => {
    const { core, manifest } = isolated();
    manifest.registerPlatformUserOwnedModels([
      { model: 'Note', ownerField: 'userId', purge: 'delete', export: 'include', rationale: "The user's notes." },
    ]);

    expect(core.userOwnedModelRegistry.ids()).toEqual([...PLATFORM_USER_OWNED_MODELS.map((def) => def.model), 'Note']);
  });

  it('refuses an app model that is a platform model', () => {
    const { manifest } = isolated();
    expect(() =>
      manifest.registerPlatformUserOwnedModels([{ model: 'UserRole', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'Again.' }]),
    ).toThrow(/Duplicate id "UserRole"/);
  });
});

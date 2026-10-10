import {
  RegistryError,
  buildPermissionCatalog,
  catalogGrants,
  composePermissionCatalog,
  permissionIds,
  permissionRegistry,
  registerPermissions,
  registerRoles,
  roleIds,
  roleRegistry,
  withTemporaryEntries,
} from '../../src/core';
import type { PermissionDeclaration, RoleDeclaration } from '../../src/core';

// =============================================================================
// The role and permission registries of core (issue #676; packaged by #866)
// =============================================================================
//
// What this pins: each validation rule (a refusal is a RegistryError naming
// the registry and the id), the order a catalog follows, the detached
// composition `composePermissionCatalog` does without touching the static
// registries, and the literal types `permissionIds` keeps. Moved here from
// the reference app's `common/permissions/permission.registry.spec.ts`, whose
// platform-order and grant invariants stay in the app.
// =============================================================================

const ROLES: readonly RoleDeclaration[] = [
  { id: 'admin', description: 'System administrator', scope: 'system' },
  { id: 'viewer', description: 'Read-only member', scope: 'org' },
  { id: 'org_admin', description: 'Organization administrator', scope: 'org' },
];

function permission(overrides: Partial<PermissionDeclaration> = {}): PermissionDeclaration {
  return { id: 'widgets:read', description: 'Read widgets', scope: 'system', defaultGrants: ['admin'], ...overrides };
}

async function rejectedRegistryErrorOf(promise: Promise<unknown>): Promise<RegistryError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError, nothing was thrown');
}

function registryErrorOf(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RegistryError);
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError, nothing was thrown');
}

describe('the static role and permission registries', () => {
  // The static registries are empty in this package's tests (no manifest
  // runs), so each case fills the roles it needs for its own duration.
  const withRoles = <T>(fn: () => T | Promise<T>) => withTemporaryEntries(roleRegistry, ROLES, fn);

  it('start empty: importing core registers nothing', () => {
    expect(roleRegistry.size).toBe(0);
    expect(permissionRegistry.size).toBe(0);
    expect(roleRegistry.name).toBe('roles');
    expect(permissionRegistry.name).toBe('permissions');
  });

  it.each([
    ['an unknown role in defaultGrants', permission({ defaultGrants: ['admin', 'ghost'] }), 'INVALID_ENTRY', /unknown role "ghost"/],
    ['a repeated grant', permission({ defaultGrants: ['admin', 'admin'] }), 'INVALID_ENTRY', /role "admin" twice/],
    ['an empty description', permission({ description: '   ' }), 'INVALID_ENTRY', /non-empty description/],
    ['an id not shaped <resource>:<action>', permission({ id: 'widgets.read' }), 'INVALID_ID', /must match/],
    ['an id with an upper-case letter', permission({ id: 'Widgets:read' }), 'INVALID_ID', /must match/],
    ['an id with no action', permission({ id: 'widgets:' }), 'INVALID_ID', /must match/],
    ['no scope', permission({ scope: undefined as unknown as 'system' }), 'INVALID_ENTRY', /needs a scope of 'system' or 'org'/],
    ['an unknown scope', permission({ scope: 'tenant' as unknown as 'system' }), 'INVALID_ENTRY', /needs a scope/],
    ['a non-array defaultGrants', permission({ defaultGrants: 'admin' as unknown as string[] }), 'INVALID_ENTRY', /must be an array/],
    ['a system permission granted to an org role', permission({ defaultGrants: ['admin', 'viewer'] }), 'INVALID_ENTRY', /org role "viewer" for a system permission/],
    ['an org permission granted to the system admin role', permission({ scope: 'org', defaultGrants: ['org_admin', 'admin'] }), 'INVALID_ENTRY', /system role "admin" for a org permission/],
  ])('refuses a permission with %s, naming the id', async (_label, entry, code, message) => {
    const error = await withRoles(() => rejectedRegistryErrorOf(withTemporaryEntries(permissionRegistry, [entry], () => undefined)));

    expect(error.code).toBe(code);
    expect(error.registry).toBe('permissions');
    expect(error.id).toBe(entry.id);
    expect(error.message).toMatch(message);
  });

  it('refuses a duplicate id, inside one batch or against an earlier one', async () => {
    await withRoles(async () => {
      const inBatch = await rejectedRegistryErrorOf(withTemporaryEntries(permissionRegistry, [permission(), permission()], () => undefined));
      expect(inBatch.code).toBe('DUPLICATE_ID');

      await withTemporaryEntries(permissionRegistry, [permission()], async () => {
        const again = registryErrorOf(() => registerPermissions([permission()]));
        expect(again.code).toBe('DUPLICATE_ID');
        expect(again.id).toBe('widgets:read');
      });
    });
  });

  it('accepts an empty defaultGrants list (a permission no role holds by default)', async () => {
    await withRoles(() =>
      withTemporaryEntries(permissionRegistry, [permission({ defaultGrants: [] })], () => {
        expect(permissionRegistry.has('widgets:read')).toBe(true);
      }),
    );
  });

  it.each([
    ['an empty description', { id: 'coach', description: '', scope: 'org' }, 'INVALID_ENTRY'],
    ['an id with a colon', { id: 'coach:x', description: 'Coach', scope: 'org' }, 'INVALID_ID'],
    ['no scope', { id: 'coach', description: 'Coach' }, 'INVALID_ENTRY'],
  ])('refuses a role with %s, naming the id', async (_label, entry, code) => {
    const error = await rejectedRegistryErrorOf(withTemporaryEntries(roleRegistry, [entry as RoleDeclaration], () => undefined));

    expect(error.code).toBe(code);
    expect(error.registry).toBe('roles');
    expect(error.id).toBe(entry.id);
  });

  it('registers a map in key order, and builds the catalog in registration order', async () => {
    await withTemporaryEntries(roleRegistry, [], async () => {
      registerRoles({ ADMIN: ROLES[0]!, VIEWER: ROLES[1]! });
      await withTemporaryEntries(permissionRegistry, [], () => {
        registerPermissions({
          B: permission({ id: 'b:write' }),
          A: permission({ id: 'a:read', scope: 'org', defaultGrants: ['viewer'] }),
        });

        expect(buildPermissionCatalog()).toEqual({
          roles: [
            { name: 'admin', description: 'System administrator', scope: 'system' },
            { name: 'viewer', description: 'Read-only member', scope: 'org' },
          ],
          permissions: [
            { name: 'b:write', description: 'Read widgets', scope: 'system' },
            { name: 'a:read', description: 'Read widgets', scope: 'org' },
          ],
          rolePermissions: { admin: ['b:write'], viewer: ['a:read'] },
        });
      });
    });
  });
});

describe('composePermissionCatalog', () => {
  it('composes batches in order on detached registries, leaving the static ones untouched', () => {
    const catalog = composePermissionCatalog({
      roles: [ROLES, [{ id: 'coach', description: 'Coaches athletes', scope: 'org' }]],
      permissions: [
        { READ: permission(), WRITE: permission({ id: 'widgets:write', defaultGrants: [] }) },
        [permission({ id: 'workouts:read', scope: 'org', defaultGrants: ['org_admin', 'coach'] })],
      ],
    });

    expect(catalog.roles.map((role) => role.name)).toEqual(['admin', 'viewer', 'org_admin', 'coach']);
    expect(catalog.permissions.map((entry) => entry.name)).toEqual(['widgets:read', 'widgets:write', 'workouts:read']);
    expect(catalog.rolePermissions).toEqual({
      admin: ['widgets:read'],
      viewer: [],
      org_admin: ['workouts:read'],
      coach: ['workouts:read'],
    });
    expect(roleRegistry.size).toBe(0);
    expect(permissionRegistry.size).toBe(0);
  });

  it('validates exactly as registering does', () => {
    const unknownRole = registryErrorOf(() =>
      composePermissionCatalog({ roles: [ROLES], permissions: [[permission({ defaultGrants: ['coach'] })]] }),
    );
    expect(unknownRole.code).toBe('INVALID_ENTRY');
    expect(unknownRole.registry).toBe('permissions');

    const duplicate = registryErrorOf(() => composePermissionCatalog({ roles: [ROLES, [ROLES[0]!]], permissions: [] }));
    expect(duplicate.code).toBe('DUPLICATE_ID');
    expect(duplicate.registry).toBe('roles');
    expect(duplicate.id).toBe('admin');
  });

  it('is repeatable: two compositions of the same declarations are equal', () => {
    const declarations = { roles: [ROLES], permissions: [[permission()]] };
    expect(composePermissionCatalog(declarations)).toEqual(composePermissionCatalog(declarations));
  });
});

describe('catalogGrants', () => {
  it('lists every default grant as a role and permission pair', () => {
    expect(catalogGrants({ rolePermissions: { admin: ['a:read', 'a:write'], viewer: [], coach: ['a:read'] } })).toEqual([
      { role: 'admin', permission: 'a:read' },
      { role: 'admin', permission: 'a:write' },
      { role: 'coach', permission: 'a:read' },
    ]);
  });
});

describe('permissionIds and roleIds', () => {
  it('map each key to its id, in key order, and freeze the result', () => {
    const ids = permissionIds({
      B_WRITE: { id: 'b:write', description: 'w', scope: 'system', defaultGrants: [] },
      A_READ: { id: 'a:read', description: 'r', scope: 'org', defaultGrants: [] },
    } as const);

    expect(ids).toEqual({ B_WRITE: 'b:write', A_READ: 'a:read' });
    expect(Object.keys(ids)).toEqual(['B_WRITE', 'A_READ']);
    expect(Object.isFrozen(ids)).toBe(true);

    // Compile-time: the literal id type survives (`npm run typecheck` checks this line).
    const literal: 'a:read' = ids.A_READ;
    expect(literal).toBe('a:read');
    const role: 'admin' = roleIds({ ADMIN: { id: 'admin', description: 'a', scope: 'system' } } as const).ADMIN;
    expect(role).toBe('admin');
  });
});

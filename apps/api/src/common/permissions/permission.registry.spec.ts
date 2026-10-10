import { PERMISSIONS, ROLES } from '../constants/roles.constants';
import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import type { PermissionDeclaration, RoleDeclaration } from '@marinoscar/platform-api/core';
import { PLATFORM_ROLES, platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { buildPermissionCatalog, permissionRegistry, roleRegistry } from './index';

// =============================================================================
// Role and permission registries (issue #676, PP-1.4)
// =============================================================================
//
// What this pins, for THIS app's registries: an app entry colliding with a
// platform entry is refused, a bad app declaration fails at import time, the
// seed order the manifest registers in (and that it equals the packaged
// `platformPermissionCatalog()`), and the grant invariants
// docs/ARCHITECTURE.md §7.1 states (Admin holds every permission; `ai:use` is
// withheld from Viewer; `storage_config:*` is not `storage:*`). The registry's
// generic validation rules and `permissionIds` are pinned in the package
// (packages/platform-api/test/core/permissions.spec.ts, #866).
// =============================================================================

const APP_REGISTRATIONS = '../../app-registrations/permissions';

function permission(overrides: Partial<PermissionDeclaration> = {}): PermissionDeclaration {
  return {
    id: 'widgets:read',
    description: 'Read widgets',
    scope: 'system',
    defaultGrants: ['admin'],
    ...overrides,
  };
}

/**
 * Runs `fn` and returns the RegistryError it throws. Matched by name, not
 * `instanceof`: an error thrown inside `jest.isolateModules` comes from that
 * sandbox's own copy of the RegistryError class.
 */
function registryErrorOf(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (err) {
    expect((err as Error).name).toBe('RegistryError');
    return err as RegistryError;
  }
  throw new Error('expected a RegistryError, nothing was thrown');
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

describe('permission registry', () => {
  describe('validation', () => {
    it.each([
      ['a duplicate of a platform id', permission({ id: 'jobs:read' }), 'DUPLICATE_ID', /Duplicate id "jobs:read"/],
      ['a system permission granted to an org role', permission({ defaultGrants: ['admin', 'viewer'] }), 'INVALID_ENTRY', /org role "viewer" for a system permission/],
      ['an org permission granted to the system admin role', permission({ scope: 'org', defaultGrants: ['org_admin', 'admin'] }), 'INVALID_ENTRY', /system role "admin" for a org permission/],
    ])('refuses %s, naming the id', async (_label, entry, code, message) => {
      const error = await rejectedRegistryErrorOf(
        withTemporaryEntries(permissionRegistry, [entry], () => undefined),
      );

      expect(error.code).toBe(code);
      expect(error.registry).toBe('permissions');
      expect(error.id).toBe(entry.id);
      expect(error.message).toMatch(message);
    });

    it('accepts a grant to a role registered earlier', async () => {
      await withTemporaryEntries(roleRegistry, [{ id: 'coach', description: 'Coaches athletes', scope: 'org' }], () =>
        withTemporaryEntries(permissionRegistry, [permission({ scope: 'org', defaultGrants: ['coach'] })], () => {
          expect(permissionRegistry.require('widgets:read').defaultGrants).toEqual(['coach']);
        }),
      );
    });

    it.each([
      ['a duplicate of a platform role', { id: 'admin', description: 'Again', scope: 'system' }, 'DUPLICATE_ID'],
    ])('refuses a role with %s, naming the id', async (_label, entry, code) => {
      const error = await rejectedRegistryErrorOf(
        withTemporaryEntries(roleRegistry, [entry as RoleDeclaration], () => undefined),
      );

      expect(error.code).toBe(code);
      expect(error.registry).toBe('roles');
      expect(error.id).toBe(entry.id);
    });
  });

  describe('at import time', () => {
    // A bad declaration in the app-owned file must stop the process the moment
    // the manifest runs, not surface later as a silently missing grant.
    afterEach(() => {
      jest.dontMock(APP_REGISTRATIONS);
    });

    function importWithAppRegistrations(appRegistrations: {
      APP_ROLES: unknown[];
      APP_PERMISSIONS: unknown[];
    }): void {
      jest.isolateModules(() => {
        jest.doMock(APP_REGISTRATIONS, () => appRegistrations);
        require('./index');
      });
    }

    it.each([
      ['an unknown role', permission({ id: 'workouts:read', defaultGrants: ['coach'] }), 'INVALID_ENTRY'],
      ['a duplicate id', permission({ id: 'users:read' }), 'DUPLICATE_ID'],
      ['a malformed id', permission({ id: 'workouts-read' }), 'INVALID_ID'],
      ['an empty description', permission({ id: 'workouts:read', description: '' }), 'INVALID_ENTRY'],
    ])('fails with a RegistryError for an app permission with %s', (_label, entry, code) => {
      const error = registryErrorOf(() =>
        importWithAppRegistrations({ APP_ROLES: [], APP_PERMISSIONS: [entry] }),
      );

      expect(error.code).toBe(code);
      expect(error.id).toBe(entry.id);
    });

    it('registers app roles before platform permissions and app permissions after them', () => {
      let isolated: typeof import('./index') | undefined;
      jest.isolateModules(() => {
        jest.doMock(APP_REGISTRATIONS, () => ({
          APP_ROLES: [{ id: 'coach', description: 'Coaches athletes', scope: 'org' }],
          APP_PERMISSIONS: [permission({ id: 'workouts:read', scope: 'org', defaultGrants: ['org_admin', 'coach'] })],
        }));
        isolated = require('./index');
      });

      const catalog = isolated!.buildPermissionCatalog();
      expect(catalog.roles.map((role) => role.name)).toEqual(['admin', 'contributor', 'viewer', 'org_admin', 'coach']);
      expect(catalog.permissions.at(-1)).toEqual({ name: 'workouts:read', description: 'Read widgets', scope: 'org' });
      expect(catalog.rolePermissions.coach).toEqual(['workouts:read']);
      expect(catalog.rolePermissions.org_admin.at(-1)).toBe('workouts:read');
    });
  });

  describe('order', () => {
    it('fills the registries with exactly the packaged platform catalog (the app adds nothing upstream)', () => {
      expect(buildPermissionCatalog()).toEqual(platformPermissionCatalog());
    });

    it('registers the platform roles in seed order', () => {
      expect(roleRegistry.ids()).toEqual(['admin', 'contributor', 'viewer', 'org_admin']);
    });

    it('registers the platform permissions in the order PERMISSIONS lists them', () => {
      expect(permissionRegistry.ids()).toEqual(Object.values(PERMISSIONS));
    });

    it('declares 51 permissions and 4 roles, each exactly once', () => {
      expect(permissionRegistry.size).toBe(51);
      expect(new Set(Object.values(PERMISSIONS)).size).toBe(51);
      expect(roleRegistry.size).toBe(4);
    });
  });

  describe('ROLES', () => {
    it('derives ROLES from the platform role declarations', () => {
      expect(ROLES).toEqual({ ADMIN: 'admin', CONTRIBUTOR: 'contributor', VIEWER: 'viewer', ORG_ADMIN: 'org_admin' });
      expect(Object.values(PLATFORM_ROLES).map((role) => role.id)).toEqual(Object.values(ROLES));
    });
  });

  describe('scopes (issue #723)', () => {
    it('gives every role and every permission a scope', () => {
      for (const role of roleRegistry.list()) expect(['system', 'org']).toContain(role.scope);
      for (const entry of permissionRegistry.list()) expect(['system', 'org']).toContain(entry.scope);
    });

    it('scopes admin as the system role and org_admin, contributor and viewer as org roles', () => {
      expect(Object.fromEntries(roleRegistry.list().map((role) => [role.id, role.scope]))).toEqual({
        admin: 'system',
        contributor: 'org',
        viewer: 'org',
        org_admin: 'org',
      });
    });

    it('classifies the permissions as the story table does', () => {
      const orgScoped = permissionRegistry.list().filter((entry) => entry.scope === 'org').map((entry) => entry.id);
      expect(orgScoped).toEqual([
        'user_settings:read',
        'user_settings:write',
        'storage:read',
        'storage:write',
        'ai:use',
        // #739: an organization's own AI configuration.
        'org_ai_config:read',
        'org_ai_config:write',
        'org_members:read',
        'org_members:write',
        'org_invites:read',
        'org_invites:write',
        // The sharing slice (#728): groups live inside one organization.
        'groups:read',
        'groups:write',
        'groups:admin',
        // Grants (#729): records shared inside one organization.
        'sharing:read',
        'sharing:write',
        'sharing:admin',
        // The settings slice's org layer (#733).
        'org_settings:read',
        'org_settings:write',
        // Org-targeted broadcasts (#738).
        'org_broadcasts:read',
        'org_broadcasts:write',
      ]);
    });

    it('grants every role only permissions of its own scope', () => {
      for (const entry of permissionRegistry.list()) {
        for (const role of entry.defaultGrants) expect(roleRegistry.require(role).scope).toBe(entry.scope);
      }
    });
  });

  describe('default grants', () => {
    const catalog = buildPermissionCatalog();
    const idsOfScope = (scope: 'system' | 'org') =>
      permissionRegistry.list().filter((entry) => entry.scope === scope).map((entry) => entry.id);

    it('grants the system admin role every system permission and nothing else (docs/ARCHITECTURE.md §7.1)', () => {
      expect(catalog.rolePermissions.admin).toEqual(idsOfScope('system'));
    });

    it('grants org_admin every org permission', () => {
      expect(catalog.rolePermissions.org_admin).toEqual(idsOfScope('org'));
    });

    it('matches the grants table per role', () => {
      expect(catalog.rolePermissions.contributor).toEqual([
        'user_settings:read',
        'user_settings:write',
        'storage:read',
        'storage:write',
        'ai:use',
        'groups:read',
        'groups:write',
        'sharing:read',
        'sharing:write',
      ]);
      expect(catalog.rolePermissions.viewer).toEqual(['user_settings:read', 'user_settings:write', 'storage:read', 'groups:read', 'sharing:read']);
    });

    it('keeps admin + org_admin equal to what admin alone held before the split, plus the four org_* permissions', () => {
      const union = new Set([...catalog.rolePermissions.admin, ...catalog.rolePermissions.org_admin]);
      expect([...union].sort()).toEqual([...permissionRegistry.ids()].sort());
    });

    it('withholds ai:use from Viewer and grants it to Contributor', () => {
      expect(catalog.rolePermissions.viewer).not.toContain(PERMISSIONS.AI_USE);
      expect(catalog.rolePermissions.contributor).toContain(PERMISSIONS.AI_USE);
    });

    it('keeps storage_config:* Admin-only while storage:read reaches every org role', () => {
      for (const role of [ROLES.CONTRIBUTOR, ROLES.VIEWER, ROLES.ORG_ADMIN]) {
        expect(catalog.rolePermissions[role]).not.toContain(PERMISSIONS.STORAGE_CONFIG_READ);
        expect(catalog.rolePermissions[role]).not.toContain(PERMISSIONS.STORAGE_CONFIG_WRITE);
        expect(catalog.rolePermissions[role]).toContain(PERMISSIONS.STORAGE_READ);
      }
    });
  });
});

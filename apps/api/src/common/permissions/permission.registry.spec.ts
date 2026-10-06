import { PERMISSIONS, ROLES } from '../constants/roles.constants';
import { RegistryError, withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  buildPermissionCatalog,
  permissionIds,
  permissionRegistry,
  PLATFORM_ROLES,
  roleRegistry,
} from './index';
import type { PermissionDeclaration } from './permission.types';

// =============================================================================
// Role and permission registries (issue #676, PP-1.4)
// =============================================================================
//
// What this pins: the registry's validation rules (each refusal is a
// RegistryError naming the id, at import time when it comes from a declaration
// file), the seed order the manifest registers in, the literal types
// `permissionIds` keeps, and the grant invariants docs/ARCHITECTURE.md §7.1
// states (Admin holds every permission; `ai:use` is withheld from Viewer;
// `storage_config:*` is not `storage:*`).
// =============================================================================

const APP_REGISTRATIONS = '../../app-registrations/permissions';

function permission(overrides: Partial<PermissionDeclaration> = {}): PermissionDeclaration {
  return {
    id: 'widgets:read',
    description: 'Read widgets',
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
      ['an unknown role in defaultGrants', permission({ defaultGrants: ['admin', 'ghost'] }), 'INVALID_ENTRY', /unknown role "ghost"/],
      ['a repeated grant', permission({ defaultGrants: ['admin', 'admin'] }), 'INVALID_ENTRY', /role "admin" twice/],
      ['an empty description', permission({ description: '   ' }), 'INVALID_ENTRY', /non-empty description/],
      ['an id not shaped <resource>:<action>', permission({ id: 'widgets.read' }), 'INVALID_ID', /must match/],
      ['an id with an upper-case letter', permission({ id: 'Widgets:read' }), 'INVALID_ID', /must match/],
      ['an id with no action', permission({ id: 'widgets:' }), 'INVALID_ID', /must match/],
      ['a duplicate of a platform id', permission({ id: 'jobs:read' }), 'DUPLICATE_ID', /Duplicate id "jobs:read"/],
    ])('refuses %s, naming the id', async (_label, entry, code, message) => {
      const error = await rejectedRegistryErrorOf(
        withTemporaryEntries(permissionRegistry, [entry], () => undefined),
      );

      expect(error.code).toBe(code);
      expect(error.registry).toBe('permissions');
      expect(error.id).toBe(entry.id);
      expect(error.message).toMatch(message);
    });

    it('refuses a duplicate id inside one batch', async () => {
      const error = await rejectedRegistryErrorOf(
        withTemporaryEntries(permissionRegistry, [permission(), permission()], () => undefined),
      );

      expect(error.code).toBe('DUPLICATE_ID');
      expect(error.id).toBe('widgets:read');
    });

    it('accepts an empty defaultGrants list (a permission no role holds by default)', async () => {
      await withTemporaryEntries(permissionRegistry, [permission({ defaultGrants: [] })], () => {
        expect(permissionRegistry.has('widgets:read')).toBe(true);
      });
    });

    it('accepts a grant to a role registered earlier', async () => {
      await withTemporaryEntries(roleRegistry, [{ id: 'coach', description: 'Coaches athletes' }], () =>
        withTemporaryEntries(permissionRegistry, [permission({ defaultGrants: ['coach'] })], () => {
          expect(permissionRegistry.require('widgets:read').defaultGrants).toEqual(['coach']);
        }),
      );
    });

    it.each([
      ['an empty description', { id: 'coach', description: '' }, 'INVALID_ENTRY'],
      ['an id with a colon', { id: 'coach:x', description: 'Coach' }, 'INVALID_ID'],
      ['a duplicate of a platform role', { id: 'admin', description: 'Again' }, 'DUPLICATE_ID'],
    ])('refuses a role with %s, naming the id', async (_label, entry, code) => {
      const error = await rejectedRegistryErrorOf(
        withTemporaryEntries(roleRegistry, [entry], () => undefined),
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
          APP_ROLES: [{ id: 'coach', description: 'Coaches athletes' }],
          APP_PERMISSIONS: [permission({ id: 'workouts:read', defaultGrants: ['admin', 'coach'] })],
        }));
        isolated = require('./index');
      });

      const catalog = isolated!.buildPermissionCatalog();
      expect(catalog.roles.map((role) => role.name)).toEqual(['admin', 'contributor', 'viewer', 'coach']);
      expect(catalog.permissions.at(-1)?.name).toBe('workouts:read');
      expect(catalog.rolePermissions.coach).toEqual(['workouts:read']);
      expect(catalog.rolePermissions.admin.at(-1)).toBe('workouts:read');
    });
  });

  describe('order', () => {
    it('registers the platform roles in seed order', () => {
      expect(roleRegistry.ids()).toEqual(['admin', 'contributor', 'viewer']);
    });

    it('registers the platform permissions in the order PERMISSIONS lists them', () => {
      expect(permissionRegistry.ids()).toEqual(Object.values(PERMISSIONS));
    });

    it('declares 31 permissions and 3 roles, each exactly once', () => {
      expect(permissionRegistry.size).toBe(31);
      expect(new Set(Object.values(PERMISSIONS)).size).toBe(31);
      expect(roleRegistry.size).toBe(3);
    });
  });

  describe('permissionIds', () => {
    it('maps each key to its id, in key order, and freezes the result', () => {
      const ids = permissionIds({
        B_WRITE: { id: 'b:write', description: 'w', defaultGrants: [] },
        A_READ: { id: 'a:read', description: 'r', defaultGrants: [] },
      } as const);

      expect(ids).toEqual({ B_WRITE: 'b:write', A_READ: 'a:read' });
      expect(Object.keys(ids)).toEqual(['B_WRITE', 'A_READ']);
      expect(Object.isFrozen(ids)).toBe(true);

      // Compile-time: the literal id type survives (`npm run typecheck` checks this line).
      const literal: 'a:read' = ids.A_READ;
      expect(literal).toBe('a:read');
    });

    it('derives ROLES from the platform role declarations', () => {
      expect(ROLES).toEqual({ ADMIN: 'admin', CONTRIBUTOR: 'contributor', VIEWER: 'viewer' });
      expect(Object.values(PLATFORM_ROLES).map((role) => role.id)).toEqual(Object.values(ROLES));
    });
  });

  describe('default grants', () => {
    const catalog = buildPermissionCatalog();

    it('grants Admin every registered permission (docs/ARCHITECTURE.md §7.1)', () => {
      const missing = permissionRegistry
        .list()
        .filter((entry) => !entry.defaultGrants.includes(ROLES.ADMIN))
        .map((entry) => entry.id);

      expect(missing).toEqual([]);
      expect(catalog.rolePermissions.admin).toEqual(permissionRegistry.ids());
    });

    it('withholds ai:use from Viewer and grants it to Contributor', () => {
      expect(catalog.rolePermissions.viewer).not.toContain(PERMISSIONS.AI_USE);
      expect(catalog.rolePermissions.contributor).toContain(PERMISSIONS.AI_USE);
    });

    it('keeps storage_config:* Admin-only while storage:read reaches every role', () => {
      for (const role of [ROLES.CONTRIBUTOR, ROLES.VIEWER]) {
        expect(catalog.rolePermissions[role]).not.toContain(PERMISSIONS.STORAGE_CONFIG_READ);
        expect(catalog.rolePermissions[role]).not.toContain(PERMISSIONS.STORAGE_CONFIG_WRITE);
        expect(catalog.rolePermissions[role]).toContain(PERMISSIONS.STORAGE_READ);
      }
    });
  });
});

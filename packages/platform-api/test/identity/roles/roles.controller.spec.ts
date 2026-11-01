import 'reflect-metadata';

import { ForbiddenException } from '@nestjs/common';

import { roleRegistry, withTemporaryEntries, type Principal, type RoleDeclaration } from '../../../src/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../../src/identity/auth/decorators/permissions.decorator';
import { RolesController } from '../../../src/identity/roles/roles.controller';

// =============================================================================
// GET /api/roles (PP-14.15): users:read opens the system scope, org_members:read the org scope
// =============================================================================

const principal = (...permissions: string[]): Principal => ({ permissions }) as unknown as Principal;

const APP_ROLES: RoleDeclaration[] = [
  { id: 'coach', description: 'Reviews workouts', scope: 'org', label: 'Coach' },
  { id: 'support', description: 'Reads the user list', scope: 'system' },
];

describe('RolesController', () => {
  const controller = new RolesController();

  it('is authenticated and admits a holder of either permission (the handler narrows by scope)', () => {
    const handler = RolesController.prototype.list;
    expect(Reflect.getMetadata('__guards__', handler).map((guard: { name: string }) => guard.name)).toEqual([
      'JwtAuthGuard',
      'RolesGuard',
      'PermissionsGuard',
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler)).toEqual(['users:read', 'org_members:read']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []).toEqual([]);
  });

  it('lists the system roles for users:read and the org roles for org_members:read', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      expect(controller.list({ scope: 'system' }, principal('users:read')).map((role) => role.id)).toEqual(['admin', 'support']);
      expect(controller.list({ scope: 'org' }, principal('org_members:read')).map((role) => role.id)).toEqual([
        'contributor',
        'viewer',
        'org_admin',
        'coach',
      ]);
    });
  });

  it('refuses a scope the caller may not read, whichever permission they hold', () => {
    expect(() => controller.list({ scope: 'org' }, principal('users:read'))).toThrow(ForbiddenException);
    expect(() => controller.list({ scope: 'system' }, principal('org_members:read'))).toThrow(ForbiddenException);
    expect(() => controller.list({ scope: 'system' }, principal('org_members:write', 'users:write'))).toThrow(ForbiddenException);
  });

  it('lists every readable scope when none is asked for, and only those', async () => {
    await withTemporaryEntries(roleRegistry, APP_ROLES, () => {
      expect(controller.list({}, principal('users:read')).every((role) => role.scope === 'system')).toBe(true);
      expect(controller.list({}, principal('org_members:read')).every((role) => role.scope === 'org')).toBe(true);
      const both = controller.list({}, principal('users:read', 'org_members:read')).map((role) => role.id);
      expect(both).toEqual(['admin', 'contributor', 'viewer', 'org_admin', 'coach', 'support']);
    });
  });

  it('reports the assignable flag so a client can hide a role the routes would refuse', async () => {
    const internal: RoleDeclaration = { id: 'robot', description: 'Managed by the app', scope: 'org', assignable: false };
    await withTemporaryEntries(roleRegistry, [internal], () => {
      const robot = controller.list({ scope: 'org' }, principal('org_members:read')).find((role) => role.id === 'robot');
      expect(robot?.assignable).toBe(false);
    });
  });
});

import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser, requestUserOf } from '../../../../src/identity/auth/decorators/current-user.decorator';

// #1103: on a bare `@Auth()` route (no permission list) neither
// `PermissionsGuard` nor `RolesGuard` sets `request.requestUser`, so
// `@CurrentUser()` used to return the raw Prisma user graph.
describe('@CurrentUser()', () => {
  const graph = {
    id: 'user-1',
    email: 'user@example.com',
    isActive: true,
    displayName: 'Person A',
    userRoles: [{ role: { name: 'admin', rolePermissions: [{ permission: { name: 'users:read' } }] } }],
    memberships: [],
  };

  class Probe {
    handler(@CurrentUser() _user: unknown, @CurrentUser('id') _id: unknown) {}
  }

  // Runs the real decorator factory the way Nest does.
  function run(request: Record<string, unknown>, index: number, data?: string): unknown {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
    const entry = Object.values(meta).find((m: any) => m.index === index) as any;
    const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    return entry.factory(data ?? entry.data, ctx);
  }

  it('yields a RequestUser on a route with no permissions (only request.user set)', () => {
    const result = run({ user: graph }, 0) as any;
    expect(result).toEqual(
      expect.objectContaining({ id: 'user-1', email: 'user@example.com', isActive: true }),
    );
    expect(result.roles).toEqual(['admin']);
    expect(result.permissions).toEqual(['users:read']);
    expect(result).not.toHaveProperty('userRoles');
    expect(result).not.toHaveProperty('displayName');
  });

  it('returns request.requestUser untouched when a guard set it', () => {
    const requestUser = { id: 'u', email: 'e', roles: [], permissions: [], isActive: true };
    expect(run({ requestUser, user: graph }, 0)).toBe(requestUser);
  });

  it('reads a single property from the RequestUser', () => {
    expect(run({ user: graph }, 1)).toBe('user-1');
  });

  it('is undefined on a public route', () => {
    expect(run({}, 0)).toBeUndefined();
    expect(requestUserOf(undefined)).toBeUndefined();
  });
});

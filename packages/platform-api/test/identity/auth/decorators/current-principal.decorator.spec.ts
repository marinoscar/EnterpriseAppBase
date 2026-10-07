import { principalOf } from './current-principal.decorator';

// #724: `@CurrentPrincipal()` reads what `JwtAuthGuard` attached, and builds
// the same thing from `request.user` when a test set only that.
describe('principalOf (@CurrentPrincipal)', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    isActive: true,
    userRoles: [{ role: { name: 'admin', rolePermissions: [{ permission: { name: 'users:read' } }] } }],
    memberships: [],
  };

  it('returns request.principal when the guard set it', () => {
    const principal = { kind: 'user', userId: 'user-1' } as any;
    expect(principalOf({ principal, user: user as any })).toBe(principal);
  });

  it('builds a session principal from request.user otherwise', () => {
    expect(principalOf({ user: user as any })).toMatchObject({
      kind: 'user',
      credential: 'session',
      userId: 'user-1',
      permissions: ['users:read'],
    });
  });

  it('honours the credential kind stamped on request.user', () => {
    const bound = Object.defineProperty({ ...user }, 'tokenKind', { value: 'node', enumerable: false });
    expect(principalOf({ user: bound as any })).toMatchObject({ kind: 'node', credential: 'node' });
  });

  it('is undefined on a public route', () => {
    expect(principalOf({})).toBeUndefined();
    expect(principalOf(undefined)).toBeUndefined();
  });
});

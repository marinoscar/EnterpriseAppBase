// Step-up versus forbidden in a protected resource (#1194): `userPermissionsOf` and `oauthAccessDecision`
// of `@marinoscar/platform-api/identity`, the reference for the extension-point catalog rows.
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import { oauthAccessDecision, oauthResourceRegistry, oauthScopeRegistry, userPermissionsOf } from '@marinoscar/platform-api/identity';

const SCOPES = [
  { id: 'notes_demo:read', title: 'Read notes', description: 'See notes.', permissions: ['notes_demo:read'], risk: 'low' as const, default: true },
  { id: 'notes_demo:write', title: 'Change notes', description: 'Edit notes.', permissions: ['notes_demo:write'], risk: 'elevated' as const },
];
const RESOURCE = { id: 'notes_demo', path: '/api/notes-demo', routePrefixes: ['/api/notes-demo'], scopes: ['notes_demo:read', 'notes_demo:write'], name: 'Notes demo' };

/** A request as the guard leaves it: the user holds `userPerms` through a system role, the `oat_` token carries `scopes`. */
function oauthRequest(scopes: string[], userPerms: string[]) {
  const user = {
    userRoles: [{ role: { name: 'demo', rolePermissions: userPerms.map((name) => ({ permission: { name } })) } }],
    memberships: [],
    activeOrgId: null,
  };
  const narrowed = scopes.flatMap((scope) => SCOPES.find((entry) => entry.id === scope)?.permissions ?? []);
  Object.defineProperty(user, 'oauthNarrowing', {
    value: { permissions: narrowed, info: { clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes_demo', scopes } },
    enumerable: false,
  });
  const principal = { kind: 'user', credential: 'oauth', permissions: narrowed, oauth: { clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes_demo', scopes } };
  return { user, principal };
}

const withDemo = <T>(fn: () => T): T =>
  withTemporaryEntries(oauthScopeRegistry, SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [RESOURCE], fn)) as T;

describe('step-up versus forbidden', () => {
  it('reads the permissions the user holds before the scope narrowing', () => {
    const request = oauthRequest(['notes_demo:read'], ['notes_demo:read', 'notes_demo:write']);
    expect(request.principal.permissions).toEqual(['notes_demo:read']);
    expect([...userPermissionsOf(request)].sort()).toEqual(['notes_demo:read', 'notes_demo:write']);
    expect(userPermissionsOf({}).size).toBe(0);
  });

  it('answers step_up when re-consent can fix it and forbidden when it cannot', () => {
    withDemo(() => {
      expect(oauthAccessDecision(oauthRequest(['notes_demo:read'], ['notes_demo:read', 'notes_demo:write']), 'notes_demo:write')).toBe('step_up');
      expect(oauthAccessDecision(oauthRequest(['notes_demo:read'], ['notes_demo:read']), 'notes_demo:write')).toBe('forbidden');
      expect(oauthAccessDecision(oauthRequest(['notes_demo:read', 'notes_demo:write'], ['notes_demo:write']), 'notes_demo:write')).toBe('granted');
    });
  });
});

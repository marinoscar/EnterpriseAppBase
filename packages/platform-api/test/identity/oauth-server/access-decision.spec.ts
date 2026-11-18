// userPermissionsOf and oauthAccessDecision (#1194): step-up versus forbidden.
import { withTemporaryEntries } from '../../../src/core/index';
import { stampCredential, stampOAuthNarrowing } from '../../../src/identity/auth/credential-binding';
import { toPrincipal } from '../../../src/identity/auth/principal.factory';
import { oauthAccessDecision, oauthResourceRegistry, oauthScopeRegistry, userPermissionsOf } from '../../../src/identity/index';
import { NOTES_RESOURCE, NOTES_SCOPES, ORG_ID, userGraph } from './support';

const withNotes = <T>(fn: () => T): T =>
  withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [NOTES_RESOURCE], fn)) as T;

function oauthRequest(scopes: string[], userPerms: string[]) {
  const user = stampCredential(userGraph(userPerms) as never, { activeOrgId: ORG_ID, tokenKind: 'oauth' });
  stampOAuthNarrowing(user, {
    permissions: scopes.flatMap((scope) => NOTES_SCOPES.find((d) => d.id === scope)?.permissions ?? []),
    info: { clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes', scopes },
  });
  return { user, principal: toPrincipal(user as never, 'oauth') };
}

function sessionRequest(userPerms: string[]) {
  const user = stampCredential(userGraph(userPerms) as never, { activeOrgId: ORG_ID, tokenKind: 'session' });
  return { user, principal: toPrincipal(user as never, 'session') };
}

describe('userPermissionsOf', () => {
  it('returns the permissions before the OAuth narrowing', () => {
    const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write']);
    expect(request.principal.permissions).not.toContain('notes:write');
    expect([...userPermissionsOf(request)].sort()).toEqual(['notes:read', 'notes:write']);
  });

  it('does not modify the request graph', () => {
    const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write']);
    userPermissionsOf(request);
    expect(request.principal.permissions).not.toContain('notes:write');
    expect(userPermissionsOf(request).has('notes:write')).toBe(true);
  });

  it('equals the principal permissions for a session credential', () => {
    const request = sessionRequest(['notes:read', 'notes:write']);
    expect([...userPermissionsOf(request)].sort()).toEqual([...request.principal.permissions].sort());
  });

  it('is empty without a user, with a non-object request or with a graph that has no roles', () => {
    expect(userPermissionsOf({}).size).toBe(0);
    expect(userPermissionsOf(undefined).size).toBe(0);
    expect(userPermissionsOf(null).size).toBe(0);
    expect(userPermissionsOf({ user: { id: 'x' } }).size).toBe(0);
  });
});

describe('oauthAccessDecision', () => {
  it('is granted when the principal already holds it', () => {
    withNotes(() => {
      expect(oauthAccessDecision(oauthRequest(['notes:read', 'notes:write'], ['notes:read', 'notes:write']), 'notes:write')).toBe('granted');
      expect(oauthAccessDecision(sessionRequest(['notes:write']), 'notes:write')).toBe('granted');
    });
  });

  it('is step_up when the user holds it, the token lacks it and a scope of the resource grants it', () => {
    withNotes(() => {
      expect(oauthAccessDecision(oauthRequest(['notes:read'], ['notes:read', 'notes:write']), 'notes:write')).toBe('step_up');
    });
  });

  it('is forbidden when the user lacks the permission', () => {
    withNotes(() => {
      expect(oauthAccessDecision(oauthRequest(['notes:read'], ['notes:read']), 'notes:write')).toBe('forbidden');
    });
  });

  it('is forbidden when no scope of the resource grants a permission the user holds', () => {
    withNotes(() => {
      expect(oauthAccessDecision(oauthRequest(['notes:read'], ['notes:read', 'billing:write']), 'billing:write')).toBe('forbidden');
    });
  });

  it('is forbidden for a session caller that lacks it, and for a request with no user', () => {
    withNotes(() => {
      expect(oauthAccessDecision(sessionRequest(['notes:read']), 'notes:write')).toBe('forbidden');
      expect(oauthAccessDecision({}, 'notes:write')).toBe('forbidden');
      expect(oauthAccessDecision(undefined, 'notes:write')).toBe('forbidden');
    });
  });
});

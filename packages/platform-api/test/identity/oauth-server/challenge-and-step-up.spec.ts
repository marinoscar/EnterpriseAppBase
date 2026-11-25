// The 401 challenge on a protected resource's routes, InsufficientScopeException, assertOAuthScopes and the
// PermissionsGuard mapping (PP-15.6).
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { HttpExceptionFilter, responseHeadersOf, withTemporaryEntries, type Principal } from '../../../src/core/index';
import { JwtAuthGuard } from '../../../src/identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../src/identity/auth/guards/permissions.guard';
import { PERMISSIONS_KEY, ANY_PERMISSIONS_KEY } from '../../../src/identity/auth/decorators/permissions.decorator';
import { stampCredential, stampOAuthNarrowing } from '../../../src/identity/auth/credential-binding';
import { toPrincipal } from '../../../src/identity/auth/principal.factory';
import { InsufficientScopeException, assertOAuthScopes, oauthResourceRegistry, oauthScopeRegistry } from '../../../src/identity/index';
import { configureOAuthChallengeBase } from '../../../src/identity/oauth-server/oauth-challenge';
import { NOTES_RESOURCE, NOTES_SCOPES, ORG_ID, APP_URL, userGraph } from './support';

const METADATA = `resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/notes-agent"`;

const withNotes = <T>(fn: () => T): T =>
  withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [NOTES_RESOURCE], fn)) as T;

beforeAll(() => configureOAuthChallengeBase(APP_URL));
afterAll(() => configureOAuthChallengeBase(undefined));

/** An oauth request: the user graph narrowed to `scopes`, the principal the guard would attach. */
function oauthRequest(scopes: string[], userPerms: string[], url = '/api/notes-agent/items') {
  const user = stampCredential(userGraph(userPerms) as never, { activeOrgId: ORG_ID, tokenKind: 'oauth' });
  stampOAuthNarrowing(user, {
    permissions: scopes.flatMap((scope) => NOTES_SCOPES.find((d) => d.id === scope)?.permissions ?? []),
    info: { clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes', scopes },
  });
  const request: any = { url, headers: {}, user };
  request.principal = toPrincipal(user as never, 'oauth');
  return request;
}

describe('the 401 challenge of JwtAuthGuard', () => {
  let settings: { isEnabled: jest.Mock };
  let guard: JwtAuthGuard;
  let passport: jest.SpyInstance;

  const context = (authorization: string | undefined, url: string) => {
    const request: any = { headers: authorization ? { authorization } : {}, url };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    settings = { isEnabled: jest.fn(async () => true) };
    const reflector = { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector;
    guard = new JwtAuthGuard(reflector, { resolveToken: jest.fn(async () => null) } as never, { validateToken: jest.fn() } as never, { resolve: jest.fn(async () => null) } as never, settings as never);
    passport = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockRejectedValue(new UnauthorizedException());
  });
  afterEach(() => jest.restoreAllMocks());

  async function refusal(authorization: string | undefined, url: string): Promise<UnauthorizedException> {
    try {
      await guard.canActivate(context(authorization, url));
    } catch (failure) {
      return failure as UnauthorizedException;
    }
    throw new Error('expected a refusal');
  }
  const headerOf = (failure: unknown) => responseHeadersOf(failure, {})['WWW-Authenticate'];

  it('challenges a request with no credential, without an error', async () => {
    await withNotes(async () => {
      expect(headerOf(await refusal(undefined, '/api/notes-agent/items'))).toBe(`Bearer ${METADATA}`);
    });
  });

  it('challenges with invalid_token whenever a credential was presented: a session JWT, a PAT, an oat_ token', async () => {
    await withNotes(async () => {
      for (const authorization of ['Bearer abc.def.ghi', 'Bearer pat_garbage', 'Bearer oat_garbage']) {
        const header = headerOf(await refusal(authorization, '/api/notes-agent/items?x=1'));
        expect(header).toContain(METADATA);
        expect(header).toContain('error="invalid_token"');
      }
    });
  });

  it('leaves a 401 outside every resource exactly as it was: no header, same exception', async () => {
    await withNotes(async () => {
      const failure = await refusal(undefined, '/api/users');
      expect(failure).toBeInstanceOf(UnauthorizedException);
      expect(responseHeadersOf(failure, {})).toEqual({});
      expect(failure.getResponse()).toEqual({ statusCode: 401, message: 'Unauthorized' });
      expect(Object.getOwnPropertySymbols(failure).filter((s) => s.description?.includes('RESPONSE_HEADERS'))).toEqual([]);
    });
  });

  it('adds no challenge while the OAuth server is not enabled, and none when the guard has no OAuth settings', async () => {
    await withNotes(async () => {
      settings.isEnabled.mockResolvedValue(false);
      expect(headerOf(await refusal(undefined, '/api/notes-agent/items'))).toBeUndefined();
      settings.isEnabled.mockResolvedValue(true);
      const bare = new JwtAuthGuard({ getAllAndOverride: () => false } as never, { resolveToken: jest.fn() } as never, { validateToken: jest.fn() } as never);
      passport.mockRejectedValue(new UnauthorizedException());
      await expect(bare.canActivate(context(undefined, '/api/notes-agent/items'))).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('does not touch a refusal that is not a 401 (the route-confinement 403)', async () => {
    await withNotes(async () => {
      passport.mockRejectedValue(new ForbiddenException('no'));
      const failure = await guard.canActivate(context(undefined, '/api/notes-agent/items')).catch((e) => e);
      expect(failure).toBeInstanceOf(ForbiddenException);
      expect(responseHeadersOf(failure, {})).toEqual({});
    });
  });
});

describe('InsufficientScopeException', () => {
  it('answers insufficient_scope with the granted scopes TOGETHER WITH the required ones for an oauth caller', () => {
    withNotes(() => {
      const exception = new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] });
      expect(exception.getStatus()).toBe(403);
      expect(responseHeadersOf(exception, oauthRequest(['notes:read'], ['notes:read', 'notes:write']))['WWW-Authenticate']).toBe(
        `Bearer ${METADATA}, error="insufficient_scope", scope="notes:read notes:write"`,
      );
    });
  });

  it('is an ordinary 403 for a caller that is not an oauth credential', () => {
    withNotes(() => {
      const exception = new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] });
      const user = stampCredential(userGraph(['notes:write']) as never, { activeOrgId: ORG_ID, tokenKind: 'pat' });
      const pat: any = { url: '/x', user, principal: toPrincipal(user as never, 'pat') };
      expect(responseHeadersOf(exception, pat)).toEqual({});
      expect(responseHeadersOf(exception, { url: '/x' })).toEqual({});
    });
  });

  it('is written by the platform error filter with the header on the reply', () => {
    withNotes(() => {
      const reply: any = { header: jest.fn().mockReturnThis(), code: jest.fn().mockReturnThis(), send: jest.fn() };
      const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write']);
      const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }) } as never;
      new HttpExceptionFilter().catch(new InsufficientScopeException({ resourceId: 'notes', requiredScopes: ['notes:write'] }), host);
      expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('error="insufficient_scope", scope="notes:read notes:write"'));
      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });
});

describe('assertOAuthScopes', () => {
  it('passes when the token holds every scope', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read', 'notes:write'], ['notes:read']);
      expect(() => assertOAuthScopes(request.principal as Principal, 'notes', ['notes:write'])).not.toThrow();
    });
  });

  it('throws InsufficientScopeException naming only the missing scopes', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read']);
      try {
        assertOAuthScopes(request.principal as Principal, 'notes', ['notes:read', 'notes:write']);
        throw new Error('expected a throw');
      } catch (failure) {
        expect(failure).toBeInstanceOf(InsufficientScopeException);
        expect((failure as InsufficientScopeException).requiredScopes).toEqual(['notes:write']);
      }
    });
  });

  it('refuses a token granted for another resource, whatever its scopes', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read']);
      const other = { ...request.principal } as Principal;
      Object.defineProperty(other, 'oauth', { value: { ...request.principal.oauth, resourceId: 'elsewhere' } });
      expect(() => assertOAuthScopes(other, 'notes', ['notes:read'])).toThrow(InsufficientScopeException);
    });
  });

  it('does nothing for a session or PAT principal and for no principal', () => {
    withNotes(() => {
      const user = stampCredential(userGraph(['notes:write']) as never, { activeOrgId: ORG_ID, tokenKind: 'pat' });
      expect(() => assertOAuthScopes(toPrincipal(user as never, 'pat'), 'notes', ['notes:write'])).not.toThrow();
      expect(() => assertOAuthScopes(undefined, 'notes', ['notes:write'])).not.toThrow();
    });
  });

  it('throws a plain Error for an unregistered resource id (a coding error, not a refusal)', () => {
    const request = oauthRequest(['notes:read'], ['notes:read']);
    expect(() => assertOAuthScopes(request.principal as Principal, 'ghost', ['x'])).toThrow(/unknown protected resource/);
  });
});

describe('PermissionsGuard on an oauth principal', () => {
  const guardFor = (required: string[] | undefined, anyOf?: string[]) => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === PERMISSIONS_KEY ? required : key === ANY_PERMISSIONS_KEY ? anyOf : undefined),
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  };
  const run = (guard: PermissionsGuard, request: unknown) =>
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext);
  const caught = (fn: () => unknown): any => {
    try {
      fn();
    } catch (failure) {
      return failure;
    }
    throw new Error('expected a refusal');
  };

  it('maps a denial that re-consent can fix (the user holds it, a scope of the resource grants it) to insufficient_scope', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write']);
      const failure = caught(() => run(guardFor(['notes:write']), request));
      expect(failure).toBeInstanceOf(InsufficientScopeException);
      expect(responseHeadersOf(failure, request)['WWW-Authenticate']).toContain('error="insufficient_scope", scope="notes:read notes:write"');
    });
  });

  it('stays a plain 403 when the USER lacks the permission: re-consent cannot add it', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read']);
      const failure = caught(() => run(guardFor(['notes:write']), request));
      expect(failure).toBeInstanceOf(ForbiddenException);
      expect(failure).not.toBeInstanceOf(InsufficientScopeException);
      expect(failure.message).toBe('Missing permissions: notes:write');
    });
  });

  it('stays a plain 403 when no scope of the resource grants the permission', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read', 'billing:read']);
      expect(caught(() => run(guardFor(['billing:read']), request))).not.toBeInstanceOf(InsufficientScopeException);
    });
  });

  it('requires EVERY missing permission to be fixable', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write', 'billing:read']);
      expect(caught(() => run(guardFor(['notes:write', 'billing:read']), request))).not.toBeInstanceOf(InsufficientScopeException);
    });
  });

  it('handles anyPermissions: one fixable alternative suffices', () => {
    withNotes(() => {
      const request = oauthRequest(['notes:read'], ['notes:read', 'notes:write']);
      const failure = caught(() => run(guardFor(undefined, ['billing:read', 'notes:write']), request));
      expect(failure).toBeInstanceOf(InsufficientScopeException);
      expect((failure as InsufficientScopeException).requiredScopes).toEqual(['notes:write']);
    });
  });

  it('is unchanged for a session or PAT principal and for a token that holds the scope', () => {
    withNotes(() => {
      const user = stampCredential(userGraph(['notes:read']) as never, { activeOrgId: ORG_ID, tokenKind: 'pat' });
      const pat: any = { user, principal: toPrincipal(user as never, 'pat') };
      expect(caught(() => run(guardFor(['notes:write']), pat))).toMatchObject({ message: 'Missing permissions: notes:write' });
      const ok = oauthRequest(['notes:read', 'notes:write'], ['notes:read', 'notes:write']);
      expect(run(guardFor(['notes:write']), ok)).toBe(true);
    });
  });
});

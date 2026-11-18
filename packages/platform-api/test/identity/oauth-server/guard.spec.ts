// JwtAuthGuard's `Bearer oat_` branch (PP-15.3, #1181): the feature gate, route
// confinement BEFORE any I/O, audience binding, one message for every token
// refusal, the narrowed principal; the roles-only refusal; and that the
// existing credentials are unaffected.
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { withTemporaryEntries } from '../../../src/core/index';
import { JwtAuthGuard } from '../../../src/identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../src/identity/auth/guards/roles.guard';
import { PermissionsGuard } from '../../../src/identity/auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../src/identity/auth/decorators/permissions.decorator';
import { ROLES_KEY } from '../../../src/identity/auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../src/identity/auth/decorators/public.decorator';
import { OAuthTokenResolver, oauthResourceRegistry, oauthScopeRegistry, oauthGrantOf } from '../../../src/identity/index';
import type { ResolvedOAuthToken } from '../../../src/identity/index';
import { stampOAuthNarrowing, stampCredential } from '../../../src/identity/auth/credential-binding';
import { InProcessDelegation } from '../../../src/identity/oauth-server/in-process-delegation.service';
import { OAuthServerSettingsReader } from '../../../src/identity/oauth-server/oauth-server-settings.reader';
import { NOTES_RESOURCE, NOTES_SCOPES, ORG_ID, OTHER_RESOURCE, userGraph } from './support';

const UNAUTHORIZED = 'Invalid or expired access token';

function resolvedFor(resource = NOTES_RESOURCE, scopes = ['notes:read'], perms = ['notes:read', 'notes:write'], systemRoles: Array<{ name: string; perms: string[] }> = []): ResolvedOAuthToken {
  const user = stampCredential(userGraph(perms, { systemRoles }) as never, { activeOrgId: ORG_ID, tokenKind: 'oauth' });
  stampOAuthNarrowing(user, {
    permissions: scopes.flatMap((s) => NOTES_SCOPES.find((d) => d.id === s)?.permissions ?? []),
    info: { clientId: 'client-1', grantId: 'grant-1', resourceId: resource.id, scopes },
  });
  return { user: user as never, tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resource, scopes };
}

describe('JwtAuthGuard: Bearer oat_', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let patService: { resolveToken: jest.Mock };
  let nodes: { validateToken: jest.Mock };
  let resolver: { resolve: jest.Mock };
  let settings: { isEnabled: jest.Mock };
  let delegation: InProcessDelegation;
  let guard: JwtAuthGuard;

  function context(authorization: string | undefined, url: string, raw?: unknown) {
    const request: any = { headers: authorization ? { authorization } : {}, url, raw };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn(() => false) };
    patService = { resolveToken: jest.fn() };
    nodes = { validateToken: jest.fn() };
    resolver = { resolve: jest.fn(async () => resolvedFor()) };
    settings = { isEnabled: jest.fn(async () => true) };
    delegation = new InProcessDelegation();
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      patService as never,
      nodes as never,
      resolver as unknown as OAuthTokenResolver,
      settings as unknown as OAuthServerSettingsReader,
      delegation,
    );
    jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockReturnValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  const withNotes = <T>(fn: () => Promise<T>) =>
    withTemporaryEntries(oauthScopeRegistry, NOTES_SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [NOTES_RESOURCE], fn));

  describe('feature gate', () => {
    it('is a 401 when the OAuth server is not mounted (no resolver), and nothing else changes', async () => {
      const unmounted = new JwtAuthGuard(reflector as unknown as Reflector, patService as never, nodes as never);
      const { ctx } = context('Bearer oat_abc', '/api/notes-agent/x');
      await expect(withNotes(() => unmounted.canActivate(ctx))).rejects.toThrow(new UnauthorizedException(UNAUTHORIZED));
      // a PAT, a node credential and a JWT take their usual paths on the same guard
      patService.resolveToken.mockResolvedValue({ user: { id: 'u', userRoles: [] }, tokenId: 'p' });
      const pat = context('Bearer pat_abc', '/api/anything');
      await expect(unmounted.canActivate(pat.ctx)).resolves.toBe(true);
      expect(pat.request.authCredential).toEqual({ kind: 'pat', tokenId: 'p' });
      const jwt = context('Bearer eyJ.x.y', '/api/anything');
      await expect(unmounted.canActivate(jwt.ctx)).resolves.toBe(true);
      expect(jwt.request.authCredential).toEqual({ kind: 'jwt' });
    });

    it('is a 401 while oauthServer.enabled is false, before confinement or any lookup', async () => {
      settings.isEnabled.mockResolvedValue(false);
      const { ctx } = context('Bearer oat_abc', '/api/users');
      await expect(withNotes(() => guard.canActivate(ctx))).rejects.toThrow(new UnauthorizedException(UNAUTHORIZED));
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('a public route short-circuits before the oat_ branch', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);
      const { ctx } = context('Bearer oat_abc', '/api/users');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(settings.isEnabled).not.toHaveBeenCalled();
    });
  });

  describe('route confinement runs BEFORE any I/O', () => {
    it.each(['/api/users', '/api/auth/me', '/api/nodes/1', '/api/notes-agentX', '/api/notes', '/', '/api/pat'])(
      'a token on %s is a 403 and the resolver is never called',
      async (url) => {
        const { ctx } = context('Bearer oat_abc', url);
        await expect(withNotes(() => guard.canActivate(ctx))).rejects.toThrow(
          new ForbiddenException('OAuth access tokens may only be used on the resource they were issued for'),
        );
        expect(resolver.resolve).not.toHaveBeenCalled();
      },
    );

    it('strips the query string: ?/api/notes-agent cannot smuggle a forbidden path through', async () => {
      const { ctx } = context('Bearer oat_abc', '/api/users?next=/api/notes-agent');
      await expect(withNotes(() => guard.canActivate(ctx))).rejects.toBeInstanceOf(ForbiddenException);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('a request with no URL is refused (fail closed)', async () => {
      const { ctx, request } = context('Bearer oat_abc', undefined as never);
      delete request.url;
      await expect(withNotes(() => guard.canActivate(ctx))).rejects.toBeInstanceOf(ForbiddenException);
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('prefers originalUrl over url', async () => {
      const { ctx, request } = context('Bearer oat_abc', '/api/notes-agent/x');
      request.originalUrl = '/api/users';
      await expect(withNotes(() => guard.canActivate(ctx))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('on a resource route', () => {
    it('admits a live token: request.user, the oauth credential info and a narrowed principal', async () => {
      const { ctx, request } = context('Bearer oat_abc', '/api/notes-agent/run?x=1');
      await expect(withNotes(() => guard.canActivate(ctx))).resolves.toBe(true);
      expect(resolver.resolve).toHaveBeenCalledWith('oat_abc');
      expect(request.authCredential).toEqual({ kind: 'oauth', tokenId: 'tok-1', grantId: 'grant-1', clientId: 'client-1', resourceId: 'notes', scopes: ['notes:read'] });
      expect(request.principal).toMatchObject({ kind: 'user', credential: 'oauth', userId: 'user-1', permissions: ['notes:read'], activeOrgId: ORG_ID });
      expect(oauthGrantOf(request)).toEqual({ clientId: 'client-1', grantId: 'grant-1', resourceId: 'notes', scopes: ['notes:read'] });
    });

    it('a token whose grant names resource B is a 403 on resource A (after the lookup)', async () => {
      resolver.resolve.mockResolvedValue(resolvedFor(OTHER_RESOURCE));
      const { ctx } = context('Bearer oat_abc', '/api/notes-agent/run');
      await expect(withNotes(() => guard.canActivate(ctx))).rejects.toThrow(
        new ForbiddenException('OAuth access tokens may only be used on the resource they were issued for'),
      );
    });

    it('answers ONE message for every token refusal (the resolver says null for all of them)', async () => {
      resolver.resolve.mockResolvedValue(null);
      const { ctx } = context('Bearer oat_abc', '/api/notes-agent/run');
      const error = await withNotes(() => guard.canActivate(ctx)).catch((e) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe(UNAUTHORIZED);
    });
  });

  describe('roles and permissions guards over an oauth principal', () => {
    async function admit(perms: string[], scopes: string[], systemRoles = [{ name: 'admin', perms: [] as string[] }]) {
      resolver.resolve.mockResolvedValue(resolvedFor(NOTES_RESOURCE, scopes, perms, systemRoles));
      const { ctx, request } = context('Bearer oat_abc', '/api/notes-agent/x');
      await withNotes(() => guard.canActivate(ctx));
      return request;
    }
    function metaContext(request: unknown, meta: Record<string, unknown>) {
      const r = new Reflector();
      const handler = () => undefined;
      for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
      const ctx = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => class {} } as unknown as ExecutionContext;
      return { r, ctx };
    }

    it('a user with notes:write and a token with only notes:read cannot write', async () => {
      const request = await admit(['notes:read', 'notes:write'], ['notes:read']);
      const { r, ctx } = metaContext(request, { [PERMISSIONS_KEY]: ['notes:write'] });
      expect(() => new PermissionsGuard(r).canActivate(ctx)).toThrow(/Missing permissions: notes:write/);
      const read = metaContext(request, { [PERMISSIONS_KEY]: ['notes:read'] });
      expect(new PermissionsGuard(read.r).canActivate(read.ctx)).toBe(true);
    });

    it('a user WITHOUT notes:read and a token with scope notes:read cannot read', async () => {
      const request = await admit(['notes:write'], ['notes:read']);
      const { r, ctx } = metaContext(request, { [PERMISSIONS_KEY]: ['notes:read'] });
      expect(() => new PermissionsGuard(r).canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('a route guarded only by @Roles(admin) is refused to an oauth credential of an admin', async () => {
      const request = await admit(['notes:read'], ['notes:read']);
      expect(request.principal.roles).toContain('admin'); // roles are kept for display
      const { r, ctx } = metaContext(request, { [ROLES_KEY]: ['admin'] });
      expect(() => new RolesGuard(r).canActivate(ctx)).toThrow(new ForbiddenException('This route is not available to OAuth access tokens'));
    });

    it('a route with roles AND permissions is decided by the narrowed permissions', async () => {
      const request = await admit(['notes:read', 'notes:write'], ['notes:read']);
      const both = metaContext(request, { [ROLES_KEY]: ['admin'], [PERMISSIONS_KEY]: ['notes:write'] });
      expect(new RolesGuard(both.r).canActivate(both.ctx)).toBe(true); // the role holds...
      expect(() => new PermissionsGuard(both.r).canActivate(both.ctx)).toThrow(ForbiddenException); // ...the scope does not
    });

    it('anyPermissions sees the narrowed set too', async () => {
      const request = await admit(['notes:read', 'notes:write'], ['notes:read']);
      const { r, ctx } = metaContext(request, { anyPermissions: ['notes:write'] });
      expect(() => new PermissionsGuard(r).canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('RolesGuard still admits a session by role (unchanged)', () => {
      const request = { user: userGraph([], { systemRoles: [{ name: 'admin', perms: [] }] }), authCredential: { kind: 'jwt' } };
      const { r, ctx } = metaContext(request, { [ROLES_KEY]: ['admin'] });
      expect(new RolesGuard(r).canActivate(ctx)).toBe(true);
    });
  });
});

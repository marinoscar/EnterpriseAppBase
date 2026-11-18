// The `oauth-server` conformance suite (PP-15.8, #1186): it passes on a sound
// registration and each of its ten checks FAILS on a deliberately broken one.
import { Controller, ForbiddenException, Get, Module, UnauthorizedException, type CanActivate } from '@nestjs/common';

import { Auth } from '../../../src/identity/auth/decorators/auth.decorator';
import {
  checkChallengeOn401,
  checkMetadataShape,
  checkNoRolesOnlyAdmission,
  checkOAuthSecretEgress,
  checkOAuthTokenConfinement,
  checkResourcePrefixExclusive,
  checkResourceScopesRegistered,
  checkScopeNarrowing,
  checkScopePermissionsRegistered,
  checkSessionOnlyRoutes,
  defaultSessionOnlyHandlers,
  discoverOAuthRoutes,
  parseBearerChallenge,
  type OAuthServerConformanceOptions,
} from '../../../src/identity/testing/index';
import { discoverControllers } from '../../../src/identity/testing/conformance';
import { createHash } from 'node:crypto';
import { withTemporaryEntries } from '../../../src/core/index';
import { oauthResourceRegistry, oauthScopeRegistry } from '../../../src/identity/index';

// The guards read the live registries: register the sound resource for each test.
const live = (fn: () => Promise<void>) => () => withTemporaryEntries(oauthScopeRegistry, SCOPES, () => withTemporaryEntries(oauthResourceRegistry, [RESOURCE], fn));

const SCOPES = [
  { id: 'cn:read', title: 'Read', description: 'Read.', permissions: ['cn:read'], risk: 'low' as const, default: true },
  { id: 'cn:write', title: 'Write', description: 'Write.', permissions: ['cn:write'], risk: 'elevated' as const },
];
const RESOURCE = { id: 'cn', path: '/api/cn', routePrefixes: ['/api/cn'], scopes: ['cn:read', 'cn:write'], name: 'Conformance notes' };

@Controller('cn')
class CnController {
  @Get('items')
  @Auth({ permissions: ['cn:read'] })
  list() {
    return [];
  }
  @Get('admin')
  @Auth({ roles: ['admin'] })
  adminOnly() {
    return [];
  }
}
@Controller('other')
class OtherController {
  @Get('x')
  @Auth()
  x() {
    return 1;
  }
}
@Module({ controllers: [CnController, OtherController] })
class CnModule {}

const options = (over: Partial<OAuthServerConformanceOptions> = {}): OAuthServerConformanceOptions => ({
  rootModule: CnModule,
  permissions: ['cn:read', 'cn:write'],
  secretEgress: { skip: 'unit test, no database' },
  ...over,
});
const routes = () => discoverOAuthRoutes(discoverControllers(CnModule));
const allow = class implements CanActivate {
  canActivate() {
    return true;
  }
};
const no401Challenge = class implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException();
  }
};

describe('oauth-server conformance checks', () => {
  it('discovers the routes with their paths and access', () => {
    expect(routes().map((r) => `${r.id} ${r.path}`)).toEqual(expect.arrayContaining(['CnController#list /api/cn/items', 'OtherController#x /api/other/x']));
  });

  describe('passes on a sound registration', () => {
    it('registries, metadata', () => {
      expect(checkScopePermissionsRegistered(SCOPES, ['cn:read', 'cn:write'])).toEqual([]);
      expect(checkResourceScopesRegistered([RESOURCE], SCOPES)).toEqual([]);
      expect(checkResourcePrefixExclusive([RESOURCE])).toEqual([]);
    });
    it('confinement, narrowing, session-only, roles-only, challenge', live(async () => {
      expect(await checkOAuthTokenConfinement(options(), routes())).toEqual([]);
      expect(await checkScopeNarrowing(options(), routes())).toEqual([]);
      expect(await checkSessionOnlyRoutes(defaultSessionOnlyHandlers())).toEqual([]);
      expect(await checkNoRolesOnlyAdmission(options(), routes())).toEqual([]);
      expect(await checkChallengeOn401(options(), routes())).toEqual([]);
    }));
  });

  describe('fails on a broken one', () => {
    it('scope-permissions-registered: a scope names an unregistered permission', () => {
      expect(checkScopePermissionsRegistered([{ ...SCOPES[0]!, permissions: ['ghost:read'] }], ['cn:read']).map((f) => f.file)).toEqual(['scope-permissions-registered']);
    });
    it('resource-scopes-registered: an unknown scope, and no default scope', () => {
      const findings = checkResourceScopesRegistered([{ ...RESOURCE, scopes: ['cn:write', 'nope'] }], SCOPES);
      expect(findings).toHaveLength(2);
    });
    it('resource-prefix-exclusive: nested prefixes and a prefix covering /api/auth', () => {
      expect(checkResourcePrefixExclusive([RESOURCE, { ...RESOURCE, id: 'b', routePrefixes: ['/api/cn/deep'] }])).toHaveLength(1);
      expect(checkResourcePrefixExclusive([{ ...RESOURCE, routePrefixes: ['/api'] }]).length).toBeGreaterThan(0);
    });
    it('token-confinement: a guard that admits an oat_ token anywhere', live(async () => {
      const findings = await checkOAuthTokenConfinement(options({ guard: allow as never }), routes());
      expect(findings.some((f) => f.message.includes('outside its resource'))).toBe(true);
    }));
    it('scope-narrowing: a permission guard that admits a token lacking the scope', live(async () => {
      const findings = await checkScopeNarrowing(options({ permissionsGuard: allow as never }), routes());
      expect(findings.map((f) => f.file)).toEqual(['scope-narrowing']);
    }));
    it('session-only-routes: a handler that does not refuse', async () => {
      class Broken {
        decide() {
          return 'ok';
        }
      }
      const findings = await checkSessionOnlyRoutes([{ controller: Broken as never, handler: 'decide' }]);
      expect(findings).toHaveLength(1);
      class Refuses {
        decide() {
          throw new ForbiddenException();
        }
      }
      expect(await checkSessionOnlyRoutes([{ controller: Refuses as never, handler: 'decide' }])).toEqual([]);
    });
    it('no-roles-only-admission: a roles guard that admits an oauth credential', live(async () => {
      expect((await checkNoRolesOnlyAdmission(options({ rolesGuard: allow as never }), routes())).map((f) => f.file)).toEqual(['no-roles-only-admission']);
    }));
    it('challenge-on-401: a guard that answers 401 without a challenge', live(async () => {
      const findings = await checkChallengeOn401(options({ guard: no401Challenge as never }), routes());
      expect(findings.length).toBeGreaterThan(0);
    }));
    it('metadata-shape: plain PKCE, a wrong issuer and a wrong resource', () => {
      const findings = checkMetadataShape({
        appUrl: 'https://a.example.test',
        authorizationServer: { issuer: 'https://b.example.test', authorization_endpoint: 'x', token_endpoint: 'y', response_types_supported: ['code'], grant_types_supported: [], code_challenge_methods_supported: ['plain'] },
        protectedResources: [{ id: 'cn', path: '/api/cn', document: { resource: 'https://a.example.test/other', authorization_servers: ['https://a.example.test'], scopes_supported: [] } }],
      });
      expect(findings.length).toBeGreaterThanOrEqual(4);
    });
    it('secret-egress: a secret, its hash and a token-shaped string', () => {
      const secret = 'oat_abcdefghijklmnopqrstuvwxyz012345';
      const hash = createHash('sha256').update(secret).digest('hex');
      expect(checkOAuthSecretEgress({ secrets: [secret], responses: [{ ok: 1 }], auditRows: [{ meta: { h: hash } }], logLines: [`token ${secret}`] })).toHaveLength(3);
      expect(checkOAuthSecretEgress({ secrets: [secret], responses: [{ ok: 1 }], auditRows: [], logLines: [] })).toEqual([]);
    });
  });

  it('parses a challenge', () => {
    expect(parseBearerChallenge('Bearer resource_metadata="https://x/y", error="invalid_token"')).toEqual({ resource_metadata: 'https://x/y', error: 'invalid_token' });
  });
});

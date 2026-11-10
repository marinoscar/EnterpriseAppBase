import 'reflect-metadata';

import { Controller, ForbiddenException, Get, Module, UseGuards, forwardRef, type CanActivate, type ExecutionContext } from '@nestjs/common';

import { Auth, JwtAuthGuard, Public } from '../../src/identity/index';
import {
  checkPermissionsRegistered,
  checkRls,
  checkRouteAccess,
  checkScopeGrants,
  checkTokenConfinement,
  discoverControllers,
  discoverIdentityRoutes,
  identityConformanceSuite,
} from '../../src/identity/testing/index';
import { conformanceSuites, runPlatformConformance, type ConformanceTestApi } from '../../src/testing/index';

// =============================================================================
// The identity conformance suite: it passes a conformant app and fails each
// fixture violation (#727): an undecorated route, an unregistered permission,
// a cross-scope grant, and a guard that lets a worker credential (or a PAT
// treated as one) through outside the rules.
// =============================================================================

@Controller('reports')
class ReportsController {
  @Get() @Auth({ permissions: ['reports:read'] }) list() { return []; }
  @Get('health') @Public() health() { return 'ok'; }
  @Get('direct') @UseGuards(JwtAuthGuard) direct() { return 'ok'; }
}

@Controller('leaky')
class LeakyController {
  @Get() everyone() { return 'oops'; }
}

@Module({ controllers: [LeakyController] })
class LeakyModule {}

@Module({ controllers: [ReportsController] })
class ReportsModule {}

@Module({ imports: [ReportsModule, { module: class DynamicHolder {}, imports: [forwardRef(() => LeakyModule)] }] })
class FixtureAppModule {}

const PERMISSIONS = [
  { id: 'reports:read', scope: 'org' as const },
  { id: 'users:read', scope: 'system' as const },
];
const ROLES = [
  { id: 'admin', scope: 'system' as const },
  { id: 'viewer', scope: 'org' as const },
];

describe('identity conformance checks', () => {
  const controllers = discoverControllers(FixtureAppModule);
  const routes = discoverIdentityRoutes(controllers);

  it('walks static, dynamic and forward-referenced imports', () => {
    expect(controllers).toEqual([ReportsController, LeakyController]);
    expect(routes.map((route) => route.id)).toEqual([
      'ReportsController#list',
      'ReportsController#health',
      'ReportsController#direct',
      'LeakyController#everyone',
    ]);
  });

  it('route-access: flags exactly the undecorated route', () => {
    expect(checkRouteAccess(routes).map((finding) => finding.file)).toEqual(['LeakyController#everyone']);
  });

  it('permissions-registered: flags a permission the registry does not know, and an org role on @Auth', () => {
    expect(checkPermissionsRegistered(routes, { permissions: PERMISSIONS, roles: ROLES })).toEqual([]);
    const missing = checkPermissionsRegistered(routes, { permissions: PERMISSIONS.slice(1), roles: ROLES });
    expect(missing).toEqual([expect.objectContaining({ file: 'ReportsController#list', message: expect.stringContaining('"reports:read"') })]);
    const orgRole = checkPermissionsRegistered(
      [{ id: 'X#y', isPublic: false, authenticated: true, permissions: [], roles: ['viewer'] }],
      { permissions: PERMISSIONS, roles: ROLES },
    );
    expect(orgRole[0]?.message).toMatch(/system roles only/);
  });

  it('scope-grants: flags a cross-scope grant', () => {
    expect(checkScopeGrants({ permissions: PERMISSIONS, roles: ROLES, grants: [{ role: 'viewer', permission: 'reports:read' }] })).toEqual([]);
    const crossed = checkScopeGrants({ permissions: PERMISSIONS, roles: ROLES, grants: [{ role: 'viewer', permission: 'users:read' }] });
    expect(crossed).toEqual([expect.objectContaining({ file: 'grants', message: expect.stringContaining('system permission "users:read" to the org role "viewer"') })]);
  });

  it('token-confinement: the slice guard conforms', async () => {
    await expect(checkTokenConfinement()).resolves.toEqual([]);
  });

  it('token-confinement: flags a guard that lets a worker credential reach any route', async () => {
    class OpenNodeGuard implements CanActivate {
      async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{ headers: { authorization: string }; authCredential?: unknown }>();
        request.authCredential = { kind: request.headers.authorization.startsWith('Bearer nod_') ? 'node' : 'pat' };
        return true;
      }
    }
    const findings = await checkTokenConfinement(OpenNodeGuard as never);
    expect(findings.map((finding) => finding.message)).toEqual(expect.arrayContaining([expect.stringContaining('nod_ worker credential on /api/users')]));
  });

  it('token-confinement: flags a guard that treats a PAT on a node route as a node credential', async () => {
    class PatAsNodeGuard extends JwtAuthGuard {
      override async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{ headers: { authorization: string }; url: string; authCredential?: unknown }>();
        if (request.url.startsWith('/api/nodes') && request.headers.authorization.startsWith('Bearer pat_')) {
          request.authCredential = { kind: 'node' };
          return true;
        }
        return super.canActivate(context);
      }
    }
    const findings = await checkTokenConfinement(PatAsNodeGuard);
    expect(findings).toEqual([expect.objectContaining({ message: expect.stringContaining('pat_ token as a personal access token on /api/nodes/register') })]);
    expect(ForbiddenException).toBeDefined();
  });

  it('rls: flags an org table that is not forced or carries none of its policies', async () => {
    const inspect = async () => [
      { table: 'storage_objects', enabled: true, forced: true, policies: ['storage_objects_org_isolation'] },
      { table: 'ai_runs', enabled: true, forced: false, policies: [] },
    ];
    const findings = await checkRls({ policies: { storage_objects: ['storage_objects_org_isolation'], ai_runs: ['ai_runs_org_isolation'], ai_usage_events: ['x'] }, inspect });
    expect(findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual([
      'ai_runs: does not have row-level security enabled AND forced.',
      'ai_runs: carries none of its listed policies (ai_runs_org_isolation).',
      'ai_usage_events: is an org table the database does not report.',
    ]);
  });
});

describe('the identity suite through runPlatformConformance', () => {
  it('is registered by importing the testing entry', () => {
    expect(conformanceSuites.get('identity')).toBe(identityConformanceSuite);
  });

  it('registers one test per check and fails the leaky fixture', async () => {
    const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
    const failures: string[] = [];
    const api: ConformanceTestApi = {
      describe: (_name, fn) => fn(),
      it: (name, fn) => {
        tests.push({ name, fn });
      },
      expect: (actual) => ({
        toEqual(expected) {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(JSON.stringify(actual));
        },
        toBeGreaterThanOrEqual() {},
        toContain() {},
      }),
    };
    runPlatformConformance({
      sourceRoots: [__dirname],
      testApi: api,
      suites: {
        identity: {
          rootModule: FixtureAppModule,
          permissions: PERMISSIONS,
          roles: ROLES,
          grants: [{ role: 'viewer', permission: 'users:read' }],
          rls: { policies: {}, inspect: async () => [] },
        },
      },
    });
    expect(tests.map((test) => test.name.split(':')[0])).toEqual(['route-access', 'permissions-registered', 'scope-grants', 'token-confinement', 'rls']);
    for (const test of tests) await test.fn();
    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toMatch(/LeakyController#everyone/);
    expect(failures.join('\n')).toMatch(/users:read/);
  });
});

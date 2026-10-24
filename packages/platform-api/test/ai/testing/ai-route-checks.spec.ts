import 'reflect-metadata';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import {
  discoverAiRbacRoutes,
  discoverAiRoutes,
  findAdminRoutesBlocked,
  findAiPermissionDeclarationFailures,
  findRoleMismatches,
  findRoutesNotAnswering401,
  findRoutesNotKillSwitched,
  isPermissionDenied,
} from '../../../src/ai/testing';
import { RBAC_EXTENSION_KEY } from '../../../src/identity';

// Known-bad proof for the `ai-kill-switch` and `ai-rbac-matrix` suites: a small
// Nest app that breaks each rule on purpose, driven by the SAME functions the
// suites call over the real app.

const refuse = (scope: 'system' | 'org') =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'AI is disabled', details: { reason: 'AI_DISABLED', scope } });

/** The kill switch: answers before any credential matters, like `AiEnabledGuard`. */
@Injectable()
class KillSwitchGuard implements CanActivate {
  canActivate(): boolean {
    throw refuse('system');
  }
}

/** A guard that authenticates by bearer token and grants permissions per token. */
const TOKEN_PERMISSIONS: Record<string, string[]> = { 'admin-token': ['ai:use', 'ai_config:read'], 'viewer-token': [] };

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest().headers.authorization as string | undefined;
    if (!header) throw new UnauthorizedException();
    context.switchToHttp().getRequest().permissions = TOKEN_PERMISSIONS[header.replace('Bearer ', '')] ?? [];
    return true;
  }
}

@Injectable()
class RequiresAiUse implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Bare 403 with no `details`: what `PermissionsGuard` throws.
    if (!(context.switchToHttp().getRequest().permissions as string[]).includes('ai:use')) {
      throw new ForbiddenException('Missing permissions: ai:use');
    }
    return true;
  }
}

@Controller('ai')
class ConsumerController {
  /** Open, like the real one. */
  @Get('config')
  config() {
    return { data: { enabled: false } };
  }

  @Post('gated')
  @UseGuards(KillSwitchGuard)
  gated() {
    return {};
  }

  /** THE KNOWN-BAD ROUTE: an `/api/ai/*` route nobody gated. */
  @Get('foo')
  foo() {
    return { data: 'served while AI is off' };
  }

  @Get('enforced')
  @UseGuards(AuthGuard, RequiresAiUse)
  enforced() {
    return {};
  }

  /** THE KNOWN-BAD ROUTE: declares `ai:use` but enforces nothing, once past authentication. */
  @Get('unenforced')
  @UseGuards(AuthGuard)
  unenforced() {
    return {};
  }

  /** Declares nothing and is open to the world: not a 401. */
  @Get('open')
  open() {
    return {};
  }
}

@Controller('admin/ai')
class AdminController {
  @Get('reachable')
  @UseGuards(AuthGuard)
  reachable() {
    return {};
  }

  /** THE KNOWN-BAD ROUTE: an admin route someone put behind the kill switch. */
  @Get('blocked')
  @UseGuards(KillSwitchGuard)
  blocked() {
    return {};
  }
}

describe('the AI route checks fail on a broken app', () => {
  let app: NestFastifyApplication;
  let server: unknown;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ConsumerController, AdminController] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('findRoutesNotKillSwitched (the kill switch)', () => {
    it('passes the gated routes and skips GET /api/ai/config', async () => {
      const routes = [
        { path: '/api/ai/config', method: 'GET' },
        { path: '/api/ai/gated', method: 'POST' },
      ];

      expect(await findRoutesNotKillSwitched(server, routes, { scope: 'system', checkCode: true })).toEqual([]);
    });

    it('names an ungated GET /api/ai/foo, and nothing else', async () => {
      const routes = [
        { path: '/api/ai/gated', method: 'POST' },
        { path: '/api/ai/foo', method: 'GET' },
      ];

      expect(await findRoutesNotKillSwitched(server, routes, { scope: 'system', checkCode: true })).toEqual([
        'GET /api/ai/foo: status=200 code=undefined reason=undefined scope=undefined',
      ]);
    });

    it('names a route that answers for the wrong scope', async () => {
      const failures = await findRoutesNotKillSwitched(server, [{ path: '/api/ai/gated', method: 'POST' }], { scope: 'org' });

      expect(failures).toEqual(['POST /api/ai/gated: status=403 reason=AI_DISABLED scope=system']);
    });
  });

  describe('findAdminRoutesBlocked (the admin surface stays reachable)', () => {
    it('passes a route that answers 401 unauthenticated', async () => {
      expect(await findAdminRoutesBlocked(server, [{ path: '/api/admin/ai/reachable', method: 'GET' }])).toEqual([]);
    });

    it('names an admin route behind the kill switch', async () => {
      expect(await findAdminRoutesBlocked(server, [{ path: '/api/admin/ai/blocked', method: 'GET' }])).toEqual([
        'GET /api/admin/ai/blocked: blocked by the kill switch (403)',
      ]);
    });

    it('names an unauthenticated route that does not answer 401 (so it cannot prove the guard is absent)', async () => {
      expect(await findAdminRoutesBlocked(server, [{ path: '/api/ai/foo', method: 'GET' }])).toEqual([
        'GET /api/ai/foo: expected 401 (not kill-switched), got 200',
      ]);
    });

    it('with a token, names only a route the kill switch blocks', async () => {
      const routes = [
        { path: '/api/admin/ai/reachable', method: 'GET' },
        { path: '/api/admin/ai/blocked', method: 'GET' },
      ];

      expect(await findAdminRoutesBlocked(server, routes, { token: 'admin-token' })).toEqual([
        'GET /api/admin/ai/blocked: blocked by the org kill switch',
      ]);
    });
  });

  describe('findRoutesNotAnswering401 (unauthenticated)', () => {
    it('names a route that serves an unauthenticated caller', async () => {
      const routes = [
        { path: '/api/ai/enforced', method: 'GET' },
        { path: '/api/ai/open', method: 'GET' },
      ];

      expect(await findRoutesNotAnswering401(server, routes)).toEqual(['GET /api/ai/open: expected 401, got 200']);
    });
  });

  describe('findRoleMismatches (the RBAC matrix)', () => {
    const enforced = { path: '/api/ai/enforced', method: 'GET', permissions: ['ai:use'] };
    const unenforced = { path: '/api/ai/unenforced', method: 'GET', permissions: ['ai:use'] };

    it('passes when each role is granted or denied exactly as seeded', async () => {
      expect(await findRoleMismatches(server, [enforced], 'viewer', 'viewer-token', new Set())).toEqual([]);
      expect(await findRoleMismatches(server, [enforced], 'admin', 'admin-token', new Set(['ai:use']))).toEqual([]);
    });

    it('names a role denied a route it holds', async () => {
      expect(await findRoleMismatches(server, [enforced], 'contributor', 'viewer-token', new Set(['ai:use']))).toEqual([
        'GET /api/ai/enforced: contributor holds ["ai:use"] but was denied',
      ]);
    });

    it('names a declared permission nothing enforces: a viewer is not denied', async () => {
      expect(await findRoleMismatches(server, [unenforced], 'viewer', 'viewer-token', new Set())).toEqual([
        'GET /api/ai/unenforced: viewer lacks ["ai:use"] but was not denied (status 200)',
      ]);
    });

    it('does not take a business refusal (a 403 with details) for an RBAC denial', () => {
      expect(isPermissionDenied({ status: 403, body: { details: { reason: 'AI_KEY_REQUIRED' } } })).toBe(false);
      expect(isPermissionDenied({ status: 403, body: { message: 'Missing permissions' } })).toBe(true);
      expect(isPermissionDenied({ status: 401, body: {} })).toBe(false);
    });
  });
});

describe('findAiPermissionDeclarationFailures', () => {
  const ok = [
    { path: '/api/ai/config', method: 'GET', permissions: [] },
    { path: '/api/ai/responses', method: 'POST', permissions: ['ai:use'] },
    { path: '/api/admin/ai/config', method: 'GET', permissions: ['ai_config:read'] },
    { path: '/api/admin/ai/org-keys', method: 'PUT', permissions: ['org_ai_config:write'] },
  ];

  it('passes the declarations the platform ships', () => {
    expect(findAiPermissionDeclarationFailures(ok)).toEqual([]);
  });

  it('names a route that lost its permission, one that invented one, and an org permission outside org-*', () => {
    expect(
      findAiPermissionDeclarationFailures([
        { path: '/api/ai/responses', method: 'POST', permissions: [] },
        { path: '/api/ai/config', method: 'GET', permissions: ['ai:use'] },
        { path: '/api/admin/ai/config', method: 'PUT', permissions: ['users:read'] },
        { path: '/api/admin/ai/models', method: 'GET', permissions: ['org_ai_config:read'] },
        { path: '/api/admin/ai/usage', method: 'GET', permissions: ['ai_config:read', 'ai_config:write'] },
      ]),
    ).toEqual([
      "POST /api/ai/responses: expected exactly ['ai:use'], got []",
      'GET /api/ai/config: expected no permission, got ["ai:use"]',
      'PUT /api/admin/ai/config: expected exactly one ai_config:* (or, under /api/admin/ai/org-*, org_ai_config:*) permission, got ["users:read"]',
      'GET /api/admin/ai/models: expected exactly one ai_config:* (or, under /api/admin/ai/org-*, org_ai_config:*) permission, got ["org_ai_config:read"]',
      'GET /api/admin/ai/usage: expected exactly one ai_config:* (or, under /api/admin/ai/org-*, org_ai_config:*) permission, got ["ai_config:read","ai_config:write"]',
    ]);
  });
});

describe('route discovery', () => {
  const document = {
    paths: {
      '/api/ai/config': { get: { [RBAC_EXTENSION_KEY]: { permissions: [] } } },
      '/api/ai/responses/{id}': { parameters: [], post: { [RBAC_EXTENSION_KEY]: { permissions: ['ai:use'] } } },
      '/api/admin/ai/config': { get: { [RBAC_EXTENSION_KEY]: { permissions: ['ai_config:read'] } } },
      '/api/users': { get: {} },
    },
  };

  it('splits consumer and admin AI routes by path and ignores everything else', () => {
    expect(discoverAiRoutes(document)).toEqual({
      aiRoutes: [
        { path: '/api/ai/config', method: 'GET' },
        { path: '/api/ai/responses/{id}', method: 'POST' },
      ],
      adminAiRoutes: [{ path: '/api/admin/ai/config', method: 'GET' }],
    });
  });

  it('reads each route’s declared permissions off the x-rbac extension', () => {
    expect(discoverAiRbacRoutes(document)).toEqual([
      { path: '/api/ai/config', method: 'GET', permissions: [] },
      { path: '/api/ai/responses/{id}', method: 'POST', permissions: ['ai:use'] },
      { path: '/api/admin/ai/config', method: 'GET', permissions: ['ai_config:read'] },
    ]);
  });
});

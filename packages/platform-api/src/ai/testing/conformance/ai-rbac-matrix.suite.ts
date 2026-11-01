// =============================================================================
// Suite: AI RBAC matrix (issues #435, #742)
// =============================================================================
//
// Every route under `/api/ai/*` and `/api/admin/ai/*`, DISCOVERED from the
// real Nest router (never hand-listed — same technique as
// the `ai-kill-switch` suite), crossed against Admin / Contributor /
// Viewer / unauthenticated, with the EXPECTED permission read off each
// route's own `x-rbac` metadata (`@Auth()`'s vendor extension) rather than
// re-declared by hand — and the seeded grant for each role passed by the app
// (`fixture.rolePermissions`, its own `ROLE_PERMISSIONS`, the actual source of
// truth a fresh deployment seeds). A route or a seed changing without the other
// catching up fails this suite, not a reviewer's memory.
//
// DISTINGUISHING "DENIED BY RBAC" FROM "DENIED FOR A BUSINESS REASON". Both
// can be 403. `PermissionsGuard` throws a bare `ForbiddenException` with no
// `details` ("Missing permissions: …"); every AI
// business refusal (`AI_KEY_REQUIRED`, `AI_DISABLED`, …) is an `AiError`,
// which always carries `details.reason` (`ai/core/ai-error.ts`). So a case that
// EXPECTS the permission to be held only requires the response NOT be a
// bare, reason-less 403 — it does not require a full 200, which would need a
// working key and model for every role this matrix exercises.
//
// PAT. the app's `pat-universality.integration.spec.ts` already proves the general
// claim ("a PAT is accepted anywhere a session is, with no narrower scope")
// against unrelated controllers; this suite re-proves it specifically for
// the AI surface's own permission boundary — an Admin's PAT reaches
// `/api/admin/ai/*`, a Viewer's PAT does not. THERE IS NO PAT SCOPE CONCEPT
// in this schema (`PersonalAccessToken` carries no `scopes` column — see
// `prisma/schema.prisma`), so "PAT with and without scopes" in the issue's
// language is answered here as "a PAT inherits its owner's role grants,
// exactly like a session" rather than as a narrower-grant test that has
// nothing in this codebase to exercise.
// =============================================================================
//
// Moved from the reference app's `apps/api/test/ai/ai-rbac-matrix.integration.spec.ts`
// with the same case list. The app supplies how it boots (`AiConformanceFixture`).
// =============================================================================

import { request } from './ai-http-client';
import { createHash, randomUUID } from 'node:crypto';

import type { ConformanceAppSuite } from '../../../testing/index';
import { authHeader, type AiConformanceApp, type AiConformanceFixture } from './ai-conformance-fixture';
import {
  discoverAiRbacRoutes,
  findAiPermissionDeclarationFailures,
  findRoleMismatches,
  findRoutesNotAnswering401,
  isPermissionDenied,
  type AiRbacRoute,
} from './ai-route-checks';

/**
 * How an app configures the `ai-rbac-matrix` suite.
 *
 * @example
 * ```ts
 * suites: { aiRbacMatrix: { fixture: aiConformanceFixture } }
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AiRbacMatrixOptions {
  /** How the app boots, and the role grants it seeds; see {@link AiConformanceFixture}. */
  fixture: AiConformanceFixture;
  /** Vacuity guard: at least this many AI routes (consumer and admin) must be found (default 15, the platform's own). */
  minRoutes?: number;
  /** Vacuity guard: at least this many of them must carry `x-rbac` permissions (default 10). */
  minPermissionedRoutes?: number;
}

const ROLES = ['admin', 'contributor', 'viewer'] as const;

function register(options: AiRbacMatrixOptions): void {
  const { fixture } = options;

describe('AI RBAC matrix — every /api/ai/* and /api/admin/ai/* route x every role (#435)', () => {
  let app: AiConformanceApp;
  let aiAndAdminRoutes: AiRbacRoute[];
  const tokensByRole: Record<(typeof ROLES)[number], string> = { admin: '', contributor: '', viewer: '' };

  beforeAll(async () => {
    app = await fixture.createAiApp(); // enabled: true, byok — RBAC is what is under test, not the kill switch.

    aiAndAdminRoutes = discoverAiRbacRoutes(fixture.openApiDocument(app.context.app));
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    app.reset();

    // A few routes (`UserAiKeysService`, `UsableModelsService`,
    // `AiModelsAdminService`) are REAL providers reading the REAL, mocked
    // `PrismaService` directly — not overridden by the harness, unlike
    // `AiService`/`AiRunsService`/`AiConfigService`. This matrix only cares
    // whether `PermissionsGuard` let the request through, not whether the
    // business logic behind it fully succeeds, so a bare empty result is
    // enough to keep those routes from throwing on an unmocked call.
    app.context.prismaMock.userAiKey.findMany.mockResolvedValue([]);
    app.context.prismaMock.userAiKey.deleteMany.mockResolvedValue({ count: 0 });
    app.context.prismaMock.aiModel.findMany.mockResolvedValue([]);
    app.context.prismaMock.aiModel.count.mockResolvedValue(0);

    for (const role of ROLES) {
      const user = await fixture.createUser(app.context, { roleName: role });
      tokensByRole[role] = user.accessToken;
    }
  });

  it('discovers a non-trivial route set carrying real x-rbac metadata', () => {
    expect(aiAndAdminRoutes.length).toBeGreaterThanOrEqual(options.minRoutes ?? 15);
    expect(aiAndAdminRoutes.filter((r) => r.permissions.length > 0).length).toBeGreaterThanOrEqual(options.minPermissionedRoutes ?? 10);
  });

  it('every declared permission is one of the three literal AI permission strings — never invented, never dropped', () => {
    // Anchors the discovery itself: the role-vs-permission matrix below only
    // checks that DECLARED and ENFORCED agree with each other, so a route
    // that quietly lost its `@Auth({ permissions: [...] })` entirely would
    // adjust its own expectation downward and slip through undetected. This
    // pins each route's declaration against a fixed, external expectation
    // instead: every `/api/admin/ai/*` route names `ai_config:read` or
    // `ai_config:write` and nothing else (the organization's own surfaces
    // under `/api/admin/ai/org-*`, #739, name `org_ai_config:*` instead); every `/api/ai/*` route names
    // `ai:use` and nothing else, except `GET /api/ai/config`, which names no
    // permission at all (any signed-in user).
    const failures = findAiPermissionDeclarationFailures(aiAndAdminRoutes);

    expect(failures).toEqual([]);
  });

  describe('unauthenticated', () => {
    it('every route answers 401, whatever permission it declares', async () => {
      const failures = await findRoutesNotAnswering401(app.context.app.getHttpServer(), aiAndAdminRoutes);

      expect(failures).toEqual([]);
    });
  });

  describe.each(ROLES)('%s (per the seeded role permissions)', (role) => {
    const granted = new Set(fixture.rolePermissions[role] ?? []);

    it('is granted or denied exactly as the seeded permission set says, for every discovered route', async () => {
      const failures = await findRoleMismatches(
        app.context.app.getHttpServer(),
        aiAndAdminRoutes,
        role,
        tokensByRole[role],
        granted,
      );

      expect(failures).toEqual([]);
    });
  });

  describe('a PAT inherits its owner\'s role grants, exactly like a session', () => {
    async function givenLivePatFor(userId: string, rawToken: string): Promise<void> {
      const fullUser = await (app.context.prismaMock.user.findUnique as jest.Mock)({ where: { id: userId } });
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');

      (app.context.prismaMock.personalAccessToken.findUnique as jest.Mock).mockImplementation(
        async ({ where }: { where: { tokenHash: string } }) => {
          if (where.tokenHash !== expectedHash) return null;

          return {
            id: randomUUID(),
            userId,
            name: 'RBAC matrix fixture',
            tokenHash: expectedHash,
            tokenPrefix: rawToken.slice(0, 8),
            expiresAt,
            lastUsedAt: null,
            revokedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            user: fullUser,
          };
        },
      );
      (app.context.prismaMock.personalAccessToken.update as jest.Mock).mockResolvedValue({});
    }

    it('an admin PAT reaches /api/admin/ai/config; a viewer PAT does not', async () => {
      const admin = await fixture.createUser(app.context, { roleName: 'admin' });
      const viewer = await fixture.createUser(app.context, { roleName: 'viewer' });

      await givenLivePatFor(admin.id, 'pat_rbac_admin_fixture');
      const adminRes = await request(app.context.app.getHttpServer())
        .get('/api/admin/ai/config')
        .set(authHeader('pat_rbac_admin_fixture'));
      expect(isPermissionDenied(adminRes)).toBe(false);

      await givenLivePatFor(viewer.id, 'pat_rbac_viewer_fixture');
      const viewerRes = await request(app.context.app.getHttpServer())
        .get('/api/admin/ai/config')
        .set(authHeader('pat_rbac_viewer_fixture'));
      expect(isPermissionDenied(viewerRes)).toBe(true);
    });

    it('a viewer PAT reaches GET /api/ai/config exactly as a viewer session does', async () => {
      const viewer = await fixture.createUser(app.context, { roleName: 'viewer' });
      await givenLivePatFor(viewer.id, 'pat_rbac_viewer_config_fixture');

      const res = await request(app.context.app.getHttpServer())
        .get('/api/ai/config')
        .set(authHeader('pat_rbac_viewer_config_fixture'))
        .expect(200);

      expect(res.body.data.enabled).toBe(true);
    });
  });
});
}

/**
 * The suite behind `runPlatformConformance({ suites: { aiRbacMatrix } })`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const aiRbacMatrixSuite: ConformanceAppSuite<AiRbacMatrixOptions> = {
  id: 'ai-rbac-matrix',
  title: 'AI RBAC matrix — every /api/ai/* and /api/admin/ai/* route x every role (#435)',
  description:
    'Every /api/ai/* and /api/admin/ai/* route is granted or denied to each role exactly as the seeded permission set says; a PAT inherits its owner’s grants (AI rule 4).',
  register(_api, _context, options) {
    register(options);
  },
};

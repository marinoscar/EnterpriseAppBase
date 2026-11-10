// =============================================================================
// The `team` example: an app adds to `/api/auth/me` and to the user list WITHOUT touching a package (PP-14.25)
// =============================================================================
//
// `src/platform-extensions/identity/team-directory.extensions.ts` is registered
// from `src/app-registrations/identity.ts` with `registerCurrentUserExtension`
// and `registerUserListExtension`. This spec drives it against the REAL
// application (the real AppModule: identity slice, guards, DTOs; only Prisma is
// mocked):
//
//   1. nothing assigned: `/auth/me` and the list are unchanged (no `extensions`);
//   2. a team assigned: `extensions.team` on `/auth/me` and on that user's row;
//   3. the list resolver runs ONCE for the page, never per row;
//   4. a throwing extension, a slow one and one that returns a secret or too many
//      bytes are skipped: the request still succeeds with the good extension;
//   5. the contract still holds (`currentUserSchema.strict()`), and a request that
//      is refused (403) never reaches an extension.
// =============================================================================

import { registerCurrentUserExtension, registerUserListExtension } from '@marinoscar/platform-api/identity';
import { USER_EXTENSION_LIMITS, currentUserSchema } from '@marinoscar/platform-contract/identity';
import request from 'supertest';

// The registration under test: what `platform/identity/identity.config.ts` imports.
import '../../../src/app-registrations/identity';
import { teamDirectory } from '../../../src/platform-extensions/identity/team-directory.extensions';
import { setupBaseMocks, setupMockUserList } from '../../fixtures/mock-setup.helper';
import { authHeader, createMockAdminUser, createMockViewerUser } from '../../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../../helpers/test-app.helper';
import { resetPrismaMock } from '../../mocks/prisma.mock';

// Extensions the example does not have, registered by THIS test (the registries
// freeze when the application bootstraps, so they go before `createTestApp`).
const slowCalls = { me: 0 };
registerCurrentUserExtension({ id: 'broken', resolve: () => { throw new Error('the billing database is down'); } });
registerCurrentUserExtension({ id: 'leaky', resolve: () => ({ apiKey: 'sk-live-must-never-reach-a-browser' }) });
registerCurrentUserExtension({ id: 'huge', resolve: () => ({ blob: 'x'.repeat(USER_EXTENSION_LIMITS.currentUserBytes + 1) }) });
registerCurrentUserExtension({
  id: 'slow',
  timeoutMs: 25,
  resolve: () => {
    slowCalls.me += 1;
    return new Promise(() => undefined);
  },
});
registerUserListExtension({ id: 'broken', resolve: () => { throw new Error('the billing database is down'); } });
registerUserListExtension({
  id: 'leaky',
  resolve: (ids) => new Map(ids.map((id) => [id, { clientSecret: 'must-never-reach-a-browser' }])),
});

describe('user extensions: the team example (PP-14.25)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    teamDirectory.reset();
    slowCalls.me = 0;
  });

  describe('GET /api/auth/me', () => {
    it('is unchanged while nobody has a team (no extensions key at all)', async () => {
      const admin = await createMockAdminUser(context);

      const { body } = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(body.data).not.toHaveProperty('extensions');
      expect(() => currentUserSchema.strict().parse(body.data)).not.toThrow();
    });

    it('adds extensions.team, skips the failing, leaking, oversized and slow extensions, and still matches the contract', async () => {
      const admin = await createMockAdminUser(context);
      teamDirectory.assignments.set(admin.id, { team: 'Core', lead: true });

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.extensions).toEqual({ team: { team: 'Core', lead: true } });
      expect(response.text).not.toContain('sk-live-must-never-reach-a-browser');
      expect(slowCalls.me).toBe(1);
      expect(() => currentUserSchema.strict().parse(response.body.data)).not.toThrow();
    });

    it('resolves per request: a team assigned afterwards shows on the next call', async () => {
      const admin = await createMockAdminUser(context);
      const first = await request(context.app.getHttpServer()).get('/api/auth/me').set(authHeader(admin.accessToken)).expect(200);
      expect(first.body.data).not.toHaveProperty('extensions');

      teamDirectory.assignments.set(admin.id, { team: 'Platform', lead: false });
      const second = await request(context.app.getHttpServer()).get('/api/auth/me').set(authHeader(admin.accessToken)).expect(200);
      expect(second.body.data.extensions.team).toEqual({ team: 'Platform', lead: false });
    });
  });

  describe('GET /api/users', () => {
    it('adds extensions.team to the rows that have one and resolves the whole page in ONE call', async () => {
      const admin = await createMockAdminUser(context);
      const [self, one, two] = setupMockUserList([
        { email: admin.email, roleName: 'admin' },
        { email: 'user1@example.com', roleName: 'viewer' },
        { email: 'user2@example.com', roleName: 'contributor' },
      ]);
      teamDirectory.assignments.set(self!.id, { team: 'Core', lead: true });
      teamDirectory.assignments.set(two!.id, { team: 'Growth', lead: false });

      const { body } = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);

      const byId = new Map<string, { extensions?: Record<string, unknown> }>(body.data.items.map((item: { id: string }) => [item.id, item]));
      expect(byId.get(self!.id)?.extensions).toEqual({ team: { team: 'Core', lead: true } });
      expect(byId.get(two!.id)?.extensions).toEqual({ team: { team: 'Growth', lead: false } });
      // Nothing for the user without a team, and nothing from the broken or leaking extensions.
      expect(byId.get(one!.id)).not.toHaveProperty('extensions');
      expect(JSON.stringify(body)).not.toContain('must-never-reach-a-browser');
      // One batched call for three rows, not three.
      expect(teamDirectory.queries.batch).toBe(1);
    });

    it('does not reach an extension for a request that is refused', async () => {
      const viewer = await createMockViewerUser(context);
      await request(context.app.getHttpServer()).get('/api/users').set(authHeader(viewer.accessToken)).expect(403);
      expect(teamDirectory.queries.batch).toBe(0);
    });
  });
});

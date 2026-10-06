import request from 'supertest';
import { JwtService } from '@nestjs/jwt';

import { PrincipalCache } from '../../src/auth/principal-cache/principal-cache.service';
import { EVENT_BUS } from '../../src/common/event-bus/event-bus.interface';
import { InProcessEventBus } from '../../src/common/event-bus/in-process-event-bus';
import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';
import { FakeEventBusNetwork } from '../helpers/fake-network-event-bus.helper';
import { authHeader, createMockAdminUser, TestUser } from '../helpers/auth-mock.helper';
import { setupBaseMocks, setupMockUserList } from '../fixtures/mock-setup.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';

// =============================================================================
// The JWT principal cache through the real HTTP stack (PP-1.12, issue #683)
// =============================================================================
//
// Proves, against the full `AppModule` (real guards, real JwtStrategy, real
// UsersService) with a mocked database, that caching the user/role/permission
// join did not weaken docs/SECURITY-ARCHITECTURE.md §1:
//
//   - two requests within the TTL run the principal query once;
//   - a deactivation answers 401 on the very next request, same process;
//   - a role removal answers 403 on the very next request, same process;
//   - a device-session revocation answers 401 although the principal is cached;
//   - an invalidation on replica A evicts the entry on replica B (two apps on
//     one fake bus network, sharing the mocked database);
//   - AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0 reads the database on every request.
//
// `GET /api/users` is the probe route: it needs `users:read` (admin only in
// the fixtures) and never calls `user.findUnique` itself, so every such call
// counted below is the JWT principal lookup.
// =============================================================================

/** `user.findUnique` calls that are the JWT strategy's principal lookup for `userId`. */
function principalLookups(userId: string): number {
  return (prismaMock.user.findUnique as jest.Mock).mock.calls.filter(
    ([args]) => args?.where?.id === userId && args?.include?.userRoles?.include?.role?.include?.rolePermissions,
  ).length;
}

/** Waits for the bus's microtask delivery to other replicas. */
const busLatency = () => new Promise((resolve) => setImmediate(resolve));

function probe(context: TestContext, user: TestUser | string) {
  const token = typeof user === 'string' ? user : user.accessToken;
  return request(context.app.getHttpServer()).get('/api/users').set(authHeader(token));
}

function bootMocks(): void {
  resetPrismaMock();
  setupBaseMocks();
  (prismaMock.user.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.user.count as jest.Mock).mockResolvedValue(0);
}

describe('JWT principal cache (integration, PP-1.12 #683)', () => {
  describe('one process', () => {
    let context: TestContext;
    let cache: PrincipalCache;

    beforeAll(async () => {
      context = await createTestApp({ useMockDatabase: true });
      cache = context.module.get(PrincipalCache);
    });

    afterAll(async () => {
      await closeTestApp(context);
    });

    beforeEach(() => {
      bootMocks();
    });

    it('is enabled with the default 30 s TTL', () => {
      expect(cache.ttlMs).toBe(30_000);
    });

    it('runs the user/roles query once for two consecutive requests within the TTL', async () => {
      const admin = await createMockAdminUser(context, 'cache-hit@example.com');

      await probe(context, admin).expect(200);
      await probe(context, admin).expect(200);

      expect(principalLookups(admin.id)).toBe(1);
    });

    it('PATCH /api/users/:id isActive=false makes the very next request 401', async () => {
      const actor = await createMockAdminUser(context, 'actor-deactivate@example.com');
      const target = await createMockAdminUser(context, 'target-deactivate@example.com');

      await probe(context, target).expect(200); // now cached
      expect(cache.get(target.id)).toBeDefined();

      await request(context.app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set(authHeader(actor.accessToken))
        .send({ isActive: false })
        .expect(200);

      // No wait of any kind: the local drop is synchronous.
      await probe(context, target).expect(401);
      expect(principalLookups(target.id)).toBe(2);
    });

    it('PUT /api/users/:id/roles removing a role makes the very next request needing it 403', async () => {
      const actor = await createMockAdminUser(context, 'actor-demote@example.com');
      const target = await createMockAdminUser(context, 'target-demote@example.com');

      await probe(context, target).expect(200); // cached as admin

      // The mocked database applies the role swap the way Postgres would.
      (prismaMock.userRole.createMany as jest.Mock).mockImplementation(async ({ data }: any) => {
        setupMockUserList([{ email: target.email, roleName: 'viewer' }]);
        return { count: Array.isArray(data) ? data.length : 1 };
      });

      await request(context.app.getHttpServer())
        .put(`/api/users/${target.id}/roles`)
        .set(authHeader(actor.accessToken))
        .send({ roleNames: ['viewer'] })
        .expect(200);

      await probe(context, target).expect(403);
    });

    it('a revoked device session answers 401 even while the principal is cached', async () => {
      const admin = await createMockAdminUser(context, 'device@example.com');
      const jwt = context.module.get(JwtService);
      const deviceToken = jwt.sign({ sub: admin.id, email: admin.email, roles: admin.roles, did: 'device-code-1' });
      const live = {
        id: 'device-code-1',
        userId: admin.id,
        revokedAt: null,
        credentialExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };

      (prismaMock.deviceCode.findUnique as jest.Mock).mockResolvedValue(live);
      await probe(context, deviceToken).expect(200);
      await probe(context, deviceToken).expect(200);
      expect(principalLookups(admin.id)).toBe(1); // the principal IS cached

      (prismaMock.deviceCode.findUnique as jest.Mock).mockResolvedValue({ ...live, revokedAt: new Date() });
      await probe(context, deviceToken).expect(401);

      // The device row was read on every request; the principal was still cached.
      expect(prismaMock.deviceCode.findUnique).toHaveBeenCalledTimes(3);
      expect(cache.get(admin.id)).toBeDefined();
      // The user's ordinary browser token is unaffected.
      await probe(context, admin).expect(200);
    });
  });

  // TWO APPS IN ONE JEST PROCESS: Passport keeps strategies in a process-wide
  // registry by name, so the LAST app booted (B) owns the 'jwt' strategy and
  // validates tokens for both. Every probe below therefore goes to B, and every
  // write to A: A's UsersService invalidates A's own cache, and only the bus
  // can carry that to B's — which is exactly the property under test.
  describe('two replicas sharing one bus (and one database)', () => {
    let network: FakeEventBusNetwork;
    let replicaA: TestContext;
    let replicaB: TestContext;

    beforeAll(async () => {
      network = new FakeEventBusNetwork();
      replicaA = await createTestApp({
        useMockDatabase: true,
        overrideProviders: [{ provide: EVENT_BUS, useValue: network.join('replica-a') }],
      });
      replicaB = await createTestApp({
        useMockDatabase: true,
        overrideProviders: [{ provide: EVENT_BUS, useValue: network.join('replica-b') }],
      });
    });

    afterAll(async () => {
      await closeTestApp(replicaA);
      await closeTestApp(replicaB);
    });

    beforeEach(() => {
      bootMocks();
    });

    it('a deactivation made on A evicts the entry on B within bus latency', async () => {
      const actor = await createMockAdminUser(replicaA, 'actor-cross@example.com');
      const target = await createMockAdminUser(replicaA, 'target-cross@example.com');
      const cacheB = replicaB.module.get(PrincipalCache);

      await probe(replicaB, target).expect(200);
      expect(cacheB.get(target.id)).toBeDefined();

      await request(replicaA.app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set(authHeader(actor.accessToken))
        .send({ isActive: false })
        .expect(200);
      await busLatency();

      expect(cacheB.get(target.id)).toBeUndefined();
      await probe(replicaB, target).expect(401);
    });
  });

  describe('two replicas WITHOUT a shared bus (control)', () => {
    let replicaA: TestContext;
    let replicaB: TestContext;

    beforeAll(async () => {
      replicaA = await createTestApp({
        useMockDatabase: true,
        overrideProviders: [{ provide: EVENT_BUS, useValue: new InProcessEventBus() }],
      });
      replicaB = await createTestApp({
        useMockDatabase: true,
        overrideProviders: [{ provide: EVENT_BUS, useValue: new InProcessEventBus() }],
      });
    });

    afterAll(async () => {
      await closeTestApp(replicaA);
      await closeTestApp(replicaB);
    });

    beforeEach(() => {
      bootMocks();
    });

    it('B keeps its entry until the TTL: the bus is what makes the change cross', async () => {
      const actor = await createMockAdminUser(replicaA, 'actor-control@example.com');
      const target = await createMockAdminUser(replicaA, 'target-control@example.com');

      await probe(replicaB, target).expect(200);
      await request(replicaA.app.getHttpServer())
        .patch(`/api/users/${target.id}`)
        .set(authHeader(actor.accessToken))
        .send({ isActive: false })
        .expect(200);
      await busLatency();

      // Stale on B, bounded by the TTL; A dropped its own copy at once.
      expect(replicaB.module.get(PrincipalCache).get(target.id)).toBeDefined();
      expect(replicaA.module.get(PrincipalCache).get(target.id)).toBeUndefined();
      await probe(replicaB, target).expect(200);
    });
  });

  describe('AUTH_PRINCIPAL_CACHE_TTL_SECONDS=0', () => {
    let context: TestContext;
    let saved: string | undefined;

    beforeAll(async () => {
      saved = process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS;
      process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = '0';
      context = await createTestApp({ useMockDatabase: true });
    });

    afterAll(async () => {
      await closeTestApp(context);
      if (saved === undefined) delete process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS;
      else process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS = saved;
    });

    beforeEach(() => {
      bootMocks();
    });

    it('disables caching entirely: every request reads the principal from the database', async () => {
      const cache = context.module.get(PrincipalCache);
      expect(cache.ttlMs).toBe(0);

      const admin = await createMockAdminUser(context, 'ttl-zero@example.com');
      await probe(context, admin).expect(200);
      await probe(context, admin).expect(200);
      await probe(context, admin).expect(200);

      expect(principalLookups(admin.id)).toBe(3);
      expect(cache.stats().size).toBe(0);
    });
  });
});

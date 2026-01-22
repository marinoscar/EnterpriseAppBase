import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from './helpers/test-app.helper';
import { resetPrismaMock } from './mocks/prisma.mock';
import { setupBaseMocks, setupMockUserList } from './fixtures/mock-setup.helper';
import {
  createMockTestUser,
  createMockAdminUser,
  createMockViewerUser,
  createMockContributorUser,
  authHeader,
} from './helpers/auth-mock.helper';
import { createMockUser, mockRoles } from './fixtures/test-data.factory';

describe('Users (Integration)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
  });

  describe('GET /api/users', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .get('/api/users')
        .expect(401);
    });

    it('should return 403 if user lacks users:read permission', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    describe('isActive filter', () => {
      it('should return ALL users when isActive parameter is omitted', async () => {
        const admin = await createMockAdminUser(context);

        setupMockUserList([
          { email: admin.email, roleName: 'admin', isActive: true },
          { email: 'active1@example.com', isActive: true },
          { email: 'active2@example.com', isActive: true },
          { email: 'inactive1@example.com', isActive: false },
          { email: 'inactive2@example.com', isActive: false },
        ]);

        const response = await request(context.app.getHttpServer())
          .get('/api/users')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(5);
        expect(response.body.data.items).toHaveLength(5);

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('active1@example.com');
        expect(emails).toContain('active2@example.com');
        expect(emails).toContain('inactive1@example.com');
        expect(emails).toContain('inactive2@example.com');
      });

      it('should reject invalid isActive values', async () => {
        const admin = await createMockAdminUser(context);

        await request(context.app.getHttpServer())
          .get('/api/users?isActive=invalid')
          .set(authHeader(admin.accessToken))
          .expect(400);
      });
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .get('/api/users/123e4567-e89b-12d3-a456-426614174000')
        .expect(401);
    });

    it('should return 403 if user lacks users:read permission', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .get(`/api/users/${viewer.id}`)
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should return user by ID for admin', async () => {
      const admin = await createMockAdminUser(context);
      const viewer = await createMockViewerUser(context, 'test@example.com');

      const response = await request(context.app.getHttpServer())
        .get(`/api/users/${viewer.id}`)
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: viewer.id,
        email: viewer.email,
        isActive: true,
        roles: ['viewer'],
      });
      expect(response.body.data.identities).toBeDefined();
    });

    it('should return 400 for invalid UUID', async () => {
      const admin = await createMockAdminUser(context);

      await request(context.app.getHttpServer())
        .get('/api/users/invalid-uuid')
        .set(authHeader(admin.accessToken))
        .expect(400);
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .patch('/api/users/123e4567-e89b-12d3-a456-426614174000')
        .send({ isActive: false })
        .expect(401);
    });

    it('should return 403 if user lacks users:write permission', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .patch(`/api/users/${viewer.id}`)
        .set(authHeader(viewer.accessToken))
        .send({ isActive: false })
        .expect(403);
    });
  });

  describe('PUT /api/users/:id/roles', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .put('/api/users/123e4567-e89b-12d3-a456-426614174000/roles')
        .send({ roleNames: ['viewer'] })
        .expect(401);
    });

    it('should return 403 if user lacks rbac:manage permission', async () => {
      const contributor = await createMockContributorUser(context);
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .put(`/api/users/${viewer.id}/roles`)
        .set(authHeader(contributor.accessToken))
        .send({ roleNames: ['admin'] })
        .expect(403);
    });
  });
});

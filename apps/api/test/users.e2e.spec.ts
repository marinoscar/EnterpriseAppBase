import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from './helpers/test-app.helper';
import { resetDatabase } from './helpers/database.helper';
import {
  createTestUser,
  createAdminUser,
  createViewerUser,
  createContributorUser,
  authHeader,
} from './helpers/auth.helper';

describe('Users (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  describe('GET /api/users', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .get('/api/users')
        .expect(401);
    });

    it('should return 403 if user lacks users:read permission', async () => {
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should return paginated list for admin', async () => {
      const admin = await createAdminUser(context);
      await createViewerUser(context, 'viewer1@example.com');
      await createViewerUser(context, 'viewer2@example.com');

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ email: admin.email }),
          expect.objectContaining({ email: 'viewer1@example.com' }),
          expect.objectContaining({ email: 'viewer2@example.com' }),
        ]),
        total: 3,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });

    describe('isActive filter', () => {
      it('should return ALL users when isActive parameter is omitted', async () => {
        const admin = await createAdminUser(context);

        // Create active users
        const activeUser1 = await createTestUser(context, {
          email: 'active1@example.com',
          isActive: true,
        });
        const activeUser2 = await createTestUser(context, {
          email: 'active2@example.com',
          isActive: true,
        });

        // Create inactive users
        const inactiveUser1 = await createTestUser(context, {
          email: 'inactive1@example.com',
          isActive: false,
        });
        const inactiveUser2 = await createTestUser(context, {
          email: 'inactive2@example.com',
          isActive: false,
        });

        const response = await request(context.app.getHttpServer())
          .get('/api/users')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(5); // admin + 2 active + 2 inactive
        expect(response.body.data.items).toHaveLength(5);

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('active1@example.com');
        expect(emails).toContain('active2@example.com');
        expect(emails).toContain('inactive1@example.com');
        expect(emails).toContain('inactive2@example.com');
      });

      it('should return only ACTIVE users when isActive=true', async () => {
        const admin = await createAdminUser(context);

        // Create active users
        const activeUser1 = await createTestUser(context, {
          email: 'active1@example.com',
          isActive: true,
        });
        const activeUser2 = await createTestUser(context, {
          email: 'active2@example.com',
          isActive: true,
        });

        // Create inactive users
        await createTestUser(context, {
          email: 'inactive1@example.com',
          isActive: false,
        });
        await createTestUser(context, {
          email: 'inactive2@example.com',
          isActive: false,
        });

        const response = await request(context.app.getHttpServer())
          .get('/api/users?isActive=true')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(3); // admin + 2 active
        expect(response.body.data.items).toHaveLength(3);

        // All returned users should be active
        response.body.data.items.forEach((user: any) => {
          expect(user.isActive).toBe(true);
        });

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('active1@example.com');
        expect(emails).toContain('active2@example.com');
        expect(emails).not.toContain('inactive1@example.com');
        expect(emails).not.toContain('inactive2@example.com');
      });

      it('should return only INACTIVE users when isActive=false', async () => {
        const admin = await createAdminUser(context);

        // Create active users
        await createTestUser(context, {
          email: 'active1@example.com',
          isActive: true,
        });
        await createTestUser(context, {
          email: 'active2@example.com',
          isActive: true,
        });

        // Create inactive users
        const inactiveUser1 = await createTestUser(context, {
          email: 'inactive1@example.com',
          isActive: false,
        });
        const inactiveUser2 = await createTestUser(context, {
          email: 'inactive2@example.com',
          isActive: false,
        });

        const response = await request(context.app.getHttpServer())
          .get('/api/users?isActive=false')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(2); // 2 inactive
        expect(response.body.data.items).toHaveLength(2);

        // All returned users should be inactive
        response.body.data.items.forEach((user: any) => {
          expect(user.isActive).toBe(false);
        });

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('inactive1@example.com');
        expect(emails).toContain('inactive2@example.com');
        expect(emails).not.toContain('active1@example.com');
        expect(emails).not.toContain('active2@example.com');
      });

      it('should reject invalid isActive values', async () => {
        const admin = await createAdminUser(context);

        await request(context.app.getHttpServer())
          .get('/api/users?isActive=invalid')
          .set(authHeader(admin.accessToken))
          .expect(400);
      });
    });

    describe('role filter', () => {
      it('should filter by role', async () => {
        const admin = await createAdminUser(context);
        const contributor = await createContributorUser(context);
        const viewer1 = await createViewerUser(context, 'viewer1@example.com');
        const viewer2 = await createViewerUser(context, 'viewer2@example.com');

        const response = await request(context.app.getHttpServer())
          .get('/api/users?role=viewer')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(2);
        expect(response.body.data.items).toHaveLength(2);

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('viewer1@example.com');
        expect(emails).toContain('viewer2@example.com');
      });
    });

    describe('search filter', () => {
      it('should filter by email search', async () => {
        const admin = await createAdminUser(context);
        await createViewerUser(context, 'alice@example.com');
        await createViewerUser(context, 'bob@example.com');
        await createViewerUser(context, 'alice.smith@example.com');

        const response = await request(context.app.getHttpServer())
          .get('/api/users?search=alice')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(2);
        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('alice@example.com');
        expect(emails).toContain('alice.smith@example.com');
      });
    });

    describe('pagination', () => {
      it('should support pagination', async () => {
        const admin = await createAdminUser(context);

        // Create 15 users
        for (let i = 1; i <= 15; i++) {
          await createViewerUser(context, `user${i}@example.com`);
        }

        const response = await request(context.app.getHttpServer())
          .get('/api/users?page=2&pageSize=10')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.page).toBe(2);
        expect(response.body.data.pageSize).toBe(10);
        expect(response.body.data.items).toHaveLength(6); // admin + 15 users = 16 total, page 2 has 6
        expect(response.body.data.total).toBe(16);
        expect(response.body.data.totalPages).toBe(2);
      });
    });

    describe('sorting', () => {
      it('should support sorting by email', async () => {
        const admin = await createAdminUser(context);
        await createViewerUser(context, 'charlie@example.com');
        await createViewerUser(context, 'alice@example.com');
        await createViewerUser(context, 'bob@example.com');

        const response = await request(context.app.getHttpServer())
          .get('/api/users?sortBy=email&sortOrder=asc')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.items[0].email).toBe('alice@example.com');
        expect(response.body.data.items[1].email).toBe('bob@example.com');
        expect(response.body.data.items[2].email).toBe('charlie@example.com');
      });
    });

    describe('combined filters', () => {
      it('should apply multiple filters together', async () => {
        const admin = await createAdminUser(context);

        // Create active viewers
        await createViewerUser(context, 'active-viewer1@example.com');
        await createViewerUser(context, 'active-viewer2@example.com');

        // Create inactive viewers
        await createTestUser(context, {
          email: 'inactive-viewer1@example.com',
          roleName: 'viewer',
          isActive: false,
        });
        await createTestUser(context, {
          email: 'inactive-viewer2@example.com',
          roleName: 'viewer',
          isActive: false,
        });

        // Create active contributors
        await createContributorUser(context, 'active-contributor@example.com');

        const response = await request(context.app.getHttpServer())
          .get('/api/users?role=viewer&isActive=true')
          .set(authHeader(admin.accessToken))
          .expect(200);

        expect(response.body.data.total).toBe(2);
        expect(response.body.data.items).toHaveLength(2);

        const emails = response.body.data.items.map((u: any) => u.email);
        expect(emails).toContain('active-viewer1@example.com');
        expect(emails).toContain('active-viewer2@example.com');
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
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .get(`/api/users/${viewer.id}`)
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should return user by ID for admin', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context, 'test@example.com');

      const response = await request(context.app.getHttpServer())
        .get(`/api/users/${user.id}`)
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: user.id,
        email: user.email,
        isActive: true,
        roles: ['viewer'],
      });
      expect(response.body.data.identities).toBeDefined();
    });

    it('should return 404 if user not found', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .get('/api/users/123e4567-e89b-12d3-a456-426614174999')
        .set(authHeader(admin.accessToken))
        .expect(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const admin = await createAdminUser(context);

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
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .patch(`/api/users/${viewer.id}`)
        .set(authHeader(viewer.accessToken))
        .send({ isActive: false })
        .expect(403);
    });

    it('should update user for admin', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set(authHeader(admin.accessToken))
        .send({
          displayName: 'Updated Name',
          isActive: false,
        })
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: user.id,
        displayName: 'Updated Name',
        isActive: false,
      });

      // Verify in database
      const updated = await context.prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updated?.displayName).toBe('Updated Name');
      expect(updated?.isActive).toBe(false);
    });

    it('should prevent admin from deactivating themselves', async () => {
      const admin = await createAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .patch(`/api/users/${admin.id}`)
        .set(authHeader(admin.accessToken))
        .send({ isActive: false })
        .expect(403);

      expect(response.body.message).toContain(
        'Cannot deactivate your own account',
      );
    });

    it('should return 404 if user not found', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .patch('/api/users/123e4567-e89b-12d3-a456-426614174999')
        .set(authHeader(admin.accessToken))
        .send({ isActive: false })
        .expect(404);
    });

    it('should create audit event', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .patch(`/api/users/${user.id}`)
        .set(authHeader(admin.accessToken))
        .send({ displayName: 'New Name' })
        .expect(200);

      const auditEvent = await context.prisma.auditEvent.findFirst({
        where: {
          actorUserId: admin.id,
          action: 'user:update',
          targetId: user.id,
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent!.meta).toMatchObject({
        changes: { displayName: 'New Name' },
      });
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
      const contributor = await createContributorUser(context);
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .put(`/api/users/${viewer.id}/roles`)
        .set(authHeader(contributor.accessToken))
        .send({ roleNames: ['admin'] })
        .expect(403);
    });

    it('should update user roles for admin', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .put(`/api/users/${user.id}/roles`)
        .set(authHeader(admin.accessToken))
        .send({ roleNames: ['admin', 'contributor'] })
        .expect(200);

      expect(response.body.data.roles).toEqual(
        expect.arrayContaining(['admin', 'contributor']),
      );
      expect(response.body.data.roles).toHaveLength(2);
    });

    it('should prevent admin from removing own admin role', async () => {
      const admin = await createAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .put(`/api/users/${admin.id}/roles`)
        .set(authHeader(admin.accessToken))
        .send({ roleNames: ['viewer'] })
        .expect(403);

      expect(response.body.message).toContain(
        'Cannot remove admin role from yourself',
      );
    });

    it('should return 400 for invalid role names', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      const response = await request(context.app.getHttpServer())
        .put(`/api/users/${user.id}/roles`)
        .set(authHeader(admin.accessToken))
        .send({ roleNames: ['invalid_role'] })
        .expect(400);

      expect(response.body.message).toContain('Invalid roles');
    });

    it('should return 404 if user not found', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .put('/api/users/123e4567-e89b-12d3-a456-426614174999/roles')
        .set(authHeader(admin.accessToken))
        .send({ roleNames: ['viewer'] })
        .expect(404);
    });

    it('should create audit event', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .put(`/api/users/${user.id}/roles`)
        .set(authHeader(admin.accessToken))
        .send({ roleNames: ['contributor'] })
        .expect(200);

      const auditEvent = await context.prisma.auditEvent.findFirst({
        where: {
          actorUserId: admin.id,
          action: 'user:roles_update',
          targetId: user.id,
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent!.meta).toMatchObject({
        newRoles: ['contributor'],
      });
    });
  });
});

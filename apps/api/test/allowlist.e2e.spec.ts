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
  authHeader,
} from './helpers/auth.helper';

describe('Allowlist (e2e)', () => {
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

  describe('GET /api/allowlist', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .get('/api/allowlist')
        .expect(401);
    });

    it('should return 403 if user lacks allowlist:read permission', async () => {
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/allowlist')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should return paginated list for admin', async () => {
      const admin = await createAdminUser(context);

      // Create some allowlist entries
      await context.prisma.allowedEmail.createMany({
        data: [
          {
            email: 'user1@example.com',
            addedById: admin.id,
          },
          {
            email: 'user2@example.com',
            addedById: admin.id,
          },
          {
            email: 'user3@example.com',
            addedById: admin.id,
          },
        ],
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ email: 'user1@example.com' }),
          expect.objectContaining({ email: 'user2@example.com' }),
          expect.objectContaining({ email: 'user3@example.com' }),
        ]),
        total: 3,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });
    });

    it('should filter by search query', async () => {
      const admin = await createAdminUser(context);

      await context.prisma.allowedEmail.createMany({
        data: [
          {
            email: 'alice@example.com',
            addedById: admin.id,
          },
          {
            email: 'bob@example.com',
            addedById: admin.id,
          },
        ],
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist?search=alice')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].email).toBe('alice@example.com');
    });

    it('should filter by status (pending)', async () => {
      const admin = await createAdminUser(context);

      // Create pending and claimed entries
      const pendingEntry = await context.prisma.allowedEmail.create({
        data: {
          email: 'pending@example.com',
          addedById: admin.id,
        },
      });

      const claimedEntry = await context.prisma.allowedEmail.create({
        data: {
          email: 'claimed@example.com',
          addedById: admin.id,
          claimedById: admin.id,
          claimedAt: new Date(),
        },
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist?status=pending')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].id).toBe(pendingEntry.id);
    });

    it('should filter by status (claimed)', async () => {
      const admin = await createAdminUser(context);

      // Create pending and claimed entries
      await context.prisma.allowedEmail.create({
        data: {
          email: 'pending@example.com',
          addedById: admin.id,
        },
      });

      const claimedEntry = await context.prisma.allowedEmail.create({
        data: {
          email: 'claimed@example.com',
          addedById: admin.id,
          claimedById: admin.id,
          claimedAt: new Date(),
        },
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist?status=claimed')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].id).toBe(claimedEntry.id);
    });

    it('should support pagination', async () => {
      const admin = await createAdminUser(context);

      // Create 15 entries
      const emails = Array.from({ length: 15 }, (_, i) => ({
        email: `user${i}@example.com`,
        addedById: admin.id,
      }));
      await context.prisma.allowedEmail.createMany({ data: emails });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist?page=2&pageSize=10')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.page).toBe(2);
      expect(response.body.data.items).toHaveLength(5); // Remaining items
      expect(response.body.data.total).toBe(15);
      expect(response.body.data.totalPages).toBe(2);
    });

    it('should support sorting', async () => {
      const admin = await createAdminUser(context);

      await context.prisma.allowedEmail.createMany({
        data: [
          {
            email: 'charlie@example.com',
            addedById: admin.id,
          },
          {
            email: 'alice@example.com',
            addedById: admin.id,
          },
          {
            email: 'bob@example.com',
            addedById: admin.id,
          },
        ],
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/allowlist?sortBy=email&sortOrder=asc')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.items[0].email).toBe('alice@example.com');
      expect(response.body.data.items[1].email).toBe('bob@example.com');
      expect(response.body.data.items[2].email).toBe('charlie@example.com');
    });
  });

  describe('POST /api/allowlist', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .send({ email: 'test@example.com' })
        .expect(401);
    });

    it('should return 403 if user lacks allowlist:write permission', async () => {
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(viewer.accessToken))
        .send({ email: 'test@example.com' })
        .expect(403);
    });

    it('should create entry for admin', async () => {
      const admin = await createAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({
          email: 'newuser@example.com',
          notes: 'Test note',
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        email: 'newuser@example.com',
        notes: 'Test note',
        addedBy: {
          id: admin.id,
          email: admin.email,
        },
        claimedById: null,
      });

      // Verify in database
      const entry = await context.prisma.allowedEmail.findUnique({
        where: { email: 'newuser@example.com' },
      });
      expect(entry).toBeDefined();
    });

    it('should normalize email to lowercase', async () => {
      const admin = await createAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({
          email: 'NewUser@EXAMPLE.COM',
        })
        .expect(201);

      expect(response.body.data.email).toBe('newuser@example.com');
    });

    it('should return 409 if email already exists', async () => {
      const admin = await createAdminUser(context);

      // Create first entry
      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({ email: 'duplicate@example.com' })
        .expect(201);

      // Try to create duplicate
      const response = await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({ email: 'duplicate@example.com' })
        .expect(409);

      expect(response.body.message).toContain(
        'duplicate@example.com is already in the allowlist',
      );
    });

    it('should validate email format', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({ email: 'invalid-email' })
        .expect(400);
    });

    it('should require email field', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({})
        .expect(400);
    });

    it('should create audit event', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({ email: 'audited@example.com' })
        .expect(201);

      const auditEvent = await context.prisma.auditEvent.findFirst({
        where: {
          actorUserId: admin.id,
          action: 'allowlist:add',
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent!.meta).toMatchObject({
        email: 'audited@example.com',
      });
    });
  });

  describe('DELETE /api/allowlist/:id', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174000')
        .expect(401);
    });

    it('should return 403 if user lacks allowlist:write permission', async () => {
      const viewer = await createViewerUser(context);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174000')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should delete entry for admin', async () => {
      const admin = await createAdminUser(context);

      // Create entry
      const entry = await context.prisma.allowedEmail.create({
        data: {
          email: 'todelete@example.com',
          addedById: admin.id,
        },
      });

      await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(204);

      // Verify deleted
      const deleted = await context.prisma.allowedEmail.findUnique({
        where: { id: entry.id },
      });
      expect(deleted).toBeNull();
    });

    it('should return 404 if entry not found', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174999')
        .set(authHeader(admin.accessToken))
        .expect(404);
    });

    it('should return 400 if entry is claimed', async () => {
      const admin = await createAdminUser(context);
      const user = await createViewerUser(context);

      // Create claimed entry
      const entry = await context.prisma.allowedEmail.create({
        data: {
          email: 'claimed@example.com',
          addedById: admin.id,
          claimedById: user.id,
          claimedAt: new Date(),
        },
      });

      const response = await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(400);

      expect(response.body.message).toContain(
        'Cannot remove allowlist entry that has been claimed',
      );

      // Verify not deleted
      const stillExists = await context.prisma.allowedEmail.findUnique({
        where: { id: entry.id },
      });
      expect(stillExists).toBeDefined();
    });

    it('should create audit event', async () => {
      const admin = await createAdminUser(context);

      const entry = await context.prisma.allowedEmail.create({
        data: {
          email: 'audited-delete@example.com',
          addedById: admin.id,
        },
      });

      await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(204);

      const auditEvent = await context.prisma.auditEvent.findFirst({
        where: {
          actorUserId: admin.id,
          action: 'allowlist:remove',
          targetId: entry.id,
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent!.meta).toMatchObject({
        email: 'audited-delete@example.com',
      });
    });

    it('should validate UUID format', async () => {
      const admin = await createAdminUser(context);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/invalid-uuid')
        .set(authHeader(admin.accessToken))
        .expect(400);
    });
  });
});

import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from './helpers/test-app.helper';
import { resetPrismaMock } from './mocks/prisma.mock';
import { setupBaseMocks, setupMockAllowedEmailList } from './fixtures/mock-setup.helper';
import {
  createMockTestUser,
  createMockAdminUser,
  createMockViewerUser,
  authHeader,
} from './helpers/auth-mock.helper';
import { createMockAllowedEmail } from './fixtures/test-data.factory';

describe('Allowlist (Integration)', () => {
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

  describe('GET /api/allowlist', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .get('/api/allowlist')
        .expect(401);
    });

    it('should return 403 if user lacks allowlist:read permission', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .get('/api/allowlist')
        .set(authHeader(viewer.accessToken))
        .expect(403);
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
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(viewer.accessToken))
        .send({ email: 'test@example.com' })
        .expect(403);
    });

    it('should validate email format', async () => {
      const admin = await createMockAdminUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({ email: 'invalid-email' })
        .expect(400);
    });

    it('should require email field', async () => {
      const admin = await createMockAdminUser(context);

      await request(context.app.getHttpServer())
        .post('/api/allowlist')
        .set(authHeader(admin.accessToken))
        .send({})
        .expect(400);
    });
  });

  describe('DELETE /api/allowlist/:id', () => {
    it('should return 401 if not authenticated', async () => {
      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174000')
        .expect(401);
    });

    it('should return 403 if user lacks allowlist:write permission', async () => {
      const viewer = await createMockViewerUser(context);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174000')
        .set(authHeader(viewer.accessToken))
        .expect(403);
    });

    it('should delete entry for admin', async () => {
      const admin = await createMockAdminUser(context);

      const entry = createMockAllowedEmail({
        email: 'todelete@example.com',
        addedById: admin.id,
      });

      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(entry);
      context.prismaMock.allowedEmail.delete.mockResolvedValue(entry);

      await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(204);

      expect(context.prismaMock.allowedEmail.delete).toHaveBeenCalledWith({
        where: { id: entry.id },
      });
    });

    it('should return 404 if entry not found', async () => {
      const admin = await createMockAdminUser(context);

      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(null);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/123e4567-e89b-12d3-a456-426614174999')
        .set(authHeader(admin.accessToken))
        .expect(404);
    });

    it('should return 400 if entry is claimed', async () => {
      const admin = await createMockAdminUser(context);
      const viewer = await createMockViewerUser(context);

      const entry = createMockAllowedEmail({
        email: 'claimed@example.com',
        addedById: admin.id,
        claimedById: viewer.id,
        claimedAt: new Date(),
      });

      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(entry);

      const response = await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(400);

      expect(response.body.message).toContain(
        'Cannot remove allowlist entry that has been claimed',
      );
    });

    it('should create audit event', async () => {
      const admin = await createMockAdminUser(context);

      const entry = createMockAllowedEmail({
        email: 'audited-delete@example.com',
        addedById: admin.id,
      });

      context.prismaMock.allowedEmail.findUnique.mockResolvedValue(entry);
      context.prismaMock.allowedEmail.delete.mockResolvedValue(entry);

      await request(context.app.getHttpServer())
        .delete(`/api/allowlist/${entry.id}`)
        .set(authHeader(admin.accessToken))
        .expect(204);

      expect(context.prismaMock.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: admin.id,
            action: 'allowlist:remove',
            targetId: entry.id,
          }),
        }),
      );
    });

    it('should validate UUID format', async () => {
      const admin = await createMockAdminUser(context);

      await request(context.app.getHttpServer())
        .delete('/api/allowlist/invalid-uuid')
        .set(authHeader(admin.accessToken))
        .expect(400);
    });
  });
});

import request from 'supertest';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { resetDatabase } from '../helpers/database.helper';
import { createTestUser, authHeader } from '../helpers/auth.helper';

describe('Guard Integration (e2e)', () => {
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

  describe('JwtAuthGuard + RolesGuard', () => {
    it('should first check JWT then check role (401 before 403)', async () => {
      // Without JWT - should get 401 (not 403)
      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .expect(401);

      expect(response.body).toHaveProperty('code');
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when authenticated but wrong role', async () => {
      const viewer = await createTestUser(context, { roleName: 'viewer' });

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should return 200 when authenticated with correct role', async () => {
      const admin = await createTestUser(context, { roleName: 'admin' });

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
    });
  });

  describe('Public Routes', () => {
    it('should skip all auth guards on health endpoints', async () => {
      await request(context.app.getHttpServer()).get('/api/health/live').expect(200);
    });

    it('should skip guards on auth/providers', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/auth/providers')
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should not require auth for OAuth initiation', async () => {
      // GET /api/auth/google initiates OAuth flow
      // It should redirect or return without requiring auth
      await request(context.app.getHttpServer()).get('/api/auth/google').expect(302);
    });
  });

  describe('Error Messages', () => {
    it('should return clear message for unauthorized', async () => {
      const response = await request(context.app.getHttpServer()).get('/api/users').expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code');
      expect(response.body.code).toBe('UNAUTHORIZED');
      expect(typeof response.body.message).toBe('string');
    });

    it('should return clear message for forbidden', async () => {
      const viewer = await createTestUser(context, { roleName: 'viewer' });

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code');
      expect(response.body.code).toBe('FORBIDDEN');
      expect(typeof response.body.message).toBe('string');
    });

    it('should include helpful details in forbidden message', async () => {
      const viewer = await createTestUser(context, { roleName: 'viewer' });

      const response = await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      // Error message should mention permissions or roles
      expect(response.body.message.toLowerCase()).toMatch(/permission|role|forbidden/);
    });
  });

  describe('Token Validation', () => {
    it('should reject expired token', async () => {
      // Create a token that's already expired
      const jwtService = context.module.get('JwtService');
      const expiredToken = jwtService.sign(
        { sub: 'user-1', email: 'test@example.com', roles: ['admin'] },
        { expiresIn: '-1s' },
      );

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(expiredToken))
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject malformed token', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader('malformed.token.here'))
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject token with invalid signature', async () => {
      // Token signed with different secret (will fail verification)
      const invalidToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(invalidToken))
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject request without Bearer prefix', async () => {
      const admin = await createTestUser(context, { roleName: 'admin' });

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', admin.accessToken) // Missing "Bearer " prefix
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should accept valid token', async () => {
      const admin = await createTestUser(context, { roleName: 'admin' });

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.email).toBe(admin.email);
    });
  });

  describe('Dynamic Role Changes', () => {
    it('should not reflect role changes in existing JWT', async () => {
      // Create viewer
      const viewer = await createTestUser(context, { roleName: 'viewer' });

      // Verify can't access users
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      // Upgrade to admin (directly in DB)
      const adminRole = await context.prisma.role.findUnique({
        where: { name: 'admin' },
      });
      await context.prisma.userRole.updateMany({
        where: { userId: viewer.id },
        data: { roleId: adminRole!.id },
      });

      // JWT still has old roles, so still forbidden
      // (JWT contains roles at time of issue)
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      // After getting new token (re-auth), would have new permissions
      // This confirms JWT contains roles at issue time, not dynamically
    });

    it('should reflect role changes with new token', async () => {
      // Create viewer
      const viewerEmail = 'viewer-upgrade@example.com';
      const viewer = await createTestUser(context, {
        email: viewerEmail,
        roleName: 'viewer',
      });

      // Verify can't access users
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      // Upgrade to admin
      const adminRole = await context.prisma.role.findUnique({
        where: { name: 'admin' },
      });
      await context.prisma.userRole.updateMany({
        where: { userId: viewer.id },
        data: { roleId: adminRole!.id },
      });

      // Generate new token with updated roles
      const jwtService = context.module.get('JwtService');
      const newToken = jwtService.sign({
        sub: viewer.id,
        email: viewer.email,
        roles: ['admin'],
      });

      // New token should have admin access
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(newToken))
        .expect(200);
    });
  });

  describe('Authorization Header Variations', () => {
    it('should accept "Bearer" with capital B', async () => {
      const admin = await createTestUser(context, { roleName: 'admin' });

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
    });

    it('should reject empty Authorization header', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', '')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject Authorization header with only "Bearer"', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Inactive User Handling', () => {
    it('should deny access for inactive user even with valid token', async () => {
      const user = await createTestUser(context, {
        roleName: 'admin',
        isActive: false,
      });

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(user.accessToken))
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Guard Order and Composition', () => {
    it('should apply guards in correct order for protected endpoints', async () => {
      // Order should be: JwtAuthGuard -> RolesGuard -> PermissionsGuard
      // Without auth: 401
      await request(context.app.getHttpServer()).get('/api/users').expect(401);

      // With auth but wrong role: 403
      const viewer = await createTestUser(context, { roleName: 'viewer' });
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(viewer.accessToken))
        .expect(403);

      // With auth and correct role: 200
      const admin = await createTestUser(context, { roleName: 'admin' });
      await request(context.app.getHttpServer())
        .get('/api/users')
        .set(authHeader(admin.accessToken))
        .expect(200);
    });
  });
});

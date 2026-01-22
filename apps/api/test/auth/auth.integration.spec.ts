import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockTestUser,
  createMockAdminUser,
  createMockInactiveUser,
  authHeader,
} from '../helpers/auth-mock.helper';

describe('Auth Controller (Integration)', () => {
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

  describe('GET /api/auth/providers', () => {
    it('should return list of enabled providers', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/auth/providers')
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.providers).toBeDefined();
      expect(Array.isArray(response.body.data.providers)).toBe(true);
    });

    it('should not require authentication', async () => {
      await request(context.app.getHttpServer())
        .get('/api/auth/providers')
        .expect(200);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user for authenticated request', async () => {
      const user = await createMockTestUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: user.id,
        email: user.email,
        roles: expect.arrayContaining([{ name: 'viewer' }]),
      });
    });

    it('should return 401 without token', async () => {
      await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader('invalid-token'))
        .expect(401);
    });

    it('should return 401 for inactive user', async () => {
      const inactiveUser = await createMockInactiveUser(context);

      await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(inactiveUser.accessToken))
        .expect(401);
    });

    it('should include permissions in response', async () => {
      const admin = await createMockAdminUser(context);

      const response = await request(context.app.getHttpServer())
        .get('/api/auth/me')
        .set(authHeader(admin.accessToken))
        .expect(200);

      expect(response.body.data.permissions).toBeDefined();
      expect(Array.isArray(response.body.data.permissions)).toBe(true);
      expect(response.body.data.permissions.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return 401 without authentication', async () => {
      await request(context.app.getHttpServer())
        .post('/api/auth/logout')
        .expect(401);
    });
  });
});

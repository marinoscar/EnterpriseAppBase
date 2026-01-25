import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks, setupMockUser } from '../fixtures/mock-setup.helper';

describe('Test Auth Integration', () => {
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

  describe('POST /api/auth/test/login', () => {
    it('should return 400 with invalid email', async () => {
      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'not-an-email', role: 'viewer' })
        .expect(400);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with missing email', async () => {
      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ role: 'viewer' })
        .expect(400);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid role', async () => {
      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'test@example.com', role: 'invalid-role' })
        .expect(400);

      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should redirect with access token for valid request (new user)', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-1',
        userId: 'new-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'new-user',
        email: 'newuser@example.com',
        displayName: 'newuser',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .type('application/json')
        .send({ email: 'newuser@example.com', role: 'viewer' })
        .expect(302);

      // Verify redirect contains token
      expect(response.headers.location).toBeDefined();
      expect(response.headers.location).toContain('/auth/callback?token=');
      expect(response.headers.location).toContain('expiresIn=');
    });

    it('should set refresh token cookie', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-2',
        userId: 'cookie-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'cookie-user',
        email: 'cookie@example.com',
        displayName: 'cookie',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'cookie@example.com', role: 'viewer' })
        .expect(302);

      // Check that Set-Cookie header is present
      expect(response.headers['set-cookie']).toBeDefined();
      const setCookieHeader = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie'][0]
        : response.headers['set-cookie'];
      expect(setCookieHeader).toContain('refresh_token=');
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('Path=/api/auth');
    });

    it('should work with existing user', async () => {
      // Setup existing user
      const existingUser = setupMockUser({
        email: 'existing@example.com',
        roleName: 'admin',
      });

      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-3',
        userId: existingUser.id,
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'existing@example.com', role: 'viewer' })
        .expect(302);

      expect(response.headers.location).toContain('/auth/callback?token=');
    });

    it('should default to viewer role when not specified', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-4',
        userId: 'default-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'default-user',
        email: 'default@example.com',
        displayName: 'default',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'default@example.com' })
        .expect(302);

      expect(response.headers.location).toContain('/auth/callback?token=');
    });

    it('should accept all valid roles (admin, contributor, viewer)', async () => {
      const roles = ['admin', 'contributor', 'viewer'];

      for (const role of roles) {
        // Mock refresh token creation
        context.prismaMock.refreshToken.create.mockResolvedValue({
          id: `token-${role}`,
          userId: `${role}-user`,
          tokenHash: 'hashed',
          expiresAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        });

        // Mock user creation
        context.prismaMock.user.create.mockResolvedValue({
          id: `${role}-user`,
          email: `${role}@example.com`,
          displayName: role,
          providerDisplayName: null,
          profileImageUrl: null,
          providerProfileImageUrl: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const response = await request(context.app.getHttpServer())
          .post('/api/auth/test/login')
          .send({ email: `${role}@example.com`, role })
          .expect(302);

        expect(response.headers.location).toContain('/auth/callback?token=');
      }
    });

    it('should normalize email to lowercase', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-upper',
        userId: 'upper-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'upper-user',
        email: 'uppercase@example.com',
        displayName: 'UPPERCASE',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'UPPERCASE@EXAMPLE.COM', role: 'viewer' })
        .expect(302);

      // Verify the email was normalized to lowercase when searching
      expect(context.prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'uppercase@example.com' },
        }),
      );
    });

    it('should accept custom displayName', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-custom',
        userId: 'custom-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'custom-user',
        email: 'custom@example.com',
        displayName: 'Custom Display Name',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({
          email: 'custom@example.com',
          role: 'viewer',
          displayName: 'Custom Display Name',
        })
        .expect(302);

      // Verify displayName was used
      expect(context.prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: 'Custom Display Name',
          }),
        }),
      );
    });

    it('should create refresh token in database', async () => {
      // Mock refresh token creation
      context.prismaMock.refreshToken.create.mockResolvedValue({
        id: 'token-refresh',
        userId: 'refresh-user',
        tokenHash: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        createdAt: new Date(),
      });

      // Mock user creation
      context.prismaMock.user.create.mockResolvedValue({
        id: 'refresh-user',
        email: 'refresh@example.com',
        displayName: 'refresh',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'refresh@example.com', role: 'viewer' })
        .expect(302);

      // Verify refresh token was created
      expect(context.prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'refresh-user',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
    });
  });
});

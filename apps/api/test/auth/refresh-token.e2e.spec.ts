import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { resetDatabase } from '../helpers/database.helper';
import { createTestUser } from '../helpers/auth.helper';
import { TestContext, createTestApp, closeTestApp } from '../helpers/test-app.helper';
import { createHash } from 'crypto';

describe('Refresh Token (e2e)', () => {
  let context: TestContext;
  let authService: AuthService;

  beforeAll(async () => {
    context = await createTestApp();
    authService = context.module.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  describe('POST /api/auth/refresh', () => {
    it('should return new access token with valid refresh token', async () => {
      const user = await createTestUser(context);

      // Create a refresh token manually
      const refreshToken = 'test-refresh-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await context.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.expiresIn).toBeDefined();
      expect(typeof response.body.accessToken).toBe('string');
      expect(typeof response.body.expiresIn).toBe('number');
    });

    it('should return 401 without refresh token', async () => {
      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .expect(401);
    });

    it('should return 401 with invalid refresh token', async () => {
      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=invalid-token-that-does-not-exist`])
        .expect(401);
    });

    it('should return 401 with expired refresh token', async () => {
      const user = await createTestUser(context);

      // Create expired token
      const refreshToken = 'expired-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() - 1); // Yesterday

      await context.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(401);
    });

    it('should return 401 with revoked refresh token', async () => {
      const user = await createTestUser(context);

      // Create revoked token
      const refreshToken = 'revoked-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await context.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          revokedAt: new Date(), // Already revoked
        },
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(401);
    });

    it('should rotate refresh token on use', async () => {
      const user = await createTestUser(context);

      // Create a refresh token
      const refreshToken = 'rotate-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await context.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      // Should set new refresh token cookie
      expect(response.headers['set-cookie']).toBeDefined();
      const cookies = Array.isArray(response.headers['set-cookie'])
        ? response.headers['set-cookie']
        : [response.headers['set-cookie']];
      const refreshCookie = cookies.find((c) => c.includes('refresh_token='));
      expect(refreshCookie).toBeDefined();

      // Old token should be revoked
      const oldToken = await context.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      expect(oldToken!.revokedAt).toBeDefined();
    });

    it('should return 401 for inactive user', async () => {
      // Create inactive user
      const role = await context.prisma.role.findUnique({ where: { name: 'viewer' } });
      const inactiveUser = await context.prisma.user.create({
        data: {
          email: 'inactive@example.com',
          providerDisplayName: 'Inactive User',
          isActive: false,
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-inactive',
              providerEmail: 'inactive@example.com',
            },
          },
          userRoles: {
            create: {
              roleId: role!.id,
            },
          },
        },
      });

      // Create refresh token for inactive user
      const refreshToken = 'inactive-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await context.prisma.refreshToken.create({
        data: {
          userId: inactiveUser.id,
          tokenHash,
          expiresAt,
        },
      });

      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(401);
    });
  });

  describe('Token Reuse Detection', () => {
    it('should revoke all tokens on reuse attempt', async () => {
      const user = await createTestUser(context);

      // Create a refresh token
      const refreshToken = 'reuse-token-' + Date.now();
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await context.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      // First use - should succeed and revoke the token
      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(200);

      // Second use of same token - should detect reuse and fail
      await request(context.app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(401);

      // All tokens for user should be revoked
      const userTokens = await context.prisma.refreshToken.findMany({
        where: { userId: user.id },
      });

      // All tokens should have revokedAt set
      const allRevoked = userTokens.every((t) => t.revokedAt !== null);
      expect(allRevoked).toBe(true);
    });
  });
});

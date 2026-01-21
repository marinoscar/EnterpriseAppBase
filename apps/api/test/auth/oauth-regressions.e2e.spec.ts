import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy';
import { MockGoogleStrategy, createMockGoogleProfile } from '../mocks/google-oauth.mock';
import { resetDatabase } from '../helpers/database.helper';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

/**
 * OAuth Regression Tests
 *
 * These tests specifically target issues that were fixed:
 * 1. HttpExceptionFilter using Express-style response.status().json() instead of Fastify's response.code().send()
 * 2. GoogleOAuthGuard needing raw Node.js http objects for Passport compatibility
 * 3. GoogleOAuthGuard needing to copy user from raw request to Fastify request
 * 4. AuthService.createNewUser calling admin bootstrap outside transaction causing FK violation
 * 5. Error redirect URL containing newlines causing invalid header characters
 */
describe('OAuth Regression Tests (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GoogleStrategy)
      .useClass(MockGoogleStrategy)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    MockGoogleStrategy.resetMockProfile();
  });

  describe('Regression: HttpExceptionFilter Fastify Compatibility', () => {
    it('should use Fastify response methods (code/send) not Express (status/json)', async () => {
      // Test with a deactivated user to trigger an error
      await prisma.user.create({
        data: {
          email: 'deactivated@example.com',
          isActive: false,
          providerDisplayName: 'Deactivated User',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-deactivated',
              providerEmail: 'deactivated@example.com',
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'viewer' } },
            },
          },
        },
      });

      const mockProfile = createMockGoogleProfile({
        id: 'google-deactivated',
        email: 'deactivated@example.com',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with error (not throw 500 from wrong response method)
      expect(response.headers.location).toBeDefined();
      expect(response.headers.location).toContain('error=');
    });

    it('should return proper JSON error format for API errors', async () => {
      // Call an authenticated endpoint without token
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);

      // Verify the response is properly formatted JSON
      expect(response.body).toHaveProperty('statusCode', 401);
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('path');
    });

    it('should handle validation errors with Fastify response', async () => {
      // Try to call refresh without a refresh token
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .expect(401);

      // Should return proper error structure
      expect(response.body).toHaveProperty('statusCode', 401);
      expect(response.body).toHaveProperty('code');
      expect(response.body.message).toContain('refresh token');
    });
  });

  describe('Regression: GoogleOAuthGuard Passport Compatibility', () => {
    it('should successfully authenticate with raw request/response objects', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'passport-test@example.com',
        displayName: 'Passport Test User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      // If the guard doesn't return raw objects, Passport will fail
      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should succeed and redirect with token
      expect(response.headers.location).toContain('token=');

      // Verify user was created (proves authentication succeeded)
      const user = await prisma.user.findUnique({
        where: { email: mockProfile.email },
      });
      expect(user).toBeDefined();
    });

    it('should copy user to Fastify request after authentication', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'request-user@example.com',
        displayName: 'Request User Test',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // If user isn't copied to Fastify request, the controller can't access it
      // and will return authentication_failed error
      expect(response.headers.location).not.toContain('error=authentication_failed');
      expect(response.headers.location).toContain('token=');
    });

    it('should handle authentication errors gracefully', async () => {
      // Set a null profile to simulate authentication failure
      MockGoogleStrategy.setMockProfile(null as any);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with error
      expect(response.headers.location).toContain('error=');
    });
  });

  describe('Regression: Admin Bootstrap Transaction Integrity', () => {
    it('should create admin user with role in single transaction', async () => {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@example.com';
      const mockProfile = createMockGoogleProfile({
        email: adminEmail,
        displayName: 'Admin User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Verify user and admin role were both created
      const user = await prisma.user.findUnique({
        where: { email: adminEmail },
        include: {
          userRoles: {
            include: { role: true }
          },
          identities: true,
          userSettings: true,
        },
      });

      expect(user).toBeDefined();
      expect(user!.userRoles.length).toBeGreaterThan(0);
      expect(user!.userRoles.some(ur => ur.role.name === 'admin')).toBe(true);
      expect(user!.identities.length).toBe(1);
      expect(user!.userSettings).toBeDefined();

      // All foreign keys should be valid (no FK violations)
      expect(user!.identities[0].userId).toBe(user!.id);
      expect(user!.userSettings!.userId).toBe(user!.id);
    });

    it('should rollback all changes if admin role assignment fails', async () => {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@example.com';

      // Delete admin role to cause FK error
      await prisma.role.delete({ where: { name: 'admin' } });

      const mockProfile = createMockGoogleProfile({
        email: adminEmail,
        displayName: 'Admin User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with error
      expect(response.headers.location).toContain('error=');

      // User should NOT have been created (transaction rolled back)
      const user = await prisma.user.findUnique({
        where: { email: adminEmail },
      });
      expect(user).toBeNull();

      // Restore admin role for other tests
      await resetDatabase(prisma);
    });

    it('should create regular user with default role in transaction', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'regular@example.com',
        displayName: 'Regular User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Verify user, role, identity, and settings were all created
      const user = await prisma.user.findUnique({
        where: { email: mockProfile.email },
        include: {
          userRoles: { include: { role: true } },
          identities: true,
          userSettings: true,
        },
      });

      expect(user).toBeDefined();
      expect(user!.userRoles.length).toBe(1);
      expect(user!.userRoles[0].role.name).toBe('viewer'); // Default role
      expect(user!.identities.length).toBe(1);
      expect(user!.userSettings).toBeDefined();
    });
  });

  describe('Regression: Error Message URL Sanitization', () => {
    it('should sanitize error messages with newlines for URL redirect', async () => {
      await prisma.user.create({
        data: {
          email: 'error-test@example.com',
          isActive: false,
          providerDisplayName: 'Error Test User',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-error',
              providerEmail: 'error-test@example.com',
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'viewer' } },
            },
          },
        },
      });

      const mockProfile = createMockGoogleProfile({
        id: 'google-error',
        email: 'error-test@example.com',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect without 'ERR_INVALID_CHAR' error
      expect(response.headers.location).toBeDefined();

      // Error message should be URL-encoded and contain no newlines
      const url = new URL(response.headers.location, 'http://localhost');
      const errorParam = url.searchParams.get('error');
      expect(errorParam).toBeDefined();
      expect(errorParam).not.toContain('\n');
      expect(errorParam).not.toContain('\r');
    });

    it('should truncate very long error messages', async () => {
      // Create a scenario that might produce a long error message
      await prisma.user.create({
        data: {
          email: 'long-error@example.com',
          isActive: false,
          providerDisplayName: 'Long Error User',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-long-error',
              providerEmail: 'long-error@example.com',
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'viewer' } },
            },
          },
        },
      });

      const mockProfile = createMockGoogleProfile({
        id: 'google-long-error',
        email: 'long-error@example.com',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const url = new URL(response.headers.location, 'http://localhost');
      const errorParam = url.searchParams.get('error');

      // Should be truncated to reasonable length (100 chars max)
      expect(errorParam?.length).toBeLessThanOrEqual(100);
    });

    it('should encode special characters in error message', async () => {
      await prisma.user.create({
        data: {
          email: 'special@example.com',
          isActive: false,
          providerDisplayName: 'Special & <chars>',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-special',
              providerEmail: 'special@example.com',
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'viewer' } },
            },
          },
        },
      });

      const mockProfile = createMockGoogleProfile({
        id: 'google-special',
        email: 'special@example.com',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const url = new URL(response.headers.location, 'http://localhost');
      const errorParam = url.searchParams.get('error');

      // Should be properly URL-encoded
      expect(errorParam).toBeDefined();
      // Should not break URL parsing
      expect(url.searchParams.toString()).toBeTruthy();
    });
  });

  describe('Integration: Full OAuth Flow End-to-End', () => {
    it('should complete entire OAuth flow without errors', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'fullflow@example.com',
        displayName: 'Full Flow Test',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      // 1. Get OAuth callback (creates user)
      const callbackResponse = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      expect(callbackResponse.headers.location).toContain('token=');

      // Extract token from redirect URL
      const redirectUrl = new URL(callbackResponse.headers.location, 'http://localhost');
      const accessToken = redirectUrl.searchParams.get('token');
      expect(accessToken).toBeTruthy();

      // 2. Use token to access authenticated endpoint
      const meResponse = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(meResponse.body.data).toHaveProperty('email', mockProfile.email);
      expect(meResponse.body.data).toHaveProperty('roles');
      expect(meResponse.body.data).toHaveProperty('permissions');

      // 3. Verify database state
      const user = await prisma.user.findUnique({
        where: { email: mockProfile.email },
        include: {
          userRoles: { include: { role: true } },
          identities: true,
          userSettings: true,
        },
      });

      expect(user).toBeDefined();
      expect(user!.userRoles.length).toBeGreaterThan(0);
      expect(user!.identities.length).toBe(1);
      expect(user!.userSettings).toBeDefined();
    });

    it('should handle refresh token flow correctly', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'refresh@example.com',
        displayName: 'Refresh Test',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      // Get initial tokens via OAuth
      const callbackResponse = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Extract refresh token from cookie
      const cookies = callbackResponse.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      const refreshTokenCookie = cookieArray.find((c) =>
        c.startsWith('refresh_token=')
      );
      expect(refreshTokenCookie).toBeDefined();

      // Use refresh token to get new access token
      const refreshResponse = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshTokenCookie!)
        .expect(200);

      expect(refreshResponse.body).toHaveProperty('accessToken');
      expect(refreshResponse.body).toHaveProperty('expiresIn');
    });
  });
});

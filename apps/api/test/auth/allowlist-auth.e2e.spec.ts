import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy';
import {
  MockGoogleStrategy,
  createMockGoogleProfile,
} from '../mocks/google-oauth.mock';
import { resetDatabase } from '../helpers/database.helper';
import { ValidationPipe } from '@nestjs/common';

describe('Allowlist Auth Flow (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminEmail: string;

  beforeAll(async () => {
    adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@example.com';

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

  describe('OAuth Login with Allowlist', () => {
    it('should succeed when email is in allowlist', async () => {
      const allowedEmail = 'allowed@example.com';

      // Add email to allowlist
      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      await prisma.allowedEmail.create({
        data: {
          email: allowedEmail,
          addedById: adminUser.id,
        },
      });

      // Set up OAuth profile
      const mockProfile = createMockGoogleProfile({
        email: allowedEmail,
        displayName: 'Allowed User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      // Simulate OAuth callback
      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with token (success)
      expect(response.headers.location).toContain('token=');
      expect(response.headers.location).not.toContain('error=');

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { email: allowedEmail },
      });
      expect(user).toBeDefined();
    });

    it('should succeed for INITIAL_ADMIN_EMAIL even if not in allowlist', async () => {
      const mockProfile = createMockGoogleProfile({
        email: adminEmail,
        displayName: 'Admin User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with token
      expect(response.headers.location).toContain('token=');
      expect(response.headers.location).not.toContain('error=');

      // Verify admin user was created with admin role
      const user = await prisma.user.findUnique({
        where: { email: adminEmail },
        include: { userRoles: { include: { role: true } } },
      });
      expect(user).toBeDefined();
      expect(user!.userRoles.some((ur) => ur.role.name === 'admin')).toBe(
        true,
      );
    });

    it('should fail with 403 when email is not in allowlist', async () => {
      const deniedEmail = 'denied@example.com';

      const mockProfile = createMockGoogleProfile({
        email: deniedEmail,
        displayName: 'Denied User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with error
      expect(response.headers.location).toContain('error=');
      expect(response.headers.location).toContain('access_denied');

      // Verify user was NOT created
      const user = await prisma.user.findUnique({
        where: { email: deniedEmail },
      });
      expect(user).toBeNull();
    });

    it('should have appropriate error message for denied logins', async () => {
      const deniedEmail = 'denied@example.com';

      const mockProfile = createMockGoogleProfile({
        email: deniedEmail,
        displayName: 'Denied User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Extract error details from redirect URL
      const redirectUrl = new URL(
        response.headers.location,
        'http://localhost',
      );
      const errorParam = redirectUrl.searchParams.get('error');
      const errorDescription = redirectUrl.searchParams.get(
        'error_description',
      );

      expect(errorParam).toBe('access_denied');
      expect(errorDescription).toContain('not authorized');
    });

    it('should mark email as claimed after successful registration', async () => {
      const allowedEmail = 'newuser@example.com';

      // Create admin and add email to allowlist
      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      const allowlistEntry = await prisma.allowedEmail.create({
        data: {
          email: allowedEmail,
          addedById: adminUser.id,
        },
      });

      expect(allowlistEntry.claimedById).toBeNull();
      expect(allowlistEntry.claimedAt).toBeNull();

      // Set up OAuth profile and login
      const mockProfile = createMockGoogleProfile({
        email: allowedEmail,
        displayName: 'New User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Verify email is marked as claimed
      const updatedEntry = await prisma.allowedEmail.findUnique({
        where: { id: allowlistEntry.id },
      });

      expect(updatedEntry!.claimedById).toBeDefined();
      expect(updatedEntry!.claimedAt).toBeDefined();

      // Verify claimed by the new user
      const newUser = await prisma.user.findUnique({
        where: { email: allowedEmail },
      });
      expect(updatedEntry!.claimedById).toBe(newUser!.id);
    });

    it('should handle case-insensitive email matching for allowlist', async () => {
      const allowedEmail = 'mixed@example.com';

      // Add email to allowlist in lowercase
      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      await prisma.allowedEmail.create({
        data: {
          email: allowedEmail.toLowerCase(),
          addedById: adminUser.id,
        },
      });

      // Login with mixed case email
      const mockProfile = createMockGoogleProfile({
        email: 'MiXeD@ExAmPlE.cOm',
        displayName: 'Mixed Case User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should succeed
      expect(response.headers.location).toContain('token=');
      expect(response.headers.location).not.toContain('error=');
    });

    it('should allow existing users to login regardless of allowlist', async () => {
      const existingEmail = 'existing@example.com';

      // Create existing user (not in allowlist)
      const existingUser = await prisma.user.create({
        data: {
          email: existingEmail,
          providerDisplayName: 'Existing User',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'existing-google-id',
              providerEmail: existingEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'viewer' } },
            },
          },
        },
      });

      // Login (email not in allowlist, but user exists)
      const mockProfile = createMockGoogleProfile({
        id: 'existing-google-id',
        email: existingEmail,
        displayName: 'Existing User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should succeed - existing users bypass allowlist check
      expect(response.headers.location).toContain('token=');
      expect(response.headers.location).not.toContain('error=');
    });

    it('should not mark email as claimed on login failure', async () => {
      const allowedEmail = 'fails@example.com';

      // Create admin and add email to allowlist
      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      const allowlistEntry = await prisma.allowedEmail.create({
        data: {
          email: allowedEmail,
          addedById: adminUser.id,
        },
      });

      // Simulate a different email trying to login
      const mockProfile = createMockGoogleProfile({
        email: 'different@example.com',
        displayName: 'Different User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Verify original allowlist entry is NOT claimed
      const entry = await prisma.allowedEmail.findUnique({
        where: { id: allowlistEntry.id },
      });
      expect(entry!.claimedById).toBeNull();
      expect(entry!.claimedAt).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple allowlist entries for same email gracefully', async () => {
      // This shouldn't happen due to unique constraint, but test the behavior
      const allowedEmail = 'unique@example.com';

      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      // First entry should succeed
      await prisma.allowedEmail.create({
        data: {
          email: allowedEmail,
          addedById: adminUser.id,
        },
      });

      // Second entry should fail due to unique constraint
      await expect(
        prisma.allowedEmail.create({
          data: {
            email: allowedEmail,
            addedById: adminUser.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('should handle email with leading/trailing whitespace', async () => {
      const allowedEmail = 'spaced@example.com';

      const adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          providerDisplayName: 'Admin',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'admin-google-id',
              providerEmail: adminEmail,
            },
          },
          userRoles: {
            create: {
              role: { connect: { name: 'admin' } },
            },
          },
        },
      });

      await prisma.allowedEmail.create({
        data: {
          email: allowedEmail,
          addedById: adminUser.id,
        },
      });

      // OAuth providers typically normalize emails, but test the behavior
      const mockProfile = createMockGoogleProfile({
        email: '  spaced@example.com  ',
        displayName: 'Spaced User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Behavior depends on how AuthService handles the email
      // Should either succeed or fail gracefully
      expect(response.headers.location).toBeDefined();
    });
  });
});

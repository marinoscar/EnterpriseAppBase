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
import { ValidationPipe } from '@nestjs/common';

describe('OAuth Flow (e2e)', () => {
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

  describe('New User OAuth Flow', () => {
    it('should create new user on first login', async () => {
      const mockProfile = createMockGoogleProfile({
        email: 'newuser@example.com',
        displayName: 'New User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      // Simulate OAuth callback
      const response = await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Should redirect with token
      expect(response.headers.location).toContain('token=');

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { email: mockProfile.email },
        include: { userRoles: { include: { role: true } } },
      });

      expect(user).toBeDefined();
      expect(user!.providerDisplayName).toBe(mockProfile.displayName);
      expect(user!.userRoles[0].role.name).toBe('viewer'); // Default role
    });

    it('should create user settings for new user', async () => {
      const mockProfile = createMockGoogleProfile();
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const user = await prisma.user.findUnique({
        where: { email: mockProfile.email },
        include: { userSettings: true },
      });

      expect(user!.userSettings).toBeDefined();
      expect(user!.userSettings!.value).toHaveProperty('theme');
    });

    it('should create identity for new user', async () => {
      const mockProfile = createMockGoogleProfile();
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const identity = await prisma.userIdentity.findFirst({
        where: {
          provider: 'google',
          providerSubject: mockProfile.id,
        },
      });

      expect(identity).toBeDefined();
      expect(identity!.providerEmail).toBe(mockProfile.email);
    });
  });

  describe('Existing User OAuth Flow', () => {
    it('should link identity to existing user by email', async () => {
      // Create existing user without Google identity
      const existingUser = await prisma.user.create({
        data: {
          email: 'existing@example.com',
          providerDisplayName: 'Existing User',
          userRoles: {
            create: {
              role: {
                connect: { name: 'contributor' },
              },
            },
          },
        },
      });

      const mockProfile = createMockGoogleProfile({
        email: existingUser.email,
        displayName: 'Google Name',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      // Verify identity was linked
      const identity = await prisma.userIdentity.findFirst({
        where: {
          userId: existingUser.id,
          provider: 'google',
        },
      });

      expect(identity).toBeDefined();

      // Verify user still has original role
      const user = await prisma.user.findUnique({
        where: { id: existingUser.id },
        include: { userRoles: { include: { role: true } } },
      });
      expect(user!.userRoles[0].role.name).toBe('contributor');
    });

    it('should update provider fields on existing user login', async () => {
      // Create user with Google identity
      const user = await prisma.user.create({
        data: {
          email: 'returning@example.com',
          providerDisplayName: 'Old Name',
          providerProfileImageUrl: 'https://old-image.com/photo.jpg',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-returning',
              providerEmail: 'returning@example.com',
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
        id: 'google-returning',
        email: user.email,
        displayName: 'New Name',
        picture: 'https://new-image.com/photo.jpg',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      expect(updatedUser!.providerDisplayName).toBe('New Name');
      expect(updatedUser!.providerProfileImageUrl).toBe('https://new-image.com/photo.jpg');
    });

    it('should not overwrite user custom display name', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'custom@example.com',
          displayName: 'My Custom Name', // User override
          providerDisplayName: 'Provider Name',
          identities: {
            create: {
              provider: 'google',
              providerSubject: 'google-custom',
              providerEmail: 'custom@example.com',
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
        id: 'google-custom',
        email: user.email,
        displayName: 'New Provider Name',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });

      expect(updatedUser!.displayName).toBe('My Custom Name'); // Unchanged
      expect(updatedUser!.providerDisplayName).toBe('New Provider Name'); // Updated
    });
  });

  describe('Admin Bootstrap', () => {
    it('should grant admin role to INITIAL_ADMIN_EMAIL', async () => {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@example.com';
      const mockProfile = createMockGoogleProfile({
        email: adminEmail,
        displayName: 'Admin User',
      });
      MockGoogleStrategy.setMockProfile(mockProfile);

      await request(app.getHttpServer())
        .get('/api/auth/google/callback')
        .expect(302);

      const user = await prisma.user.findUnique({
        where: { email: adminEmail },
        include: { userRoles: { include: { role: true } } },
      });

      expect(user!.userRoles.some((ur) => ur.role.name === 'admin')).toBe(true);
    });
  });

  describe('Deactivated User', () => {
    it('should reject login for deactivated user', async () => {
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

      // Should redirect with error
      expect(response.headers.location).toContain('error=');
    });
  });
});

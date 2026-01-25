import request from 'supertest';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';

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
    it('should redirect with access token in development', async () => {
      // Mock role and user creation
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-user-1',
        email: 'test@example.com',
        displayName: 'test',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null) // First check: user doesn't exist
        .mockResolvedValueOnce(mockUser); // Reload after role assignment
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'test@example.com', role: 'viewer' })
        .expect(302);

      // Verify redirect contains token
      expect(response.headers.location).toBeDefined();
      expect(response.headers.location).toContain('/auth/callback?token=');
      expect(response.headers.location).toContain('expiresIn=');
    });

    it('should set refresh token cookie', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-user-2',
        email: 'cookie@example.com',
        displayName: 'cookie',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

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

    it('should create user if not exists', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-user-3',
        email: 'newuser@example.com',
        displayName: 'newuser',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null) // User doesn't exist
        .mockResolvedValueOnce(mockUser); // Reload after creation
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'newuser@example.com', role: 'viewer' })
        .expect(302);

      // Verify user creation was called
      expect(context.prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'newuser@example.com',
            displayName: 'newuser',
            isActive: true,
          }),
        }),
      );
    });

    it('should work with admin role', async () => {
      const mockAdminRole = {
        id: 'role-admin',
        name: 'admin',
        description: 'Admin role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-admin',
        email: 'admin@example.com',
        displayName: 'admin',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockAdminRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockAdminRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'admin@example.com', role: 'admin' })
        .expect(302);

      expect(response.headers.location).toContain('/auth/callback?token=');
      expect(context.prismaMock.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'admin' },
      });
    });

    it('should work with contributor role', async () => {
      const mockContributorRole = {
        id: 'role-contributor',
        name: 'contributor',
        description: 'Contributor role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-contributor',
        email: 'contributor@example.com',
        displayName: 'contributor',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockContributorRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockContributorRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'contributor@example.com', role: 'contributor' })
        .expect(302);

      expect(response.headers.location).toContain('/auth/callback?token=');
      expect(context.prismaMock.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'contributor' },
      });
    });

    it('should work with viewer role', async () => {
      const mockViewerRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-viewer',
        email: 'viewer@example.com',
        displayName: 'viewer',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockViewerRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'viewer@example.com', role: 'viewer' })
        .expect(302);

      expect(response.headers.location).toContain('/auth/callback?token=');
      expect(context.prismaMock.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'viewer' },
      });
    });

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

    it('should default to viewer role when not specified', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-default',
        email: 'default@example.com',
        displayName: 'default',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'default@example.com' })
        .expect(302);

      expect(context.prismaMock.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'viewer' },
      });
    });

    it('should create refresh token in database', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-refresh',
        email: 'refresh@example.com',
        displayName: 'refresh',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'refresh@example.com', role: 'viewer' })
        .expect(302);

      expect(context.prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should accept custom displayName', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-custom',
        email: 'custom@example.com',
        displayName: 'Custom Display Name',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({
          email: 'custom@example.com',
          role: 'viewer',
          displayName: 'Custom Display Name',
        })
        .expect(302);

      expect(context.prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            displayName: 'Custom Display Name',
          }),
        }),
      );
    });

    it('should normalize email to lowercase', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-upper',
        email: 'uppercase@example.com',
        displayName: 'UPPERCASE',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'UPPERCASE@EXAMPLE.COM', role: 'viewer' })
        .expect(302);

      expect(context.prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'uppercase@example.com' },
        }),
      );
    });

    it('should redirect to appUrl configured in environment', async () => {
      const mockRole = {
        id: 'role-viewer',
        name: 'viewer',
        description: 'Viewer role',
        isSystemRole: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUser = {
        id: 'test-url',
        email: 'url@example.com',
        displayName: 'url',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockRole }],
      };

      context.prismaMock.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      context.prismaMock.role.findUnique.mockResolvedValue(mockRole);
      context.prismaMock.$transaction.mockImplementation(async (callback: any) => callback(context.prismaMock));
      context.prismaMock.user.create.mockResolvedValue(mockUser);
      context.prismaMock.userRole.deleteMany.mockResolvedValue({ count: 0 });
      context.prismaMock.userRole.create.mockResolvedValue({});
      context.prismaMock.refreshToken.create.mockResolvedValue({});

      const response = await request(context.app.getHttpServer())
        .post('/api/auth/test/login')
        .send({ email: 'url@example.com', role: 'viewer' })
        .expect(302);

      // Redirect should start with the app URL
      const location = response.headers.location;
      expect(location).toMatch(/^http[s]?:\/\/.+\/auth\/callback/);
    });
  });
});

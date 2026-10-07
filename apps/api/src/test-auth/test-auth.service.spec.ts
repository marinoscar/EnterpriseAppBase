import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TestAuthService } from './test-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService, mockPrismaTransaction } from '../../test/mocks/prisma.mock';
import { TestLoginDto } from './dto/test-login.dto';
import { PrincipalCache } from '../auth/principal-cache/principal-cache.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../organizations/tenancy.service';

const principalCacheStub = { invalidate: jest.fn() };

describe('TestAuthService', () => {
  let service: TestAuthService;
  let mockPrisma: MockPrismaService;
  let mockJwtService: jest.Mocked<JwtService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  const mockViewerRole = {
    id: 'role-viewer',
    name: 'viewer',
    description: 'Viewer role',
    isSystemRole: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAdminRole = {
    id: 'role-admin',
    name: 'admin',
    description: 'Admin role',
    isSystemRole: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockContributorRole = {
    id: 'role-contributor',
    name: 'contributor',
    description: 'Contributor role',
    isSystemRole: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    // Setup transaction mock to handle both array and callback forms
    mockPrismaTransaction.call({ $transaction: mockPrisma.$transaction });
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockPrisma);
      } else if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    });

    // PP-6.1 (#721): the default organization a new test user joins.
    mockPrisma.organization.findFirst.mockResolvedValue({ id: 'org-default', isDefault: true } as any);
    mockPrisma.membership.upsert.mockResolvedValue({ id: 'membership-1' } as any);

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
      verify: jest.fn(),
    } as any;
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'jwt.accessTtlMinutes': 15,
          'jwt.refreshTtlDays': 14,
        };
        return config[key];
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestAuthService,
        // PP-1.12 (#683): the JWT principal cache; only `invalidate` is written to.
        { provide: PrincipalCache, useValue: principalCacheStub },
        // PP-6.1 (#721): the real service over the mocked Prisma.
        OrganizationsService,
        // PP-6.2 (#722): the tenancy mode (single, from the stub ConfigService).
        TenancyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TestAuthService>(TestAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loginAsTestUser', () => {
    it('should create a new user if email does not exist', async () => {
      const dto: TestLoginDto = {
        email: 'newuser@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-1',
        email: dto.email,
        displayName: 'newuser',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(null); // First check: user doesn't exist
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser as any); // Reload after role assignment
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('expiresIn');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(dto.email);
      expect(result.user.roles).toContain('viewer');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    // PP-6.1 (#721): a new test user joins the default org, atomically.
    it('creates exactly one membership in the default org for a new user, inside the transaction', async () => {
      const dto: TestLoginDto = { email: 'newmember@example.com', role: 'viewer' };
      const mockUser = {
        id: 'user-9',
        email: dto.email,
        displayName: 'newmember',
        isActive: true,
        userRoles: [{ role: mockViewerRole }],
      };
      const order: string[] = [];
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
        if (typeof arg !== 'function') return Array.isArray(arg) ? Promise.all(arg) : arg;
        order.push('tx:begin');
        const result = await arg(mockPrisma);
        order.push('tx:end');
        return result;
      });
      mockPrisma.membership.upsert.mockImplementation((async () => {
        order.push('membership');
        return { id: 'membership-1' };
      }) as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValue(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      await service.loginAsTestUser(dto);

      expect(mockPrisma.membership.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_userId: { orgId: 'org-default', userId: 'user-9' } },
        }),
      );
      // The user is created and joined inside the first transaction.
      expect(order.slice(0, 3)).toEqual(['tx:begin', 'membership', 'tx:end']);
    });

    it('rejects, without issuing tokens, when the membership write fails for a new user', async () => {
      const dto: TestLoginDto = { email: 'rollback@example.com', role: 'viewer' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'user-10', email: dto.email, userRoles: [] } as any);
      mockPrisma.membership.upsert.mockRejectedValue(new Error('membership insert failed'));

      await expect(service.loginAsTestUser(dto)).rejects.toThrow('membership insert failed');

      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('does not create a membership for an existing user', async () => {
      const dto: TestLoginDto = { email: 'already@example.com', role: 'viewer' };
      const mockUser = { id: 'user-11', email: dto.email, userRoles: [{ role: mockViewerRole }] };
      // PP-6.2 (#722): the user already belongs to the default org (the
      // PP-6.1 backfill), so the sign-in self-heal finds it and writes nothing.
      mockPrisma.membership.findUnique.mockResolvedValue({ id: 'membership-11' } as any);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      await service.loginAsTestUser(dto);

      expect(mockPrisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('should find existing user if email exists', async () => {
      const dto: TestLoginDto = {
        email: 'existing@example.com',
        role: 'viewer',
      };

      const existingUser = {
        id: 'existing-user',
        email: dto.email,
        displayName: 'Existing User',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser as any); // Reload after role assignment
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(result.user.email).toBe(dto.email);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(result.user.id).toBe('existing-user');
    });

    it('should assign the specified role', async () => {
      const dto: TestLoginDto = {
        email: 'admin@example.com',
        role: 'admin',
      };

      const mockUser = {
        id: 'user-admin',
        email: dto.email,
        displayName: 'admin',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockAdminRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // First check
        .mockResolvedValueOnce(mockUser as any); // Reload after role assignment
      mockPrisma.role.findUnique.mockResolvedValue(mockAdminRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(mockPrisma.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'admin' },
      });
      expect(result.user.roles).toContain('admin');
    });

    it('should generate valid access token', async () => {
      const dto: TestLoginDto = {
        email: 'token@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-token',
        email: dto.email,
        displayName: 'token',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        roles: ['viewer'],
      });
      expect(result.accessToken).toBe('mock-jwt-token');
    });

    it('should create refresh token in database', async () => {
      const dto: TestLoginDto = {
        email: 'refresh@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-refresh',
        email: dto.email,
        displayName: 'refresh',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should use default role (viewer) when not specified', async () => {
      const dto = {
        email: 'default@example.com',
        // role is optional, should default to 'viewer'
      } as TestLoginDto;

      const mockUser = {
        id: 'user-default',
        email: dto.email,
        displayName: 'default',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(mockPrisma.role.findUnique).toHaveBeenCalledWith({
        where: { name: 'viewer' },
      });
      expect(result.user.roles).toContain('viewer');
    });

    it('should work with contributor role', async () => {
      const dto: TestLoginDto = {
        email: 'contributor@example.com',
        role: 'contributor',
      };

      const mockUser = {
        id: 'user-contrib',
        email: dto.email,
        displayName: 'contributor',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockContributorRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockContributorRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(result.user.roles).toContain('contributor');
    });

    it('should use email prefix as displayName when not provided', async () => {
      const dto: TestLoginDto = {
        email: 'testuser@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-prefix',
        email: dto.email,
        displayName: 'testuser',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(result.user.displayName).toBe('testuser');
    });

    it('should use provided displayName when specified', async () => {
      const dto: TestLoginDto = {
        email: 'custom@example.com',
        role: 'viewer',
        displayName: 'Custom Display Name',
      };

      const mockUser = {
        id: 'user-custom',
        email: dto.email,
        displayName: dto.displayName,
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(result.user.displayName).toBe('Custom Display Name');
    });

    it('should normalize email to lowercase', async () => {
      const dto: TestLoginDto = {
        email: 'UPPERCASE@EXAMPLE.COM',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-upper',
        email: 'uppercase@example.com',
        displayName: 'UPPERCASE',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      await service.loginAsTestUser(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'uppercase@example.com' },
        }),
      );
    });

    it('should throw error when role not found', async () => {
      const dto: TestLoginDto = {
        email: 'invalid@example.com',
        role: 'viewer',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      // The new user is created (and joined to the default org) before the role lookup.
      mockPrisma.user.create.mockResolvedValue({ id: 'user-x', email: dto.email, userRoles: [] } as any);
      mockPrisma.role.findUnique.mockResolvedValue(null); // Role not found

      await expect(service.loginAsTestUser(dto)).rejects.toThrow('Role viewer not found');
    });

    it('should replace existing roles when logging in', async () => {
      const dto: TestLoginDto = {
        email: 'existing@example.com',
        role: 'admin',
      };

      const existingUser = {
        id: 'existing-user',
        email: dto.email,
        displayName: 'Existing User',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }], // Currently has viewer
      };

      const updatedUser = {
        ...existingUser,
        userRoles: [{ role: mockAdminRole }], // Now has admin
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(existingUser as any)
        .mockResolvedValueOnce(updatedUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockAdminRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: existingUser.id },
      });
      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: existingUser.id,
          roleId: mockAdminRole.id,
        },
      });
      expect(result.user.roles).toContain('admin');
    });

    it('invalidates the cached principal after the role swap committed (PP-1.12, #683)', async () => {
      const user = {
        id: 'swap-user',
        email: 'swap@example.com',
        displayName: null,
        isActive: true,
        userRoles: [{ role: mockAdminRole }],
      };
      const order: string[] = [];
      mockPrisma.user.findUnique.mockResolvedValue(user as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockAdminRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);
      const transaction = mockPrisma.$transaction as jest.Mock;
      const original = transaction.getMockImplementation();
      transaction.mockImplementationOnce(async (arg: any) => {
        const result = await original!(arg);
        order.push('transaction:committed');
        return result;
      });
      principalCacheStub.invalidate.mockImplementationOnce(() => order.push('invalidate'));

      await service.loginAsTestUser({ email: user.email, role: 'admin' });

      expect(principalCacheStub.invalidate).toHaveBeenCalledWith({ userId: 'swap-user' });
      expect(order).toEqual(['transaction:committed', 'invalidate']);
    });

    it('should create user settings for new users', async () => {
      const dto: TestLoginDto = {
        email: 'newsettings@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-settings',
        email: dto.email,
        displayName: 'newsettings',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      await service.loginAsTestUser(dto);

      // Verify user settings were created
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userSettings: expect.objectContaining({
              create: expect.objectContaining({
                value: expect.any(Object),
              }),
            }),
          }),
        }),
      );
    });

    it('should return correct expiresIn value', async () => {
      const dto: TestLoginDto = {
        email: 'expires@example.com',
        role: 'viewer',
      };

      const mockUser = {
        id: 'user-expires',
        email: dto.email,
        displayName: 'expires',
        providerDisplayName: null,
        profileImageUrl: null,
        providerProfileImageUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        userRoles: [{ role: mockViewerRole }],
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.user.create.mockResolvedValue(mockUser as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      const result = await service.loginAsTestUser(dto);

      // 15 minutes * 60 seconds = 900 seconds
      expect(result.expiresIn).toBe(900);
    });
  });

  // PP-6.2 (#722): test login bypasses OAuth and the allowlist, never the
  // tenancy rules. Single mode is every test above (the stub has no
  // `tenancy.mode`); these rebuild the service with TENANCY_MODE=multi.
  describe('loginAsTestUser, TENANCY_MODE=multi', () => {
    const ADMIN_EMAIL = 'admin@example.test';

    beforeEach(async () => {
      mockConfigService.get.mockImplementation(((key: string) => {
        const config: Record<string, any> = {
          'jwt.accessTtlMinutes': 15,
          'jwt.refreshTtlDays': 14,
          'tenancy.mode': 'multi',
          INITIAL_ADMIN_EMAIL: ADMIN_EMAIL,
        };
        return config[key];
      }) as any);
      const module = await Test.createTestingModule({
        providers: [
          TestAuthService,
          { provide: PrincipalCache, useValue: principalCacheStub },
          OrganizationsService,
          TenancyService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: JwtService, useValue: mockJwtService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      service = module.get(TestAuthService);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);
    });

    it('creates a new non-admin user without a membership and refuses it with no_organization', async () => {
      const created = { id: 'user-m1', email: 'new@example.test', displayName: 'new', userRoles: [] };
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(created as any);
      mockPrisma.membership.count.mockResolvedValue(0);

      await expect(service.loginAsTestUser({ email: created.email, role: 'viewer' })).rejects.toMatchObject({
        reason: 'no_organization',
      });

      expect(mockPrisma.organization.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.membership.upsert).not.toHaveBeenCalled();
      // Refused before the role swap and before any token.
      expect(mockPrisma.userRole.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('joins the INITIAL_ADMIN_EMAIL user to the default org and signs it in', async () => {
      const created = { id: 'admin-1', email: ADMIN_EMAIL, displayName: 'admin', userRoles: [{ role: mockAdminRole }] };
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValue(created as any);
      mockPrisma.user.create.mockResolvedValue(created as any);
      mockPrisma.role.findUnique.mockResolvedValue(mockAdminRole as any);
      mockPrisma.membership.count.mockResolvedValue(1);

      const result = await service.loginAsTestUser({ email: ADMIN_EMAIL, role: 'admin' });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(mockPrisma.membership.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId_userId: { orgId: 'org-default', userId: 'admin-1' } } }),
      );
    });

    it('signs in an existing user with an active membership, writing no membership', async () => {
      const existing = { id: 'user-m2', email: 'member@example.test', displayName: null, userRoles: [{ role: mockViewerRole }] };
      mockPrisma.user.findUnique.mockResolvedValue(existing as any);
      mockPrisma.membership.count.mockResolvedValue(1);

      const result = await service.loginAsTestUser({ email: existing.email, role: 'viewer' });

      expect(result.user.id).toBe('user-m2');
      expect(mockPrisma.membership.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.membership.upsert).not.toHaveBeenCalled();
    });
  });

  describe('loginAsTestUser, TENANCY_MODE=single self-heal', () => {
    it('gives an existing user without a default-org membership one', async () => {
      const existing = { id: 'user-s1', email: 'lost@example.test', displayName: null, userRoles: [{ role: mockViewerRole }] };
      mockPrisma.user.findUnique.mockResolvedValue(existing as any);
      mockPrisma.membership.findUnique.mockResolvedValue(null);
      mockPrisma.role.findUnique.mockResolvedValue(mockViewerRole as any);
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userRole.create.mockResolvedValue({} as any);
      mockPrisma.refreshToken.create.mockResolvedValue({} as any);

      await service.loginAsTestUser({ email: existing.email, role: 'viewer' });

      expect(mockPrisma.membership.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId_userId: { orgId: 'org-default', userId: 'user-s1' } } }),
      );
      expect(mockPrisma.membership.count).not.toHaveBeenCalled();
    });
  });
});

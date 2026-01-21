import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TestContext } from './test-app.helper';

export interface TestUser {
  id: string;
  email: string;
  roles: string[];
  accessToken: string;
}

/**
 * Creates a test user with specified role and returns auth token
 */
export async function createTestUser(
  context: TestContext,
  options: {
    email?: string;
    roleName?: string;
    isActive?: boolean;
  } = {},
): Promise<TestUser> {
  const {
    email = `test-${Date.now()}@example.com`,
    roleName = 'viewer',
    isActive = true,
  } = options;

  const { prisma, module } = context;
  const jwtService = module.get<JwtService>(JwtService);

  // Get role
  const role = await prisma.role.findUnique({
    where: { name: roleName },
  });

  if (!role) {
    throw new Error(`Role ${roleName} not found. Did you seed the database?`);
  }

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      providerDisplayName: 'Test User',
      isActive,
      identities: {
        create: {
          provider: 'google',
          providerSubject: `google-${Date.now()}`,
          providerEmail: email,
        },
      },
      userRoles: {
        create: {
          roleId: role.id,
        },
      },
      userSettings: {
        create: {
          value: {
            theme: 'system',
            profile: { useProviderImage: true },
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        },
      },
    },
    include: {
      userRoles: {
        include: { role: true },
      },
    },
  });

  // Generate JWT
  const roles = user.userRoles.map((ur) => ur.role.name);
  const accessToken = jwtService.sign({
    sub: user.id,
    email: user.email,
    roles,
  });

  return {
    id: user.id,
    email: user.email,
    roles,
    accessToken,
  };
}

/**
 * Creates an admin test user
 */
export async function createAdminUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createTestUser(context, { email, roleName: 'admin' });
}

/**
 * Creates a contributor test user
 */
export async function createContributorUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createTestUser(context, { email, roleName: 'contributor' });
}

/**
 * Creates a viewer test user
 */
export async function createViewerUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createTestUser(context, { email, roleName: 'viewer' });
}

/**
 * Creates an inactive test user
 */
export async function createInactiveUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createTestUser(context, { email, isActive: false });
}

/**
 * Helper to set Authorization header
 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

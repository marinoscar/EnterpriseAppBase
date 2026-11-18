import { JwtService } from '@nestjs/jwt';
import { TestContext } from './test-app.helper';
import { setupMockUser } from '../fixtures/mock-setup.helper';
import { CreateMockUserOptions } from '../fixtures/test-data.factory';

/**
 * Test user with access token
 * No database record is created - all data is mocked
 */
export interface TestUser {
  id: string;
  email: string;
  roles: string[];
  accessToken: string;
}

/**
 * Creates a mock test user and returns auth token
 * This version does NOT create database records
 * Instead, it sets up Prisma mock responses
 */
export async function createMockTestUser(
  context: TestContext,
  options: CreateMockUserOptions = {},
): Promise<TestUser> {
  const { module } = context;
  const jwtService = module.get<JwtService>(JwtService);

  // Setup the mock user in Prisma mock
  const mockUser = setupMockUser(options);

  // Generate JWT. A user with an active membership (the post-split shape,
  // #723) gets the `org` claim every token the API issues carries (#724); a
  // pre-split user has no membership and keeps the pre-#724 claim set, which
  // single mode honours through the temporary compatibility path.
  const accessToken = jwtService.sign({
    sub: mockUser.id,
    email: mockUser.email,
    roles: mockUser.roles,
    ...(mockUser.activeOrgId ? { org: mockUser.activeOrgId } : {}),
  });

  return {
    id: mockUser.id,
    email: mockUser.email,
    roles: mockUser.roles,
    accessToken,
  };
}

/**
 * Creates a mock admin test user
 */
export async function createMockAdminUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createMockTestUser(context, { email, roleName: 'admin' });
}

/**
 * Creates a mock contributor test user
 */
export async function createMockContributorUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createMockTestUser(context, { email, roleName: 'contributor' });
}

/**
 * Creates a mock viewer test user
 */
export async function createMockViewerUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createMockTestUser(context, { email, roleName: 'viewer' });
}

/**
 * Creates a mock inactive test user
 */
export async function createMockInactiveUser(
  context: TestContext,
  email?: string,
): Promise<TestUser> {
  return createMockTestUser(context, { email, isActive: false });
}

/**
 * Helper to set Authorization header
 */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

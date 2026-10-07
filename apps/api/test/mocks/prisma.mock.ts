import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

/**
 * Type-safe Prisma mock for testing
 */
export type MockPrismaClient = DeepMockProxy<PrismaClient>;
export type MockPrismaService = DeepMockProxy<PrismaClient>;

/**
 * Global Prisma mock instance
 * Use this in tests with jest-mock-extended
 */
const _prismaMock: MockPrismaClient = mockDeep<PrismaClient>();

/**
 * Gives a mock the org-scope entry points of `PrismaService` (issue #725):
 * `forOrg(orgId)` returns the mock itself and `runInOrg(orgId, fn)` runs `fn`
 * with the mock as the transaction client, so a spec asserts on the SAME
 * `storageObject.create` it always did. Defined once, not as `jest.fn()`s, so
 * `mockReset` / `jest.resetAllMocks` cannot wipe them.
 *
 * Whether the scope is applied (and that an unscoped client sees nothing) is
 * proven against a real database by `test/tenancy/rls-isolation.db.spec.ts`.
 */
export function withOrgScope<T extends object>(mock: T): T {
  const scoped: Record<string, unknown> = {
    forOrg: () => proxy,
    runInOrg: (_orgId: string, fn: (tx: unknown) => unknown) => fn(proxy),
  };
  const proxy: T = new Proxy(mock, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in scoped) return scoped[prop];
      return Reflect.get(target, prop, receiver);
    },
  });
  return proxy;
}

// Export as `any` to allow flexible mocking without strict Prisma type checking
// This is intentional - tests need to mock partial responses
export const prismaMock = withOrgScope(_prismaMock) as any;

/**
 * Alias for backward compatibility
 */
export const mockPrisma = prismaMock;

/**
 * Reset all Prisma mocks
 * Call this in beforeEach() to ensure clean state
 */
export function resetPrismaMock(): void {
  mockReset(_prismaMock);
}

/**
 * Helper to mock $transaction - executes callbacks immediately
 */
export function mockPrismaTransaction(): void {
  prismaMock.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') {
      // Interactive transaction
      return arg(prismaMock);
    } else if (Array.isArray(arg)) {
      // Sequential operations
      return Promise.all(arg);
    }
    return arg;
  });
}

/**
 * Creates a fresh mock PrismaService for unit tests
 */
export function createMockPrismaService(): MockPrismaService {
  return withOrgScope(mockDeep<PrismaClient>());
}

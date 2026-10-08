// Test doubles for the credentials slice's specs (issue #735).
//
// `createMockCredentialsPrisma()` is the structural stand-in for the app's
// Prisma client behind `PLATFORM_PRISMA`: one `jest.fn()` per delegate
// method the slice calls. `$extends` hands back the same object, so the user-
// and org-scoped clients (`forUser` / `forOrg`) reach these mocks with the
// service's own arguments; the real scoping is proven by the reference app's
// `*.db.spec.ts` suites.

export type MockDelegate = Record<'findUnique' | 'findMany' | 'update' | 'upsert' | 'deleteMany', jest.Mock>;

export interface MockCredentialsPrisma {
  credential: MockDelegate;
  userCredential: MockDelegate;
  orgCredential: MockDelegate;
  $extends: jest.Mock;
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
}

function mockDelegate(): MockDelegate {
  return {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
}

export function createMockCredentialsPrisma(): MockCredentialsPrisma {
  const prisma = {
    credential: mockDelegate(),
    userCredential: mockDelegate(),
    orgCredential: mockDelegate(),
    $extends: jest.fn(),
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  } as MockCredentialsPrisma;
  prisma.$extends.mockImplementation(() => prisma);
  return prisma;
}

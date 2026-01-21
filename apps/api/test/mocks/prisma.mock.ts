import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

export type MockPrismaService = DeepMockProxy<PrismaClient>;

export const mockPrisma = mockDeep<PrismaClient>();

export function resetPrismaMock(): void {
  mockReset(mockPrisma);
}

/**
 * Creates a mock PrismaService for unit tests
 */
export function createMockPrismaService(): MockPrismaService {
  return mockDeep<PrismaClient>();
}

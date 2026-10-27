// The jobs and nodes specs' deep mock of the slices' structural client
// (`JobsPrisma`), the counterpart of apps/api/test/mocks/prisma.mock.ts (#734):
// the specs moved here with the code they test, and a package never imports an
// app or a generated client.

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { JobsPrisma } from '../../../src/jobs/data/jobs-db';

/** A deep mock of the slices' client. */
export type MockPrismaService = DeepMockProxy<JobsPrisma>;

/** A fresh deep mock of the slices' client, for one spec. */
export function createMockPrismaService(): MockPrismaService {
  return mockDeep<JobsPrisma>();
}

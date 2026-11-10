// Doubles shared by the storage-migration specs (issue #1093).

import type { StorageMigrationService } from '../../../src/storage/migration/storage-migration.service';

/** One jest.fn() per delegate method the migration code calls. */
export function delegate(): Record<string, jest.Mock> {
  return {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  };
}

/** A bypass client: the four storage delegates. */
export function fakeSystemDb() {
  return {
    storageObject: delegate(),
    storageObjectChunk: delegate(),
    storageMigrationRun: delegate(),
    storageMigrationItem: delegate(),
  };
}

export type FakeDb = ReturnType<typeof fakeSystemDb>;

/** A run row with sensible defaults. */
export function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    orgId: null,
    sourceProvider: 's3',
    targetProvider: 'r2',
    status: 'running',
    totalCount: 0,
    migratedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    plannedAt: null,
    startedById: 'user-1',
    cancelledById: null,
    startedAt: null,
    finishedAt: null,
    cancelledAt: null,
    lastError: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

/** A StorageMigrationService double whose `db()` is `db`. */
export function fakeMigrations(db: FakeDb): jest.Mocked<Pick<StorageMigrationService, 'db' | 'finalizeIfDone' | 'failRun' | 'recordRunError'>> {
  return {
    db: jest.fn(() => db as never),
    finalizeIfDone: jest.fn().mockResolvedValue(null),
    failRun: jest.fn().mockResolvedValue(undefined),
    recordRunError: jest.fn().mockResolvedValue(undefined),
  };
}

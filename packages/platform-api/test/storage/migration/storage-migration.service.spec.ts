// =============================================================================
// Unit tests for StorageMigrationService (issue #1093): start, cancel, counts,
// race-safe finalization
// =============================================================================

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import '../../../src/storage/drivers/builtin-storage-drivers';
import {
  STORAGE_MIGRATE_PLAN_TYPE,
  STORAGE_MIGRATION_PRIORITY,
  STORAGE_MIGRATION_SYSTEM_ACCESS_REASON,
} from '../../../src/storage/migration/storage-migration.constants';
import { StorageMigrationService } from '../../../src/storage/migration/storage-migration.service';
import { fakeSystemDb, runRow, type FakeDb } from './fakes';

const configured = (bucket: string, endpoint?: string) => ({
  configured: true,
  config: { provider: 'x', bucket, region: 'auto', ...(endpoint ? { endpoint } : {}), settings: {}, secrets: {} },
});

function build(overrides: { resolveDriver?: jest.Mock; enqueue?: jest.Mock } = {}) {
  const db = fakeSystemDb();
  const system = { asSystem: jest.fn(() => db) };
  const prisma = { auditEvent: { create: jest.fn().mockResolvedValue({}) } };
  const storageConfig = {
    resolveDriver:
      overrides.resolveDriver ??
      jest.fn(async (id: string) => (id === 's3' ? configured('old-bucket') : configured('new-bucket', 'https://r2.example.test'))),
  };
  const jobs = { enqueue: overrides.enqueue ?? jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const service = new StorageMigrationService(system as never, prisma as never, storageConfig as never, jobs as never);
  return { service, db, system, prisma, storageConfig, jobs };
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed on storage_migration_runs_active_uniq_idx'), {
    code: 'P2002',
    meta: { target: 'storage_migration_runs_active_uniq_idx' },
  });
}

describe('StorageMigrationService.start', () => {
  it('creates a pending run, queues one background planner job and audits it', async () => {
    const { service, db, jobs, prisma, system } = build();
    db.storageMigrationRun.create.mockResolvedValue(runRow({ status: 'pending' }));

    const run = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, 'user-1');

    expect(system.asSystem).toHaveBeenCalledWith(STORAGE_MIGRATION_SYSTEM_ACCESS_REASON);
    expect(db.storageMigrationRun.create).toHaveBeenCalledWith({
      data: { sourceProvider: 's3', targetProvider: 'r2', status: 'pending', startedById: 'user-1' },
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: STORAGE_MIGRATE_PLAN_TYPE,
        subjectId: 'run-1',
        payload: { runId: 'run-1' },
        priority: STORAGE_MIGRATION_PRIORITY,
        orgId: null,
        skipDedup: true,
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'storage.migration.start', targetId: 'run-1' }) }),
    );
    expect(run).toMatchObject({ id: 'run-1', status: 'pending', totalCount: 0, pendingCount: 0 });
  });

  it('refuses an unknown driver, an unconfigured source or target, and the same bucket on both sides', async () => {
    const unknown = build();
    await expect(unknown.service.start({ sourceProvider: 'nope', targetProvider: 'r2' }, 'u')).rejects.toMatchObject({
      response: { details: { reason: 'UNKNOWN_DRIVER' } },
    });

    const noTarget = build({
      resolveDriver: jest.fn(async (id: string) => (id === 's3' ? configured('a') : { configured: false, provider: id, missing: ['bucket'] })),
    });
    await expect(noTarget.service.start({ sourceProvider: 's3', targetProvider: 'r2' }, 'u')).rejects.toMatchObject({
      response: { details: { reason: 'TARGET_NOT_CONFIGURED', missing: ['bucket'] } },
    });

    const noSource = build({ resolveDriver: jest.fn(async (id: string) => ({ configured: false, provider: id, missing: ['secretAccessKey'] })) });
    await expect(noSource.service.start({ sourceProvider: 's3', targetProvider: 'r2' }, 'u')).rejects.toMatchObject({
      response: { details: { reason: 'SOURCE_NOT_CONFIGURED' } },
    });

    const same = build({ resolveDriver: jest.fn(async () => configured('shared')) });
    await expect(same.service.start({ sourceProvider: 's3', targetProvider: 's3compatible' }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    expect(same.db.storageMigrationRun.create).not.toHaveBeenCalled();
  });

  it('turns the one-active-run index violation into a 409 naming the active run at details.activeRunId', async () => {
    const { service, db, jobs } = build();
    db.storageMigrationRun.create.mockRejectedValue(p2002());
    db.storageMigrationRun.findFirst.mockResolvedValue({ id: 'active-run' });

    const error = await service.start({ sourceProvider: 's3', targetProvider: 'r2' }, 'u').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ details: { activeRunId: 'active-run' } });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('fails the run (freeing the slot) when the planner cannot be queued', async () => {
    const { service, db } = build({ enqueue: jest.fn().mockRejectedValue(new Error('queue down')) });
    db.storageMigrationRun.create.mockResolvedValue(runRow({ status: 'pending' }));

    await expect(service.start({ sourceProvider: 's3', targetProvider: 'r2' }, 'u')).rejects.toThrow('queue down');
    expect(db.storageMigrationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1', status: { in: ['pending', 'running'] } }, data: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});

describe('StorageMigrationService.cancel', () => {
  it('flips an active run to cancelled and skips its queued items', async () => {
    const { service, db } = build();
    db.storageMigrationRun.findUnique.mockResolvedValue(runRow({ status: 'cancelled' }));

    const run = await service.cancel('run-1', 'admin-1');

    expect(db.storageMigrationRun.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'run-1', status: { in: ['pending', 'running'] } },
      data: { status: 'cancelled', cancelledById: 'admin-1' },
    });
    expect(db.storageMigrationItem.updateMany).toHaveBeenCalledWith({
      where: { runId: 'run-1', status: 'pending' },
      data: { status: 'skipped', lastError: 'Run cancelled' },
    });
    expect(run.status).toBe('cancelled');
  });

  it('answers 409 for a finished run and 404 for a missing one', async () => {
    const finished = build();
    finished.db.storageMigrationRun.updateMany.mockResolvedValue({ count: 0 });
    finished.db.storageMigrationRun.findUnique.mockResolvedValue({ status: 'completed' });
    await expect(finished.service.cancel('run-1', 'a')).rejects.toBeInstanceOf(ConflictException);

    const missing = build();
    missing.db.storageMigrationRun.updateMany.mockResolvedValue({ count: 0 });
    missing.db.storageMigrationRun.findUnique.mockResolvedValue(null);
    await expect(missing.service.cancel('run-1', 'a')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('StorageMigrationService counts and finalization', () => {
  const groups = (db: FakeDb, rows: Array<[string, number]>) =>
    db.storageMigrationItem.groupBy.mockResolvedValue(rows.map(([status, n]) => ({ runId: 'run-1', status, _count: { _all: n } })));

  it('derives the run counts from the items on every read', async () => {
    const { service, db } = build();
    db.storageMigrationRun.findUnique.mockResolvedValue(runRow());
    groups(db, [['migrated', 3], ['failed', 1], ['skipped', 2], ['pending', 4], ['copying', 1]]);

    await expect(service.get('run-1')).resolves.toMatchObject({
      totalCount: 11,
      migratedCount: 3,
      failedCount: 1,
      skippedCount: 2,
      pendingCount: 5,
    });
  });

  it('does not finalize while any item is pending or copying', async () => {
    const { service, db } = build();
    groups(db, [['migrated', 3], ['copying', 1]]);
    await expect(service.finalizeIfDone('run-1')).resolves.toBeNull();
    expect(db.storageMigrationRun.updateMany).not.toHaveBeenCalled();
  });

  it('finalizes with ONE conditional update (running and planned), completed or failed', async () => {
    const ok = build();
    groups(ok.db, [['migrated', 3], ['skipped', 1]]);
    await expect(ok.service.finalizeIfDone('run-1')).resolves.toBe('completed');
    expect(ok.db.storageMigrationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'running', plannedAt: { not: null } },
      data: expect.objectContaining({ status: 'completed', totalCount: 4, migratedCount: 3, skippedCount: 1, failedCount: 0 }),
    });

    const bad = build();
    groups(bad.db, [['migrated', 3], ['failed', 1]]);
    await expect(bad.service.finalizeIfDone('run-1')).resolves.toBe('failed');

    const lost = build();
    groups(lost.db, [['migrated', 1]]);
    lost.db.storageMigrationRun.updateMany.mockResolvedValue({ count: 0 });
    await expect(lost.service.finalizeIfDone('run-1')).resolves.toBeNull();
  });

  it('lists newest first with a page meta', async () => {
    const { service, db } = build();
    db.storageMigrationRun.findMany.mockResolvedValue([runRow()]);
    db.storageMigrationRun.count.mockResolvedValue(21);

    const page = await service.list({ page: 2, pageSize: 10 });

    expect(db.storageMigrationRun.findMany).toHaveBeenCalledWith({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 10, take: 10 });
    expect(page.meta).toEqual({ page: 2, pageSize: 10, totalItems: 21, totalPages: 3 });
  });
});

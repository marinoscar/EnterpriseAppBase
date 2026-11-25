// =============================================================================
// Unit tests for the two storage-migration job handlers and their settled
// listener (issue #1093)
// =============================================================================

import { Readable } from 'node:stream';

import type { Job } from '../../../src/jobs/data/jobs-db';
import { JobHandlerRegistry } from '../../../src/jobs/index';
import { StorageMigrateObjectHandler } from '../../../src/storage/migration/storage-migrate-object.handler';
import { StorageMigratePlanHandler } from '../../../src/storage/migration/storage-migrate-plan.handler';
import { StorageMigrationSettledListener } from '../../../src/storage/migration/storage-migration-settled.listener';
import {
  STORAGE_MIGRATE_OBJECT_TYPE,
  STORAGE_MIGRATE_PLAN_TYPE,
  STORAGE_MIGRATION_ITEM_SUBJECT_TYPE,
  STORAGE_MIGRATION_RUN_SUBJECT_TYPE,
} from '../../../src/storage/migration/storage-migration.constants';
import { fakeMigrations, fakeSystemDb, runRow } from './fakes';

const ORG = '11111111-1111-4111-8111-111111111111';
const BYTES = Buffer.from('migration bytes');

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: STORAGE_MIGRATE_OBJECT_TYPE,
    orgId: ORG,
    payload: { runId: 'run-1', itemId: 'item-1' },
    subjectType: STORAGE_MIGRATION_ITEM_SUBJECT_TYPE,
    subjectId: 'item-1',
    ...overrides,
  } as Job;
}

const object = (overrides: Record<string, unknown> = {}) => ({
  id: 'obj-1',
  storageKey: 'uploads/org/obj-1.bin',
  mimeType: 'application/octet-stream',
  size: BigInt(BYTES.length),
  storageProvider: 's3',
  bucket: 'old',
  status: 'ready',
  orgId: ORG,
  ...overrides,
});

function objectHandler(options: { tx?: ReturnType<typeof fakeSystemDb>; run?: Record<string, unknown> | null; configured?: boolean } = {}) {
  const db = fakeSystemDb();
  db.storageMigrationRun.findUnique.mockResolvedValue(options.run === undefined ? runRow() : options.run);
  const tx = options.tx ?? fakeSystemDb();
  const migrations = fakeMigrations(db);
  const jobScope = { run: jest.fn((_job: Job, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const written: Buffer[] = [];
  const source = { download: jest.fn(async () => Readable.from([BYTES])), getBucket: () => 'old' };
  const target = {
    upload: jest.fn(async (_key: string, stream: Readable) => {
      for await (const chunk of stream) written.push(chunk as Buffer);
      return { key: _key, bucket: 'new', location: _key };
    }),
    download: jest.fn(async () => Readable.from([Buffer.concat(written)])),
    getBucket: () => 'new',
  };
  const router = { forObject: jest.fn(async () => source), forLocation: jest.fn(async () => target) };
  const storageConfig = {
    resolveDriver: jest.fn(async () => (options.configured === false ? { configured: false, missing: ['bucket'] } : { configured: true })),
  };
  const handler = new StorageMigrateObjectHandler(
    new JobHandlerRegistry(),
    migrations as never,
    jobScope as never,
    router as never,
    storageConfig as never,
  );
  return { handler, db, tx, migrations, jobScope, source, target, router };
}

describe('StorageMigrateObjectHandler', () => {
  it('is server-only: no node result schema and no persistNodeResult', () => {
    const { handler } = objectHandler();
    expect(handler.type).toBe('storage.migrate_object');
    expect((handler as { nodeResultSchema?: unknown }).nodeResultSchema).toBeUndefined();
    expect((handler as { persistNodeResult?: unknown }).persistNodeResult).toBeUndefined();
  });

  it('copies, verifies, then repoints the row guarded on its source location, and never deletes the source', async () => {
    const t = objectHandler();
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'pending' });
    t.tx.storageObject.findUnique.mockResolvedValue(object());
    t.tx.storageObject.updateMany.mockResolvedValue({ count: 1 });
    (t.source as Record<string, unknown>).delete = jest.fn();

    await t.handler.process(job());

    expect(t.target.upload).toHaveBeenCalledWith('uploads/org/obj-1.bin', expect.any(Readable), expect.objectContaining({ contentLength: BYTES.length }));
    expect(t.target.download).toHaveBeenCalled();
    expect(t.tx.storageObject.updateMany).toHaveBeenCalledWith({
      where: { id: 'obj-1', storageProvider: 's3', storageKey: 'uploads/org/obj-1.bin' },
      data: { storageProvider: 'r2', bucket: 'new' },
    });
    expect(t.tx.storageMigrationItem.update).toHaveBeenLastCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ status: 'migrated', sizeBytes: BigInt(BYTES.length), checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    });
    expect((t.source as unknown as Record<string, jest.Mock>).delete).not.toHaveBeenCalled();
    expect(t.migrations.finalizeIfDone).toHaveBeenCalledWith('run-1');
    expect(t.jobScope.run).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG }), expect.any(Function));
  });

  it('skips without copying when the run was cancelled', async () => {
    const t = objectHandler({ run: runRow({ status: 'cancelled' }) });
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'pending' });

    await t.handler.process(job());

    expect(t.source.download).not.toHaveBeenCalled();
    expect(t.tx.storageMigrationItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { status: 'skipped', lastError: 'Run cancelled' } });
  });

  it('skips an object that is no longer on the source (a re-run never copies it twice)', async () => {
    const t = objectHandler();
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'pending' });
    t.tx.storageObject.findUnique.mockResolvedValue(object({ storageProvider: 'r2' }));

    await t.handler.process(job());

    expect(t.source.download).not.toHaveBeenCalled();
    expect(t.tx.storageMigrationItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'skipped' }) }));
  });

  it('does nothing for an item that already finished (a retried or duplicate job)', async () => {
    const t = objectHandler();
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'migrated' });

    await t.handler.process(job());

    expect(t.source.download).not.toHaveBeenCalled();
    expect(t.tx.storageMigrationItem.update).not.toHaveBeenCalled();
  });

  it('does not repoint an object that changed while it was being copied', async () => {
    const t = objectHandler();
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'copying' });
    t.tx.storageObject.findUnique.mockResolvedValue(object());
    t.tx.storageObject.updateMany.mockResolvedValue({ count: 0 });

    await t.handler.process(job());

    expect(t.tx.storageMigrationItem.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'skipped' }) }));
  });

  it('throws (so the queue retries) when a driver is not configured, before reading any byte', async () => {
    const t = objectHandler({ configured: false });
    t.tx.storageMigrationItem.findUnique.mockResolvedValue({ id: 'item-1', objectId: 'obj-1', status: 'pending' });
    t.tx.storageObject.findUnique.mockResolvedValue(object());

    await expect(t.handler.process(job())).rejects.toThrow(/not configured/);
    expect(t.source.download).not.toHaveBeenCalled();
  });
});

describe('StorageMigratePlanHandler', () => {
  function plan(run = runRow({ status: 'pending' })) {
    const db = fakeSystemDb();
    db.storageMigrationRun.findUnique.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { status: 'running' } : run,
    );
    const migrations = fakeMigrations(db);
    let n = 0;
    const jobs = { enqueue: jest.fn(async () => ({ id: `job-${++n}` })) };
    const handler = new StorageMigratePlanHandler(new JobHandlerRegistry(), migrations as never, jobs as never);
    return { handler, db, migrations, jobs };
  }

  const planJob = () => job({ type: STORAGE_MIGRATE_PLAN_TYPE, orgId: null, payload: { runId: 'run-1' }, subjectType: STORAGE_MIGRATION_RUN_SUBJECT_TYPE, subjectId: 'run-1' });

  it('creates one item per ready object on the source, queues one job per item in its organization, then marks the run planned', async () => {
    const t = plan();
    t.db.storageObject.findMany.mockResolvedValueOnce([
      { id: 'o1', orgId: ORG, size: 5n },
      { id: 'o2', orgId: 'org-b', size: 7n },
    ]);
    t.db.storageMigrationItem.findMany.mockResolvedValueOnce([
      { id: 'i1', objectId: 'o1', orgId: ORG },
      { id: 'i2', objectId: 'o2', orgId: 'org-b' },
    ]);
    t.db.storageMigrationItem.count.mockResolvedValue(2);

    await t.handler.process(planJob());

    expect(t.db.storageObject.findMany.mock.calls[0][0]).toMatchObject({ where: { storageProvider: 's3', status: 'ready' } });
    expect(t.db.storageMigrationItem.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(t.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(t.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: STORAGE_MIGRATE_OBJECT_TYPE, orgId: 'org-b', skipDedup: true, payload: { runId: 'run-1', itemId: 'i2' } }),
    );
    expect(t.db.storageMigrationItem.updateMany).toHaveBeenCalledWith({ where: { id: 'i1', jobId: null }, data: { jobId: 'job-1' } });
    expect(t.db.storageMigrationRun.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'run-1', status: 'running' },
      data: { plannedAt: expect.any(Date), totalCount: 2 },
    });
    expect(t.migrations.finalizeIfDone).toHaveBeenCalledWith('run-1');
  });

  it('plans nothing for a run that is no longer active, and stops when cancelled mid-plan', async () => {
    const done = plan(runRow({ status: 'cancelled' }));
    await done.handler.process(planJob());
    expect(done.db.storageObject.findMany).not.toHaveBeenCalled();

    const cancelled = plan();
    cancelled.db.storageMigrationRun.findUnique.mockImplementation(async (args: { select?: unknown }) =>
      args.select ? { status: 'cancelled' } : runRow({ status: 'running' }),
    );
    await cancelled.handler.process(planJob());
    expect(cancelled.db.storageObject.findMany).not.toHaveBeenCalled();
    expect(cancelled.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('StorageMigrationSettledListener', () => {
  const event = (over: Record<string, unknown>) => ({ succeeded: false, lastError: 'boom', jobId: 'j', job: { payload: { runId: 'run-1' } }, ...over });

  it('fails the still-open item of an object job that gave up, and finalizes the run', async () => {
    const db = fakeSystemDb();
    const migrations = fakeMigrations(db);
    await new StorageMigrationSettledListener(migrations as never).onJobSettled(
      event({ type: STORAGE_MIGRATE_OBJECT_TYPE, subjectType: STORAGE_MIGRATION_ITEM_SUBJECT_TYPE, subjectId: 'item-1' }) as never,
    );
    expect(db.storageMigrationItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', status: { in: ['pending', 'copying'] } },
      data: { status: 'failed', lastError: 'boom' },
    });
    expect(migrations.finalizeIfDone).toHaveBeenCalledWith('run-1');
  });

  it('fails the run of a planner that gave up, and ignores successes and other job types', async () => {
    const migrations = fakeMigrations(fakeSystemDb());
    const listener = new StorageMigrationSettledListener(migrations as never);
    await listener.onJobSettled(event({ type: STORAGE_MIGRATE_PLAN_TYPE, subjectType: STORAGE_MIGRATION_RUN_SUBJECT_TYPE, subjectId: 'run-1' }) as never);
    expect(migrations.failRun).toHaveBeenCalledWith('run-1', 'The planner failed: boom');

    await listener.onJobSettled(event({ type: 'other.job', subjectType: 'x', subjectId: 'y' }) as never);
    await listener.onJobSettled(event({ type: STORAGE_MIGRATE_PLAN_TYPE, succeeded: true, subjectId: 'run-1' }) as never);
    expect(migrations.failRun).toHaveBeenCalledTimes(1);
  });
});

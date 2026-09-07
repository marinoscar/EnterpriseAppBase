// =============================================================================
// Unit tests for JobStuckService (issue #263, epic #254)
// =============================================================================
//
// THE SPLIT WITH `test/jobs/job-stuck-reset.db.spec.ts` IS DELIBERATE. That
// suite asks Postgres which rows the three recovery signals actually MATCH —
// a question a mock cannot answer, because a mocked `updateMany` returns
// whatever the test told it to regardless of the `where` it was handed. This
// suite covers what a real database makes awkward instead: the exact shape of
// that `where` (so a signal cannot be silently dropped in a refactor), the
// two-phase give-up/requeue split, the per-row failure message, and the
// settings fallbacks that only happen when a read throws.
// =============================================================================

import { ConfigService } from '@nestjs/config';

import { JobStuckService, stuckRunningWhere } from './job-stuck.service';
import { DEFAULT_SYSTEM_SETTINGS } from '../common/types/settings.types';
import type { PrismaService } from '../prisma/prisma.service';
import type { SystemSettingsService } from '../settings/system-settings/system-settings.service';

const THRESHOLD = new Date('2026-01-01T12:00:00.000Z');
const NOW = new Date('2026-01-01T12:30:00.000Z');

function makeService(overrides: {
  findMany?: jest.Mock;
  updateMany?: jest.Mock;
  config?: Record<string, unknown>;
  jobsPolicy?: jest.Mock;
}) {
  const findMany = overrides.findMany ?? jest.fn().mockResolvedValue([]);
  const updateMany = overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 0 });

  const prisma = { job: { findMany, updateMany } } as unknown as PrismaService;

  const config = {
    get: jest.fn((key: string) => (overrides.config ?? { 'jobs.maxAttempts': 3 })[key]),
  } as unknown as ConfigService;

  const systemSettings = {
    getJobsPolicy:
      overrides.jobsPolicy ??
      jest.fn().mockResolvedValue({
        history: { retentionDays: 30, purgeEnabled: true },
        stuckThresholdMinutes: 30,
      }),
  } as unknown as SystemSettingsService;

  return {
    service: new JobStuckService(prisma, config, systemSettings),
    findMany,
    updateMany,
    systemSettings,
  };
}

describe('stuckRunningWhere', () => {
  it('carries all three recovery signals, OR-ed, under status running', () => {
    const where = stuckRunningWhere(THRESHOLD, NOW);

    expect(where.status).toBe('running');
    expect(where.OR).toEqual([
      { startedAt: { lt: THRESHOLD } },
      { startedAt: null, createdAt: { lt: THRESHOLD } },
      { leaseExpiresAt: { lt: NOW } },
    ]);
  });

  it('ages the zombie signal by createdAt, since startedAt is null there', () => {
    // The signal that is easiest to lose in a refactor and impossible to
    // notice afterwards: `NULL < threshold` is NULL, never true, so a row
    // that is `running` with no `startedAt` is invisible to signal 1 and
    // (when the lease was never written either) to signal 3. Without this
    // arm it is stuck forever, holding its dedup key with it.
    const zombie = stuckRunningWhere(THRESHOLD, NOW).OR?.[1];

    expect(zombie).toEqual({ startedAt: null, createdAt: { lt: THRESHOLD } });
  });

  it('compares the lease against now and the ages against the threshold', () => {
    // Two different instants, deliberately: an expired lease is stuck NOW,
    // while an aged claim is stuck relative to the threshold. Collapsing them
    // to one instant either reaps live jobs or delays every dead lease by a
    // whole threshold.
    const where = stuckRunningWhere(THRESHOLD, NOW);

    expect(where.OR?.[0]).toEqual({ startedAt: { lt: THRESHOLD } });
    expect(where.OR?.[2]).toEqual({ leaseExpiresAt: { lt: NOW } });
  });
});

describe('JobStuckService.getStuckThresholdMinutes', () => {
  it('reads the value through the narrow system-settings accessor', async () => {
    const jobsPolicy = jest.fn().mockResolvedValue({
      history: { retentionDays: 30, purgeEnabled: true },
      stuckThresholdMinutes: 45,
    });
    const { service } = makeService({ jobsPolicy });

    await expect(service.getStuckThresholdMinutes()).resolves.toBe(45);
    expect(jobsPolicy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the shipped default when the settings read throws', async () => {
    // A cron tick has no caller to report to, and a settings blip is not a
    // reason to stop reaping.
    const jobsPolicy = jest.fn().mockRejectedValue(new Error('database is having a moment'));
    const { service } = makeService({ jobsPolicy });

    await expect(service.getStuckThresholdMinutes()).resolves.toBe(
      DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes
    );
  });

  it('falls back when the stored value is not a usable number', async () => {
    const jobsPolicy = jest.fn().mockResolvedValue({
      history: { retentionDays: 30, purgeEnabled: true },
      stuckThresholdMinutes: Number.NaN,
    });
    const { service } = makeService({ jobsPolicy });

    await expect(service.getStuckThresholdMinutes()).resolves.toBe(
      DEFAULT_SYSTEM_SETTINGS.jobs.stuckThresholdMinutes
    );
  });
});

describe('JobStuckService.resetStuck', () => {
  it('fails the rows at or over the attempt cap, one at a time, naming their own count', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'job-a', type: 'example.echo', attempts: 3 },
      { id: 'job-b', type: 'example.echo', attempts: 7 },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({ findMany, updateMany });

    const result = await service.resetStuck();

    // Two give-up updates plus the single requeue sweep.
    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(result.failed).toBe(2);

    const [first] = updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    const [second] = updateMany.mock.calls[1] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];

    expect(first.where).toMatchObject({ id: 'job-a', status: 'running' });
    expect(first.data).toMatchObject({
      status: 'failed',
      scheduledFor: null,
      claimedByNodeId: null,
      leaseExpiresAt: null,
    });

    // THE REASON THE PHASE IS ONE ROW AT A TIME: each message carries that
    // job's own attempt count, which a bulk update could not do.
    expect(String(first.data.lastError)).toContain('after 3 attempt(s)');
    expect(String(second.data.lastError)).toContain('after 7 attempt(s)');

    // `executor` is NOT cleared on the terminal row — which side the job died
    // on is exactly what you want to still know later.
    expect(first.data).not.toHaveProperty('executor');
  });

  it('requeues the rows still under budget with claim, lease and executor released', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 4 });
    const { service } = makeService({ updateMany });

    const result = await service.resetStuck();

    expect(result).toEqual({ reset: 4, failed: 0 });

    const [requeue] = updateMany.mock.calls[0] as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];

    expect(requeue.where).toMatchObject({ status: 'running', attempts: { lt: 3 } });
    expect(requeue.data).toEqual({
      status: 'pending',
      claimedByNodeId: null,
      leaseExpiresAt: null,
      executor: null,
      scheduledFor: null,
      finishedAt: null,
      lastError: expect.any(String),
    });
  });

  it('never touches attempts, in either phase', async () => {
    // The claim-time charge is the ONLY evidence a poison pill leaves behind
    // — the executor died before anything could count the failure — so the
    // reaper must not spend it, refund it, or reset it.
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'job-a', type: 'example.echo', attempts: 3 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({ findMany, updateMany });

    await service.resetStuck();

    for (const call of updateMany.mock.calls) {
      const [{ data }] = call as [{ data: Record<string, unknown> }];
      expect(data).not.toHaveProperty('attempts');
    }
  });

  it('splits the two phases on the configured attempt cap', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = makeService({
      findMany,
      updateMany,
      config: { 'jobs.maxAttempts': 5 },
    });

    await service.resetStuck();

    expect(findMany.mock.calls[0][0].where).toMatchObject({ attempts: { gte: 5 } });
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ attempts: { lt: 5 } });
  });

  it('degrades to the shipped attempt cap when the config key is missing', async () => {
    // A stub `ConfigService` returning `undefined` must not produce `NaN`,
    // which would make every comparison false and silently disable the
    // give-up phase.
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ findMany, config: {} });

    await service.resetStuck();

    expect(findMany.mock.calls[0][0].where).toMatchObject({ attempts: { gte: 3 } });
  });

  it('honours an explicit olderThanMinutes instead of reading settings', async () => {
    const jobsPolicy = jest.fn();
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ findMany, jobsPolicy });

    const before = Date.now();
    await service.resetStuck(10);
    const after = Date.now();

    expect(jobsPolicy).not.toHaveBeenCalled();

    const where = findMany.mock.calls[0][0].where as {
      OR: [{ startedAt: { lt: Date } }, unknown, unknown];
    };
    const threshold = where.OR[0].startedAt.lt.getTime();

    expect(threshold).toBeGreaterThanOrEqual(before - 10 * 60_000);
    expect(threshold).toBeLessThanOrEqual(after - 10 * 60_000);
  });

  it('judges every row in a sweep against the same pair of instants', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'job-a', type: 'example.echo', attempts: 9 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({ findMany, updateMany });

    await service.resetStuck();

    const readWhere = findMany.mock.calls[0][0].where as { OR: unknown[] };
    const failWhere = (updateMany.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    const requeueWhere = (updateMany.mock.calls[1][0] as { where: { OR: unknown[] } }).where;

    expect(failWhere.OR).toEqual(readWhere.OR);
    expect(requeueWhere.OR).toEqual(readWhere.OR);
  });

  it('counts only the give-up updates that actually matched a row', async () => {
    // A job settled by an executor that turned out to be alive after all
    // fails the re-asserted `where`, so nothing is stamped over its terminal
    // row and nothing is counted.
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'job-a', type: 'example.echo', attempts: 3 }]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const { service } = makeService({ findMany, updateMany });

    await expect(service.resetStuck()).resolves.toEqual({ reset: 0, failed: 0 });
  });
});

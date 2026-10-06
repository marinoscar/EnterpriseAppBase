import type { Job } from '@prisma/client';

import { DEFAULT_SYSTEM_SETTINGS } from '../../common/types/settings.types';
import { RETENTION_PURGE_BATCH_SIZE } from '../../common/retention/batched-purge';
import { AI_RUNS_PURGE_TYPE, AiRunsPurgeHandler } from './ai-runs-purge.handler';

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB = { id: 'job-1', type: AI_RUNS_PURGE_TYPE } as Job;

describe('AiRunsPurgeHandler', () => {
  let findMany: jest.Mock;
  let deleteMany: jest.Mock;
  let getRetentionPolicy: jest.Mock;
  let register: jest.Mock;
  let handler: AiRunsPurgeHandler;

  const rows = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
  const withPolicy = (policy: { enabled: boolean; days: number }) => ({
    ...structuredClone(DEFAULT_SYSTEM_SETTINGS.retention),
    aiRuns: policy,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-06T01:00:00.000Z') });
    findMany = jest.fn().mockResolvedValue([]);
    deleteMany = jest.fn(async ({ where }) => ({ count: where.id.in.length }));
    getRetentionPolicy = jest.fn().mockResolvedValue(withPolicy({ enabled: true, days: 90 }));
    register = jest.fn();
    handler = new AiRunsPurgeHandler(
      { register } as never,
      { aiRun: { findMany, deleteMany } } as never,
      { getRetentionPolicy } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('self-registers as a server-only type with the declared profile', () => {
    handler.onModuleInit();

    expect(register).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe('ai.runs.purge');
    expect(handler.profile).toEqual({ maxRuntimeMs: 1_800_000, maxAttempts: 3 });
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
  });

  it('reads ids older than now - days that are terminal, oldest first, and deletes exactly those', async () => {
    findMany
      .mockResolvedValueOnce(rows(RETENTION_PURGE_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(rows(2, 'b'));

    await handler.process(JOB);

    const cutoff = new Date(Date.now() - 90 * DAY_MS);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff }, status: { in: ['succeeded', 'failed', 'cancelled'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: RETENTION_PURGE_BATCH_SIZE,
    });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany.mock.calls[1][0]).toEqual({ where: { id: { in: ['b-0', 'b-1'] } } });
  });

  it('uses the configured retention days', async () => {
    getRetentionPolicy.mockResolvedValue(withPolicy({ enabled: true, days: 7 }));

    await handler.process(JOB);

    expect(findMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date(Date.now() - 7 * DAY_MS));
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('never selects a pending or running row, at any age', async () => {
    getRetentionPolicy.mockResolvedValue(withPolicy({ enabled: true, days: 1 }));

    await handler.process(JOB);

    const where = findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['succeeded', 'failed', 'cancelled']);
    for (const status of ['pending', 'running']) {
      expect(where.status.in).not.toContain(status);
    }
  });

  it('is a no-op while its policy is disabled, even when queued by hand', async () => {
    getRetentionPolicy.mockResolvedValue(withPolicy({ enabled: false, days: 90 }));

    await expect(handler.process(JOB)).resolves.toBeUndefined();

    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('ignores the other three policies', async () => {
    getRetentionPolicy.mockResolvedValue({
      notifications: { enabled: false, days: 1 },
      notificationDeliveries: { enabled: false, days: 1 },
      auditEvents: { enabled: false, days: 1 },
      aiRuns: { enabled: false, days: 1 },
      aiRuns: { enabled: true, days: 30 },
    });

    await handler.process(JOB);

    expect(findMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date(Date.now() - 30 * DAY_MS));
  });

  it('lets a database error escape so the queue retries', async () => {
    findMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(handler.process(JOB)).rejects.toThrow('connection reset');
  });
});

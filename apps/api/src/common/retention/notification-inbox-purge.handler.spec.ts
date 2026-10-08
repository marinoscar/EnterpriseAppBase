import type { Job } from '@prisma/client';

import { DEFAULT_SYSTEM_SETTINGS } from '../types/settings.types';
import { RETENTION_PURGE_BATCH_SIZE } from './batched-purge';
import { NOTIFICATION_INBOX_PURGE_TYPE, NotificationInboxPurgeHandler } from './notification-inbox-purge.handler';

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB = { id: 'job-1', type: NOTIFICATION_INBOX_PURGE_TYPE } as Job;

describe('NotificationInboxPurgeHandler', () => {
  let findMany: jest.Mock;
  let deleteMany: jest.Mock;
  let getRetentionPolicy: jest.Mock;
  let register: jest.Mock;
  let handler: NotificationInboxPurgeHandler;

  const rows = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
  const withPolicy = (policy: { enabled: boolean; days: number }) => ({
    ...structuredClone(DEFAULT_SYSTEM_SETTINGS.retention),
    notifications: policy,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-06T01:00:00.000Z') });
    findMany = jest.fn().mockResolvedValue([]);
    deleteMany = jest.fn(async ({ where }) => ({ count: where.id.in.length }));
    getRetentionPolicy = jest.fn().mockResolvedValue(withPolicy({ enabled: true, days: 180 }));
    register = jest.fn();
    handler = new NotificationInboxPurgeHandler(
      { register } as never,
      { notification: { findMany, deleteMany } } as never,
      { getRetentionPolicy } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('self-registers as a server-only type with the declared profile', () => {
    handler.onModuleInit();

    expect(register).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe('notifications.inbox.purge');
    expect(handler.profile).toEqual({ maxRuntimeMs: 1_800_000, maxAttempts: 3 });
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
  });

  it('reads ids older than now - days, read or unread, oldest first, and deletes exactly those', async () => {
    findMany
      .mockResolvedValueOnce(rows(RETENTION_PURGE_BATCH_SIZE, 'a'))
      .mockResolvedValueOnce(rows(2, 'b'));

    await handler.process(JOB);

    const cutoff = new Date(Date.now() - 180 * DAY_MS);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
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

  it('is a no-op while its policy is disabled, even when queued by hand', async () => {
    getRetentionPolicy.mockResolvedValue(withPolicy({ enabled: false, days: 180 }));

    await expect(handler.process(JOB)).resolves.toBeUndefined();

    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('ignores the other three policies', async () => {
    const allOff = {
      notifications: { enabled: false, days: 1 },
      notificationDeliveries: { enabled: false, days: 1 },
      auditEvents: { enabled: false, days: 1 },
      aiRuns: { enabled: false, days: 1 },
    };
    getRetentionPolicy.mockResolvedValue({ ...allOff, notifications: { enabled: true, days: 30 } });

    await handler.process(JOB);

    expect(findMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date(Date.now() - 30 * DAY_MS));
  });

  it('lets a database error escape so the queue retries', async () => {
    findMany.mockRejectedValueOnce(new Error('connection reset'));

    await expect(handler.process(JOB)).rejects.toThrow('connection reset');
  });
});

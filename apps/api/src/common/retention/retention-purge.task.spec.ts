import { DEFAULT_SYSTEM_SETTINGS } from '../types/settings.types';
import { AI_RUNS_PURGE_TYPE } from '../../ai/runtime/ai-runs-purge.handler';
import { NOTIFICATION_DELIVERIES_PURGE_TYPE } from '../../notifications/retention/notification-deliveries-purge.handler';
import { NOTIFICATION_INBOX_PURGE_TYPE } from '../../notifications/retention/notification-inbox-purge.handler';
import { AUDIT_EVENTS_PURGE_TYPE } from './audit-events-purge.handler';
import { RETENTION_PURGES, RetentionPurgeTask } from './retention-purge.task';

const ALL_ON = {
  notifications: { enabled: true, days: 180 },
  notificationDeliveries: { enabled: true, days: 90 },
  auditEvents: { enabled: true, days: 365 },
  aiRuns: { enabled: true, days: 90 },
};

describe('RetentionPurgeTask', () => {
  let findFirst: jest.Mock;
  let enqueue: jest.Mock;
  let getRetentionPolicy: jest.Mock;
  let task: RetentionPurgeTask;

  const enqueuedTypes = () => enqueue.mock.calls.map(([arg]) => arg.type);

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(null);
    enqueue = jest.fn(async ({ type }) => ({ id: `job-${type}` }));
    getRetentionPolicy = jest.fn().mockResolvedValue(ALL_ON);
    task = new RetentionPurgeTask(
      { enqueue } as never,
      { job: { findFirst } } as never,
      { getRetentionPolicy } as never,
    );
  });

  it('maps each policy to the type its handler exports', () => {
    expect(RETENTION_PURGES.map(({ policy, type }) => [policy, type])).toEqual([
      ['notifications', NOTIFICATION_INBOX_PURGE_TYPE],
      ['notificationDeliveries', NOTIFICATION_DELIVERIES_PURGE_TYPE],
      ['auditEvents', AUDIT_EVENTS_PURGE_TYPE],
      ['aiRuns', AI_RUNS_PURGE_TYPE],
    ]);
    expect(RETENTION_PURGES.map(({ policy }) => policy).sort()).toEqual(
      Object.keys(DEFAULT_SYSTEM_SETTINGS.retention).sort(),
    );
  });

  it('enqueues one global, low-priority job per enabled policy', async () => {
    await task.handleCron();

    expect(enqueue).toHaveBeenCalledTimes(4);
    for (const type of [
      'notifications.inbox.purge',
      'notifications.deliveries.purge',
      'audit.events.purge',
      'ai.runs.purge',
    ]) {
      expect(enqueue).toHaveBeenCalledWith({ type, reason: 'backfill', priority: 100, orgId: null });
    }
  });

  it('enqueues nothing for a disabled policy (the shipped defaults leave audit off)', async () => {
    getRetentionPolicy.mockResolvedValue(DEFAULT_SYSTEM_SETTINGS.retention);

    await task.handleCron();

    expect(enqueuedTypes()).toEqual([
      'notifications.inbox.purge',
      'notifications.deliveries.purge',
      'ai.runs.purge',
    ]);
  });

  it('enqueues nothing at all when every policy is disabled', async () => {
    getRetentionPolicy.mockResolvedValue({
      notifications: { enabled: false, days: 1 },
      notificationDeliveries: { enabled: false, days: 1 },
      auditEvents: { enabled: false, days: 1 },
      aiRuns: { enabled: false, days: 1 },
    });

    await task.handleCron();

    expect(enqueue).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('skips a type whose purge is already pending or running, and still queues the others', async () => {
    findFirst.mockImplementation(async ({ where }) =>
      where.type === AUDIT_EVENTS_PURGE_TYPE ? { id: 'job-0', status: 'running' } : null,
    );

    await task.handleCron();

    expect(enqueuedTypes()).not.toContain(AUDIT_EVENTS_PURGE_TYPE);
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('keeps going when one enqueue fails, and never throws', async () => {
    enqueue.mockImplementation(async ({ type }) => {
      if (type === NOTIFICATION_INBOX_PURGE_TYPE) throw new Error('db down');
      return { id: `job-${type}` };
    });

    await expect(task.handleCron()).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(4);
  });

  it('never throws when the settings read fails, and enqueues nothing', async () => {
    getRetentionPolicy.mockRejectedValue(new Error('settings unreadable'));

    await expect(task.handleCron()).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

import { RETENTION_POLICY_KEYS } from '@marinoscar/platform-contract/jobs';

import { RetentionPurgeRegistry } from './retention-purge.registry';
import { RetentionPurgeTask } from './retention-purge.task';
import { RETENTION_SYSTEM_SETTINGS } from './retention.system-settings';

const NOTIFICATION_INBOX_PURGE_TYPE = 'notifications.inbox.purge';
const NOTIFICATION_DELIVERIES_PURGE_TYPE = 'notifications.deliveries.purge';
const AUDIT_EVENTS_PURGE_TYPE = 'audit.events.purge';
const AI_RUNS_PURGE_TYPE = 'ai.runs.purge';

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
  let purges: RetentionPurgeRegistry;
  let task: RetentionPurgeTask;

  const enqueuedTypes = () => enqueue.mock.calls.map(([arg]) => arg.type);

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(null);
    enqueue = jest.fn(async ({ type }) => ({ id: `job-${type}` }));
    getRetentionPolicy = jest.fn().mockResolvedValue(ALL_ON);
    // Registered out of order on purpose: the scheduler lists them in key order.
    purges = new RetentionPurgeRegistry();
    purges.register({ policy: 'aiRuns', type: AI_RUNS_PURGE_TYPE, what: 'AI run purge' });
    purges.register({ policy: 'auditEvents', type: AUDIT_EVENTS_PURGE_TYPE, what: 'audit log purge' });
    purges.register({
      policy: 'notificationDeliveries',
      type: NOTIFICATION_DELIVERIES_PURGE_TYPE,
      what: 'delivery log purge',
    });
    purges.register({ policy: 'notifications', type: NOTIFICATION_INBOX_PURGE_TYPE, what: 'notification inbox purge' });
    task = new RetentionPurgeTask(
      { enqueue } as never,
      { job: { findFirst } } as never,
      { getRetentionPolicy } as never,
      purges,
    );
  });

  it('lists the purges in the namespace key order, one per policy key', () => {
    expect(purges.list().map(({ policy, type }) => [policy, type])).toEqual([
      ['notifications', NOTIFICATION_INBOX_PURGE_TYPE],
      ['notificationDeliveries', NOTIFICATION_DELIVERIES_PURGE_TYPE],
      ['auditEvents', AUDIT_EVENTS_PURGE_TYPE],
      ['aiRuns', AI_RUNS_PURGE_TYPE],
    ]);
    expect(purges.list().map(({ policy }) => policy)).toEqual([...RETENTION_POLICY_KEYS]);
    expect(Object.keys(RETENTION_SYSTEM_SETTINGS.defaults)).toEqual([...RETENTION_POLICY_KEYS]);
  });

  it('enqueues only the purges whose handler is mounted', async () => {
    const partial = new RetentionPurgeRegistry();
    partial.register({ policy: 'auditEvents', type: AUDIT_EVENTS_PURGE_TYPE, what: 'audit log purge' });
    task = new RetentionPurgeTask(
      { enqueue } as never,
      { job: { findFirst } } as never,
      { getRetentionPolicy } as never,
      partial,
    );

    await task.handleCron();

    expect(enqueuedTypes()).toEqual([AUDIT_EVENTS_PURGE_TYPE]);
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
    getRetentionPolicy.mockResolvedValue(RETENTION_SYSTEM_SETTINGS.defaults);

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

import { join } from 'node:path';

import { OnEvent } from '@nestjs/event-emitter';

import { JOB_SETTLED_EVENT, JobSettledEvent } from '../../src/jobs/index';
import { NODE_EVENT_REPORTED, NODE_OFFLINE_EVENT, NodeEventReportedEvent, NodeOfflineEvent } from '../../src/nodes/index';
import { runPlatformConformance } from '../../src/testing/index';
import '../../src/jobs/testing/index';
import { WebhookPurgeTask } from '../../src/webhooks/tasks/webhook-purge.task';
import { WebhookEventListeners } from '../../src/webhooks/listeners/webhook-event.listeners';
import { WebhookPurgeHandler, WEBHOOK_PURGE_JOB_TYPE, WebhooksService } from '../../src/webhooks/index';
import { createWebhooksTestKit } from '../../src/webhooks/testing/index';

const SLICE_ROOT = join(__dirname, '..', '..', 'src', 'webhooks');

function listeners(enqueueFanout = jest.fn().mockResolvedValue('event-id')) {
  const webhooks = { enqueueFanout } as unknown as WebhooksService;
  return { listeners: new WebhookEventListeners(webhooks), enqueueFanout };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    type: 'example.task',
    status: 'failed',
    subjectType: 'thing',
    subjectId: 't1',
    orgId: null,
    attempts: 3,
    lastError: 'Connection refused',
    finishedAt: new Date('2026-11-01T10:00:00Z'),
    ...overrides,
  } as never;
}

describe('WebhookEventListeners (enqueue only)', () => {
  it('bridges nodes.node.offline to a fan-out job, never to a delivery', async () => {
    const { listeners: l, enqueueFanout } = listeners();
    l.onNodeOffline(new NodeOfflineEvent('n1', 'builder-1', new Date('2026-11-01T09:00:00Z'), new Date('2026-11-01T10:00:00Z'), 5));
    await flush();
    expect(enqueueFanout).toHaveBeenCalledWith(
      'nodes.node.offline',
      { nodeId: 'n1', nodeName: 'builder-1', lastHeartbeatAt: '2026-11-01T09:00:00.000Z', markedOfflineAt: '2026-11-01T10:00:00.000Z', staleAfterMinutes: 5 },
      { orgId: null },
    );
  });

  it('bridges nodes.node.event, without the owner id', async () => {
    const { listeners: l, enqueueFanout } = listeners();
    l.onNodeEvent(new NodeEventReportedEvent('n1', 'builder-1', 'user-1', 'disk.low', 'warning', { freeGb: 3 }, new Date('2026-11-01T10:00:00Z')));
    await flush();
    const [key, data] = enqueueFanout.mock.calls[0]!;
    expect(key).toBe('nodes.node.event');
    expect(data).toEqual({ nodeId: 'n1', nodeName: 'builder-1', type: 'disk.low', severity: 'warning', attrs: { freeGb: 3 }, occurredAt: '2026-11-01T10:00:00.000Z' });
    expect(JSON.stringify(data)).not.toContain('user-1');
  });

  it('bridges a job that failed for good, truncating its error', async () => {
    const { listeners: l, enqueueFanout } = listeners();
    l.onJobSettled(new JobSettledEvent(job({ lastError: 'x'.repeat(2000) })));
    await flush();
    const [key, data] = enqueueFanout.mock.calls[0]!;
    expect(key).toBe('jobs.job.failed');
    expect(data).toMatchObject({ jobId: 'job-1', type: 'example.task', attempts: 3, orgId: null, finishedAt: '2026-11-01T10:00:00.000Z' });
    expect((data as { lastError: string }).lastError).toHaveLength(500);
  });

  it('ignores a job that succeeded and the slice\'s own jobs (a webhook about a webhook would loop)', async () => {
    const { listeners: l, enqueueFanout } = listeners();
    l.onJobSettled(new JobSettledEvent(job({ status: 'succeeded' })));
    l.onJobSettled(new JobSettledEvent(job({ type: 'webhooks.deliver' })));
    l.onJobSettled(new JobSettledEvent(job({ type: 'webhooks.fanout' })));
    await flush();
    expect(enqueueFanout).not.toHaveBeenCalled();
  });

  it('swallows a failed enqueue: a bridge never breaks the code that raised the event', async () => {
    const { listeners: l, enqueueFanout } = listeners(jest.fn().mockRejectedValue(new Error('queue down')));
    expect(() => l.onNodeOffline(new NodeOfflineEvent('n1', 'n', null, new Date(), 5))).not.toThrow();
    await flush();
    expect(enqueueFanout).toHaveBeenCalled();
  });

  it('subscribes to exactly the three events', () => {
    const names = ['onNodeOffline', 'onNodeEvent', 'onJobSettled'] as const;
    const events = names.map((name) => Reflect.getMetadata('EVENT_LISTENER_METADATA', WebhookEventListeners.prototype[name]) as Array<{ event: string }>);
    expect(events.map((e) => e[0]!.event)).toEqual([NODE_OFFLINE_EVENT, NODE_EVENT_REPORTED, JOB_SETTLED_EVENT]);
    expect(typeof OnEvent).toBe('function');
  });

  it('makes no HTTP request: the fan-out is a job, the delivery another', async () => {
    const kit = createWebhooksTestKit();
    const real = new WebhookEventListeners(kit.webhooks);
    real.onNodeOffline(new NodeOfflineEvent('n1', 'n', null, new Date(), 5));
    await flush();
    expect(kit.jobs.enqueued.map((j) => j.type)).toEqual(['webhooks.fanout']);
    expect(kit.receiver.requests).toHaveLength(0);
    expect(kit.repository.deliveries.size).toBe(0);
  });
});

describe('the queue-rule conformance suites, run over the slice itself', () => {
  runPlatformConformance({
    sourceRoots: [SLICE_ROOT],
    suites: {
      onEventNoIo: { minListenerFiles: 1, mustScan: ['listeners/webhook-event.listeners.ts'] },
      cronEnqueueOnly: { exempt: [], minCronFiles: 1 },
    },
    summaryOutput: () => undefined,
  });
});

describe('webhooks.deliveries_purge', () => {
  it('deletes deliveries older than the retention period and keeps the rest', async () => {
    const kit = createWebhooksTestKit({ deliveryRetentionDays: 7 });
    const now = new Date('2026-11-10T00:00:00Z');
    kit.purge.now = () => now;
    const ctx = kit.context('system');
    const { endpoint } = await kit.endpoints.create(ctx, { name: 'p', url: 'https://receiver.example.test/p', eventKeys: ['nodes.*'], enabled: true });
    const ages = [30, 8, 6, 1];
    for (const days of ages) {
      kit.repository.now = () => new Date(now.getTime() - days * 86_400_000);
      await kit.endpoints.test(ctx, endpoint.id);
    }
    expect(kit.repository.deliveries.size).toBe(4);
    await kit.purge.process({ id: 'j' } as never);
    expect([...kit.repository.deliveries.values()].map((d) => Math.round((now.getTime() - d.createdAt.getTime()) / 86_400_000)).sort((a, b) => a - b)).toEqual([1, 6]);
  });

  it('is server-only and named by a permanent type', () => {
    const kit = createWebhooksTestKit();
    expect(kit.purge).toBeInstanceOf(WebhookPurgeHandler);
    expect(kit.purge.type).toBe(WEBHOOK_PURGE_JOB_TYPE);
    expect(kit.purge.type).toBe('webhooks.deliveries_purge');
    expect((kit.purge as unknown as Record<string, unknown>).nodeResultSchema).toBeUndefined();
  });

  it('the cron only enqueues, through the housekeeping helper', async () => {
    const created: unknown[] = [];
    const jobs = { enqueue: jest.fn(async (input: unknown) => (created.push(input), { id: 'j' })) };
    const prisma = { job: { findFirst: jest.fn().mockResolvedValue(null) } };
    const task = new WebhookPurgeTask(jobs as never, prisma as never);
    await task.handleCron();
    expect(created).toEqual([expect.objectContaining({ type: 'webhooks.deliveries_purge', orgId: null })]);
    prisma.job.findFirst.mockResolvedValue({ id: 'running', status: 'running' });
    await task.handleCron();
    expect(created).toHaveLength(1);
    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', WebhookPurgeTask.prototype.handleCron)).toBeDefined();
  });
});

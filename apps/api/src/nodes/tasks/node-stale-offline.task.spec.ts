// =============================================================================
// Unit tests for the stale-node sweep (issue #270, epic #254)
// =============================================================================
//
// The behavioural, row-level criteria — a silent node flips, a node inside the
// window does not, a node that never heartbeated is aged by `registeredAt`, a
// `disabled` node is never touched — are driven end to end against a narrow
// Prisma emulation in `test/nodes/node-fleet-lifecycle.spec.ts`, and again
// against real Postgres in `test/nodes/node-fleet-lifecycle.db.spec.ts`.
//
// What is proven HERE is the statement the sweep actually sends and the two
// properties a cron has that a service does not: it stops for its kill switch,
// and it never rejects out of the handler.
// =============================================================================

import { ConfigService } from '@nestjs/config';

import { NodeStaleOfflineTask } from './node-stale-offline.task';
import type { NodeLifecycleService } from '../node-lifecycle.service';
import type { PrismaService } from '../../prisma/prisma.service';

const POLICY = { staleHeartbeatSeconds: 90, offlineStaleMultiplier: 4, offlineRetentionDays: 30 };

function makeTask(config: Record<string, unknown> = {}, count = 0) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  const prisma = { workerNode: { updateMany } } as unknown as PrismaService;
  const lifecycle = {
    getPolicy: jest.fn().mockResolvedValue(POLICY),
    staleCutoff: (policy: typeof POLICY, now: Date) =>
      new Date(now.getTime() - policy.staleHeartbeatSeconds * policy.offlineStaleMultiplier * 1000),
  } as unknown as NodeLifecycleService;
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return { task: new NodeStaleOfflineTask(prisma, lifecycle, configService), updateMany };
}

describe('NodeStaleOfflineTask', () => {
  it('marks silent nodes offline in one set-based statement', async () => {
    const { task, updateMany } = makeTask({}, 3);

    await task.handleCron();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toEqual({ status: 'offline' });
  });

  it('never auto-transitions a disabled node, and never re-stamps an offline one', async () => {
    // `disabled` is an administrator's explicit intent. Sweeping it to
    // `offline` would let a re-registering node come back ONLINE AND ENABLED,
    // silently undoing a kill switch somebody threw on purpose — and nothing
    // in the row would record that it had ever been disabled.
    const { task, updateMany } = makeTask();

    await task.handleCron();

    expect(updateMany.mock.calls[0][0].where.status).toEqual({ in: ['online', 'draining'] });
  });

  it('ages a node that never heartbeated by registeredAt, not by a null heartbeat', async () => {
    // `NULL < cutoff` is NULL in SQL, never true, so the first arm cannot see
    // a node that never pinged. Without the second arm such a row is stuck at
    // `online` forever — and permanently invisible to retention.
    const { task, updateMany } = makeTask();

    await task.handleCron();

    const { where } = updateMany.mock.calls[0][0];

    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({ lastHeartbeatAt: { lt: expect.any(Date) } });
    expect(where.OR[1]).toEqual({
      lastHeartbeatAt: null,
      registeredAt: { lt: expect.any(Date) },
    });
  });

  it('uses staleHeartbeatSeconds x offlineStaleMultiplier as the cutoff', async () => {
    // NOT an independent "offline after N minutes" setting: a second duration
    // is a second definition of liveness, and the two can be configured into
    // contradicting each other.
    const before = Date.now();
    const { task, updateMany } = makeTask();

    await task.handleCron();

    const cutoff: Date = updateMany.mock.calls[0][0].where.OR[0].lastHeartbeatAt.lt;
    const windowMs = POLICY.staleHeartbeatSeconds * POLICY.offlineStaleMultiplier * 1000;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - windowMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - windowMs);
  });

  it('stops only for nodes.staleOfflineEnabled === false', async () => {
    const { task, updateMany } = makeTask({ 'nodes.staleOfflineEnabled': false });

    await task.handleCron();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('sweeps when the switch is unset, so a missing key fails open', async () => {
    // A fleet whose liveness tracking silently stopped because of a typo looks
    // exactly like a perfectly healthy fleet.
    const { task, updateMany } = makeTask({});

    await task.handleCron();

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed sweep rather than rejecting out of the cron handler', async () => {
    const { task, updateMany } = makeTask();
    updateMany.mockRejectedValue(new Error('connection reset'));

    await expect(task.handleCron()).resolves.toBeUndefined();
  });
});

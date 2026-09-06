// =============================================================================
// Unit tests for the offline-node prune (issue #270, epic #254)
// =============================================================================
//
// The acceptance criterion this file exists for is the one that is easy to get
// backwards: A NODE PAST RETENTION THAT IS STILL HOLDING A `running` JOB IS
// NOT DELETED, and it becomes deletable the moment that job settles. Deleting
// it would not break anything — `Job.claimedByNode` is `onDelete: SetNull`, so
// the job survives — which is exactly why nothing else would catch it: the
// damage is a `running` row owned by nobody, indistinguishable from the
// corrupt state the lease reaper's zombie signal exists to clean up after.
//
// The sequencing criterion (a crashed node becomes `offline` and is THEN
// prunable) lives in `test/nodes/node-fleet-lifecycle.spec.ts`, because it is
// a property of the pair rather than of this task.
// =============================================================================

import { ConfigService } from '@nestjs/config';

import { NodeOfflinePruneTask, prunableOfflineNodeWhere } from './node-offline-prune.task';
import type { NodeLifecycleService } from '../node-lifecycle.service';
import type { PrismaService } from '../../prisma/prisma.service';

const POLICY = { staleHeartbeatSeconds: 90, offlineStaleMultiplier: 4, offlineRetentionDays: 30 };

interface FakeOptions {
  /** Candidate node ids the retention select returns. */
  candidates?: string[];

  /** Node ids that still hold a `running` job. */
  busy?: string[];

  config?: Record<string, unknown>;
}

function makeTask({ candidates = [], busy = [], config = {} }: FakeOptions = {}) {
  const findManyNodes = jest.fn().mockResolvedValue(candidates.map((id) => ({ id })));
  const findManyJobs = jest
    .fn()
    .mockResolvedValue(busy.map((claimedByNodeId) => ({ claimedByNodeId })));
  const deleteMany = jest.fn().mockImplementation(async ({ where }: any) => ({
    count: where.id.in.length,
  }));

  const prisma = {
    workerNode: { findMany: findManyNodes, deleteMany },
    job: { findMany: findManyJobs },
  } as unknown as PrismaService;

  const lifecycle = {
    getPolicy: jest.fn().mockResolvedValue(POLICY),
    retentionCutoff: (policy: typeof POLICY, now: Date) =>
      new Date(now.getTime() - policy.offlineRetentionDays * 86_400_000),
  } as unknown as NodeLifecycleService;

  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return {
    task: new NodeOfflinePruneTask(prisma, lifecycle, configService),
    findManyNodes,
    findManyJobs,
    deleteMany,
  };
}

describe('NodeOfflinePruneTask', () => {
  it('selects only offline rows, aged by heartbeat or by registration', async () => {
    // Pruning by age alone would reach a `disabled` node — an administrator's
    // explicit intent, recorded nowhere else — and a `draining` node still
    // finishing a long job.
    const { task, findManyNodes } = makeTask();

    await task.handleCron();

    const { where } = findManyNodes.mock.calls[0][0];

    expect(where.status).toBe('offline');
    expect(where.OR).toEqual([
      { lastHeartbeatAt: { lt: expect.any(Date) } },
      { lastHeartbeatAt: null, registeredAt: { lt: expect.any(Date) } },
    ]);
  });

  it('does not delete a node that still holds a running job', async () => {
    const { task, deleteMany } = makeTask({ candidates: ['busy-node'], busy: ['busy-node'] });

    const result = await task.prune();

    expect(deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 0, skippedBusy: 1 });
  });

  it('deletes that same node once its job has settled', async () => {
    // The skip is a deferral, not a refusal: the reaper settles or requeues
    // the job on its own schedule and the next daily tick takes the node.
    // Nothing has to be re-run by hand.
    const { task, deleteMany } = makeTask({ candidates: ['busy-node'], busy: [] });

    const result = await task.prune();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0][0].where.id).toEqual({ in: ['busy-node'] });
    expect(result).toEqual({ deleted: 1, skippedBusy: 0 });
  });

  it('deletes the idle candidates while skipping the busy one', async () => {
    const { task, deleteMany } = makeTask({
      candidates: ['idle-a', 'busy', 'idle-b'],
      busy: ['busy'],
    });

    const result = await task.prune();

    expect(deleteMany.mock.calls[0][0].where.id).toEqual({ in: ['idle-a', 'idle-b'] });
    expect(result).toEqual({ deleted: 2, skippedBusy: 1 });
  });

  it('asks which nodes are busy in one query for the whole candidate set', async () => {
    const { task, findManyJobs } = makeTask({ candidates: ['a', 'b', 'c'] });

    await task.prune();

    expect(findManyJobs).toHaveBeenCalledTimes(1);
    expect(findManyJobs.mock.calls[0][0]).toMatchObject({
      where: { status: 'running', claimedByNodeId: { in: ['a', 'b', 'c'] } },
      distinct: ['claimedByNodeId'],
    });
  });

  it('re-asserts the retention predicate on the delete, not just the ids', async () => {
    // Between the select and the delete a node may have re-registered, which
    // clears `offline` and stamps a fresh heartbeat. Deleting by id alone
    // would destroy a registration a worker is actively using.
    const { task, deleteMany } = makeTask({ candidates: ['a'] });

    await task.prune();

    const { where } = deleteMany.mock.calls[0][0];

    expect(where.status).toBe('offline');
    expect(where.OR).toHaveLength(2);
  });

  it('asks nothing further when no node is past retention', async () => {
    const { task, findManyJobs, deleteMany } = makeTask({ candidates: [] });

    await expect(task.prune()).resolves.toEqual({ deleted: 0, skippedBusy: 0 });
    expect(findManyJobs).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('stops only for nodes.offlinePruneEnabled === false', async () => {
    const { task, findManyNodes } = makeTask({ config: { 'nodes.offlinePruneEnabled': false } });

    await task.handleCron();

    expect(findManyNodes).not.toHaveBeenCalled();
  });

  it('prunes when the switch is unset, so a missing key fails open', async () => {
    const { task, findManyNodes } = makeTask();

    await task.handleCron();

    expect(findManyNodes).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed prune rather than rejecting out of the cron handler', async () => {
    const { task, findManyNodes } = makeTask();
    findManyNodes.mockRejectedValue(new Error('connection reset'));

    await expect(task.handleCron()).resolves.toBeUndefined();
  });
});

describe('prunableOfflineNodeWhere', () => {
  it('mirrors the stale sweep arm for arm', () => {
    // The two predicates are two halves of one lifecycle: ageing a
    // never-heartbeated node by `registeredAt` in the sweep and by
    // `lastHeartbeatAt` here would sweep it to `offline` and then never
    // delete it.
    const cutoff = new Date('2026-08-01T00:00:00.000Z');

    expect(prunableOfflineNodeWhere(cutoff)).toEqual({
      status: 'offline',
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, registeredAt: { lt: cutoff } },
      ],
    });
  });
});

import { NodeEventsPurgeTask } from '../../../src/nodes/tasks/node-events-purge.task';
import { NODE_EVENTS_PURGE_TYPE } from '../../../src/nodes/handlers/node-events-purge.handler';
import { resolveNodesModuleOptions } from '../../../src/nodes/nodes.options';
import type { JobsService } from '../../../src/jobs/jobs.service';
import type { JobsPrisma } from '../../../src/jobs/data/jobs-db';

function make(options?: Parameters<typeof resolveNodesModuleOptions>[0], active: unknown = null) {
  const findFirst = jest.fn().mockResolvedValue(active);
  const enqueue = jest.fn().mockResolvedValue({ id: 'job-1' });
  const task = new NodeEventsPurgeTask(
    { enqueue } as unknown as JobsService,
    { job: { findFirst } } as unknown as JobsPrisma,
    options === undefined ? undefined : resolveNodesModuleOptions(options),
  );
  return { task, enqueue, findFirst };
}

describe('NodeEventsPurgeTask', () => {
  it('only enqueues nodes.node_events_purge as housekeeping (orgId null)', async () => {
    const { task, enqueue } = make();

    await task.handleCron();

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ type: NODE_EVENTS_PURGE_TYPE, priority: 100, orgId: null });
  });

  it('skips when one is already pending or running', async () => {
    const { task, enqueue } = make(undefined, { id: 'job-0' });

    await task.handleCron();

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('stops for tasks.nodeEventsPurge === false', async () => {
    const { task, enqueue, findFirst } = make({ tasks: { nodeEventsPurge: false } });

    await task.handleCron();

    expect(enqueue).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('never rejects out of the cron handler', async () => {
    const { task, enqueue } = make();
    enqueue.mockRejectedValue(new Error('connection reset'));

    await expect(task.handleCron()).resolves.toBeUndefined();
  });
});

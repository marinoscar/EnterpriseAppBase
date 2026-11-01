import { JobHandlerRegistry } from '../../../src/jobs/index';
import type { Job, JobsPrisma } from '../../../src/jobs/data/jobs-db';
import { NODE_EVENTS_PURGE_TYPE, NodeEventsPurgeHandler } from '../../../src/nodes/handlers/node-events-purge.handler';
import { resolveNodesModuleOptions } from '../../../src/nodes/nodes.options';

const DAY = 24 * 60 * 60 * 1000;

function make(options?: Parameters<typeof resolveNodesModuleOptions>[0]) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
  const registry = new JobHandlerRegistry();
  const handler = new NodeEventsPurgeHandler(
    registry,
    { workerNodeEvent: { deleteMany } } as unknown as JobsPrisma,
    options === undefined ? undefined : resolveNodesModuleOptions(options),
  );
  return { handler, deleteMany, registry };
}

describe('NodeEventsPurgeHandler', () => {
  it('registers itself under the permanent type and is server-only', () => {
    const { handler, registry } = make();
    handler.onModuleInit();

    expect(NODE_EVENTS_PURGE_TYPE).toBe('nodes.node_events_purge');
    expect(registry.get(NODE_EVENTS_PURGE_TYPE)).toBe(handler);
    expect((handler as any).nodeResultSchema).toBeUndefined();
    expect((handler as any).persistNodeResult).toBeUndefined();
  });

  it('deletes events received before the default 30-day cutoff', async () => {
    const { handler, deleteMany } = make();
    const now = new Date('2026-06-30T00:00:00.000Z');

    const count = await handler.purge(now);

    expect(count).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * DAY) } } });
  });

  it('honours nodeEventsRetentionDays', async () => {
    const { handler, deleteMany } = make({ nodeEventsRetentionDays: 7 });
    const now = new Date('2026-06-30T00:00:00.000Z');

    await handler.purge(now);

    expect(deleteMany).toHaveBeenCalledWith({ where: { receivedAt: { lt: new Date(now.getTime() - 7 * DAY) } } });
  });

  it('process() purges and throws on failure so the job fails visibly', async () => {
    const { handler, deleteMany } = make();
    await expect(handler.process({ id: 'j1' } as Job)).resolves.toBeUndefined();

    deleteMany.mockRejectedValue(new Error('boom'));
    await expect(handler.process({ id: 'j2' } as Job)).rejects.toThrow('boom');
  });

  it('rejects an invalid retention option', () => {
    expect(() => resolveNodesModuleOptions({ nodeEventsRetentionDays: 0 })).toThrow(/nodeEventsRetentionDays/);
    expect(() => resolveNodesModuleOptions({ nodeEventsRetentionDays: 1.5 })).toThrow(/nodeEventsRetentionDays/);
  });
});

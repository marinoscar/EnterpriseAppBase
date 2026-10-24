// =============================================================================
// Unit tests for the stale-node sweep (issue #270; moved to a handler by #353)
// =============================================================================
//
// ⚠ THESE ARE THE CRON'S TESTS, ADAPTED — not new ones. #353 (epic #345) moved
// the sweep off `NodeStaleOfflineTask`'s `@Cron` body and onto
// `NodeFleetSweepHandler`, so the assertions about the STATEMENT and about the
// notification moved with it; `tasks/node-stale-offline.task.spec.ts` keeps
// what genuinely belongs to a cron (the kill switch, and that it enqueues
// rather than sweeping). The two properties that changed hands are called out
// where they appear below.
//
// The behavioural, row-level criteria — a silent node flips, a node inside the
// window does not, a node that never heartbeated is aged by `registeredAt`, a
// `disabled` node is never touched — are driven end to end against a narrow
// Prisma emulation in `test/nodes/node-fleet-lifecycle.spec.ts`, and again
// against real Postgres in `test/nodes/node-fleet-lifecycle.db.spec.ts`.
//
// What is proven HERE is the statement the sweep actually sends, and that
// `nodes.node.offline` (#288; an event since #734, the app's listener raises
// the `nodes.node_offline` notification) is emitted once per node it flipped
// in a way that is incapable of affecting the sweep. The statement is `updateManyAndReturn`
// for that same issue — still ONE atomic statement, but one that says WHICH
// rows it changed, which is what a per-node notification needs and an
// `updateMany` count cannot give.
// =============================================================================


import { type Job, type JobsPrisma } from '../../../src/jobs/data/jobs-db';

import { NodeFleetSweepHandler } from '../../../src/nodes/handlers/node-fleet-sweep.handler';
import type { JobHandlerRegistry } from '../../../src/jobs/job-handler.registry';
import type { NodeLifecycleService } from '../../../src/nodes/node-lifecycle.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';

import { NODE_OFFLINE_EVENT, NodeOfflineEvent } from '../../../src/nodes/events/node-offline.event';

/** The row the worker hands `process`. Only `id` is read, for the log line. */
const JOB = { id: 'job-1' } as Job;

const POLICY = { staleHeartbeatSeconds: 90, offlineStaleMultiplier: 4, offlineRetentionDays: 30 };

type SweptNode = { id: string; name: string; lastHeartbeatAt: Date | null };

function makeHandler(config: Record<string, unknown> = {}, transitioned: SweptNode[] = []) {
  const updateManyAndReturn = jest.fn().mockResolvedValue(transitioned);
  const prisma = { workerNode: { updateManyAndReturn } } as unknown as JobsPrisma;
  const lifecycle = {
    getPolicy: jest.fn().mockResolvedValue(POLICY),
    staleCutoff: (policy: typeof POLICY, now: Date) =>
      new Date(now.getTime() - policy.staleHeartbeatSeconds * policy.offlineStaleMultiplier * 1000),
  } as unknown as NodeLifecycleService;
  // The handler reads no configuration at all: the kill switch gates the
  // enqueue (see the "does not re-ask" case), and since #734 the app URL is
  // the notification listener's. `config` stays a parameter for that case.
  void config;
  const emit = jest.fn().mockReturnValue(true);
  const events = { emit } as unknown as EventEmitter2;

  const registry = { register: jest.fn() } as unknown as JobHandlerRegistry;

  return {
    handler: new NodeFleetSweepHandler(registry, prisma, lifecycle, events),
    updateManyAndReturn,
    emit,
  };
}

/** Three flipped rows, so "one message per node" is distinguishable from "one message". */
const FLIPPED: SweptNode[] = [
  { id: 'node-1', name: 'worker-a', lastHeartbeatAt: new Date('2026-01-01T00:00:00.000Z') },
  { id: 'node-2', name: 'worker-b', lastHeartbeatAt: null },
  { id: 'node-3', name: 'worker-c', lastHeartbeatAt: new Date('2026-01-02T00:00:00.000Z') },
];

describe('NodeFleetSweepHandler', () => {
  it('marks silent nodes offline in one set-based statement', async () => {
    const { handler, updateManyAndReturn } = makeHandler({}, FLIPPED);

    await handler.process(JOB);

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(updateManyAndReturn.mock.calls[0][0].data).toEqual({ status: 'offline' });
  });

  it('never auto-transitions a disabled node, and never re-stamps an offline one', async () => {
    // `disabled` is an administrator's explicit intent. Sweeping it to
    // `offline` would let a re-registering node come back ONLINE AND ENABLED,
    // silently undoing a kill switch somebody threw on purpose — and nothing
    // in the row would record that it had ever been disabled.
    const { handler, updateManyAndReturn } = makeHandler();

    await handler.process(JOB);

    expect(updateManyAndReturn.mock.calls[0][0].where.status).toEqual({
      in: ['online', 'draining'],
    });
  });

  it('ages a node that never heartbeated by registeredAt, not by a null heartbeat', async () => {
    // `NULL < cutoff` is NULL in SQL, never true, so the first arm cannot see
    // a node that never pinged. Without the second arm such a row is stuck at
    // `online` forever — and permanently invisible to retention.
    const { handler, updateManyAndReturn } = makeHandler();

    await handler.process(JOB);

    const { where } = updateManyAndReturn.mock.calls[0][0];

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
    const { handler, updateManyAndReturn } = makeHandler();

    await handler.process(JOB);

    const cutoff: Date = updateManyAndReturn.mock.calls[0][0].where.OR[0].lastHeartbeatAt.lt;
    const windowMs = POLICY.staleHeartbeatSeconds * POLICY.offlineStaleMultiplier * 1000;

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - windowMs);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - windowMs);
  });

  it('does not re-ask the kill switch: a queued sweep was already decided on', async () => {
    // ⚠ THIS ASSERTION IS THE INVERSE OF THE ONE IT REPLACES. Before #353 the
    // sweep lived in a `@Cron` and stopped for `NODE_STALE_OFFLINE_ENABLED`.
    // The switch now gates the ENQUEUE (`NodeStaleOfflineTask`), because a
    // sweep row that reached a worker was queued by a process that had already
    // decided to sweep — re-asking here would let a job queued by one replica
    // be silently dropped by another.
    const { handler, updateManyAndReturn } = makeHandler({
      'nodes.staleOfflineEnabled': false,
    });

    await handler.process(JOB);

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it('THROWS a failed sweep rather than swallowing it', async () => {
    // ⚠ ALSO INVERTED BY #353, and for the reason `job-handler.interface.ts`
    // gives: the cron had to swallow because a rejection out of a `@Cron`
    // handler is an unhandled rejection. A handler has a worker above it whose
    // whole job is to turn a rejection into `lastError` plus a retry, so
    // swallowing here would report a sweep that never happened as `succeeded`.
    const { handler, updateManyAndReturn } = makeHandler();
    updateManyAndReturn.mockRejectedValue(new Error('connection reset'));

    await expect(handler.process(JOB)).rejects.toThrow('connection reset');
  });
});

// =============================================================================
// `nodes.node.offline` (#288, epic #254; an event since #734)
// =============================================================================
//
// The notification itself (`nodes.node_offline`, audience `nodes:read`, the
// trimmed `appUrl`) is the app listener's: apps/api/src/notifications/ops/
// node-offline-notifier.spec.ts and test/nodes/node-offline-event.integration.spec.ts.

describe('NodeFleetSweepHandler emits nodes.node.offline', () => {
  it('emits exactly one event per node it actually flipped', async () => {
    const { handler, emit } = makeHandler({}, FLIPPED);

    await handler.process(JOB);

    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls.map((call) => call[0])).toEqual([NODE_OFFLINE_EVENT, NODE_OFFLINE_EVENT, NODE_OFFLINE_EVENT]);
    expect(emit.mock.calls.map((call) => (call[1] as NodeOfflineEvent).nodeName)).toEqual(['worker-a', 'worker-b', 'worker-c']);
  });

  it('uses the permanent event key', () => {
    expect(NODE_OFFLINE_EVENT).toBe('nodes.node.offline');
  });

  it('carries the node name, id, last-heartbeat time and the stale window', async () => {
    const { handler, emit } = makeHandler({}, [FLIPPED[0]]);

    await handler.process(JOB);

    const event = emit.mock.calls[0][1] as NodeOfflineEvent;
    expect(event).toBeInstanceOf(NodeOfflineEvent);
    expect(event).toMatchObject({
      nodeId: 'node-1',
      nodeName: 'worker-a',
      lastHeartbeatAt: FLIPPED[0].lastHeartbeatAt,
      // 90s x 4 = 360s = 6 minutes.
      staleAfterMinutes: 6,
    });
    expect(event.markedOfflineAt).toBeInstanceOf(Date);
  });

  it('carries a null last-heartbeat through rather than substituting a time', async () => {
    // A node that registered and never pinged is a DIFFERENT failure from one
    // that went quiet, and the template says so in words. Substituting
    // `registeredAt` here would erase the distinction before it got there.
    const { handler, emit } = makeHandler({}, [FLIPPED[1]]);

    await handler.process(JOB);

    expect((emit.mock.calls[0][1] as NodeOfflineEvent).lastHeartbeatAt).toBeNull();
  });

  it('emits nothing when no node flipped', async () => {
    const { handler, emit } = makeHandler({}, []);

    await handler.process(JOB);

    expect(emit).not.toHaveBeenCalled();
  });

  it('emits only after the write returned', async () => {
    const { handler, emit, updateManyAndReturn } = makeHandler({}, [FLIPPED[0]]);

    await handler.process(JOB);

    expect(updateManyAndReturn.mock.invocationCallOrder[0]).toBeLessThan(emit.mock.invocationCallOrder[0]!);
  });

  // ---------------------------------------------------------------------------
  // FIRE-AND-FORGET CONTAINMENT (#288 acceptance criterion)
  // ---------------------------------------------------------------------------

  it('a THROWING listener does not fail the sweep, the rows stay offline, and the others still hear', async () => {
    const { handler, updateManyAndReturn, emit } = makeHandler({}, FLIPPED);
    emit.mockImplementationOnce(() => {
      throw new Error('the listener exploded');
    });

    // 1. `sweep()` still resolves, and still reports what it transitioned.
    await expect(handler.sweep()).resolves.toBe(3);
    // 2. The write happened and was not rolled back or retried.
    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(updateManyAndReturn.mock.calls[0][0].data).toEqual({ status: 'offline' });
    // 3. A throw for one node does not swallow the events for the rest.
    expect(emit).toHaveBeenCalledTimes(3);
  });
});

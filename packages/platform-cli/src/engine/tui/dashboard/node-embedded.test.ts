import { describe, expect, it, vi } from 'vitest';

import type { NodeEngineEvent, NodeSnapshot } from '../../node/node-events.js';
import type { StartedNode, StartNodeOptions } from '../../node/start.js';
import { embeddedNodeFeed, isDaemonListening } from './node-embedded.js';
import { DashboardSource } from './source.js';
import { nodeDashboardReducer } from '../../node/node-dashboard-source.js';

function snap(status: NodeSnapshot['status'] = 'idle'): NodeSnapshot {
  return {
    nodeId: 'n1',
    status,
    concurrency: 1,
    eligibleTypes: [],
    activeJobs: [],
    history: [],
    counters: { claimed: 0, succeeded: 0, failed: 0, rateLimited: 0 },
    startedAt: 't',
    lastHeartbeatAt: null,
    heartbeatAgeMs: null,
  };
}

/** A `startNode` that records its options and hands back a controllable engine. */
function fakeStart() {
  const stop = vi.fn(async () => {});
  let options: StartNodeOptions | undefined;
  let status: NodeSnapshot['status'] = 'idle';
  const start = vi.fn(async (o: StartNodeOptions) => {
    options = o;
    return { engine: { getSnapshot: () => snap(status), stop }, finished: Promise.resolve() } as unknown as StartedNode;
  });
  return {
    start,
    stop,
    options: () => options,
    fire: (event: NodeEngineEvent, next: NodeSnapshot['status'] = status) => {
      status = next;
      options?.onEvent?.(event);
    },
  };
}

describe('embeddedNodeFeed', () => {
  it('starts the engine in-process without touching the terminal, and renders its events', async () => {
    const fake = fakeStart();
    const source = new DashboardSource(nodeDashboardReducer, embeddedNodeFeed({ startNode: fake.start }));
    await source.start();

    const options = fake.options()!;
    // Nothing may write to the ink frame or take over Ctrl-C.
    expect(options.stderr?.write('x')).toBe(true);
    expect(options.selfTest).toBe(false);
    expect(options.headless).toBe(false);
    options.installSignalHandlers?.(() => {});

    expect(source.getState()).toMatchObject({ connected: true, mode: 'embedded' });
    fake.fire({ kind: 'job-started', at: 't', jobId: 'j1', type: 'x' }, 'working');
    expect(source.getState().events).toHaveLength(1);
    expect(source.getState().snapshot?.status).toBe('working');
  });

  it('stop() stops the engine without deregistering, and ignores later events', async () => {
    const fake = fakeStart();
    const source = new DashboardSource(nodeDashboardReducer, embeddedNodeFeed({ startNode: fake.start }));
    await source.start();

    source.stop();
    expect(fake.stop).toHaveBeenCalledWith({ deregister: false });
    fake.fire({ kind: 'idle', at: 't' });
    expect(source.getState().events).toEqual([]);
  });

  it('stop() before the engine is up shuts it down as soon as it is', async () => {
    const fake = fakeStart();
    let release: (() => void) | undefined;
    const slow = vi.fn(async (o: StartNodeOptions) => {
      await new Promise<void>((r) => (release = r));
      return fake.start(o);
    });
    const feed = embeddedNodeFeed({ startNode: slow });
    const started = feed.start(() => {});
    feed.stop();
    release?.();
    await started;
    await vi.waitFor(() => expect(fake.stop).toHaveBeenCalledWith({ deregister: false }));
  });

  it('reports a failed start as a disconnect instead of throwing', async () => {
    const source = new DashboardSource(
      nodeDashboardReducer,
      embeddedNodeFeed({
        startNode: async () => {
          throw new Error('No server or credential is configured.');
        },
      }),
    );
    await source.start();
    expect(source.getState()).toMatchObject({ connected: false, error: 'No server or credential is configured.' });
  });
});

describe('isDaemonListening', () => {
  it('connects and hangs up, sending nothing', async () => {
    const send = vi.fn();
    const close = vi.fn();
    const ok = await isDaemonListening('/x', (async () => ({ send, close })) as never);
    expect(ok).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('is false when nothing answers', async () => {
    const ok = await isDaemonListening('/x', (async () => {
      throw new Error('ENOENT');
    }) as never);
    expect(ok).toBe(false);
  });
});

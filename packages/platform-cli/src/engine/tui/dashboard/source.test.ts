import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DaemonNotRunningError } from '../../node/daemon.js';
import type { DaemonMessage } from '../../node/ipc-protocol.js';
import { createNodeDashboardReducer, nodeDashboardReducer } from '../../node/node-dashboard-source.js';
import type { NodeEngineEvent, NodeSnapshot } from '../../node/node-events.js';
import {
  DashboardSource,
  daemonAttachFeed,
  inProcessFeed,
  pollFeed,
  selectDashboardFeed,
  type DashboardFeed,
  type DashboardFeedMessage,
  type DashboardReducer,
} from './source.js';

// =============================================================================
// The dashboard-source pattern  (RETRO-G1.3)
// =============================================================================
//
// Everything here runs without ink, a terminal or React: a reducer is a pure
// function, a feed takes its transport as a parameter, and the source is glue.
// =============================================================================

function snapshot(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    nodeId: 'node-1',
    status: 'idle',
    concurrency: 2,
    eligibleTypes: [],
    activeJobs: [],
    history: [],
    counters: { claimed: 0, succeeded: 0, failed: 0, rateLimited: 0 },
    startedAt: '2026-01-01T00:00:00.000Z',
    lastHeartbeatAt: null,
    heartbeatAgeMs: null,
    ...overrides,
  };
}

const idle = (at: string): NodeEngineEvent => ({ kind: 'idle', at });

/** A feed a test drives by hand. */
function manualFeed<E>(mode: 'attached' | 'embedded' | 'poll' = 'attached') {
  let sink: ((message: DashboardFeedMessage<E>) => void) | undefined;
  const stop = vi.fn();
  const feed: DashboardFeed<E> = {
    mode,
    start: async (emit) => {
      sink = emit;
    },
    stop,
  };
  return { feed, stop, emit: (message: DashboardFeedMessage<E>) => sink?.(message) };
}

/** A fake daemon connection whose frames a test pushes by hand. */
function fakeDaemon() {
  const send = vi.fn();
  const close = vi.fn();
  let push: ((message: DaemonMessage) => void) | undefined;
  let drop: (() => void) | undefined;
  let attempts = 0;
  return {
    send,
    close,
    attempts: () => attempts,
    push: (message: DaemonMessage) => push?.(message),
    drop: () => drop?.(),
    connect: (async (options: { onMessage: (m: DaemonMessage) => void; onClose?: () => void }) => {
      attempts += 1;
      push = options.onMessage;
      drop = options.onClose;
      return { send, close };
    }) as never,
  };
}

describe('nodeDashboardReducer', () => {
  it('is pure: the same input gives an equal output and the input is never mutated', () => {
    const before = nodeDashboardReducer.initial();
    const frozen = Object.freeze({ ...before, logs: Object.freeze([]) as never, events: Object.freeze([]) as never });

    const a = nodeDashboardReducer.reduce(frozen, idle('t1'));
    const b = nodeDashboardReducer.reduce(frozen, idle('t1'));

    expect(a).toEqual(b);
    expect(a).not.toBe(frozen);
    expect(frozen.events).toEqual([]);
  });

  it('hydrates a snapshot, and ignores a value that is not one', () => {
    const state = nodeDashboardReducer.initial();
    expect(nodeDashboardReducer.hydrate(state, snapshot({ status: 'working' })).snapshot?.status).toBe('working');
    expect(nodeDashboardReducer.hydrate(state, { nope: true })).toBe(state);
    expect(nodeDashboardReducer.hydrate(state, null)).toBe(state);
  });

  it('bounds events and log lines to the newest N', () => {
    const reducer = createNodeDashboardReducer({ maxLines: 3 });
    let state = reducer.initial();
    for (let i = 0; i < 10; i += 1) {
      state = reducer.reduce(state, idle(`t${i}`));
      state = reducer.log!(state, [{ ts: `t${i}`, level: 'info', msg: `line ${i}` }]);
    }
    expect(state.events.map((e) => e.at)).toEqual(['t7', 't8', 't9']);
    expect(state.logs.map((l) => l.msg)).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it('parseEvent accepts an event frame and drops anything else', () => {
    expect(nodeDashboardReducer.parseEvent({ kind: 'idle', at: 't' })).toEqual({ kind: 'idle', at: 't' });
    expect(nodeDashboardReducer.parseEvent('x')).toBeUndefined();
    expect(nodeDashboardReducer.parseEvent({ at: 't' })).toBeUndefined();
    expect(nodeDashboardReducer.parseEvent(null)).toBeUndefined();
  });
});

describe('DashboardSource', () => {
  it('applies the reducer to what the feed says and merges the connection fields', async () => {
    const { feed, emit } = manualFeed<NodeEngineEvent>();
    const source = new DashboardSource(nodeDashboardReducer, feed);
    await source.start();

    emit({ kind: 'attempt' });
    emit({ kind: 'connected' });
    emit({ kind: 'snapshot', snapshot: snapshot({ status: 'working' }) });
    emit({ kind: 'frame', frame: { kind: 'idle', at: 't' } });
    emit({ kind: 'frame', frame: 'garbage' });
    emit({ kind: 'logs', lines: [{ ts: 't', level: 'info', msg: 'hi' }] });

    const state = source.getState();
    expect(state).toMatchObject({ connected: true, everConnected: true, attempts: 1, mode: 'attached' });
    expect(state.snapshot?.status).toBe('working');
    expect(state.events).toHaveLength(1);
    expect(state.logs).toHaveLength(1);
  });

  it('publishes a NEW state object on every change, to subscribers and onChange', async () => {
    const { feed, emit } = manualFeed<NodeEngineEvent>();
    const onChange = vi.fn();
    const source = new DashboardSource(nodeDashboardReducer, feed, { onChange });
    const seen: unknown[] = [];
    const unsubscribe = source.subscribe((state) => seen.push(state));
    await source.start();

    emit({ kind: 'event', event: idle('a') });
    emit({ kind: 'event', event: idle('b') });
    expect(seen[0]).not.toBe(seen[1]);
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    emit({ kind: 'event', event: idle('c') });
    expect(seen).toHaveLength(2);
  });

  it('a log message is ignored when the reducer has no log step', async () => {
    const reducer: DashboardReducer<{ n: number }, number> = {
      initial: () => ({ n: 0 }),
      hydrate: (s) => s,
      reduce: (s, e) => ({ n: s.n + e }),
      parseEvent: (f) => (typeof f === 'number' ? f : undefined),
    };
    const { feed, emit } = manualFeed<number>();
    const source = new DashboardSource(reducer, feed);
    await source.start();
    emit({ kind: 'logs', lines: [] });
    emit({ kind: 'event', event: 2 });
    emit({ kind: 'frame', frame: 3 });
    expect(source.getState().n).toBe(5);
  });

  it('stop() stops the feed once, goes disconnected and ignores what the feed says afterwards', async () => {
    const { feed, stop, emit } = manualFeed<NodeEngineEvent>();
    const source = new DashboardSource(nodeDashboardReducer, feed);
    await source.start();
    emit({ kind: 'connected' });

    source.stop();
    source.stop();
    emit({ kind: 'event', event: idle('late') });

    expect(stop).toHaveBeenCalledOnce();
    expect(source.getState().connected).toBe(false);
    expect(source.getState().events).toEqual([]);
  });

  it('start() is idempotent and does nothing after stop()', async () => {
    const start = vi.fn(async () => {});
    const source = new DashboardSource(nodeDashboardReducer, { mode: 'poll', start, stop: () => {} });
    await source.start();
    await source.start();
    expect(start).toHaveBeenCalledOnce();

    const stopped = new DashboardSource(nodeDashboardReducer, { mode: 'poll', start, stop: () => {} });
    stopped.stop();
    await stopped.start();
    expect(start).toHaveBeenCalledOnce();
  });
});

describe('daemonAttachFeed', () => {
  it('feeds the source from the daemon and NEVER sends a frame', async () => {
    const peer = fakeDaemon();
    const source = new DashboardSource(nodeDashboardReducer, daemonAttachFeed({ socketPath: '/x', connect: peer.connect }));
    await source.start();

    peer.push({ type: 'snapshot', snapshot: snapshot({ status: 'working' }) });
    peer.push({ type: 'event', event: idle('t') });
    peer.push({ type: 'log-tail', lines: [{ ts: 't', level: 'info', msg: 'hello' }] });
    peer.push({ type: 'ack', command: 'set-concurrency' });
    source.stop();

    expect(source.getState().snapshot?.status).toBe('working');
    expect(source.getState().events).toHaveLength(1);
    expect(source.getState().logs).toHaveLength(1);
    // The criterion that keeps a headless production worker safe to inspect.
    expect(peer.send).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('reads only its own channel: no channel field means node', async () => {
    const peer = fakeDaemon();
    const node = new DashboardSource(nodeDashboardReducer, daemonAttachFeed({ socketPath: '/x', connect: peer.connect }));
    await node.start();

    // An OLD daemon's frame carries no channel, and is the node's.
    peer.push({ type: 'event', event: idle('old') });
    // A second engine's frames are not.
    peer.push({ type: 'event', event: { anything: 1 }, channel: 'backup' });
    peer.push({ type: 'snapshot', snapshot: { phase: 'scan' }, channel: 'backup' });

    expect(node.getState().events.map((e) => e.at)).toEqual(['old']);
    expect(node.getState().snapshot).toBeUndefined();
  });

  it('a feed for another channel reads that channel and not the node', async () => {
    const reducer: DashboardReducer<{ phase: string; seen: number[] }, number> = {
      initial: () => ({ phase: '', seen: [] }),
      hydrate: (s, snap) => ({ ...s, phase: (snap as { phase: string }).phase }),
      reduce: (s, e) => ({ ...s, seen: [...s.seen, e] }),
      parseEvent: (f) => (typeof f === 'number' ? f : undefined),
    };
    const peer = fakeDaemon();
    const source = new DashboardSource(reducer, daemonAttachFeed<number>({ socketPath: '/x', channel: 'backup', connect: peer.connect }));
    await source.start();

    peer.push({ type: 'snapshot', snapshot: snapshot() });
    peer.push({ type: 'snapshot', snapshot: { phase: 'scan' }, channel: 'backup' });
    peer.push({ type: 'event', event: 7, channel: 'backup' });
    peer.push({ type: 'event', event: idle('node') });

    expect(source.getState()).toMatchObject({ phase: 'scan', seen: [7] });
    expect(peer.send).not.toHaveBeenCalled();
  });

  it('reconnects after the daemon restarts under it (the memory valve exit)', async () => {
    const peer = fakeDaemon();
    let fire: (() => void) | undefined;
    const source = new DashboardSource(
      nodeDashboardReducer,
      daemonAttachFeed({
        socketPath: '/x',
        connect: peer.connect,
        setTimer: (fn) => {
          fire = fn;
          return 1;
        },
        clearTimer: () => {},
      }),
    );
    await source.start();
    peer.push({ type: 'snapshot', snapshot: snapshot() });

    peer.drop();
    expect(source.getState().connected).toBe(false);
    expect(source.getState().everConnected).toBe(true);

    fire?.();
    await vi.waitFor(() => expect(peer.attempts()).toBe(2));
    await vi.waitFor(() => expect(source.getState().connected).toBe(true));
    expect(source.getState().attempts).toBe(2);
    // The new connection's snapshot replaces the old one.
    peer.push({ type: 'snapshot', snapshot: snapshot({ status: 'working' }) });
    expect(source.getState().snapshot?.status).toBe('working');
  });

  it('says "no worker is running" distinctly, keeps trying, and stop() clears the timer', async () => {
    const cleared: unknown[] = [];
    const source = new DashboardSource(
      nodeDashboardReducer,
      daemonAttachFeed({
        socketPath: '/x',
        connect: (async () => {
          throw new DaemonNotRunningError('/x');
        }) as never,
        setTimer: () => 'handle',
        clearTimer: (h) => cleared.push(h),
      }),
    );
    await source.start();
    expect(source.getState().error).toBe('No worker is running here.');
    expect(source.getState().everConnected).toBe(false);

    source.stop();
    expect(cleared).toEqual(['handle']);
  });

  it('a connection that lands after stop() is closed, not kept', async () => {
    let resolve: ((client: { send(): void; close(): void }) => void) | undefined;
    const close = vi.fn();
    const feed = daemonAttachFeed({
      socketPath: '/x',
      connect: (() => new Promise((r) => (resolve = r as never))) as never,
    });
    const started = feed.start(() => {});
    feed.stop();
    resolve?.({ send: () => {}, close });
    await started;
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('inProcessFeed', () => {
  it('delivers the snapshot, then every event, and stops listening on stop()', async () => {
    const emitter = new EventEmitter();
    let current = snapshot({ status: 'idle' });
    const source = new DashboardSource(
      nodeDashboardReducer,
      inProcessFeed<NodeEngineEvent>(emitter, { snapshot: () => current }),
    );
    await source.start();

    expect(source.getState()).toMatchObject({ connected: true, mode: 'embedded' });
    expect(source.getState().snapshot?.status).toBe('idle');

    current = snapshot({ status: 'working' });
    emitter.emit('event', idle('t'));
    expect(source.getState().events).toHaveLength(1);
    // Unlike the daemon, an in-process feed re-reads the snapshot after each event.
    expect(source.getState().snapshot?.status).toBe('working');

    source.stop();
    expect(emitter.listenerCount('event')).toBe(0);
    emitter.emit('event', idle('late'));
    expect(source.getState().events).toHaveLength(1);
  });

  it('follows a custom event name and an optional log channel', async () => {
    const emitter = new EventEmitter();
    const source = new DashboardSource(
      nodeDashboardReducer,
      inProcessFeed<NodeEngineEvent>(emitter, {
        snapshot: () => snapshot(),
        eventName: 'engine-event',
        logEventName: 'log',
        refreshSnapshot: false,
      }),
    );
    await source.start();
    emitter.emit('engine-event', idle('t'));
    emitter.emit('log', { ts: 't', level: 'info', msg: 'one' });
    emitter.emit('log', [{ ts: 't', level: 'info', msg: 'two' }]);
    expect(source.getState().events).toHaveLength(1);
    expect(source.getState().logs.map((l) => l.msg)).toEqual(['one', 'two']);
  });
});

describe('pollFeed', () => {
  it('polls on the interval, one request at a time, and reports failure without stopping', async () => {
    const timers: Array<() => void> = [];
    const results = [Promise.resolve(1), Promise.reject(new Error('down')), Promise.resolve(3)];
    const reducer: DashboardReducer<{ last: number }, number> = {
      initial: () => ({ last: 0 }),
      hydrate: (s) => s,
      reduce: (_s, e) => ({ last: e }),
      parseEvent: () => undefined,
    };
    const source = new DashboardSource(
      reducer,
      pollFeed(() => results.shift()!, { intervalMs: 10, setTimer: (fn) => timers.push(fn), clearTimer: () => {} }),
    );
    await source.start();
    expect(source.getState()).toMatchObject({ last: 1, connected: true, mode: 'poll', attempts: 1 });

    timers.shift()!();
    await vi.waitFor(() => expect(source.getState().error).toBe('down'));
    expect(source.getState().connected).toBe(false);
    expect(source.getState().last).toBe(1); // the last good sample stays

    timers.shift()!();
    await vi.waitFor(() => expect(source.getState().last).toBe(3));
    expect(source.getState()).toMatchObject({ connected: true, error: undefined, attempts: 3 });
  });

  it('stop() aborts the request in flight, clears the timer and swallows the late result', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((value: number) => void) | undefined;
    const cleared: unknown[] = [];
    const reducer: DashboardReducer<{ last: number }, number> = {
      initial: () => ({ last: 0 }),
      hydrate: (s) => s,
      reduce: (_s, e) => ({ last: e }),
      parseEvent: () => undefined,
    };
    const source = new DashboardSource(
      reducer,
      pollFeed(
        (s) => {
          signal = s;
          return new Promise<number>((r) => (finish = r));
        },
        { intervalMs: 10, setTimer: () => 'h', clearTimer: (h) => cleared.push(h) },
      ),
    );
    const started = source.start();
    expect(signal?.aborted).toBe(false);

    source.stop();
    expect(signal?.aborted).toBe(true);
    finish?.(99);
    await started;
    expect(source.getState().last).toBe(0);
    expect(cleared).toEqual([]); // no timer was ever scheduled, and none is left
  });

  it('stop() clears a scheduled poll', async () => {
    const cleared: unknown[] = [];
    const feed = pollFeed(async () => 1, { intervalMs: 10, setTimer: () => 'next', clearTimer: (h) => cleared.push(h) });
    await feed.start(() => {});
    feed.stop();
    feed.stop();
    expect(cleared).toEqual(['next']);
  });
});

describe('selectDashboardFeed', () => {
  const embedded = (): DashboardFeed<number> => ({ mode: 'embedded', start: async () => {}, stop: () => {} });

  it('attaches when a daemon is running, even if an embedded feed is on offer', async () => {
    const feed = await selectDashboardFeed<number>({ socketPath: '/x', isDaemonRunning: async () => true, embedded });
    expect(feed.mode).toBe('attached');
  });

  it('runs embedded when no daemon is and the caller offers it', async () => {
    const feed = await selectDashboardFeed<number>({ socketPath: '/x', isDaemonRunning: async () => false, embedded });
    expect(feed.mode).toBe('embedded');
  });

  it('attaches anyway (to keep looking) when no daemon is running and nothing embedded is offered', async () => {
    const feed = await selectDashboardFeed<number>({ socketPath: '/x', isDaemonRunning: async () => false });
    expect(feed.mode).toBe('attached');
  });

  it('treats a throwing probe as "not running"', async () => {
    const feed = await selectDashboardFeed<number>({
      socketPath: '/x',
      isDaemonRunning: async () => {
        throw new Error('boom');
      },
      embedded,
    });
    expect(feed.mode).toBe('embedded');
  });
});

describe('pollFeed refresh (seam #1115)', () => {
  const reducer: DashboardReducer<{ last: number }, number> = {
    initial: () => ({ last: 0 }),
    hydrate: (s) => s,
    reduce: (_s, e) => ({ last: e }),
    parseEvent: () => undefined,
  };

  it('polls now: clears the waiting timer and fetches without rebuilding the source', async () => {
    const timers = new Map<number, () => void>();
    const cleared: number[] = [];
    let next = 0;
    let value = 0;
    const fetches: number[] = [];
    const source = new DashboardSource(
      reducer,
      pollFeed(
        async () => {
          value += 1;
          fetches.push(value);
          return value;
        },
        {
          intervalMs: 60_000,
          setTimer: (fn) => {
            next += 1;
            timers.set(next, fn);
            return next;
          },
          clearTimer: (handle) => {
            cleared.push(handle as number);
            timers.delete(handle as number);
          },
        },
      ),
    );
    expect(source.refresh()).toBe(false); // not started yet
    await source.start();
    expect(source.getState().last).toBe(1);
    expect(timers.size).toBe(1);

    expect(source.refresh()).toBe(true);
    await vi.waitFor(() => expect(source.getState().last).toBe(2));
    expect(cleared).toEqual([1]);
    expect(fetches).toEqual([1, 2]);
    // The interval restarts from the refreshed poll: exactly one timer waits.
    expect([...timers.keys()]).toEqual([2]);

    source.stop();
    expect(source.refresh()).toBe(false);
    expect(fetches).toEqual([1, 2]);
  });

  it('during a request in flight, polls again as soon as it settles (still one at a time)', async () => {
    const pending: Array<(value: number) => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const timers: Array<() => void> = [];
    const feed = pollFeed<number>(
      () =>
        new Promise<number>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.push((v) => {
            inFlight -= 1;
            resolve(v);
          });
        }),
      { intervalMs: 60_000, setTimer: (fn) => timers.push(fn), clearTimer: () => {} },
    );
    const source = new DashboardSource(reducer, feed);
    const started = source.start();
    expect(pending).toHaveLength(1);
    source.refresh();
    source.refresh();
    expect(pending).toHaveLength(1); // no second concurrent request
    pending.shift()!(1);
    await started;
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(timers).toHaveLength(0); // the refresh replaced the wait
    pending.shift()!(2);
    await vi.waitFor(() => expect(source.getState().last).toBe(2));
    expect(timers).toHaveLength(1);
    expect(maxInFlight).toBe(1);
    source.stop();
  });

  it('a source over a push feed cannot refresh', async () => {
    const feed: DashboardFeed<number> = { mode: 'embedded', start: async () => undefined, stop: () => undefined };
    const source = new DashboardSource(reducer, feed);
    await source.start();
    expect(source.refresh()).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { ExecutorRegistry } from './executors/index.js';
import { createHostTelemetry } from './host-telemetry.js';
import type { HeartbeatRequest, NodeApi, NodeEvent } from './node-api.js';
import { NodeEngine, type EngineScheduler } from './node-engine.js';
import { ApiError } from '../errors.js';

function scheduler(): EngineScheduler & { fireAll(): void } {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    setInterval: (fn: () => void) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id: unknown) => void timers.delete(id as number),
    fireAll: () => timers.forEach((fn) => fn()),
  } as unknown as EngineScheduler & { fireAll(): void };
}

const event: NodeEvent = { type: 'power.battery_low', severity: 'warning', at: '2026-01-01T00:00:00.000Z' };

function build(opts: {
  features?: string[];
  heartbeatFeatures?: string[];
  failFirst?: boolean;
  refuseHost?: boolean;
  pending?: NodeEvent[][];
  now?: () => number;
}) {
  const bodies: HeartbeatRequest[] = [];
  let calls = 0;
  const api = {
    async heartbeat(_id: string, body: HeartbeatRequest) {
      calls += 1;
      if (opts.failFirst === true && calls === 1) throw new Error('network down');
      if (opts.refuseHost === true && (body.events !== undefined || body.vitals?.host !== undefined)) {
        throw new ApiError({ status: 400, serverMessage: 'Validation failed', code: 'VALIDATION_ERROR', details: [], method: 'POST', url: 'http://h', structured: true, rawBody: undefined });
      }
      bodies.push(body);
      return (opts.heartbeatFeatures !== undefined ? { serverFeatures: opts.heartbeatFeatures } : {}) as never;
    },
    async claim() {
      return [];
    },
    async deregister() {},
  } as unknown as NodeApi;
  const pending: NodeEvent[][] = opts.pending ?? [[event]];
  const telemetry = createHostTelemetry({
    heartbeatMs: 15_000,
    sampler: { sample: () => ({ cpuCount: 4 }) },
    probe: { read: async () => ({ source: 'ac' as const }) },
    watcher: { observe: () => pending.shift() ?? [], observeDisk: () => [] },
  });
  const sched = scheduler();
  const engine = new NodeEngine({
    api,
    nodeId: 'n1',
    concurrency: 1,
    executors: new ExecutorRegistry(),
    scheduler: sched,
    sleep: () => new Promise((r) => setTimeout(r, 1)),
    pollIntervalMs: 1,
    collectVitals: () => ({ cpuPercent: 1 }),
    hostTelemetry: telemetry,
    ...(opts.features !== undefined ? { serverFeatures: opts.features } : {}),
    relaySpans: false,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    powerPollIntervalMs: 10_000,
  });
  return { engine, bodies, sched };
}

async function runOne(engine: NodeEngine, bodies: HeartbeatRequest[], n = 1): Promise<void> {
  const run = engine.run();
  await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(n));
  await engine.drain();
  await run;
}

describe('NodeEngine host telemetry (#1045)', () => {
  it('omits host, power and events when the server did not advertise node_host_vitals', async () => {
    const { engine, bodies } = build({});
    await runOne(engine, bodies);
    expect(bodies[0]?.vitals).toEqual({ cpuPercent: 1 });
    expect(bodies[0]).not.toHaveProperty('events');
  });

  it('omits them when the server advertises other features only', async () => {
    const { engine, bodies } = build({ features: ['something_else'] });
    await runOne(engine, bodies);
    expect(bodies[0]?.vitals).toEqual({ cpuPercent: 1 });
  });

  it('sends host, power and events when advertised', async () => {
    const { engine, bodies } = build({ features: ['node_host_vitals'] });
    await runOne(engine, bodies);
    expect(bodies[0]?.vitals).toEqual({ cpuPercent: 1, host: { cpuCount: 4 }, power: { source: 'ac' } });
    expect(bodies[0]?.events).toEqual([event]);
  });

  it('re-queues events when the heartbeat fails and sends them on the next beat', async () => {
    const { engine, bodies, sched } = build({ features: ['node_host_vitals'], failFirst: true });
    const run = engine.run();
    await vi.waitFor(() => expect(engine.getVitalsCounters().heartbeatFailures).toBe(1));
    expect(bodies).toHaveLength(0);
    sched.fireAll();
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]?.events).toEqual([event]);
    await engine.drain();
    await run;
  });

  it('stops sending host fields (and restores the events) after the server refuses them', async () => {
    const { engine, bodies } = build({ features: ['node_host_vitals'], refuseHost: true });
    await runOne(engine, bodies);
    expect(bodies[0]?.vitals).toEqual({ cpuPercent: 1 });
    expect(bodies[0]).not.toHaveProperty('events');
  });

  it('learns node_host_vitals from a heartbeat response: first beat plain, later beats carry host fields', async () => {
    const { engine, bodies, sched } = build({ heartbeatFeatures: ['node_host_vitals'] });
    const run = engine.run();
    await vi.waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]?.vitals).toEqual({ cpuPercent: 1 });
    expect(bodies[0]).not.toHaveProperty('events');
    sched.fireAll();
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
    expect(bodies[1]?.vitals).toEqual({ cpuPercent: 1, host: { cpuCount: 4 }, power: { source: 'ac' } });
    expect(bodies[1]?.events).toEqual([event]);
    await engine.drain();
    await run;
  });

  it('keeps sending plain vitals when heartbeat responses advertise nothing', async () => {
    const { engine, bodies, sched } = build({ heartbeatFeatures: [] });
    const run = engine.run();
    await vi.waitFor(() => expect(bodies.length).toBe(1));
    sched.fireAll();
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
    expect(bodies[1]?.vitals).toEqual({ cpuPercent: 1 });
    await engine.drain();
    await run;
  });

  it('a power.source_changed event from the poll fires one extra heartbeat, debounced to 5 s', async () => {
    const change: NodeEvent = { type: 'power.source_changed', severity: 'warning', at: '2026-01-01T00:00:00.000Z' };
    let clock = 1_000_000;
    // First collect (the initial beat) yields nothing; each later poll yields a change.
    const { engine, bodies, sched } = build({
      features: ['node_host_vitals'],
      pending: [[], [change], [change], [change], [change], [change]],
      now: () => clock,
    });
    const run = engine.run();
    await vi.waitFor(() => expect(bodies.length).toBe(1));
    // sched.fireAll fires BOTH the heartbeat interval and the power poll, so
    // drive the poll alone through the engine's private method.
    const poll = () => (engine as unknown as { pollPower(): Promise<void> }).pollPower();
    await poll();
    await vi.waitFor(() => expect(bodies.length).toBe(2));
    clock += 2_000; // inside the 5 s window: no extra heartbeat
    await poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies.length).toBe(2);
    clock += 4_000; // 6 s since the last extra beat
    await poll();
    await vi.waitFor(() => expect(bodies.length).toBe(3));
    void sched;
    await engine.drain();
    await run;
  });
});

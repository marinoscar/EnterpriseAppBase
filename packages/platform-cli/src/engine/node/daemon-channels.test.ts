import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { daemonAttachFeed, DashboardSource, type DashboardReducer } from '../tui/dashboard/source.js';
import { listDaemonChannels, registerDaemonChannel, resetDaemonChannelsForTests } from './daemon-channels.js';
import { startDaemonHost, type DaemonHost } from './daemon.js';
import { NodeLogger } from './logger.js';
import { nodeDashboardReducer } from './node-dashboard-source.js';
import type { NodeEngine } from './node-engine.js';
import type { NodeSnapshot } from './node-events.js';

// =============================================================================
// Daemon channels over a REAL socket  (RETRO-G1.3)
// =============================================================================

let dir: string;
let host: DaemonHost | undefined;
let sources: Array<DashboardSource<never, never>>;

const snapshot = (): NodeSnapshot => ({
  nodeId: 'node-1',
  status: 'idle',
  concurrency: 1,
  eligibleTypes: [],
  activeJobs: [],
  history: [],
  counters: { claimed: 0, succeeded: 0, failed: 0, rateLimited: 0 },
  startedAt: 't',
  lastHeartbeatAt: null,
  heartbeatAgeMs: null,
});

const engine = { getSnapshot: snapshot, setConcurrency: () => {}, drain: async () => {}, stop: async () => {} } as unknown as NodeEngine;

const socketPath = (): string => join(dir, 'node.sock');

async function startHost(): Promise<DaemonHost> {
  host = await startDaemonHost(engine, new NodeLogger({ path: join(dir, 'log', 'node.log') }), {
    pidPath: join(dir, 'node.pid'),
    socketPath: socketPath(),
  });
  return host;
}

interface BackupState {
  phase: string;
  events: number[];
}
const backupReducer: DashboardReducer<BackupState, number> = {
  initial: () => ({ phase: '', events: [] }),
  hydrate: (s, snap) => ({ ...s, phase: (snap as { phase: string }).phase }),
  reduce: (s, e) => ({ ...s, events: [...s.events, e] }),
  parseEvent: (f) => (typeof f === 'number' ? f : undefined),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'appctl-channels-'));
  resetDaemonChannelsForTests();
  sources = [];
});

afterEach(async () => {
  for (const source of sources) source.stop();
  await host?.close();
  host = undefined;
  resetDaemonChannelsForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('registerDaemonChannel', () => {
  it('validates the id and refuses the built-in and duplicates', () => {
    const channel = { snapshot: () => ({}), events: new EventEmitter() };
    expect(() => registerDaemonChannel({ id: 'node', ...channel })).toThrow(/built-in/);
    expect(() => registerDaemonChannel({ id: 'Bad Id', ...channel })).toThrow(/invalid/);
    const off = registerDaemonChannel({ id: 'backup', ...channel });
    expect(() => registerDaemonChannel({ id: 'backup', ...channel })).toThrow(/already registered/);
    expect(listDaemonChannels().map((c) => c.id)).toEqual(['backup']);
    off();
    expect(listDaemonChannels()).toEqual([]);
  });
});

describe('a second engine on the same socket', () => {
  it('is visible to an attached client without disturbing the node channel', async () => {
    const emitter = new EventEmitter();
    registerDaemonChannel({ id: 'backup', snapshot: () => ({ phase: 'scan' }), events: emitter });
    await startHost();

    const node = new DashboardSource(nodeDashboardReducer, daemonAttachFeed({ socketPath: socketPath() }));
    const backup = new DashboardSource(backupReducer, daemonAttachFeed<number>({ socketPath: socketPath(), channel: 'backup' }));
    sources.push(node as never, backup as never);
    await node.start();
    await backup.start();

    await new Promise((r) => setTimeout(r, 50));
    expect(node.getState().snapshot?.nodeId).toBe('node-1');
    expect(backup.getState().phase).toBe('scan');

    emitter.emit('event', 42);
    host!.broadcast({ kind: 'idle', at: 't' });
    await new Promise((r) => setTimeout(r, 50));

    expect(backup.getState().events).toEqual([42]);
    expect(node.getState().events).toEqual([{ kind: 'idle', at: 't' }]);
    // Neither read the other's frames.
    expect(node.getState().events).toHaveLength(1);
  });

  it('forwards a channel registered AFTER the host started, and stops when it is unregistered', async () => {
    await startHost();
    const backup = new DashboardSource(backupReducer, daemonAttachFeed<number>({ socketPath: socketPath(), channel: 'backup' }));
    sources.push(backup as never);
    await backup.start();

    const emitter = new EventEmitter();
    const off = registerDaemonChannel({ id: 'backup', snapshot: () => ({ phase: 'late' }), events: emitter });
    await new Promise((r) => setTimeout(r, 50));
    expect(backup.getState().phase).toBe('late');

    emitter.emit('event', 1);
    await new Promise((r) => setTimeout(r, 30));
    off();
    emitter.emit('event', 2);
    await new Promise((r) => setTimeout(r, 30));
    expect(backup.getState().events).toEqual([1]);
    expect(emitter.listenerCount('event')).toBe(0);
  });

  it('a channel whose snapshot throws costs only that channel', async () => {
    registerDaemonChannel({
      id: 'broken',
      snapshot: () => {
        throw new Error('boom');
      },
      events: new EventEmitter(),
    });
    await startHost();

    const node = new DashboardSource(nodeDashboardReducer, daemonAttachFeed({ socketPath: socketPath() }));
    sources.push(node as never);
    await node.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(node.getState().snapshot?.nodeId).toBe('node-1');
  });

  it('close() detaches from every channel emitter', async () => {
    const emitter = new EventEmitter();
    registerDaemonChannel({ id: 'backup', snapshot: () => ({}), events: emitter });
    await startHost();
    expect(emitter.listenerCount('event')).toBe(1);
    await host!.close();
    expect(emitter.listenerCount('event')).toBe(0);
  });
});

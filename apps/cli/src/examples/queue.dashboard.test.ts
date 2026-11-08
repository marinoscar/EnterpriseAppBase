import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { publishSyncEngine, syncDashboardReducer } from './queue.dashboard.js';

// The DashboardReducer / registerDaemonChannel example (RETRO-G1.3).

describe('syncDashboardReducer', () => {
  it('folds a snapshot and events without ink or a socket', () => {
    let state = syncDashboardReducer.initial();
    state = syncDashboardReducer.hydrate(state, { phase: 'copying', filesTotal: 3, filesDone: 0 });
    const event = syncDashboardReducer.parseEvent({ kind: 'file-copied' });
    expect(event).toBeDefined();
    state = syncDashboardReducer.reduce(state, event!);
    expect(state).toEqual({ snapshot: { phase: 'copying', filesTotal: 3, filesDone: 0 }, copied: 1 });
    expect(syncDashboardReducer.parseEvent('nope')).toBeUndefined();
  });
});

describe('publishSyncEngine', () => {
  it('registers the channel once and unregisters on request', () => {
    const engine = Object.assign(new EventEmitter(), {
      getSnapshot: () => ({ phase: 'idle' as const, filesTotal: 0, filesDone: 0 }),
    });
    const off = publishSyncEngine(engine);
    expect(() => publishSyncEngine(engine)).toThrow(/already registered/);
    off();
    publishSyncEngine(engine)();
  });
});

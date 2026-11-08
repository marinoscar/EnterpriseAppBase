import { registerDaemonChannel } from '@marinoscar/platform-cli/node';
import { DashboardSource, daemonAttachFeed, type DashboardReducer } from '@marinoscar/platform-cli/tui';

// =============================================================================
// EXAMPLE, NOT WIRED: a second engine's dashboard (RETRO-G1.3)
// =============================================================================
//
// An app that hosts another engine beside the worker (a sync mirror, an
// importer) shows it in the TUI in two halves:
//
//   daemon side   `registerDaemonChannel({ id, snapshot, events })` publishes
//                 the engine on the SAME socket the worker already hosts. Its
//                 frames carry `channel: 'sync'`; the worker's carry none.
//   TUI side      a pure `DashboardReducer` over the engine's snapshot and
//                 events, fed by `daemonAttachFeed({ channel: 'sync' })`. The
//                 screen renders it with `useDashboard(source)`.
//
// The reducer is plain functions, so it is tested without ink or a socket
// (see queue.dashboard.test.ts). Attaching is read-only: the feed never sends
// a command to the daemon.
// =============================================================================

/** What the example engine reports. */
export interface SyncSnapshot {
  phase: 'idle' | 'scanning' | 'copying';
  filesTotal: number;
  filesDone: number;
}

/** One thing the example engine says. */
export interface SyncEvent {
  kind: 'file-copied' | 'phase';
  phase?: SyncSnapshot['phase'];
}

/** The dashboard's data. */
export interface SyncDashboardData {
  snapshot: SyncSnapshot | undefined;
  copied: number;
}

/** The reducer: pure, so a screen and a test fold the same way. */
export const syncDashboardReducer: DashboardReducer<SyncDashboardData, SyncEvent> = {
  initial: () => ({ snapshot: undefined, copied: 0 }),
  hydrate: (state, snapshot) => ({ ...state, snapshot: snapshot as SyncSnapshot }),
  reduce: (state, event) => (event.kind === 'file-copied' ? { ...state, copied: state.copied + 1 } : state),
  parseEvent: (frame) =>
    typeof frame === 'object' && frame !== null && 'kind' in frame ? (frame as SyncEvent) : undefined,
};

/** The TUI half: attach to the 'sync' channel of the worker's socket. */
export function createSyncDashboard(socketPath: string): DashboardSource<SyncDashboardData, SyncEvent> {
  return new DashboardSource(syncDashboardReducer, daemonAttachFeed<SyncEvent>({ socketPath, channel: 'sync' }));
}

/** The daemon half: publish the engine (an `EventEmitter`) on the worker's socket. */
export function publishSyncEngine(engine: {
  getSnapshot(): SyncSnapshot;
  on(name: string, listener: (payload: unknown) => void): unknown;
  off(name: string, listener: (payload: unknown) => void): unknown;
}): () => void {
  return registerDaemonChannel({ id: 'sync', snapshot: () => engine.getSnapshot(), events: engine });
}

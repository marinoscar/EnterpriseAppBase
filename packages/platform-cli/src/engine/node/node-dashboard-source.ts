import {
  DashboardSource,
  daemonAttachFeed,
  type DashboardConnection,
  type DashboardReducer,
} from '../tui/dashboard/source.js';
import type { connectToDaemon } from './daemon.js';
import type { LogRecord } from './logger.js';
import type { NodeEngineEvent, NodeSnapshot } from './node-events.js';

// =============================================================================
// The TUI's data source  (issue #279, epic #254; refactored in RETRO-G1.3)
// =============================================================================
//
// The dashboard is mostly a matter of rendering a stream that already exists:
// the daemon pushes a snapshot on connect, then a log tail, then every engine
// event live. So this module is the whole non-visual half of the screen — and
// it lives here rather than in `tui/` so it can be tested without ink, without
// a terminal, and without React.
//
// -----------------------------------------------------------------------------
// ATTACHING IS READ-ONLY, AND THAT IS A DESIGN DECISION
// -----------------------------------------------------------------------------
//
// This source NEVER sends a command. Not `status`, not `set-concurrency`,
// nothing — the daemon volunteers everything on connect. Two consequences,
// both deliberate:
//
//   1. An operator can inspect a HEADLESS worker — a systemd unit, a
//      container running production work — without perturbing it, and
//      detaching leaves it running untouched.
//
//   2. A TUI that can accidentally stop production work is a liability. The
//      useful mutations (`set-concurrency`, `stop`) are already one-line
//      commands; putting them behind a highlighted row in a full-screen app
//      is how somebody stops a fleet member by leaning on the keyboard.
//
// -----------------------------------------------------------------------------
// RECONNECTION
// -----------------------------------------------------------------------------
//
// A worker RESTARTS: the memory valve exits deliberately (#277) and a
// supervisor brings it back. A dashboard that died with it would be useless in
// exactly the situation somebody opened it for, so a closed connection is
// retried until `stop()` — and `stop()` is the only thing that ends the loop,
// so a teardown can never leave a timer behind.
//
// -----------------------------------------------------------------------------
// WHERE THE MACHINERY LIVES NOW
// -----------------------------------------------------------------------------
//
// The attach, reconnect and teardown contracts above are implemented ONCE, in
// `tui/dashboard/source.ts` (`daemonAttachFeed`, `DashboardSource`), so an app
// can reuse them for another daemon-hosted engine. What stays here is what is
// specific to the worker: `nodeDashboardReducer` (the pure state transitions)
// and `NodeDashboardSource`, now a thin compatibility wrapper over the two.
// =============================================================================

/** How many log lines and events the dashboard keeps. */
export const MAX_DASHBOARD_LINES = 200;

/**
 * What the worker dashboard shows, without the connection fields.
 *
 * @stability experimental
 */
export interface NodeDashboardData {
  snapshot: NodeSnapshot | undefined;
  logs: LogRecord[];
  events: NodeEngineEvent[];
}

/**
 * The worker dashboard's state: its data plus the connection fields. A
 * superset of what `NodeDashboardSource` has always exposed.
 *
 * @stability experimental
 */
export type DashboardState = NodeDashboardData & DashboardConnection;

/** Keep the newest `limit`. */
function clip<T>(items: T[], limit: number): T[] {
  return items.length > limit ? items.slice(items.length - limit) : items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Builds the worker dashboard's reducer with its own buffer bound.
 *
 * @param options - `maxLines`, how many log lines and events to keep.
 * @returns A pure reducer: no I/O, no React, safe to call from a test.
 * @stability experimental
 */
export function createNodeDashboardReducer(
  options: { maxLines?: number | undefined } = {},
): DashboardReducer<NodeDashboardData, NodeEngineEvent> {
  const maxLines = options.maxLines ?? MAX_DASHBOARD_LINES;
  return {
    initial: () => ({ snapshot: undefined, logs: [], events: [] }),
    hydrate: (state, snapshot) =>
      isRecord(snapshot) && typeof snapshot.nodeId === 'string'
        ? { ...state, snapshot: snapshot as unknown as NodeSnapshot }
        : state,
    reduce: (state, event) => ({ ...state, events: clip([...state.events, event], maxLines) }),
    log: (state, lines) => ({ ...state, logs: clip([...state.logs, ...lines], maxLines) }),
    parseEvent: (frame) =>
      isRecord(frame) && typeof frame.kind === 'string' ? (frame as unknown as NodeEngineEvent) : undefined,
  };
}

/**
 * The worker dashboard's reducer with the default buffer bound.
 *
 * @stability experimental
 */
export const nodeDashboardReducer: DashboardReducer<NodeDashboardData, NodeEngineEvent> = createNodeDashboardReducer();

export interface DashboardSourceOptions {
  socketPath: string;
  onChange: (state: DashboardState) => void;
  /** Test seams. */
  connect?: typeof connectToDaemon | undefined;
  reconnectDelayMs?: number | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
  maxLines?: number | undefined;
}

/**
 * The worker dashboard's source over a daemon socket: a compatibility wrapper
 * (`DashboardSource` + `nodeDashboardReducer` + `daemonAttachFeed`) that keeps
 * the class and options the TUI has used since #279.
 *
 * @stability experimental
 */
export class NodeDashboardSource {
  private readonly source: DashboardSource<NodeDashboardData, NodeEngineEvent>;

  constructor(options: DashboardSourceOptions) {
    this.source = new DashboardSource(
      options.maxLines === undefined ? nodeDashboardReducer : createNodeDashboardReducer({ maxLines: options.maxLines }),
      daemonAttachFeed<NodeEngineEvent>({
        socketPath: options.socketPath,
        reconnectMs: options.reconnectDelayMs,
        connect: options.connect,
        setTimer: options.setTimer,
        clearTimer: options.clearTimer,
      }),
      { onChange: options.onChange },
    );
  }

  getState(): DashboardState {
    return this.source.getState();
  }

  /** Attach, and keep attaching. Resolves once the first attempt has settled. */
  start(): Promise<void> {
    return this.source.start();
  }

  /**
   * Detach. The daemon is NOT told, and is not affected in any way.
   *
   * Idempotent, and it clears the reconnect timer — a source that left one
   * behind would keep a finished ink process alive, which looks like a hang.
   */
  stop(): void {
    this.source.stop();
  }
}

/** One-line summary of an engine event, shared by the dashboard and the log view. */
export function describeEvent(event: NodeEngineEvent): string {
  switch (event.kind) {
    case 'started':
      return `worker started (${event.nodeId}, concurrency ${event.concurrency})`;
    case 'idle':
      return 'idle';
    case 'claimed':
      return `claimed ${event.jobs.length} job(s)`;
    case 'job-started':
      return `▶ ${event.type} ${event.jobId}`;
    case 'job-input':
      return `  ↓ input ${event.objectId} (${event.bytes} bytes)`;
    case 'job-log':
      return `  · ${event.message}`;
    case 'job-succeeded':
      return `✓ ${event.type} ${event.jobId} in ${event.durationMs}ms`;
    case 'job-failed':
      return `✗ ${event.type} ${event.jobId}${event.rateLimited ? ' (rate limited)' : ''}: ${event.error}`;
    case 'lease-renewed':
      return `  ↻ lease ${event.jobId}`;
    case 'lease-renew-failed':
      return `  ! lease renew failed ${event.jobId}: ${event.error}`;
    case 'heartbeat':
      return `♥ heartbeat (concurrency ${event.concurrency})`;
    case 'heartbeat-failed':
      return `! heartbeat failed: ${event.error}`;
    case 'vitals-disabled':
      return `! server refused vitals; no longer sending them: ${event.error}`;
    case 'telemetry-disabled':
      return `! server has no span relay; no longer sending job spans: ${event.error}`;
    case 'concurrency-changed':
      return `concurrency now ${event.concurrency}`;
    case 'claim-failed':
      return `! claim failed: ${event.error}`;
    case 'draining':
      return `draining (${event.inFlight} in flight)`;
    case 'stopped':
      return `stopped${event.deregistered ? ' and deregistered' : ''}`;
  }
}

/** Elapsed milliseconds for an active job, for the dashboard's age column. */
export function elapsedMs(startedAt: string, now: number): number {
  const started = Date.parse(startedAt);
  return Number.isNaN(started) ? 0 : Math.max(0, now - started);
}

/** `1m 04s`, `12s`, `2h 05m`. Short enough for a narrow column. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

import type { LogRecord } from '../../node/logger.js';
import type { DashboardFeed, DashboardFeedMessage, DashboardMode } from '../dashboard/index.js';

// =============================================================================
// Fake dashboard feeds  (RETRO-G1.5, #1069)
// =============================================================================
//
// A `DashboardSource` is fed by a `DashboardFeed`. These two let a test drive
// one frame by frame, with no socket, emitter or timer. They import no ink.
// =============================================================================

/**
 * A feed a test drives by hand.
 *
 * @typeParam E - The event type the reducer expects.
 * @stability experimental
 */
export interface FakeDashboardFeed<E> extends DashboardFeed<E> {
  /** True once the source started it. */
  readonly started: boolean;
  /** True once the source stopped it. */
  readonly stopped: boolean;
  /** Reports a connection attempt. */
  attempt(): void;
  /** Reports the source reachable. */
  connect(): void;
  /** Reports the source lost. */
  disconnect(error?: string): void;
  /** Delivers the on-connect snapshot (the reducer's `hydrate` folds it). */
  snapshot(snapshot: unknown): void;
  /** Delivers an unvalidated wire value (the reducer's `parseEvent` decides). */
  frame(frame: unknown): void;
  /** Delivers an event already typed. */
  event(event: E): void;
  /** Delivers a log tail. */
  logs(lines: LogRecord[]): void;
  /** Delivers an error message from the source. */
  error(message: string): void;
}

function fakeFeed<E>(mode: DashboardMode): FakeDashboardFeed<E> {
  let emit: ((message: DashboardFeedMessage<E>) => void) | undefined;
  let started = false;
  let stopped = false;
  const send = (message: DashboardFeedMessage<E>): void => {
    if (emit === undefined) {
      throw new Error('The fake feed has not been started: call source.start() (or render the screen) before driving it.');
    }
    emit(message);
  };
  return {
    mode,
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    async start(sink) {
      emit = sink;
      started = true;
    },
    stop() {
      stopped = true;
    },
    attempt: () => send({ kind: 'attempt' }),
    connect: () => send({ kind: 'connected' }),
    disconnect: (error) => send({ kind: 'disconnected', ...(error === undefined ? {} : { error }) }),
    snapshot: (snapshot) => send({ kind: 'snapshot', snapshot }),
    frame: (frame) => send({ kind: 'frame', frame }),
    event: (event) => send({ kind: 'event', event }),
    logs: (lines) => send({ kind: 'logs', lines }),
    error: (message) => send({ kind: 'error', message }),
  };
}

/**
 * A fake of `daemonAttachFeed`: mode `attached`, fed with wire frames and a
 * snapshot.
 *
 * @typeParam E - The event type.
 * @returns The feed and its drivers.
 * @stability experimental
 * @example
 * ```ts
 * const feed = fakeDaemonFeed<SyncEvent>();
 * const source = new DashboardSource(syncDashboardReducer, feed);
 * await source.start();
 * feed.connect();
 * feed.snapshot({ phase: 'idle', filesTotal: 3, filesDone: 0 });
 * feed.frame({ kind: 'file-copied' });
 * expect(source.getState().copied).toBe(1);
 * ```
 */
export function fakeDaemonFeed<E = unknown>(): FakeDashboardFeed<E> {
  return fakeFeed<E>('attached');
}

/**
 * A fake of `inProcessFeed`: mode `embedded`, fed with typed events.
 *
 * @typeParam E - The event type.
 * @returns The feed and its drivers.
 * @stability experimental
 */
export function fakeEmitterFeed<E = unknown>(): FakeDashboardFeed<E> {
  return fakeFeed<E>('embedded');
}

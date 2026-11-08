import { connectToDaemon, DaemonNotRunningError } from '../../node/daemon.js';
import { messageChannel, NODE_CHANNEL, type DaemonMessage } from '../../node/ipc-protocol.js';
import type { LogRecord } from '../../node/logger.js';

// =============================================================================
// The dashboard-source pattern  (RETRO-G1.3, epic #1064)
// =============================================================================
//
// A TUI dashboard is a pure reducer fed by a pluggable feed. Nothing in this
// module imports React or ink, so every piece is testable with a fake socket,
// a fake emitter or a fake fetch.
//
//   feed      WHERE the data comes from: a daemon socket (`daemonAttachFeed`),
//             an engine running in this process (`inProcessFeed`) or an HTTP
//             poll (`pollFeed`). A feed knows nothing about the state's shape.
//   reducer   WHAT the data means: `DashboardReducer<S, E>` turns the snapshot
//             and each event into the next state. Pure functions.
//   source    The glue: `DashboardSource` owns the state, applies the reducer
//             to what the feed emits, adds the connection fields and notifies
//             subscribers (`useDashboard` is the ink side of that).
//
// -----------------------------------------------------------------------------
// ATTACHING IS READ-ONLY, AND THAT IS A DESIGN DECISION
// -----------------------------------------------------------------------------
//
// `daemonAttachFeed` NEVER sends a command. Not `status`, not
// `set-concurrency`, nothing: the daemon volunteers everything on connect. An
// operator can inspect a HEADLESS worker (a systemd unit, a container running
// production work) without perturbing it, and detaching leaves it untouched.
// A TUI that can stop a fleet member from a highlighted row is a liability;
// the useful mutations stay one-line commands.
//
// -----------------------------------------------------------------------------
// RECONNECTION
// -----------------------------------------------------------------------------
//
// A worker RESTARTS: the memory valve exits deliberately and a supervisor
// brings it back. A dashboard that died with it would be useless in exactly
// the situation somebody opened it for, so a closed connection is retried
// until `stop()`. `stop()` is the only thing that ends the loop, so a teardown
// can never leave a timer behind.
// =============================================================================

/**
 * How a dashboard turns what a feed delivers into state. Every method is pure.
 *
 * @typeParam S - The dashboard's data (without the connection fields).
 * @typeParam E - One event, as the reducer understands it.
 * @stability experimental
 * @extensionPoint hook
 */
export interface DashboardReducer<S, E> {
  /** The state before anything has arrived. */
  initial(): S;
  /** Folds the snapshot the feed delivers on connect (the daemon's snapshot frame). */
  hydrate(state: S, snapshot: unknown): S;
  /** Folds one event. */
  reduce(state: S, event: E): S;
  /** Folds a log tail, when the dashboard shows one. */
  log?(state: S, lines: LogRecord[]): S;
  /** Validates a raw frame from the wire; `undefined` drops it. */
  parseEvent(frame: unknown): E | undefined;
}

/**
 * Where a dashboard's data comes from.
 *
 * @stability experimental
 */
export type DashboardMode = 'attached' | 'embedded' | 'poll';

/**
 * What a feed tells its source.
 *
 * `frame` carries an unvalidated wire value (the source runs it through
 * `reducer.parseEvent`); `event` carries one already typed (an in-process
 * emitter, a poll result).
 *
 * @stability experimental
 */
export type DashboardFeedMessage<E> =
  | { kind: 'attempt' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; error?: string | undefined }
  | { kind: 'snapshot'; snapshot: unknown }
  | { kind: 'frame'; frame: unknown }
  | { kind: 'event'; event: E }
  | { kind: 'logs'; lines: LogRecord[] }
  | { kind: 'error'; message: string };

/**
 * A source of dashboard data. `start` resolves once the first attempt has
 * settled; `stop` is idempotent and ends every timer and connection.
 *
 * @stability experimental
 */
export interface DashboardFeed<E> {
  readonly mode: DashboardMode;
  start(emit: (message: DashboardFeedMessage<E>) => void): Promise<void>;
  stop(): void;
}

/**
 * The connection fields every dashboard state carries.
 *
 * @stability experimental
 */
export interface DashboardConnection {
  connected: boolean;
  /** Whether the feed was ever reached. Distinguishes "starting" from "gone". */
  everConnected: boolean;
  /** The last failure, for the frame's notice line. */
  error: string | undefined;
  /** Connection or poll attempts so far. */
  attempts: number;
  mode: DashboardMode;
}

/**
 * Options of {@link DashboardSource}.
 *
 * @stability experimental
 */
export interface DashboardSourceOptions<S> {
  /** Called with every new state (in addition to `subscribe`). */
  onChange?: ((state: S & DashboardConnection) => void) | undefined;
}

/**
 * Owns a dashboard's state: applies the reducer to what the feed emits.
 *
 * @typeParam S - The dashboard's data.
 * @typeParam E - One event.
 * @stability experimental
 * @example
 * ```ts
 * const source = new DashboardSource(myReducer, daemonAttachFeed({ socketPath, channel: 'backup' }));
 * // in a screen: const state = useDashboard(source);
 * ```
 */
export class DashboardSource<S, E> {
  private inner: S;
  private connection: DashboardConnection;
  private current: S & DashboardConnection;
  private readonly subscribers = new Set<(state: S & DashboardConnection) => void>();
  private stopped = false;
  private started = false;

  constructor(
    private readonly reducer: DashboardReducer<S, E>,
    private readonly feed: DashboardFeed<E>,
    private readonly options: DashboardSourceOptions<S> = {},
  ) {
    this.inner = reducer.initial();
    this.connection = { connected: false, everConnected: false, error: undefined, attempts: 0, mode: feed.mode };
    this.current = { ...this.inner, ...this.connection };
  }

  /** The current state. A NEW object after every change, so React sees it. */
  getState = (): S & DashboardConnection => this.current;

  /** Registers a listener; returns the unsubscribe. */
  subscribe = (listener: (state: S & DashboardConnection) => void): (() => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };

  /** Starts the feed. Resolves once its first attempt has settled. Idempotent. */
  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    await this.feed.start((message) => this.receive(message));
  }

  /**
   * Stops the feed and ignores anything it says afterwards. Idempotent. The
   * daemon (or server) is not told and is not affected in any way.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.feed.stop();
    this.publish({ connection: { connected: false } });
  }

  private receive(message: DashboardFeedMessage<E>): void {
    if (this.stopped) return;
    switch (message.kind) {
      case 'attempt':
        this.publish({ connection: { attempts: this.connection.attempts + 1 } });
        return;
      case 'connected':
        this.publish({ connection: { connected: true, everConnected: true, error: undefined } });
        return;
      case 'disconnected':
        this.publish({
          connection: { connected: false, ...(message.error !== undefined ? { error: message.error } : {}) },
        });
        return;
      case 'snapshot':
        this.publish({ data: this.reducer.hydrate(this.inner, message.snapshot) });
        return;
      case 'frame': {
        const event = this.reducer.parseEvent(message.frame);
        if (event !== undefined) this.publish({ data: this.reducer.reduce(this.inner, event) });
        return;
      }
      case 'event':
        this.publish({ data: this.reducer.reduce(this.inner, message.event) });
        return;
      case 'logs':
        if (this.reducer.log !== undefined) this.publish({ data: this.reducer.log(this.inner, message.lines) });
        return;
      case 'error':
        this.publish({ connection: { error: message.message } });
        return;
    }
  }

  private publish(patch: { data?: S; connection?: Partial<DashboardConnection> }): void {
    if (patch.data !== undefined) this.inner = patch.data;
    if (patch.connection !== undefined) this.connection = { ...this.connection, ...patch.connection };
    // A NEW OBJECT every time. The consumer is React, which compares by
    // identity; mutating in place would render the first frame and then never
    // update again: the classic "the TUI is frozen" bug.
    this.current = { ...this.inner, ...this.connection };
    this.options.onChange?.(this.current);
    for (const subscriber of [...this.subscribers]) subscriber(this.current);
  }
}

// -----------------------------------------------------------------------------
// Feed 1: attach to the daemon socket
// -----------------------------------------------------------------------------

/**
 * Options of {@link daemonAttachFeed}.
 *
 * @stability experimental
 */
export interface DaemonAttachFeedOptions {
  socketPath: string;
  /** Which engine's frames to read. Default `node` (the frames with no `channel` field). */
  channel?: string | undefined;
  /** Wait between reconnect attempts. Default 2000. */
  reconnectMs?: number | undefined;
  /** Test seams. */
  connect?: typeof connectToDaemon | undefined;
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
}

/**
 * Attaches read-only to a worker daemon's socket and keeps re-attaching until
 * `stop()`. Never sends a frame.
 *
 * @typeParam E - The event type the reducer expects after `parseEvent`.
 * @param options - The socket path and, to read an app's second engine, its channel id.
 * @returns A feed in `attached` mode.
 * @stability experimental
 */
export function daemonAttachFeed<E = unknown>(options: DaemonAttachFeedOptions): DashboardFeed<E> {
  const channel = options.channel ?? NODE_CHANNEL;
  let emit: ((message: DashboardFeedMessage<E>) => void) | undefined;
  let client: { close(): void } | undefined;
  let timer: unknown;
  let stopped = false;

  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));

  const receive = (message: DaemonMessage): void => {
    switch (message.type) {
      case 'ack':
        // This feed sends no commands, so an ack can only be the echo of
        // another attached client's request. Not ours to render.
        return;
      case 'error':
        emit?.({ kind: 'error', message: message.message });
        return;
      case 'snapshot':
        if (messageChannel(message) === channel) emit?.({ kind: 'snapshot', snapshot: message.snapshot });
        return;
      case 'log-tail':
        if (messageChannel(message) === channel) emit?.({ kind: 'logs', lines: message.lines });
        return;
      case 'event':
        if (messageChannel(message) === channel) emit?.({ kind: 'frame', frame: message.event });
        return;
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || timer !== undefined) return;
    timer = setTimer(() => {
      timer = undefined;
      void attach();
    }, options.reconnectMs ?? 2_000);
  };

  const attach = async (): Promise<void> => {
    if (stopped) return;
    emit?.({ kind: 'attempt' });
    const connect = options.connect ?? connectToDaemon;
    try {
      const connected = await connect({
        socketPath: options.socketPath,
        onMessage: receive,
        onClose: () => {
          client = undefined;
          emit?.({ kind: 'disconnected' });
          scheduleReconnect();
        },
      });
      if (stopped) {
        connected.close();
        return;
      }
      client = connected;
      emit?.({ kind: 'connected' });
    } catch (error) {
      client = undefined;
      emit?.({
        kind: 'disconnected',
        error:
          error instanceof DaemonNotRunningError
            ? 'No worker is running here.'
            : error instanceof Error
              ? error.message
              : String(error),
      });
      scheduleReconnect();
    }
  };

  return {
    mode: 'attached',
    async start(sink) {
      emit = sink;
      await attach();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      client?.close();
      client = undefined;
    },
  };
}

// -----------------------------------------------------------------------------
// Feed 2: an engine running in this process
// -----------------------------------------------------------------------------

/**
 * The slice of an emitter {@link inProcessFeed} needs. Node's `EventEmitter`
 * satisfies it.
 *
 * @stability experimental
 */
export interface DashboardEmitter {
  // `any` because Node's EventEmitter declares its listeners `(...args: any[])`.
  on(name: string, listener: (...args: any[]) => void): unknown;
  off(name: string, listener: (...args: any[]) => void): unknown;
}

/**
 * Options of {@link inProcessFeed}.
 *
 * @stability experimental
 */
export interface InProcessFeedOptions {
  /** The engine's current state, delivered on start and after every event. */
  snapshot(): unknown;
  /** The event name on the emitter. Default `event`. */
  eventName?: string | undefined;
  /** An optional second event name carrying one log record or an array of them. */
  logEventName?: string | undefined;
  /** `false` delivers the snapshot once only, like the daemon does. Default `true`. */
  refreshSnapshot?: boolean | undefined;
}

/**
 * Feeds a dashboard from an engine running in this process: the snapshot on
 * start, then every event the emitter fires. No socket, no reconnection.
 *
 * @typeParam E - The event type the emitter fires.
 * @param emitter - The engine's emitter.
 * @param options - How to read its snapshot and which event name to follow.
 * @returns A feed in `embedded` mode.
 * @stability experimental
 */
export function inProcessFeed<E = unknown>(emitter: DashboardEmitter, options: InProcessFeedOptions): DashboardFeed<E> {
  const eventName = options.eventName ?? 'event';
  let stopped = false;
  let detach: (() => void) | undefined;

  return {
    mode: 'embedded',
    async start(emit) {
      if (stopped) return;
      emit({ kind: 'attempt' });
      const onEvent = (event: E): void => {
        if (stopped) return;
        emit({ kind: 'event', event });
        if (options.refreshSnapshot !== false) emit({ kind: 'snapshot', snapshot: options.snapshot() });
      };
      const onLog = (payload: LogRecord | LogRecord[]): void => {
        if (!stopped) emit({ kind: 'logs', lines: Array.isArray(payload) ? payload : [payload] });
      };
      emitter.on(eventName, onEvent);
      if (options.logEventName !== undefined) emitter.on(options.logEventName, onLog);
      detach = () => {
        emitter.off(eventName, onEvent);
        if (options.logEventName !== undefined) emitter.off(options.logEventName, onLog);
      };
      emit({ kind: 'connected' });
      emit({ kind: 'snapshot', snapshot: options.snapshot() });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      detach?.();
      detach = undefined;
    },
  };
}

// -----------------------------------------------------------------------------
// Feed 3: an HTTP poll
// -----------------------------------------------------------------------------

/**
 * Options of {@link pollFeed}.
 *
 * @stability experimental
 */
export interface PollFeedOptions {
  intervalMs: number;
  /** Test seams. */
  setTimer?: ((fn: () => void, ms: number) => unknown) | undefined;
  clearTimer?: ((handle: unknown) => void) | undefined;
}

/**
 * Polls a server endpoint: one request at a time, the next one `intervalMs`
 * after the last settled. `stop()` aborts the request in flight and clears
 * the timer, so unmounting a screen never leaves either behind.
 *
 * A failed poll is reported as a disconnect with the message and polling
 * continues; a poll that needs to say something specific (a 403) returns it
 * as an event instead of throwing.
 *
 * @typeParam E - What one poll returns; the reducer folds it.
 * @param fetch - Performs one poll. Must honour `signal`.
 * @param options - The interval.
 * @returns A feed in `poll` mode.
 * @stability experimental
 */
export function pollFeed<E>(fetch: (signal: AbortSignal) => Promise<E>, options: PollFeedOptions): DashboardFeed<E> {
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  let controller: AbortController | undefined;
  let timer: unknown;
  let stopped = false;
  let emit: ((message: DashboardFeedMessage<E>) => void) | undefined;

  const poll = async (): Promise<void> => {
    if (stopped) return;
    controller = new AbortController();
    const signal = controller.signal;
    emit?.({ kind: 'attempt' });
    try {
      const result = await fetch(signal);
      if (stopped || signal.aborted) return;
      emit?.({ kind: 'connected' });
      emit?.({ kind: 'event', event: result });
    } catch (error) {
      if (stopped || signal.aborted) return;
      emit?.({ kind: 'disconnected', error: error instanceof Error ? error.message : String(error) });
    }
    if (stopped) return;
    timer = setTimer(() => {
      timer = undefined;
      void poll();
    }, options.intervalMs);
  };

  return {
    mode: 'poll',
    async start(sink) {
      emit = sink;
      await poll();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      controller?.abort();
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
  };
}

// -----------------------------------------------------------------------------
// Choosing a feed
// -----------------------------------------------------------------------------

/**
 * Dependencies of {@link selectDashboardFeed}.
 *
 * @stability experimental
 */
export interface SelectDashboardFeedDeps<E> {
  socketPath: string;
  channel?: string | undefined;
  /** Whether a daemon is listening. A probe, never a command. */
  isDaemonRunning(): Promise<boolean>;
  /** Builds the in-process feed. Omit to never run embedded. */
  embedded?: (() => DashboardFeed<E>) | undefined;
}

/**
 * Attach when a daemon is running; otherwise run embedded when the caller
 * offers it; otherwise attach anyway (the feed keeps looking and the screen
 * says that no worker is running).
 *
 * @typeParam E - The event type.
 * @param deps - The socket, the probe and the optional embedded builder.
 * @returns The feed to hand to a {@link DashboardSource}.
 * @stability experimental
 */
export async function selectDashboardFeed<E>(deps: SelectDashboardFeedDeps<E>): Promise<DashboardFeed<E>> {
  const attach = (): DashboardFeed<E> =>
    daemonAttachFeed<E>({ socketPath: deps.socketPath, ...(deps.channel !== undefined ? { channel: deps.channel } : {}) });
  let running = false;
  try {
    running = await deps.isDaemonRunning();
  } catch {
    running = false;
  }
  if (running) return attach();
  return deps.embedded !== undefined ? deps.embedded() : attach();
}

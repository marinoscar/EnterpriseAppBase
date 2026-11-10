import { CHANNEL_ID_PATTERN, NODE_CHANNEL } from './ipc-protocol.js';
import type { LogRecord } from './logger.js';

// =============================================================================
// Daemon channels  (RETRO-G1.3)
// =============================================================================
//
// The daemon socket carries the worker engine's snapshot and events. An app
// that hosts a SECOND engine in the same process (a backup mirror beside the
// node worker, say) publishes it on the same socket by registering a channel:
// the daemon sends the channel's snapshot to every client that connects, then
// forwards each event the channel's emitter fires, with the frames tagged by
// `channel` so a dashboard reads only the one it was built for
// (`daemonAttachFeed({ channel })`).
//
// The node engine is the implicit channel `node` and is never registered here;
// its frames carry no `channel` field, which is what keeps old daemons and old
// TUIs interoperable.
//
// A registry rather than a `startDaemonHost` option because the daemon is
// started by the platform's `node start` and the app's engine is built by the
// app: the app registers before (or after) `node start` runs, and the host
// picks channels up either way.
// =============================================================================

/**
 * The slice of an event emitter a channel needs. Node's `EventEmitter`
 * satisfies it.
 *
 * @stability experimental
 */
export interface DaemonChannelEmitter {
  /** Adds a listener. */
  on(name: string, listener: (payload: unknown) => void): unknown;
  /** Removes a listener. */
  off(name: string, listener: (payload: unknown) => void): unknown;
}

/**
 * A second engine published on the daemon socket.
 *
 * @stability experimental
 */
export interface DaemonChannel {
  /** Lowercase `[a-z][a-z0-9-]{0,31}`. `node` is the built-in engine's. */
  id: string;
  /** The state a client gets on connect. Must be JSON-serialisable. */
  snapshot(): unknown;
  /** Fires the channel's events; the daemon forwards each payload to every client. */
  events: DaemonChannelEmitter;
  /** The event name on `events`. Default `event`. */
  eventName?: string | undefined;
  /** Recent log lines replayed on connect, if the engine keeps any. */
  logTail?: (() => LogRecord[]) | undefined;
}

type Listener = (change: { kind: 'added' | 'removed'; channel: DaemonChannel }) => void;

const channels = new Map<string, DaemonChannel>();
const listeners = new Set<Listener>();

/**
 * Publishes a second engine on the daemon socket.
 *
 * @param channel - The channel id, its snapshot function and its event emitter.
 * @returns A function that unregisters the channel; the daemon stops
 *   forwarding its events.
 * @throws Error when the id is malformed, is `node`, or is already registered.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerDaemonChannel({
 *   id: 'backup',
 *   snapshot: () => backupEngine.getSnapshot(),
 *   events: backupEngine, // an EventEmitter
 * });
 * ```
 */
export function registerDaemonChannel(channel: DaemonChannel): () => void {
  if (typeof channel.id !== 'string' || !CHANNEL_ID_PATTERN.test(channel.id)) {
    throw new Error(`Daemon channel id "${String(channel.id)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
  if (channel.id === NODE_CHANNEL) {
    throw new Error(`Daemon channel id "${NODE_CHANNEL}" is the built-in worker engine's; choose another id.`);
  }
  if (channels.has(channel.id)) {
    throw new Error(`Daemon channel "${channel.id}" is already registered.`);
  }
  const frozen: DaemonChannel = Object.freeze({ ...channel });
  channels.set(channel.id, frozen);
  for (const listener of [...listeners]) listener({ kind: 'added', channel: frozen });

  return () => {
    if (channels.get(channel.id) !== frozen) return;
    channels.delete(channel.id);
    for (const listener of [...listeners]) listener({ kind: 'removed', channel: frozen });
  };
}

/**
 * The channels registered so far, in registration order.
 *
 * @returns A copy.
 * @stability experimental
 */
export function listDaemonChannels(): readonly DaemonChannel[] {
  return [...channels.values()];
}

/** The daemon host subscribes to additions and removals; returns the unsubscribe. */
export function watchDaemonChannels(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Empties the registry. Tests only. */
export function resetDaemonChannelsForTests(): void {
  channels.clear();
  listeners.clear();
}

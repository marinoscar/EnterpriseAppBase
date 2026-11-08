import { EventEmitter } from 'node:events';

import { connectToDaemon } from '../../node/daemon.js';
import type { NodeEngineEvent } from '../../node/node-events.js';
import { startNode, type StartedNode, type StartNodeOptions } from '../../node/start.js';
import { inProcessFeed, type DashboardFeed, type DashboardFeedMessage } from './source.js';

// =============================================================================
// The worker, embedded  (RETRO-G1.3)
// =============================================================================
//
// With no daemon running, the node screen can offer to run the engine IN THE
// TUI'S OWN PROCESS and render it through `inProcessFeed`. It is opt-in behind
// an explicit key, and the screen says why:
//
//   An interactive process CANNOT re-exec itself to raise its heap ceiling
//   without destroying raw-mode input (see `runtime-tuning.ts`), so in-process
//   work runs at the low default limit, and the memory valve (which exits the
//   process after a clean drain, expecting a supervisor to restart it) would
//   close the TUI with it. A detached daemon (`s`) gets the tuning and a
//   supervisor-friendly exit; embedded is for a quick look, a laptop, a demo.
//
// The engine still hosts the daemon socket (`startNode` always does), so
// another terminal can attach to an embedded worker while the TUI is open.
// =============================================================================

/** Options of {@link embeddedNodeFeed}. */
export interface EmbeddedNodeFeedOptions {
  /** Forwarded to `startNode` (paths, env, test seams). */
  start?: Omit<StartNodeOptions, 'onEvent' | 'stderr' | 'installSignalHandlers' | 'selfTest' | 'headless'> | undefined;
  /** Test seam: replaces `startNode`. */
  startNode?: ((options: StartNodeOptions) => Promise<StartedNode>) | undefined;
}

/**
 * A feed that starts the worker engine in this process when it starts, feeds
 * the dashboard from its events and stops it (without deregistering) when it
 * stops. Never writes to stderr (it would corrupt the ink frame) and never
 * installs signal handlers (ink owns Ctrl-C).
 *
 * @param options - `start` options for `startNode`, and a test seam.
 * @returns A feed in `embedded` mode. A failure to start is reported as a disconnect, not thrown.
 * @stability experimental
 */
export function embeddedNodeFeed(options: EmbeddedNodeFeedOptions = {}): DashboardFeed<NodeEngineEvent> {
  const run = options.startNode ?? startNode;
  const emitter = new EventEmitter();
  let inner: DashboardFeed<NodeEngineEvent> | undefined;
  let started: StartedNode | undefined;
  let stopped = false;

  const shutdown = (node: StartedNode): void => {
    // `finished` rejects when the run loop errors; it is already logged.
    void node.engine.stop({ deregister: false }).catch(() => {});
    void node.finished.catch(() => {});
  };

  return {
    mode: 'embedded',
    async start(emit: (message: DashboardFeedMessage<NodeEngineEvent>) => void) {
      emit({ kind: 'attempt' });
      try {
        const node = await run({
          ...(options.start ?? {}),
          headless: false,
          selfTest: false,
          stderr: { write: () => true },
          installSignalHandlers: () => {},
          onEvent: (event) => emitter.emit('event', event),
        });
        if (stopped) {
          shutdown(node);
          return;
        }
        started = node;
        inner = inProcessFeed<NodeEngineEvent>(emitter, { snapshot: () => node.engine.getSnapshot() });
        await inner.start(emit);
      } catch (error) {
        emit({ kind: 'disconnected', error: error instanceof Error ? error.message : String(error) });
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      inner?.stop();
      if (started !== undefined) shutdown(started);
      started = undefined;
    },
  };
}

/**
 * Whether something is already listening on the worker socket. A probe that
 * connects and hangs up; it sends nothing.
 *
 * @param socketPath - The daemon socket.
 * @param connect - Test seam.
 * @returns `true` when a daemon accepted the connection.
 * @stability experimental
 */
export async function isDaemonListening(
  socketPath: string,
  connect: typeof connectToDaemon = connectToDaemon,
): Promise<boolean> {
  try {
    const client = await connect({ socketPath, timeoutMs: 500, onMessage: () => {} });
    client.close();
    return true;
  } catch {
    return false;
  }
}

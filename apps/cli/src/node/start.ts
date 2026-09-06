import { CLI_NAME } from '../branding.js';
import { HttpNodeApi, type NodeApi } from './node-api.js';
import { registerNode } from './enrollment.js';
import { NodeEngine } from './node-engine.js';
import type { NodeEngineEvent } from './node-events.js';
import { NodeLogger, readLogTail, formatLogRecord } from './logger.js';
import { startDaemonHost, type DaemonHost } from './daemon.js';
import { nodeLogPath, nodePidPath, nodeSocketPath, nodeTmpDir, type NodePathsContext } from './paths.js';
import { resolveNodeConfig, saveNodeConfig, type ResolvedNodeConfig } from './node-config.js';

// =============================================================================
// `node start`  (issue #275, epic #254)
// =============================================================================
//
// Wires config → API client → engine → daemon socket → signal handlers, and
// owns exactly two decisions that are hard to get right anywhere else:
//
//   1. EVERY RUN HOSTS THE DAEMON SOCKET, foreground or detached. A worker you
//      can only inspect if you happened to start it a particular way is a
//      worker nobody inspects.
//
//   2. `--headless` DRAINS ON SIGTERM WITHOUT DEREGISTERING. A restarting
//      container must RE-ATTACH to its existing node row; deregistering on
//      every SIGTERM would leak a row per restart, and a crash-looping replica
//      would fill the fleet page with corpses. Interactive Ctrl-C does
//      deregister, because a human stopping a worker on their laptop means it
//      is going away.
// =============================================================================

export interface StartNodeOptions extends NodePathsContext {
  /** Drain-without-deregister on SIGTERM. Also settable through the environment. */
  headless?: boolean | undefined;
  /** Streams. Human output goes to stderr, per program.ts. */
  stderr?: { write(chunk: string): unknown } | undefined;
  /** Test seams. */
  createApi?: ((config: ResolvedNodeConfig) => NodeApi) | undefined;
  /** Replaces the signal wiring, which a test must not install globally. */
  installSignalHandlers?: ((handler: (signal: NodeJS.Signals) => void) => void) | undefined;
  /** Wired by #277. */
  writeHeapSnapshot?: (() => Promise<{ path: string; size: number }>) | undefined;
  capabilities?: Record<string, unknown> | undefined;
}

export interface StartedNode {
  engine: NodeEngine;
  host: DaemonHost;
  logger: NodeLogger;
  config: ResolvedNodeConfig;
  /** Resolves when the engine has drained and the socket is closed. */
  finished: Promise<void>;
}

/**
 * Start a worker in this process and return once it is serving.
 *
 * Returns rather than awaiting the run loop, so a caller can hold the handle —
 * which is what makes this testable and what #279's TUI needs.
 */
export async function startNode(options: StartNodeOptions = {}): Promise<StartedNode> {
  const stderr = options.stderr ?? process.stderr;
  const pathCtx: NodePathsContext = {
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.home !== undefined ? { home: options.home } : {}),
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
  };

  const config = resolveNodeConfig(pathCtx);
  const headless = options.headless ?? config.headless;

  const logger = new NodeLogger({
    path: nodeLogPath(pathCtx),
    // In the foreground a human wants to see what is happening; a detached run
    // has its stdio redirected to the same file anyway, so mirroring would
    // double every line.
    ...(headless ? {} : { mirror: (record) => stderr.write(`${formatLogRecord(record)}\n`) }),
  });

  const api = options.createApi?.(config) ?? HttpNodeApi.create(config.serverUrl, config.token);

  // Register on first start. `validateTypes: false` because a start must not
  // fail because `GET /nodes/job-types` was briefly unavailable — the server
  // re-checks every claim against its own registry regardless.
  let nodeId = config.nodeId;
  if (nodeId === undefined) {
    const registered = await registerNode({
      api,
      node: config.node,
      validateTypes: false,
      configContext: pathCtx,
      ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
    });
    nodeId = registered.node.id;
    logger.info(registered.reattached ? 'reattached to node' : 'registered node', {
      nodeId,
      name: registered.node.name,
    });
  }

  let host: DaemonHost | undefined;

  const engine = new NodeEngine({
    api,
    nodeId,
    concurrency: config.node.concurrency,
    eligibleTypes: config.node.eligibleTypes,
    pollIntervalMs: config.node.pollIntervalMs,
    tmpDir: nodeTmpDir(pathCtx),
    ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
    persistConcurrency: (value) => {
      saveNodeConfig({ node: { concurrency: value } }, { ...pathCtx, degradeOnFailure: true });
    },
    onEvent: (event) => {
      logEvent(logger, event);
      host?.broadcast(event);
    },
  });

  host = await startDaemonHost(engine, logger, {
    pidPath: nodePidPath(pathCtx),
    socketPath: nodeSocketPath(pathCtx),
    logTail: () => readLogTail(nodeLogPath(pathCtx), 50),
    ...(options.writeHeapSnapshot !== undefined ? { writeHeapSnapshot: options.writeHeapSnapshot } : {}),
  });

  const install =
    options.installSignalHandlers ??
    ((handler: (signal: NodeJS.Signals) => void) => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => handler(signal));
    });

  let shuttingDown = false;
  install((signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown signal received', { signal, headless });
    // THE ONE BRANCH THAT MATTERS. See the file header.
    void engine.stop({ deregister: !headless });
  });

  const finished = engine
    .run()
    .then(async () => {
      await host?.close();
    })
    .catch(async (error: unknown) => {
      logger.error('worker exited with an error', { error: error instanceof Error ? error.message : String(error) });
      await host?.close();
      throw error;
    });

  logger.info('worker started', {
    nodeId,
    name: config.node.name,
    concurrency: config.node.concurrency,
    types: engine.claimableTypes(),
    headless,
  });

  if (!headless) {
    stderr.write(
      `Worker ${config.node.name} (${nodeId}) is running.\n` +
        `  Concurrency ${config.node.concurrency}; types ${
          engine.claimableTypes().length > 0 ? engine.claimableTypes().join(', ') : '(none — this node has no executors)'
        }\n` +
        `  Attach from another terminal: ${CLI_NAME} node status\n`,
    );
  }

  return { engine, host, logger, config, finished };
}

/**
 * One engine event → one log line.
 *
 * Kept OUT of the engine deliberately: the engine is UI-free and must stay
 * renderable by a printer, the IPC broadcast and the TUI without any of them
 * inheriting a logging opinion from it.
 */
function logEvent(logger: NodeLogger, event: NodeEngineEvent): void {
  switch (event.kind) {
    case 'job-succeeded':
      logger.info('job succeeded', { jobId: event.jobId, type: event.type, durationMs: event.durationMs });
      return;
    case 'job-failed':
      logger.error('job failed', {
        jobId: event.jobId,
        type: event.type,
        error: event.error,
        rateLimited: event.rateLimited,
        willRetry: event.willRetry,
      });
      return;
    case 'job-started':
      logger.info('job started', { jobId: event.jobId, type: event.type });
      return;
    case 'lease-renew-failed':
      logger.warn('lease renew failed', { jobId: event.jobId, error: event.error });
      return;
    case 'heartbeat-failed':
      logger.warn('heartbeat failed', { error: event.error });
      return;
    case 'claim-failed':
      logger.warn('claim failed', { error: event.error });
      return;
    case 'concurrency-changed':
      logger.info('concurrency changed', { concurrency: event.concurrency });
      return;
    case 'draining':
      logger.info('draining', { inFlight: event.inFlight });
      return;
    case 'stopped':
      logger.info('stopped', { deregistered: event.deregistered });
      return;
    default:
      // `idle`, `claimed`, `heartbeat`, `job-input`, `job-log`, `lease-renewed`
      // and `started` are high-volume or uninteresting on their own; they still
      // reach attached clients through the broadcast.
      logger.debug(event.kind, { event });
  }
}

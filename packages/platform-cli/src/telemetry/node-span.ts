// =============================================================================
// The span shapes a worker node relays  (issue #608; moved by PP-4.5, #706)
// =============================================================================
//
// Mirrors of the server's `POST /api/nodes/:id/telemetry` contract. They live
// here, not in the app's API client, so the relay needs no app type at all:
// what it needs from the client is one optional method (`NodeSpanSink`).
// =============================================================================

/**
 * The five phases a node always relays. Mirrors the server's
 * `BUILTIN_NODE_SPAN_NAMES`.
 *
 * @stability experimental
 */
export type BuiltinNodeSpanName = 'job.download' | 'job.execute' | 'job.upload' | 'job.submit' | 'job.secret';

/**
 * A span name a node may relay: one of the five phases, or an executor's own
 * span under the fixed prefix `job.app.` (`job.app.transcode`). Mirrors the
 * server's `nodeSpanNameSchema`: a name outside both shapes is dropped on this
 * side (`isNodeSpanName`) before it is queued, and would be dropped (alone, not
 * with its batch) on the server's.
 *
 * @stability experimental
 */
export type NodeSpanName = BuiltinNodeSpanName | `job.app.${string}`;

/**
 * Mirrors the server's `NODE_APP_SPAN_NAME_PATTERN`: `job.app.` and then a
 * lower-case name of 2 to 48 characters.
 *
 * @stability experimental
 */
export const NODE_APP_SPAN_NAME_PATTERN = /^job\.app\.[a-z][a-z0-9_.-]{1,47}$/;

const BUILTIN_SPAN_NAMES: readonly string[] = ['job.download', 'job.execute', 'job.upload', 'job.submit', 'job.secret'];

/**
 * Whether `name` is a span name the server takes: a built-in phase or
 * `job.app.<name>`.
 *
 * @param name - a candidate span name.
 * @returns true when it is relayable.
 * @stability experimental
 */
export function isNodeSpanName(name: unknown): name is NodeSpanName {
  return typeof name === 'string' && (BUILTIN_SPAN_NAMES.includes(name) || NODE_APP_SPAN_NAME_PATTERN.test(name));
}

/**
 * Allowlisted span attributes. Mirrors the server's `nodeSpanAttributesSchema`:
 * the four built-in integers, plus APP attributes under keys shaped
 * `^[a-z][A-Za-z0-9]{1,31}$`, each a non-negative integer or a short
 * TOKEN-SHAPED string (letters, digits and `_ . + -`, at most 128: no space,
 * slash, colon or quote, so no URL, path or credential rides along). At most 16
 * keys. The server emits only the app attributes its deployment registered
 * (`registerNodeSpanAttribute`) and drops the rest, so sending one it does not
 * know costs nothing but the bytes.
 *
 * @stability experimental
 */
export interface NodeSpanAttributes {
  /** Bytes moved by the phase. Non-negative. */
  bytes?: number | undefined;
  /** The job's attempt number. 0 to 10,000. */
  attempt?: number | undefined;
  /** A child process's exit code. -1024 to 1024. */
  exitCode?: number | undefined;
  /** The HTTP status of the phase's request. 100 to 599. */
  httpStatus?: number | undefined;
  /** An app attribute: a non-negative integer or a token-shaped string. */
  [appKey: string]: number | string | undefined;
}

/**
 * One phase of one job, as `POST /nodes/:id/telemetry` takes it.
 *
 * @stability experimental
 */
export interface NodeSpan {
  /** The job the phase belongs to. */
  jobId: string;
  /** Which phase. */
  name: NodeSpanName;
  /** When the phase started, Unix epoch milliseconds. */
  startTimeUnixMs: number;
  /** How long it ran, milliseconds, capped at one day. */
  durationMs: number;
  /** Whether the phase succeeded. */
  status: 'ok' | 'error';
  /** An error CLASS or CODE (`MissingJobInputError`, `ApiError.409`), never a message. */
  errorType?: string | undefined;
  /** Integer-only attributes; see {@link NodeSpanAttributes}. */
  attributes?: NodeSpanAttributes | undefined;
}

/**
 * What the relay needs from the app's API client: one optional method. An app
 * client whose `telemetry` posts to `/nodes/:id/telemetry` satisfies it
 * structurally. A client without the method is a relay that is off.
 *
 * @stability experimental
 */
export interface NodeSpanSink {
  /** Sends one batch of at most `MAX_SPANS_PER_BATCH` spans for `nodeId`. */
  telemetry?(nodeId: string, body: { spans: NodeSpan[] }): Promise<unknown>;
}

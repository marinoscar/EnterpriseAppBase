// =============================================================================
// The span shapes a worker node relays  (issue #608; moved by PP-4.5, #706)
// =============================================================================
//
// Mirrors of the server's `POST /api/nodes/:id/telemetry` contract. They live
// here, not in the app's API client, so the relay needs no app type at all:
// what it needs from the client is one optional method (`NodeSpanSink`).
// =============================================================================

/**
 * The phase spans a node may relay. Mirrors the server's `NODE_SPAN_NAMES`:
 * an enum on the server, so a name not listed here is a 400 for the whole
 * batch. Never add one on this side first.
 *
 * @stability experimental
 */
export type NodeSpanName = 'job.download' | 'job.execute' | 'job.upload' | 'job.submit' | 'job.secret';

/**
 * Integer-only, allowlisted span attributes. Mirrors the server's `.strict()`
 * `nodeSpanAttributesSchema`: there is deliberately no string attribute, so no
 * URL, path or credential can ride along in one.
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

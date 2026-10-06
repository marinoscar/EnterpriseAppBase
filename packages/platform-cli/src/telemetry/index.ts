// `@marinoscar/platform-cli/telemetry`: the worker node's job-phase span relay
// (PP-4.5, #706). #707 completes
// the slice.

export {
  DEFAULT_MAX_QUEUED_SPANS,
  JobSpanRecorder,
  MAX_SPANS_PER_BATCH,
  NodeSpanRelay,
  errorTypeOf,
} from './node-span-relay.js';
export type { NodeSpanRelayOptions } from './node-span-relay.js';
export type { NodeSpan, NodeSpanAttributes, NodeSpanName, NodeSpanSink } from './node-span.js';

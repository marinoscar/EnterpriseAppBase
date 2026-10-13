import type { NodeSpanAttributeDefinition } from '@marinoscar/platform-api/nodes';

// =============================================================================
// EXAMPLE, NOT WIRED: span attributes for an executor's own span (PP-14.19)
// =============================================================================
//
// The server half of `apps/cli/src/examples/transcode.executor.ts`. A node's
// `job.app.transcode` span carries `frames` and `codec`; the API relays an
// attribute ONLY when it is registered here (listed in
// `APP_NODE_SPAN_ATTRIBUTES`, app-registrations/jobs.ts). Anything else a node
// sends is dropped from the span, and a value of the wrong type, over its length
// cap, or not token-shaped (no space, slash, colon or quote, so no path or URL
// fits) is dropped too. They are emitted as `job.app.frames` and
// `job.app.codec`, a namespace no server-set attribute can collide with.
//
// Proved by test/examples/nodes/executor-telemetry.example.spec.ts.
// =============================================================================

/** The attributes the transcode executor's span may carry. */
export const TRANSCODE_SPAN_ATTRIBUTES: readonly NodeSpanAttributeDefinition[] = [
  { key: 'frames', type: 'int' },
  { key: 'codec', type: 'string', maxLength: 16 },
];

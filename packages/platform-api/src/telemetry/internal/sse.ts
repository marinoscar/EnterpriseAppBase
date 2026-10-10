// =============================================================================
// SSE wire helpers of the telemetry assistant (issue #703)
// =============================================================================
//
// The same headers, heartbeat and disconnect signal as the app's
// `ai/http/ai-sse.ts`, copied so the telemetry slice does not import the AI
// module's HTTP layer (the platform's core does not own them yet). The values
// must stay identical to the app's: the assistant stream is proxied by the
// same nginx location rules. `internal.spec.ts` pins the same values the
// app's copy has. Internal to the slice: not exported.
// =============================================================================

import type { ServerResponse } from 'node:http';

/** Interval of the `: ping` keep-alive comment. */
export const AI_SSE_HEARTBEAT_MS = 15_000;

/** The response headers of an event stream. */
export const AI_SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // nginx: do not buffer this response (the location block also says so).
  'X-Accel-Buffering': 'no',
} as const;

/** Aborted when the client goes away. */
export interface DisconnectSignal {
  readonly signal: AbortSignal;
  /** Stop listening (the response finished normally). */
  dispose(): void;
}

/**
 * Aborts when the client goes away before the response finished. Listens on
 * the RESPONSE's `close`, not the request's: an `IncomingMessage` emits
 * `close` as soon as its body has been consumed.
 */
export function abortOnDisconnect(res: ServerResponse): DisconnectSignal {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
  };

  res.on('close', onClose);

  return {
    signal: controller.signal,
    dispose: () => res.off('close', onClose),
  };
}

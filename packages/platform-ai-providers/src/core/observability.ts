// =============================================================================
// Logger and tracer ports (issue #991)
// =============================================================================
//
// The adapters log one debug line per provider call and run each call inside
// an `ai.provider.call` span. Inside the platform those are Nest's `Logger`
// and an OpenTelemetry `Tracer`; this package depends on neither, so it
// declares the SUBSET it uses as two structural ports:
//
//   - `AiLogger` is satisfied by Nest's `Logger` (and by `console`).
//   - `AiTracer` / `AiSpan` are satisfied by `@opentelemetry/api`'s `Tracer`
//     and `Span`, and the numeric constants below carry OpenTelemetry's own
//     `SpanKind.CLIENT` and `SpanStatusCode` values, so a span started
//     through the port is the span the platform started before the split.
//
// Both are optional everywhere. Without a logger nothing is logged; without a
// tracer no span is started at all (no no-op span objects, no attribute
// work). Importing this file has no side effect: no global tracer lookup.
// =============================================================================

/**
 * The logging surface the adapters use. Nest's `Logger` satisfies it
 * structurally, as does `console`.
 *
 * @stability experimental
 */
export interface AiLogger {
  /** Logs at debug level; the adapters' per-call line goes here. */
  debug(message: unknown, ...optionalParams: unknown[]): void;
  /** Logs at info level. */
  log(message: unknown, ...optionalParams: unknown[]): void;
  /** Logs a warning (a best-effort clean-up that failed, for example). */
  warn(message: unknown, ...optionalParams: unknown[]): void;
  /** Logs an error. */
  error(message: unknown, ...optionalParams: unknown[]): void;
  /** Logs at verbose level, when the logger has one. */
  verbose?(message: unknown, ...optionalParams: unknown[]): void;
}

/**
 * A logger that drops every line: the default when none is wired.
 *
 * @stability experimental
 */
export const NOOP_AI_LOGGER: AiLogger = Object.freeze({
  debug: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  verbose: () => undefined,
});

/**
 * A span attribute value (the scalar subset of OpenTelemetry's `AttributeValue` the adapters write).
 *
 * @stability experimental
 */
export type AiSpanAttributeValue = string | number | boolean;

/**
 * The options the adapters pass when starting a span (a subset of OpenTelemetry's `SpanOptions`).
 *
 * @stability experimental
 */
export interface AiSpanOptions {
  /** The span kind; the adapters always pass {@link AI_SPAN_KIND_CLIENT}. */
  kind?: number;
  /** Attributes set at start. */
  attributes?: Record<string, AiSpanAttributeValue>;
}

/**
 * A span status (a subset of OpenTelemetry's `SpanStatus`).
 *
 * @stability experimental
 */
export interface AiSpanStatus {
  /** {@link AI_SPAN_STATUS_OK} or {@link AI_SPAN_STATUS_ERROR}. */
  code: number;
  /** For an error: the AI error code. */
  message?: string;
}

/**
 * The span surface the adapters use. OpenTelemetry's `Span` satisfies it structurally.
 *
 * @stability experimental
 */
export interface AiSpan {
  /** Sets one attribute (`ai.status` at the end of a call). */
  setAttribute(key: string, value: AiSpanAttributeValue): unknown;
  /** Sets the span status. */
  setStatus(status: AiSpanStatus): unknown;
  /** Ends the span. */
  end(): void;
}

/**
 * The tracer surface the adapters use. OpenTelemetry's `Tracer` satisfies it
 * structurally: pass `trace.getTracer(name)`.
 *
 * @stability experimental
 */
export interface AiTracer {
  /** Starts (and does not activate) a span. */
  startSpan(name: string, options?: AiSpanOptions): AiSpan;
}

/**
 * OpenTelemetry's `SpanKind.CLIENT`.
 *
 * @stability experimental
 */
export const AI_SPAN_KIND_CLIENT = 2;

/**
 * OpenTelemetry's `SpanStatusCode.OK`.
 *
 * @stability experimental
 */
export const AI_SPAN_STATUS_OK = 1;

/**
 * OpenTelemetry's `SpanStatusCode.ERROR`.
 *
 * @stability experimental
 */
export const AI_SPAN_STATUS_ERROR = 2;

/**
 * What every adapter, engine and telemetry helper of this package accepts
 * for observability. Both members are optional.
 *
 * @stability experimental
 */
export interface AiObservabilityOptions {
  /** Where the per-call debug line goes; nothing is logged when absent. */
  logger?: AiLogger;
  /** Starts the `ai.provider.call` spans; no span is started when absent. */
  tracer?: AiTracer;
}

/**
 * Ends a span the way every adapter does: `ai.status` set to `status`, the
 * span status OK for `'ok'` and ERROR (message = the code) otherwise. A
 * no-op for `undefined` (no tracer was wired).
 *
 * @param span - the span, or `undefined` when no tracer was wired.
 * @param status - `'ok'` or the AI error code.
 *
 * @stability experimental
 */
export function endAiSpan(span: AiSpan | undefined, status: string): void {
  if (!span) {
    return;
  }

  span.setAttribute('ai.status', status);
  span.setStatus(status === 'ok' ? { code: AI_SPAN_STATUS_OK } : { code: AI_SPAN_STATUS_ERROR, message: status });
  span.end();
}

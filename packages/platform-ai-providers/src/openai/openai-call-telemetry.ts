// =============================================================================
// Provider-call telemetry for the OpenAI wire family (issue #426, extracted #448)
// =============================================================================
//
// Every provider call an OpenAI-family adapter (OpenAI, Azure OpenAI, a
// generic OpenAI-compatible server) makes runs inside one `ai.provider.call`
// span carrying `ai.provider`, `ai.model`, `ai.operation` and `ai.status`
// (`ok` or the AiErrorCode) — never prompt text, output text or the key. The
// debug log line carries the same four facts plus the request ids and a
// duration. No exception is recorded on the span: an SDK error's message can
// echo a masked key.
//
// Extracted from `openai.adapter.ts` unchanged so the two #448 adapters share
// it rather than copy it; the OpenAI adapter's spans and log lines are
// byte-for-byte what they were.
// =============================================================================

import type { AiError } from '../core/index';
import {
  AI_SPAN_KIND_CLIENT,
  endAiSpan,
  NOOP_AI_LOGGER,
  type AiLogger,
  type AiSpan,
  type AiTracer,
} from '../core/index';
import type { AiCallContext } from '../core/index';
import { mapOpenAiError, type OpenAiFamily } from './openai-errors';

/**
 * The span every provider call runs inside.
 *
 * @stability experimental
 */
export const AI_PROVIDER_CALL_SPAN = 'ai.provider.call';

/**
 * The `ai.provider.call` span and the per-call debug line for an
 * OpenAI-family adapter. Without a tracer no span is started; without a
 * logger nothing is logged.
 *
 * @stability experimental
 */
export class OpenAiCallTelemetry {
  private readonly logger: AiLogger;
  private readonly tracer: AiTracer | undefined;

  /**
   * @param family - the provider id and label the span and line carry.
   * @param logger - where the per-call debug line goes (no-op when absent).
   * @param mapError - maps a thrown error; the family's own `mapOpenAiError` by default.
   * @param tracer - starts the span (no span when absent).
   */
  constructor(
    private readonly family: OpenAiFamily,
    logger?: AiLogger,
    private readonly mapError: (err: unknown) => AiError = (err) => mapOpenAiError(err, family),
    tracer?: AiTracer,
  ) {
    this.logger = logger ?? NOOP_AI_LOGGER;
    this.tracer = tracer;
  }

  /**
   * Starts the `ai.provider.call` span for one operation.
   *
   * @param operation - the provider operation (`responses.create`, ...).
   * @param model - the model id, when the operation has one.
   * @returns the span, or `undefined` when no tracer is wired.
   */
  startSpan(operation: string, model: string | undefined): AiSpan | undefined {
    return this.tracer?.startSpan(AI_PROVIDER_CALL_SPAN, {
      kind: AI_SPAN_KIND_CLIENT,
      attributes: {
        'ai.provider': this.family.providerId,
        'ai.operation': operation,
        ...(model ? { 'ai.model': model } : {}),
      },
    });
  }

  /**
   * Ends a span with `ai.status` and the matching span status.
   *
   * @param span - the span {@link OpenAiCallTelemetry.startSpan} returned.
   * @param status - `'ok'` or the AI error code.
   */
  endSpan(span: AiSpan | undefined, status: string): void {
    endAiSpan(span, status);
  }

  /**
   * Writes the per-call debug line.
   * ⚠ Only ids, the model, the operation, the outcome and a duration. Never
   * `ctx.apiKey`, never the request or response body.
   *
   * @param operation - the provider operation.
   * @param model - the model id, when the operation has one.
   * @param ctx - the call context (only `requestId` is read).
   * @param status - `'ok'` or the AI error code.
   * @param started - `Date.now()` when the call started.
   * @param providerRequestId - the provider's request id, when known.
   */
  logCall(
    operation: string,
    model: string | undefined,
    ctx: AiCallContext,
    status: string,
    started: number,
    providerRequestId?: string | null,
  ): void {
    this.logger.debug({
      msg: 'AI provider call',
      provider: this.family.providerId,
      operation,
      model,
      status,
      requestId: ctx.requestId,
      providerRequestId: providerRequestId ?? undefined,
      durationMs: Date.now() - started,
    });
  }

  /**
   * Runs `fn` inside an `ai.provider.call` span, mapping any failure to `AiError`.
   *
   * @param operation - the provider operation.
   * @param model - the model id, when the operation has one.
   * @param ctx - the call context.
   * @param fn - the provider call.
   * @returns what `fn` resolved to.
   */
  async call<T>(
    operation: string,
    model: string | undefined,
    ctx: AiCallContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    const span = this.startSpan(operation, model);
    let status = 'ok';
    let providerRequestId: string | undefined;

    try {
      const result = await fn();

      if (result && typeof result === 'object' && 'providerRequestId' in result) {
        providerRequestId = (result as { providerRequestId?: string }).providerRequestId;
      }

      return result;
    } catch (err) {
      const mapped = this.mapError(err);

      status = mapped.code;
      providerRequestId = mapped.toJSON().details.providerRequestId as string | undefined;

      throw mapped;
    } finally {
      this.endSpan(span, status);
      this.logCall(operation, model, ctx, status, started, providerRequestId);
    }
  }
}

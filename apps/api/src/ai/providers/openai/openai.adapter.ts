// =============================================================================
// OpenAI provider adapter (issue #426, epic #419)
// =============================================================================
//
// The first real `AiProviderAdapter`: OpenAI through its Responses API, with
// the official SDK hidden completely behind the neutral contract. Pieces:
//
//   openai-client.factory.ts     one SDK client per call (key, maxRetries 0)
//   openai-responses.mapper.ts   AiResponseRequest <-> Responses API
//   openai-stream.mapper.ts      stream events -> AiStreamEvent
//   openai-errors.ts             SDK error -> AiError
//   openai-model-catalog.ts      classifyModel()'s rule table
//
// PORTS. Only `responses` is carried. `images`, `audio`, `embeddings` and
// `realtime` are deliberately ABSENT until Phase 2 (#420) implements them —
// presence is the declaration, so `AiProviderRegistry.supports()` stays
// truthful about what this adapter can actually do today.
//
// OBSERVABILITY. Every provider call runs inside an `ai.provider.call` span
// carrying `ai.provider`, `ai.model`, `ai.operation` and `ai.status` (`ok` or
// the AiErrorCode) — never prompt text, output text or the key. The debug log
// line carries the same four facts plus the request ids and duration. No
// exception is recorded on the span: an SDK error's message can echo a
// masked key.
// =============================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses';

import { AiError } from '../../core/ai-error';
import type { AiModelCapabilities } from '../../core/capabilities';
import type {
  AiCallContext,
  AiDiscoveredModel,
  AiKeyVerification,
  AiProviderAdapter,
  AiResponsesPort,
} from '../../core/provider-adapter.interface';
import { AiProviderRegistry } from '../../core/provider-registry';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from '../../core/types/responses.types';
import { resolveServiceName } from '../../../common/otel/service-name';
import { OpenAiClientFactory } from './openai-client.factory';
import { mapOpenAiError, OPENAI_PROVIDER_ID } from './openai-errors';
import { classifyOpenAiModel } from './openai-model-catalog';
import { fromOpenAiResponse, toOpenAiRequest } from './openai-responses.mapper';
import { OpenAiStreamMapper } from './openai-stream.mapper';

export const AI_PROVIDER_CALL_SPAN = 'ai.provider.call';

type OpenAiOperation = 'models.list' | 'verify_key' | 'responses.create' | 'responses.stream';

const tracer = trace.getTracer(resolveServiceName());

@Injectable()
export class OpenAiProviderAdapter implements AiProviderAdapter, OnModuleInit {
  readonly id = OPENAI_PROVIDER_ID;
  readonly displayName = 'OpenAI';

  readonly responses: AiResponsesPort = {
    create: (req, ctx) => this.createResponse(req, ctx),
    stream: (req, ctx) => this.streamResponse(req, ctx),
  };

  private readonly logger = new Logger(OpenAiProviderAdapter.name);

  constructor(
    private readonly registry: AiProviderRegistry,
    private readonly clients: OpenAiClientFactory,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  classifyModel(modelId: string): AiModelCapabilities | null {
    return classifyOpenAiModel(modelId);
  }

  async listModels(ctx: AiCallContext): Promise<AiDiscoveredModel[]> {
    return this.call('models.list', undefined, ctx, async () => {
      const client = this.clients.create(ctx);
      const models: AiDiscoveredModel[] = [];

      for await (const model of client.models.list({ signal: ctx.signal })) {
        models.push({
          id: model.id,
          ownedBy: model.owned_by,
          ...(typeof model.created === 'number' ? { createdAt: new Date(model.created * 1000) } : {}),
        });
      }

      return models;
    });
  }

  /**
   * `GET /v1/models` with the key. A rejected key is an ANSWER
   * (`{ ok: false, code: 'AI_KEY_INVALID' }`), as is any other failure —
   * mapped to its code — so the admin UI never has to catch.
   */
  async verifyKey(ctx: AiCallContext): Promise<AiKeyVerification> {
    try {
      await this.call('verify_key', undefined, ctx, async () => {
        const client = this.clients.create(ctx);

        await client.models.list({ signal: ctx.signal });
      });

      return { ok: true };
    } catch (err) {
      const mapped = mapOpenAiError(err);

      return mapped.code === 'AI_KEY_INVALID'
        ? { ok: false, code: 'AI_KEY_INVALID' }
        : { ok: false, code: mapped.code, detail: mapped.message };
    }
  }

  // ---- responses port -------------------------------------------------------

  private createResponse(req: AiResponseRequest, ctx: AiCallContext): Promise<AiResponse> {
    return this.call('responses.create', req.model, ctx, async () => {
      const body = toOpenAiRequest(req, this.classifyModel(req.model));
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.responses
        .create({ ...body, stream: false }, { signal: ctx.signal })
        .withResponse();

      if (data.status === 'cancelled') {
        throw new AiError('AI_PROVIDER_UNAVAILABLE', 'The OpenAI response was cancelled.', {
          details: { provider: OPENAI_PROVIDER_ID, ...(request_id ? { providerRequestId: request_id } : {}) },
        });
      }

      return fromOpenAiResponse(data, { request: req, providerRequestId: request_id });
    });
  }

  /**
   * Streams one response. A failure BEFORE `response.created` (a rejected
   * key, a 429, an unsupported request) is thrown as an `AiError`; once the
   * stream has started, a failure ends it with exactly one `error` event, so
   * a consumer that has begun rendering always sees a terminal event.
   *
   * `ctx.signal` aborts the SDK request; a consumer that stops iterating
   * (`break`) aborts it too.
   */
  private async *streamResponse(req: AiResponseRequest, ctx: AiCallContext): AsyncGenerator<AiStreamEvent> {
    const started = Date.now();
    const span = this.startSpan('responses.stream', req.model);
    let status = 'ok';
    let providerRequestId: string | null = null;
    let sdkStream: AsyncIterable<ResponseStreamEvent> & { controller: AbortController } | undefined;
    let terminated = false;

    try {
      const body = toOpenAiRequest(req, this.classifyModel(req.model));
      const client = this.clients.create(ctx);

      try {
        const { data, request_id } = await client.responses
          .create({ ...body, stream: true }, { signal: ctx.signal })
          .withResponse();

        sdkStream = data;
        providerRequestId = request_id;
      } catch (err) {
        throw mapOpenAiError(err);
      }

      const mapper = new OpenAiStreamMapper({ request: req, providerRequestId });

      try {
        for await (const event of sdkStream) {
          for (const out of mapper.map(event)) {
            if (out.type === 'error') status = out.code;
            yield out;
          }

          if (mapper.terminated) break;
        }
      } catch (err) {
        const mapped = mapOpenAiError(err);

        if (!mapper.started) throw mapped;

        status = mapped.code;

        yield* mapper.fail(mapped);
      }

      terminated = mapper.terminated;

      if (!terminated) {
        if (ctx.signal?.aborted) {
          throw new AiError('AI_PROVIDER_UNAVAILABLE', 'The AI request was cancelled.', {
            details: { provider: OPENAI_PROVIDER_ID, aborted: true },
          });
        }

        const truncated = new AiError(
          'AI_PROVIDER_UNAVAILABLE',
          'The OpenAI stream ended before the response completed.',
          { details: { provider: OPENAI_PROVIDER_ID } },
        );

        if (!mapper.started) throw truncated;

        status = truncated.code;
        terminated = true;

        yield* mapper.fail(truncated);
      }
    } catch (err) {
      const mapped = mapOpenAiError(err);

      status = mapped.code;

      throw mapped;
    } finally {
      // A consumer that stopped early leaves the HTTP stream open: close it.
      if (!terminated) sdkStream?.controller.abort();

      this.endSpan(span, status);
      this.logCall('responses.stream', req.model, ctx, status, started, providerRequestId);
    }
  }

  // ---- telemetry ------------------------------------------------------------

  private startSpan(operation: OpenAiOperation, model: string | undefined): Span {
    return tracer.startSpan(AI_PROVIDER_CALL_SPAN, {
      kind: SpanKind.CLIENT,
      attributes: {
        'ai.provider': OPENAI_PROVIDER_ID,
        'ai.operation': operation,
        ...(model ? { 'ai.model': model } : {}),
      },
    });
  }

  private endSpan(span: Span, status: string): void {
    span.setAttribute('ai.status', status);
    span.setStatus(status === 'ok' ? { code: SpanStatusCode.OK } : { code: SpanStatusCode.ERROR, message: status });
    span.end();
  }

  /**
   * ⚠ Only ids, the model, the operation, the outcome and a duration. Never
   * `ctx.apiKey`, never the request or response body — see
   * `openai.adapter.spec.ts`'s redaction test.
   */
  private logCall(
    operation: OpenAiOperation,
    model: string | undefined,
    ctx: AiCallContext,
    status: string,
    started: number,
    providerRequestId?: string | null,
  ): void {
    this.logger.debug({
      msg: 'AI provider call',
      provider: OPENAI_PROVIDER_ID,
      operation,
      model,
      status,
      requestId: ctx.requestId,
      providerRequestId: providerRequestId ?? undefined,
      durationMs: Date.now() - started,
    });
  }

  /** Runs `fn` inside an `ai.provider.call` span, mapping any failure to `AiError`. */
  private async call<T>(
    operation: OpenAiOperation,
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
      const mapped = mapOpenAiError(err);

      status = mapped.code;
      providerRequestId = mapped.toJSON().details.providerRequestId as string | undefined;

      throw mapped;
    } finally {
      this.endSpan(span, status);
      this.logCall(operation, model, ctx, status, started, providerRequestId);
    }
  }
}

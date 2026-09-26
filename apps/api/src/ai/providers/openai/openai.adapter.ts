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
//   openai-embeddings.mapper.ts  AiEmbeddingRequest <-> /v1/embeddings
//   openai-images.mapper.ts      AiImage*Request <-> /v1/images/{generations,edits}
//   openai-audio.mapper.ts       AiTranscriptionRequest <-> /v1/audio/transcriptions,
//                                AiSpeechRequest <-> /v1/audio/speech
//
// PORTS. `responses`, `embeddings` (#440), `images` (#437, generate AND
// edit) and `audio` (#438 `transcribe`, #439 `speech` + its static `voices`)
// are carried. `realtime` is
// deliberately ABSENT until a later story implements it — presence is the
// declaration, so `AiProviderRegistry.supports()` stays truthful about what
// this adapter can actually do today.
//
// STORAGE-OBJECT INPUTS (#441). `fileInputStrategy` is images by
// `presigned_url` (a 10-minute signed GET the runtime minted, passed as
// `image_url` — OpenAI fetches it, the bytes never pass through the API) and
// files by `upload`: the runtime's capped stream goes to the Files API
// (`purpose: 'user_data'`) under the caller's own resolved key, the request
// names it by `file_id`, and the provider-side copy is DELETED once the
// response completes, fails or its stream ends — best effort, logged by file
// id only. Nothing is cached across calls (or users): each call uploads its
// own copy.
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
import { type OpenAI, toFile } from 'openai';
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
import type {
  AiAudioPort,
  AiEmbeddingRequest,
  AiEmbeddingResult,
  AiEmbeddingsPort,
  AiImageEditRequest,
  AiImageGenerationRequest,
  AiImageResult,
  AiImagesPort,
  AiSpeechRequest,
  AiSpeechResult,
  AiTranscriptionRequest,
  AiTranscriptionResult,
} from '../../core/types/media.types';
import type { AiFileInputStrategies } from '../../core/types/file-inputs.types';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from '../../core/types/responses.types';
import { resolveServiceName } from '../../../common/otel/service-name';
import {
  fromOpenAiSpeechResponse,
  fromOpenAiTranscriptionResponse,
  OPENAI_TRANSCRIPTION_MAX_BYTES,
  toOpenAiSpeechRequest,
  toOpenAiTranscriptionRequest,
} from './openai-audio.mapper';
import { OpenAiClientFactory } from './openai-client.factory';
import { fromOpenAiEmbeddingResponse, toOpenAiEmbeddingRequest } from './openai-embeddings.mapper';
import { mapOpenAiError, OPENAI_PROVIDER_ID } from './openai-errors';
import {
  fromOpenAiImagesResponse,
  toOpenAiImageEditRequest,
  toOpenAiImageGenerateRequest,
} from './openai-images.mapper';
import { classifyOpenAiModel, OPENAI_SPEECH_VOICES } from './openai-model-catalog';
import {
  fromOpenAiResponse,
  type OpenAiStorageDeliveries,
  type OpenAiStorageDelivery,
  storageObjectIdsOf,
  toOpenAiRequest,
} from './openai-responses.mapper';
import { OpenAiStreamMapper } from './openai-stream.mapper';

export const AI_PROVIDER_CALL_SPAN = 'ai.provider.call';

type OpenAiOperation =
  | 'models.list'
  | 'verify_key'
  | 'responses.create'
  | 'responses.stream'
  | 'embeddings.create'
  | 'images.generate'
  | 'images.edit'
  | 'audio.transcribe'
  | 'audio.speech';

const tracer = trace.getTracer(resolveServiceName());

@Injectable()
export class OpenAiProviderAdapter implements AiProviderAdapter, OnModuleInit {
  readonly id = OPENAI_PROVIDER_ID;
  readonly displayName = 'OpenAI';

  /** Images by presigned URL, files through the Files API — see the file header. */
  readonly fileInputStrategy: AiFileInputStrategies = { image: 'presigned_url', file: 'upload' };

  readonly responses: AiResponsesPort = {
    create: (req, ctx) => this.createResponse(req, ctx),
    stream: (req, ctx) => this.streamResponse(req, ctx),
  };

  readonly embeddings: AiEmbeddingsPort = {
    embed: (req, ctx) => this.embed(req, ctx),
  };

  readonly images: AiImagesPort = {
    generate: (req, ctx) => this.generateImages(req, ctx),
    edit: (req, ctx) => this.editImages(req, ctx),
  };

  readonly audio: AiAudioPort = {
    transcribe: (req, ctx) => this.transcribe(req, ctx),
    transcriptionMaxBytes: OPENAI_TRANSCRIPTION_MAX_BYTES,
    speech: (req, ctx) => this.speak(req, ctx),
    voices: OPENAI_SPEECH_VOICES,
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
      const uploaded: string[] = [];
      let client: OpenAI | undefined;
      const lazyClient = () => (client ??= this.clients.create(ctx));

      try {
        const storage = await this.deliverStorageInputs(req, ctx, lazyClient, uploaded);
        const body = toOpenAiRequest(req, this.classifyModel(req.model), storage);

        const { data, request_id } = await lazyClient()
          .responses.create({ ...body, stream: false }, { signal: ctx.signal })
          .withResponse();

        if (data.status === 'cancelled') {
          throw new AiError('AI_PROVIDER_UNAVAILABLE', 'The OpenAI response was cancelled.', {
            details: { provider: OPENAI_PROVIDER_ID, ...(request_id ? { providerRequestId: request_id } : {}) },
          });
        }

        return fromOpenAiResponse(data, { request: req, providerRequestId: request_id });
      } finally {
        await this.deleteUploaded(client, uploaded, ctx);
      }
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
    const uploaded: string[] = [];
    let client: OpenAI | undefined;
    const lazyClient = () => (client ??= this.clients.create(ctx));

    try {
      const storage = await this.deliverStorageInputs(req, ctx, lazyClient, uploaded);
      const body = toOpenAiRequest(req, this.classifyModel(req.model), storage);

      try {
        const { data, request_id } = await lazyClient().responses
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

      await this.deleteUploaded(client, uploaded, ctx);

      this.endSpan(span, status);
      this.logCall('responses.stream', req.model, ctx, status, started, providerRequestId);
    }
  }

  // ---- storage-object inputs (#441) ------------------------------------------

  /**
   * What each storage-object part of `req` becomes on the wire, by the
   * strategy the runtime prepared it for: a presigned (or inline `data:`)
   * URL, or a Files API id — uploaded here, with the call's own key, and
   * pushed onto `uploaded` so the caller deletes it whatever happens next.
   * `undefined` when the request names no storage object.
   */
  private async deliverStorageInputs(
    req: AiResponseRequest,
    ctx: AiCallContext,
    client: () => OpenAI,
    uploaded: string[],
  ): Promise<OpenAiStorageDeliveries | undefined> {
    const ids = storageObjectIdsOf(req);

    if (ids.length === 0) return undefined;

    const deliveries = new Map<string, OpenAiStorageDelivery>();

    for (const id of ids) {
      const input = ctx.storageInputs?.get(id);

      if (!input) {
        throw new AiError('AI_INVALID_REQUEST', 'A storage-object input was not resolved by the runtime.', {
          details: { provider: OPENAI_PROVIDER_ID },
        });
      }

      const base = { modality: input.modality, filename: input.filename };

      if (input.strategy === 'presigned_url' && input.url) {
        deliveries.set(id, { ...base, url: input.url });
      } else if (input.strategy === 'upload' && input.open) {
        const file = await toFile(await input.open(), input.filename, { type: input.mimeType });
        const created = await client().files.create({ file, purpose: 'user_data' }, { signal: ctx.signal });

        uploaded.push(created.id);
        deliveries.set(id, { ...base, fileId: created.id });
      } else if (input.strategy === 'inline' && input.read) {
        const payload = await input.read();
        const data = Buffer.from(payload.data).toString('base64');

        deliveries.set(id, { ...base, url: `data:${input.mimeType};base64,${data}` });
      } else {
        throw new AiError('AI_INVALID_REQUEST', 'A storage-object input was not prepared for delivery.', {
          details: { provider: OPENAI_PROVIDER_ID, strategy: input.strategy },
        });
      }
    }

    return deliveries;
  }

  /**
   * Deletes the provider-side copies of this call's uploaded inputs. Best
   * effort: a failure is logged (file id and outcome only — never the key)
   * and never replaces the call's own result. Deliberately not bound to
   * `ctx.signal`: a cancelled call still cleans up.
   */
  private async deleteUploaded(client: OpenAI | undefined, uploaded: string[], ctx: AiCallContext): Promise<void> {
    if (!client) return;

    for (const fileId of uploaded.splice(0)) {
      try {
        await client.files.delete(fileId);
        this.logger.debug({ msg: 'AI input file deleted', provider: OPENAI_PROVIDER_ID, fileId, requestId: ctx.requestId });
      } catch (err) {
        this.logger.warn({
          msg: 'Could not delete an AI input file from the provider',
          provider: OPENAI_PROVIDER_ID,
          fileId,
          requestId: ctx.requestId,
          status: mapOpenAiError(err).code,
        });
      }
    }
  }

  // ---- embeddings port ------------------------------------------------------

  /** `POST /v1/embeddings`, floats on the wire — see `openai-embeddings.mapper.ts`. */
  private embed(req: AiEmbeddingRequest, ctx: AiCallContext): Promise<AiEmbeddingResult> {
    return this.call('embeddings.create', req.model, ctx, async () => {
      const body = toOpenAiEmbeddingRequest(req);
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.embeddings.create(body, { signal: ctx.signal }).withResponse();

      return fromOpenAiEmbeddingResponse(data, { request: req, providerRequestId: request_id });
    });
  }

  // ---- images port ------------------------------------------------------------

  /** `POST /v1/images/generations`, always answered as base64 bytes — see `openai-images.mapper.ts`. */
  private generateImages(req: AiImageGenerationRequest, ctx: AiCallContext): Promise<AiImageResult> {
    return this.call('images.generate', req.model, ctx, async () => {
      const body = toOpenAiImageGenerateRequest(req);
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.images.generate(body, { signal: ctx.signal }).withResponse();

      return fromOpenAiImagesResponse(data, { request: req, providerRequestId: request_id });
    });
  }

  /** `POST /v1/images/edits` (multipart: the source images and the optional mask). */
  private editImages(req: AiImageEditRequest, ctx: AiCallContext): Promise<AiImageResult> {
    return this.call('images.edit', req.model, ctx, async () => {
      const body = await toOpenAiImageEditRequest(req);
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.images.edit(body, { signal: ctx.signal }).withResponse();

      return fromOpenAiImagesResponse(data, { request: req, providerRequestId: request_id });
    });
  }

  // ---- audio port -------------------------------------------------------------

  /**
   * `POST /v1/audio/transcriptions` (multipart). A streamed input is sent as
   * it is read — see `openai-audio.mapper.ts`.
   */
  private transcribe(req: AiTranscriptionRequest, ctx: AiCallContext): Promise<AiTranscriptionResult> {
    return this.call('audio.transcribe', req.model, ctx, async () => {
      const body = await toOpenAiTranscriptionRequest(req);
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.audio.transcriptions
        .create(body, { signal: ctx.signal })
        .withResponse();

      return fromOpenAiTranscriptionResponse(data, { request: req, providerRequestId: request_id });
    });
  }

  /** `POST /v1/audio/speech` — the answer is the audio file itself. */
  private speak(req: AiSpeechRequest, ctx: AiCallContext): Promise<AiSpeechResult> {
    return this.call('audio.speech', req.model, ctx, async () => {
      const body = toOpenAiSpeechRequest(req);
      const client = this.clients.create(ctx);

      const { data, request_id } = await client.audio.speech.create(body, { signal: ctx.signal }).withResponse();
      const bytes = new Uint8Array(await data.arrayBuffer());

      return fromOpenAiSpeechResponse(bytes, { request: req, providerRequestId: request_id });
    });
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

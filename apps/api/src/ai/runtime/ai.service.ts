// =============================================================================
// AiService — THE runtime facade (issue #432, epic #419)
// =============================================================================
//
// The one injectable a fork uses to add AI to a feature:
//
//   constructor(private readonly ai: AiService) {}
//   ...
//   const res = await this.ai.forUser(userId).respond({ input: 'Summarise …' });
//
// No SDK, no key, no policy check of the caller's own. Every call runs the
// same gate pipeline, in this order (docs/specs/ai-platform.md §7, §8, §13):
//
//   1. kill switch                     AI_DISABLED
//   2. provider enabled + registered   AI_PROVIDER_DISABLED
//   3. model enabled / capabilities /  AI_MODEL_NOT_ENABLED,
//      key exists / key reaches model  AI_CAPABILITY_UNSUPPORTED,
//                                      AI_KEY_REQUIRED, AI_MODEL_NOT_REACHABLE
//      (UsableModelsService.assertUsable, with the capabilities the request's
//      SHAPE needs — structured output, tools, reasoning, images, streaming)
//   4. reasoning effort offered by the model
//   5. clamp maxOutputTokens to the deployment cap and the model's own limit
//   6. resolve the key (AiKeyResolver — the byok invariant lives there)
//   7. call the adapter with { apiKey, baseUrl, signal, requestId }
//   8. record ONE `ai_usage_events` row per round-trip (success, failure or
//      cancellation) with whose key paid (AiUsageRecorder)
//   9. trace it as an `ai.request` span (provider, model, operation, key
//      source, status, token counts — never prompt text, never the key)
//
// ⚠ THE KEY. `apiKey` exists in this file only between step 6 and the
// adapter call. It is never logged, never put on a span, never persisted and
// never part of an error.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { resolveServiceName } from '../../common/otel/service-name';
import { userAiSettingsSchema } from '../../common/schemas/settings.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { AiConfigService } from '../config/ai-config.service';
import { AiError } from '../core/ai-error';
import type { AiCapability } from '../core/capabilities';
import type { AiCallContext, AiResponsesPort } from '../core/provider-adapter.interface';
import { AiProviderRegistry } from '../core/provider-registry';
import { parseStructured } from '../core/structured-output';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from '../core/types/responses.types';
import { AiKeyResolver, type AiKeySource } from '../keys/ai-key-resolver.service';
import type { UsableAiModel } from '../keys/dto/usable-ai-model.dto';
import { UsableModelsService } from '../keys/usable-models.service';
import { toStoredRunRequest } from './ai-run-request';
import { AiRunsService } from './ai-runs.service';
import type {
  AiCallOptions,
  AiRequest,
  AiRunHandle,
  AiStructuredRequest,
  AiStructuredResponse,
  AiToolLoopRequest,
  AiToolLoopResult,
} from './ai-runtime.types';
import { runToolLoop } from './ai-tool-loop';
import { AiUsageRecorder, type AiUsageStatus } from './ai-usage.recorder';

/** The facade's span — one per provider round-trip. The adapter's own `ai.provider.call` nests inside it. */
export const AI_REQUEST_SPAN = 'ai.request';

const tracer = trace.getTracer(resolveServiceName());

/** Prompt text is logged (only when `ai.logPromptContent`) truncated to this many characters. */
export const AI_PROMPT_LOG_MAX_CHARS = 2048;

/**
 * One user's AI client. Obtain it with `AiService.forUser(userId)`; every
 * method runs the full gate pipeline, resolves the right key, records one
 * usage row per provider round-trip, and traces the call.
 */
export interface AiUserClient {
  /** The user this client acts for. */
  readonly userId: string;

  /** One response. */
  respond(req: AiRequest, opts?: AiCallOptions): Promise<AiResponse>;

  /**
   * A streamed response. Lazy: gate and pre-stream provider errors surface on
   * the first iteration. A caller that must answer them BEFORE committing to
   * a stream (an SSE route) uses `openStream` instead.
   */
  stream(req: AiRequest, opts?: AiCallOptions): AsyncIterable<AiStreamEvent>;

  /**
   * A streamed response whose gates and provider connection are settled
   * EAGERLY: the promise rejects with an `AiError` for every failure that
   * happens before the first event; after that, a failure is an in-band
   * `error` event and the iterable ends.
   */
  openStream(req: AiRequest, opts?: AiCallOptions): Promise<AsyncIterable<AiStreamEvent>>;

  /**
   * A response validated against `schema` — `parsed` is typed and always
   * present. Output that is not JSON or does not match is
   * `AiError('AI_STRUCTURED_OUTPUT_INVALID')` (502).
   */
  respondStructured<S extends z.ZodTypeAny>(
    req: AiStructuredRequest<S>,
    opts?: AiCallOptions,
  ): Promise<AiStructuredResponse<z.output<S>>>;

  /**
   * The function-calling agent loop (`ai-tool-loop.ts`): up to `maxSteps`
   * (default 8, max 20) gated round-trips, each with its own usage row.
   */
  runTools(req: AiToolLoopRequest, opts?: AiCallOptions): Promise<AiToolLoopResult>;

  /**
   * Queues the request as a background run (an `ai.response.run` job) and
   * returns at once; poll `AiRunsService.get(userId, runId)`. The gates run
   * now — an unusable request fails fast — and again when the job executes.
   *
   * @throws AiError('AI_INVALID_REQUEST') when `ai.defaults.allowBackgroundRuns`
   *   is off, or the request carries a function tool (in-process code cannot
   *   survive the queue hop; use `runTools`).
   */
  startRun(req: AiRequest): Promise<AiRunHandle>;
}

/** Internal: who a client acts for, and under which job (for usage rows). */
export interface AiClientScope {
  userId: string;
  jobId?: string;
}

/** Everything the gate pipeline settled for one provider call. */
export interface PreparedAiCall {
  provider: string;
  port: AiResponsesPort;
  /** The request the adapter receives — model resolved, tokens clamped. */
  request: AiResponseRequest;
  model: UsableAiModel;
  baseUrl?: string;
  logPromptContent: boolean;
}

interface PrepareOptions {
  streaming: boolean;
}

/** How one round-trip ended, for its usage row and span. */
interface CallOutcome {
  status: AiUsageStatus;
  response?: AiResponse;
  errorCode?: string;
}

/** Records a round-trip's usage row and ends its span — exactly once. */
interface CallTracker {
  finish(outcome: CallOutcome): Promise<void>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly registry: AiProviderRegistry,
    private readonly usableModels: UsableModelsService,
    private readonly keyResolver: AiKeyResolver,
    private readonly prisma: PrismaService,
    private readonly usage: AiUsageRecorder,
    private readonly runs: AiRunsService,
  ) {}

  /**
   * The AI client for `userId`. Cheap — create one per request.
   *
   * `jobId` is internal plumbing for the background-run handler, so its
   * usage rows name the job they were incurred under.
   */
  forUser(userId: string, scope: { jobId?: string } = {}): AiUserClient {
    const bound: AiClientScope = { userId, jobId: scope.jobId };

    return {
      userId,
      respond: (req, opts) => this.respond(bound, req, opts),
      stream: (req, opts) => this.lazyStream(bound, req, opts),
      openStream: (req, opts) => this.openStream(bound, req, opts),
      respondStructured: (req, opts) => this.respondStructured(bound, req, opts),
      runTools: (req, opts = {}) =>
        runToolLoop((next, callOpts) => this.respond(bound, next, callOpts), req, {
          userId,
          signal: opts.signal,
        }),
      startRun: (req) => this.startRun(bound, req),
    };
  }

  // ---- respond ----------------------------------------------------------------

  private async respond(scope: AiClientScope, req: AiRequest, opts: AiCallOptions = {}): Promise<AiResponse> {
    const call = await this.prepare(scope.userId, req, { streaming: false });

    return this.invoke(scope, call, opts);
  }

  private async respondStructured<S extends z.ZodTypeAny>(
    scope: AiClientScope,
    req: AiStructuredRequest<S>,
    opts: AiCallOptions = {},
  ): Promise<AiStructuredResponse<z.output<S>>> {
    const { schema, schemaName, strict, ...rest } = req;
    const response = await this.respond(
      scope,
      { ...rest, structuredOutput: { name: schemaName ?? 'response', schema, strict: strict ?? true } },
      opts,
    );

    return response as AiStructuredResponse<z.output<S>>;
  }

  private async startRun(scope: AiClientScope, req: AiRequest): Promise<AiRunHandle> {
    await this.aiConfig.assertEnabled();

    if (!(await this.aiConfig.resolve()).defaults.allowBackgroundRuns) {
      throw new AiError('AI_INVALID_REQUEST', 'Background AI runs are disabled in this deployment.');
    }

    const call = await this.prepare(scope.userId, req, { streaming: false });

    return this.runs.create({
      userId: scope.userId,
      provider: call.provider,
      modelId: call.request.model,
      // Named fields only, and never a key — see `ai-run-request.ts`.
      request: toStoredRunRequest(call.provider, call.request),
    });
  }

  /** Steps 6-7 for an already-gated call. */
  private async invoke(scope: AiClientScope, call: PreparedAiCall, opts: AiCallOptions): Promise<AiResponse> {
    const { ctx, keySource } = await this.context(scope, call, opts);
    const tracker = this.track(scope, call, keySource, 'responses.create');

    let response: AiResponse;

    try {
      response = await call.port.create(call.request, ctx);
    } catch (err) {
      const error = toAiError(err, opts.signal);

      await tracker.finish(failure(error, opts.signal));
      throw error;
    }

    // Adapters validate structured output themselves; a response they left
    // unparsed (a truncated answer, say) is validated here, so a caller that
    // asked for a schema never receives an unvalidated result.
    const spec = call.request.structuredOutput;

    if (spec && response.parsed === undefined) {
      try {
        response = { ...response, parsed: parseStructured(spec.schema, response.outputText) };
      } catch (err) {
        const error = toAiError(err, opts.signal);

        // The round-trip happened (and was billed): keep its tokens.
        await tracker.finish({ status: 'failed', response, errorCode: error.code });
        throw error;
      }
    }

    await tracker.finish({ status: 'succeeded', response });

    return response;
  }

  // ---- stream -------------------------------------------------------------------

  private async *lazyStream(
    scope: AiClientScope,
    req: AiRequest,
    opts: AiCallOptions = {},
  ): AsyncGenerator<AiStreamEvent> {
    yield* await this.openStream(scope, req, opts);
  }

  private async openStream(
    scope: AiClientScope,
    req: AiRequest,
    opts: AiCallOptions = {},
  ): Promise<AsyncIterable<AiStreamEvent>> {
    const call = await this.prepare(scope.userId, req, { streaming: true });
    const { ctx, keySource } = await this.context(scope, call, opts);
    const tracker = this.track(scope, call, keySource, 'responses.stream');
    let iterator: AsyncIterator<AiStreamEvent>;

    // Prime the first event so a provider refusal that happens before the
    // stream starts (a rejected key, a throttle) rejects THIS promise — the
    // caller can still answer it as an ordinary error, not an in-band frame.
    let first: IteratorResult<AiStreamEvent>;

    try {
      iterator = call.port.stream(call.request, ctx)[Symbol.asyncIterator]();
      first = await iterator.next();
    } catch (err) {
      const error = toAiError(err, opts.signal);

      await tracker.finish(failure(error, opts.signal));
      throw error;
    }

    return this.relay(first, iterator, tracker, opts);
  }

  private async *relay(
    first: IteratorResult<AiStreamEvent>,
    iterator: AsyncIterator<AiStreamEvent>,
    tracker: CallTracker,
    opts: AiCallOptions,
  ): AsyncGenerator<AiStreamEvent> {
    let finished = false;
    // Until a terminal event arrives, the stream ending means the consumer
    // walked away (or the adapter broke the contract — also not a success).
    let outcome: CallOutcome = { status: 'cancelled' };

    try {
      let result = first;

      while (!result.done) {
        const event = result.value;

        if (event.type === 'response.completed') {
          outcome = { status: 'succeeded', response: event.response };
        } else if (event.type === 'error') {
          outcome = { status: 'failed', errorCode: event.code };
        }

        yield event;
        result = await iterator.next();
      }

      finished = true;

      if (outcome.status === 'cancelled' && !opts.signal?.aborted) {
        outcome = { status: 'failed', errorCode: 'AI_PROVIDER_UNAVAILABLE' };
      }
    } catch (err) {
      finished = true;

      const error = toAiError(err, opts.signal);

      outcome = failure(error, opts.signal);
      throw error;
    } finally {
      // A consumer that stopped early: let the adapter close its connection.
      if (!finished) await iterator.return?.();

      await tracker.finish(outcome);
    }
  }

  // ---- usage + tracing --------------------------------------------------------------

  /** Opens the `ai.request` span and returns the once-only finisher for it. */
  private track(
    scope: AiClientScope,
    call: PreparedAiCall,
    keySource: AiKeySource,
    operation: 'responses.create' | 'responses.stream',
  ): CallTracker {
    const started = Date.now();
    const span: Span = tracer.startSpan(AI_REQUEST_SPAN, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'ai.provider': call.provider,
        'ai.model': call.request.model,
        'ai.operation': operation,
        'ai.key_source': keySource,
      },
    });
    let done = false;

    return {
      finish: async (outcome) => {
        if (done) return;
        done = true;

        const latencyMs = Date.now() - started;
        const usage = outcome.response?.usage;

        span.setAttribute('ai.status', outcome.status);
        if (outcome.errorCode) span.setAttribute('ai.error_code', outcome.errorCode);
        if (usage?.inputTokens !== undefined) span.setAttribute('ai.usage.input_tokens', usage.inputTokens);
        if (usage?.outputTokens !== undefined) span.setAttribute('ai.usage.output_tokens', usage.outputTokens);
        if (usage?.reasoningTokens !== undefined) {
          span.setAttribute('ai.usage.reasoning_tokens', usage.reasoningTokens);
        }
        span.setStatus(
          outcome.status === 'failed'
            ? { code: SpanStatusCode.ERROR, message: outcome.errorCode ?? 'failed' }
            : { code: SpanStatusCode.OK },
        );
        span.end();

        this.logger.debug(
          `AI ${operation} ${call.provider}/${call.request.model} key=${keySource} ` +
            `${outcome.status}${outcome.errorCode ? ` (${outcome.errorCode})` : ''} in ${latencyMs}ms`,
        );

        await this.usage.record({
          userId: scope.userId,
          provider: call.provider,
          modelId: call.request.model,
          operation: 'responses',
          keySource,
          usage,
          latencyMs,
          status: outcome.status,
          errorCode: outcome.errorCode ?? null,
          providerRequestId: outcome.response?.providerRequestId ?? null,
          jobId: scope.jobId ?? null,
        });
      },
    };
  }

  // ---- the gate pipeline -----------------------------------------------------------

  /**
   * Steps 1-5 of the pipeline: everything but the key. Throws the exact
   * `AiError` for the first gate that refuses. Decrypts nothing.
   */
  async prepare(userId: string, req: AiRequest, opts: PrepareOptions): Promise<PreparedAiCall> {
    // 1. Kill switch — before anything else is read.
    await this.aiConfig.assertEnabled();

    const { provider, model } = await this.resolveTarget(userId, req);

    // 2. Provider enabled in settings AND registered in this process.
    const slot = await this.aiConfig.assertProviderEnabled(provider);
    const port = this.registry.get(provider)?.responses;

    // 3. Model enabled, capabilities (model AND provider port), key reach.
    const needed = requiredCapabilities(req, opts.streaming);
    const { model: usable } = await this.usableModels.assertUsable(userId, provider, model, needed);

    if (!port) {
      // assertUsable already refused a provider without a responses port
      // (`responses` is always in `needed`); this narrows the type.
      throw capabilityUnsupported(provider, model, 'responses');
    }

    // 4. Reasoning effort must be one the model offers, when it says.
    const effort = req.reasoning?.effort;
    const efforts = usable.capabilities.reasoningEfforts;

    if (effort && efforts && !efforts.includes(effort)) {
      throw new AiError(
        'AI_CAPABILITY_UNSUPPORTED',
        `Model "${model}" does not offer reasoning effort "${effort}".`,
        { details: { provider, model, capability: 'reasoning', effort } },
      );
    }

    // 5. Clamp output tokens.
    const policy = await this.aiConfig.resolve();
    const maxOutputTokens = clampOutputTokens(
      req.maxOutputTokens,
      policy.defaults.maxOutputTokensCap,
      usable.capabilities.maxOutputTokens,
    );

    const { provider: _provider, model: _model, ...rest } = req;
    const request: AiResponseRequest = { ...rest, model };

    if (maxOutputTokens !== undefined) {
      request.maxOutputTokens = maxOutputTokens;
    }

    return {
      provider,
      port,
      request,
      model: usable,
      baseUrl: slot.baseUrl,
      logPromptContent: policy.logPromptContent,
    };
  }

  /** Step 6: resolve the key and build the adapter context. */
  private async context(
    scope: AiClientScope,
    call: PreparedAiCall,
    opts: AiCallOptions,
  ): Promise<{ ctx: AiCallContext; keySource: AiKeySource }> {
    if (opts.signal?.aborted) {
      throw cancelled(call.provider);
    }

    const { apiKey, keySource } = await this.keyResolver.resolve(scope.userId, call.provider);
    const requestId = randomUUID();

    if (call.logPromptContent) {
      this.logger.debug(
        `AI prompt ${requestId} (${call.provider}/${call.request.model}): ${promptPreview(call.request)}`,
      );
    }

    return {
      ctx: {
        apiKey,
        requestId,
        ...(call.baseUrl ? { baseUrl: call.baseUrl } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      keySource,
    };
  }

  /**
   * Which (provider, model) the request targets. See `AiRequest` for the
   * fallback order.
   */
  private async resolveTarget(userId: string, req: AiRequest): Promise<{ provider: string; model: string }> {
    const requested = req.model?.trim();

    if (requested) {
      const provider = req.provider ?? (await this.defaultModel(userId))?.provider ?? this.soleProvider();

      if (!provider) {
        throw new AiError('AI_INVALID_REQUEST', 'No provider selected.', { details: { model: requested } });
      }

      return { provider, model: requested };
    }

    const fallback = await this.defaultModel(userId);

    if (!fallback || (req.provider !== undefined && req.provider !== fallback.provider)) {
      throw new AiError('AI_INVALID_REQUEST', 'No model selected.');
    }

    return { provider: fallback.provider, model: fallback.modelId };
  }

  /**
   * The user's `ai.defaultModel`, read RAW from `user_settings.value` — not
   * through `UserSettingsService.getSettings`, which creates a row when none
   * exists (see `NotificationsService.loadRecipient` for the full argument).
   */
  private async defaultModel(userId: string): Promise<{ provider: string; modelId: string } | null> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
      select: { value: true },
    });
    const value = row?.value as { ai?: unknown } | null | undefined;
    const parsed = userAiSettingsSchema.safeParse(value?.ai);

    return parsed.success ? parsed.data.defaultModel : null;
  }

  private soleProvider(): string | undefined {
    const ids = this.registry.ids();

    return ids.length === 1 ? ids[0] : undefined;
  }
}

// ---- helpers ---------------------------------------------------------------------------

/**
 * The model capabilities a request's SHAPE needs. `responses` always; the
 * rest follow from what the request carries.
 */
export function requiredCapabilities(
  req: Pick<AiResponseRequest, 'structuredOutput' | 'tools' | 'reasoning' | 'input'>,
  streaming: boolean,
): AiCapability[] {
  const needed = new Set<AiCapability>(['responses']);

  if (streaming) needed.add('streaming');
  if (req.structuredOutput) needed.add('structured_output');
  if (req.reasoning?.effort) needed.add('reasoning');

  for (const tool of req.tools ?? []) {
    needed.add(tool.type === 'function' ? 'tools' : 'hosted_tools');
  }

  if (Array.isArray(req.input)) {
    for (const item of req.input) {
      if (item.type !== 'message') continue;

      for (const part of item.content) {
        if (part.type === 'image') needed.add('vision_input');
        if (part.type === 'file') needed.add('file_input');
      }
    }
  }

  return [...needed];
}

/**
 * The effective `maxOutputTokens`: the caller's value bounded by the
 * deployment cap and the model's own limit. With no caller value, the
 * deployment cap still bounds the call (it "bounds every call"); the model's
 * limit alone does not invent one.
 */
export function clampOutputTokens(
  requested: number | undefined,
  deploymentCap: number | undefined,
  modelMax: number | undefined,
): number | undefined {
  if (requested !== undefined && (!Number.isInteger(requested) || requested < 1)) {
    throw new AiError('AI_INVALID_REQUEST', 'maxOutputTokens must be a positive integer.', {
      details: { maxOutputTokens: requested },
    });
  }

  const bounds = [requested ?? deploymentCap, deploymentCap, modelMax].filter(
    (value): value is number => value !== undefined,
  );

  if (requested === undefined && deploymentCap === undefined) {
    return undefined;
  }

  return Math.min(...bounds);
}

/** The outcome of a round-trip that threw. An abort is a cancellation, not a failure. */
function failure(error: AiError, signal?: AbortSignal): CallOutcome {
  return signal?.aborted
    ? { status: 'cancelled', errorCode: error.code }
    : { status: 'failed', errorCode: error.code };
}

function capabilityUnsupported(provider: string, model: string, capability: AiCapability): AiError {
  return new AiError('AI_CAPABILITY_UNSUPPORTED', `Model "${model}" does not support ${capability}.`, {
    details: { provider, model, capability },
  });
}

function cancelled(provider: string): AiError {
  return new AiError('AI_PROVIDER_UNAVAILABLE', 'The AI request was cancelled.', {
    details: { provider, aborted: true },
  });
}

/**
 * Normalises anything a provider call threw. An abort is reported as a
 * cancellation (never as the raw `AbortError`), everything else via
 * `AiError.wrap` — so nothing raw escapes the facade.
 */
export function toAiError(err: unknown, signal?: AbortSignal): AiError {
  if (err instanceof AiError) return err;

  if (signal?.aborted) {
    return new AiError('AI_PROVIDER_UNAVAILABLE', 'The AI request was cancelled.', {
      cause: err,
      details: { aborted: true },
    });
  }

  return AiError.wrap(err);
}

/** Prompt text for the opt-in debug log line, truncated. Never the key. */
function promptPreview(req: AiResponseRequest): string {
  const text = JSON.stringify({ instructions: req.instructions, input: req.input });

  return text.length > AI_PROMPT_LOG_MAX_CHARS
    ? `${text.slice(0, AI_PROMPT_LOG_MAX_CHARS)}… (truncated)`
    : text;
}

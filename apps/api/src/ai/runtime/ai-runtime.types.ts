// =============================================================================
// The runtime facade's public types (issue #432, epic #419)
// =============================================================================
//
// What a fork codes against. Everything here is provider-neutral and carries
// no key: the facade resolves the key per call and hands it straight to the
// adapter (docs/specs/ai-platform.md §3), so no type in this file has a field
// able to hold one.
// =============================================================================

import type { z } from 'zod';

import type { AiDefinedTool } from '../core/tools';
import type { AiEmbeddingRequest } from '../core/types/media.types';
import type { AiResponse, AiResponseRequest, AiStreamEvent } from '../core/types/responses.types';

/**
 * A request as a fork writes it. `model` (and `provider`) are optional:
 *
 *   - both omitted  -> the caller's `ai.defaultModel` user setting, else
 *                      `AI_INVALID_REQUEST` ('No model selected');
 *   - `model` alone -> `provider` is the default model's provider, else the
 *                      only registered provider, else `AI_INVALID_REQUEST`.
 */
export type AiRequest = Omit<AiResponseRequest, 'model'> & { provider?: string; model?: string };

/**
 * `embed`'s request. `model` is REQUIRED — vectors from different models are
 * not comparable, so an embedding model is never inferred from the caller's
 * chat `ai.defaultModel`. `provider` resolves as for `AiRequest`.
 */
export type AiEmbedRequest = Omit<AiEmbeddingRequest, 'model'> & { provider?: string; model: string };

/** Per-call options every facade method accepts. */
export interface AiCallOptions {
  /** Aborts the provider call. An aborted call records a `cancelled` usage row. */
  signal?: AbortSignal;
}

/** `respondStructured`'s request: a Zod schema instead of a `structuredOutput` spec. */
export type AiStructuredRequest<S extends z.ZodTypeAny> = Omit<AiRequest, 'structuredOutput'> & {
  schema: S;
  /** Identifier the provider is told (`[a-zA-Z0-9_-]`). Defaults to `'response'`. */
  schemaName?: string;
  /** Ask the provider to enforce the schema exactly. Defaults to true. */
  strict?: boolean;
};

/** A structured response: `parsed` is always present and already validated. */
export type AiStructuredResponse<T> = AiResponse<T> & { parsed: T };

/** What happened to one function call the model made during `runTools`. */
export type AiToolCallStatus = 'ok' | 'invalid_arguments' | 'unknown_tool' | 'error' | 'timeout';

export interface AiToolCallRecord {
  callId: string;
  name: string;
  /** The raw arguments string the model produced. */
  arguments: string;
  status: AiToolCallStatus;
  /** What was fed back to the model as the `function_call_output`. */
  output: string;
  /** The tool's error message when `status` is `error` or `timeout`. */
  error?: string;
  durationMs: number;
}

/** One provider round-trip of the tool loop, and the calls it produced. */
export interface AiToolStep {
  /** 1-based round-trip index. */
  step: number;
  response: AiResponse;
  /** Empty on the final step (the model stopped calling tools). */
  calls: AiToolCallRecord[];
}

export const AI_TOOL_LOOP_DEFAULT_MAX_STEPS = 8;
export const AI_TOOL_LOOP_MAX_STEPS = 20;
export const AI_TOOL_DEFAULT_TIMEOUT_MS = 30_000;

export type AiToolLoopRequest = Omit<AiRequest, 'tools'> & {
  tools: AiDefinedTool[];
  /** Provider round-trips allowed, 1-20. Defaults to 8. */
  maxSteps?: number;
  /** Per-tool execution timeout. Defaults to 30 s. */
  toolTimeoutMs?: number;
  /** Called after every round-trip, in order. A throw here aborts the loop. */
  onStep?: (step: AiToolStep) => void;
};

export interface AiToolLoopResult {
  /** The last provider response. */
  final: AiResponse;
  steps: AiToolStep[];
  /**
   * `completed` — the model stopped calling tools;
   * `steps_exhausted` — `maxSteps` round-trips were spent and the model still
   * wanted to call tools (those calls were NOT executed).
   */
  stopReason: 'completed' | 'steps_exhausted';
}

/** `startRun`'s answer. Poll `AiRunsService.get(userId, runId)`. */
export interface AiRunHandle {
  runId: string;
  jobId: string;
}

export const AI_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/** A background run as its owner sees it. Carries no request and no key. */
export interface AiRunView {
  id: string;
  status: AiRunStatus;
  provider: string;
  modelId: string;
  /** The completed `AiResponse`, once `succeeded`. */
  output: AiResponse | null;
  errorCode: string | null;
  errorMessage: string | null;
  jobId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

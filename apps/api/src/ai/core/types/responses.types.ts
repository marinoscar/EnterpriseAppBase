// =============================================================================
// Text/reasoning/tool request and response types (issue #424, epic #419)
// =============================================================================
//
// Shaped after the OpenAI Responses API because it is the most expressive of
// the current provider APIs (typed input items, typed output items, hosted
// tools, reasoning summaries, response chaining) — but PROVIDER-NEUTRAL: no
// SDK type appears here, and every provider maps onto these shapes inside its
// own adapter. A field one provider cannot honour is the adapter's problem to
// reject with `AI_CAPABILITY_UNSUPPORTED`, never a reason to widen this file
// with provider-specific members. `providerOptions` is the one escape hatch.
//
// Tool parameters and structured-output schemas are ZOD schemas, not JSON
// Schema: the caller's validation and the provider's schema are then the same
// object and cannot disagree. Adapters convert with `toJsonSchema()`.
// =============================================================================

import type { z } from 'zod';

import type { AiErrorCode } from '../ai-error';
import type { AiReasoningEffort } from '../capabilities';

export type AiMessageRole = 'user' | 'assistant' | 'system' | 'developer';

/**
 * One part of a message. Media parts point at bytes (a URL or a storage
 * object id) rather than embedding them: resolving a storage object into
 * something a provider can read is the runtime's job (#431), so it happens
 * once, under the caller's own authorization.
 */
export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; storageObjectId?: string; detail?: 'low' | 'high' | 'auto' }
  | { type: 'file'; storageObjectId?: string; url?: string; filename?: string };

export type AiInputItem =
  | { type: 'message'; role: AiMessageRole; content: AiContentPart[] }
  | { type: 'function_call_output'; callId: string; output: string };

/**
 * A function the model may call. `parameters` is a Zod schema; it is both
 * what the provider is told (via `toJsonSchema`) and what the model's
 * arguments are validated against before `execute` runs (see `tools.ts`).
 */
export interface AiFunctionTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  type: 'function';
  name: string;
  description: string;
  parameters: P;
  strict?: boolean;
}

/** A tool the PROVIDER executes (web search, code interpreter, ...). */
export type AiHostedToolType = 'web_search' | 'file_search' | 'code_interpreter' | 'mcp';

export type AiHostedTool = { type: AiHostedToolType; options?: Record<string, unknown> };

export type AiTool = AiFunctionTool | AiHostedTool;

export type AiToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; name: string };

export interface AiStructuredOutputSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** A short identifier for the schema (`[a-zA-Z0-9_-]`); some providers require one. */
  name: string;
  schema: S;
  strict?: boolean;
}

export interface AiResponseRequest<S extends z.ZodTypeAny = z.ZodTypeAny> {
  model: string;
  instructions?: string;
  input: string | AiInputItem[];
  tools?: AiTool[];
  toolChoice?: AiToolChoice;
  structuredOutput?: AiStructuredOutputSpec<S>;
  reasoning?: { effort?: AiReasoningEffort; summary?: 'auto' | 'concise' | 'detailed' };
  maxOutputTokens?: number;
  temperature?: number;
  /** Chain onto an earlier response instead of resending history (where supported). */
  previousResponseId?: string;
  metadata?: Record<string, string>;
  /**
   * Keyed by provider id (`{ openai: { ... } }`). The escape hatch for a
   * provider feature this contract does not model; an adapter reads only its
   * own key and ignores the rest, so one request stays portable.
   */
  providerOptions?: Record<string, Record<string, unknown>>;
}

export type AiOutputItem =
  | { type: 'message'; text: string }
  | { type: 'reasoning'; summary: string[] }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'hosted_tool_call'; tool: string; status: string; result?: unknown };

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export type AiFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export interface AiResponse<T = unknown> {
  id: string;
  provider: string;
  model: string;
  output: AiOutputItem[];
  /** Every `message` item's text, concatenated in order. */
  outputText: string;
  /** Present only when the request carried `structuredOutput`, already validated. */
  parsed?: T;
  usage: AiUsage;
  finishReason: AiFinishReason;
  providerRequestId?: string;
}

/**
 * Streaming events. A well-formed stream starts with `response.created`, ends
 * with exactly one of `response.completed` or `error`, and the concatenation
 * of its `output_text.delta` events equals the completed response's
 * `outputText` (the conformance kit asserts all three).
 */
export type AiStreamEvent =
  | { type: 'response.created'; id: string }
  | { type: 'output_text.delta'; delta: string }
  | { type: 'reasoning_summary.delta'; delta: string }
  | { type: 'function_call.arguments.delta'; callId: string; delta: string }
  | { type: 'output_item.done'; item: AiOutputItem }
  | { type: 'response.completed'; response: AiResponse }
  | { type: 'error'; code: AiErrorCode; message: string };

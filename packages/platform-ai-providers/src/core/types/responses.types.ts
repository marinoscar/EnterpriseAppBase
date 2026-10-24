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
import type { AiBinaryPayload } from './media.types';

/**
 * Who a message is from. `system` and `developer` carry instructions; a
 * provider without a `developer` role maps it onto its system prompt.
 *
 * @stability experimental
 */
export type AiMessageRole = 'user' | 'assistant' | 'system' | 'developer';

/**
 * One part of a message. Media parts point at bytes (exactly one of a URL or
 * a storage object id) rather than embedding them: resolving a storage
 * object into something a provider can read is the runtime's job (#441 —
 * see `file-inputs.types.ts`), so it happens once per call, under the
 * caller's own authorization, and the request itself keeps only the id.
 *
 * @stability experimental
 */
export type AiContentPart =
  | {
      /** A text part. */
      type: 'text';
      /** The text. */
      text: string;
    }
  | {
      /** An image part. */
      type: 'image';
      /** A URL the provider fetches the image from. */
      url?: string;
      /** A storage object the caller may read; resolved by the runtime. */
      storageObjectId?: string;
      /** How closely the model looks at the image (provider default when absent). */
      detail?: 'low' | 'high' | 'auto';
    }
  | {
      /** A file part (a PDF, a document). */
      type: 'file';
      /** A storage object the caller may read; resolved by the runtime. */
      storageObjectId?: string;
      /** A URL the provider fetches the file from. */
      url?: string;
      /** The file name the provider is told. */
      filename?: string;
    };

// ---- provider continuation state (#446) ---------------------------------------
//
// A STATELESS provider (Anthropic's Messages API) cannot resume a response by
// id, so a multi-round conversation — the tool loop — resends the whole
// history, including the model's own earlier turns. Some of what the model
// produced must then be echoed back byte-for-byte even though it is not
// something a caller may see: Anthropic signs every `thinking` block and
// requires the signed block (or the encrypted `redacted_thinking` block) back
// on the next request of a tool-use turn.
//
// That opaque material rides on the `reasoning` item under a SYMBOL key, so
// it is invisible by construction to everything that serialises a response:
// `JSON.stringify` (every HTTP body, SSE frame, log line and `ai_runs.output`
// row) skips symbol keys, and so do DTO mappers that name their fields. It
// survives only an in-process object copy (`{ ...item }`), which is exactly
// the tool loop's hop from one round's output to the next round's input.
// An adapter reads only state whose `provider` is its own id.

/**
 * The symbol key provider continuation state travels under (see above).
 *
 * @stability experimental
 */
export const AI_PROVIDER_STATE: unique symbol = Symbol('ai.providerState');

/**
 * Opaque, provider-owned continuation state. ⚠ Never exposed: it may hold a
 * signature or encrypted reasoning, which a caller must not see.
 *
 * @stability experimental
 */
export interface AiProviderState {
  /** The adapter id that produced it — only that adapter reads it. */
  provider: string;
  /** The adapter's own material; opaque to everything else. */
  data: unknown;
}

/**
 * A reasoning summary, plus the provider's opaque state for replaying it.
 *
 * @stability experimental
 */
export interface AiReasoningItem {
  /** Discriminator. */
  type: 'reasoning';
  /** The summary paragraphs, in order (empty when the provider gave none). */
  summary: string[];
  /** The provider's continuation state; never serialised (a symbol key). */
  [AI_PROVIDER_STATE]?: AiProviderState;
}

/**
 * A request's input. Beyond messages and tool outputs, an input may REPLAY
 * the model's own earlier `function_call` and `reasoning` items (#446) — how
 * a caller, or the tool loop, carries a conversation to a provider that
 * cannot chain with `previousResponseId` (see
 * `AiProviderAdapter.supportsPreviousResponseId`). A provider that chains may
 * ignore replayed reasoning it cannot use.
 *
 * @stability experimental
 */
export type AiInputItem =
  | {
      /** A message. */
      type: 'message';
      /** Who it is from. */
      role: AiMessageRole;
      /** Its parts, in order. */
      content: AiContentPart[];
    }
  | {
      /** A replayed function call the model made earlier. */
      type: 'function_call';
      /** The provider's call id; the matching output names it. */
      callId: string;
      /** The function's name. */
      name: string;
      /** The arguments, as the JSON text the model produced. */
      arguments: string;
    }
  | {
      /** The result of a function call, sent back to the model. */
      type: 'function_call_output';
      /** The call this answers. */
      callId: string;
      /** The result, as text (usually JSON). */
      output: string;
    }
  | AiReasoningItem;

/**
 * A function the model may call. `parameters` is a Zod schema; it is both
 * what the provider is told (via `toJsonSchema`) and what the model's
 * arguments are validated against before `execute` runs (see `tools.ts`).
 *
 * @typeParam P - the parameters' Zod schema.
 *
 * @stability experimental
 */
export interface AiFunctionTool<P extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Discriminator. */
  type: 'function';
  /** The name the model calls it by (`[a-zA-Z0-9_-]`). */
  name: string;
  /** What it does, for the model. */
  description: string;
  /** The parameters' schema. */
  parameters: P;
  /** Ask the provider to hold the model's arguments to the schema exactly. */
  strict?: boolean;
}

/**
 * The tools the PROVIDER executes inside one response (issue #442): live web
 * search, file search over provider-side vector stores, sandboxed code
 * execution, image generation and remote MCP servers. Each is gated twice —
 * the model must declare `hosted_tools` AND an administrator must have
 * switched that tool type on (`ai.hostedTools.<type>`, all off by default) —
 * see `AiService.prepare` and `core/hosted-tools.ts`.
 *
 * @stability experimental
 */
export const AI_HOSTED_TOOL_TYPES = [
  'web_search',
  'file_search',
  'code_interpreter',
  'image_generation',
  'mcp',
] as const;

/**
 * One of {@link AI_HOSTED_TOOL_TYPES}.
 *
 * @stability experimental
 */
export type AiHostedToolType = (typeof AI_HOSTED_TOOL_TYPES)[number];

/**
 * Hosted live web search.
 *
 * @stability experimental
 */
export interface AiWebSearchTool {
  /** Discriminator. */
  type: 'web_search';
  /** How much retrieved context the provider feeds the model. */
  searchContextSize?: 'low' | 'medium' | 'high';
  /** Approximate location to bias results toward (ISO-3166 alpha-2 `country`). */
  userLocation?: {
    /** ISO-3166 alpha-2 country code. */
    country?: string;
    /** City name. */
    city?: string;
  };
}

/**
 * Hosted file search over provider-side vector stores.
 *
 * @stability experimental
 */
export interface AiFileSearchTool {
  /** Discriminator. */
  type: 'file_search';
  /** Provider-side vector store ids to search (at least one). */
  vectorStoreIds: string[];
  /** The most chunks to retrieve. */
  maxResults?: number;
}

/**
 * Hosted sandboxed code execution.
 *
 * @stability experimental
 */
export interface AiCodeInterpreterTool {
  /** Discriminator. */
  type: 'code_interpreter';
  /** The sandbox; only a provider-managed `auto` container is modelled. */
  container?: {
    /** A provider-managed container. */
    type: 'auto';
  };
}

/**
 * Hosted image generation inside a response.
 *
 * @stability experimental
 */
export interface AiImageGenerationTool {
  /** Discriminator. */
  type: 'image_generation';
  /** Provider-validated, e.g. `1024x1024` or `auto`. */
  size?: string;
  /** Provider-validated, e.g. `low` / `medium` / `high` / `auto`. */
  quality?: string;
}

/**
 * A remote MCP server the provider calls.
 *
 * @stability experimental
 */
export interface AiMcpTool {
  /** Discriminator. */
  type: 'mcp';
  /** A short label the model and the output items name the server by. */
  serverLabel: string;
  /** MUST be `https://`; the host must pass `ai.hostedTools.mcpAllowedHosts` when that list is set. */
  serverUrl: string;
  /** Restrict the model to these of the server's tools. */
  allowedTools?: string[];
  /** Whether a call waits for the caller's approval (`never` by default). */
  requireApproval?: 'never' | 'always';
  /**
   * Sent to the MCP server with each request (typically `Authorization`).
   *
   * ⚠ SECRET MATERIAL. Header values are never logged, never put on a span or
   * a usage row, never stored in `ai_runs.request` (a background run carrying
   * them is refused), never part of an `AiError`, and scrubbed from the
   * response should the server echo one back (`AiService`).
   */
  headers?: Record<string, string>;
}

/**
 * Any provider-executed tool.
 *
 * @stability experimental
 */
export type AiHostedTool =
  | AiWebSearchTool
  | AiFileSearchTool
  | AiCodeInterpreterTool
  | AiImageGenerationTool
  | AiMcpTool;

/**
 * A tool of a request: a function the caller executes, or a hosted tool.
 *
 * @stability experimental
 */
export type AiTool = AiFunctionTool | AiHostedTool;

/**
 * Whether, and which, tool the model must call.
 *
 * @stability experimental
 */
export type AiToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
      /** Force one function. */
      type: 'function';
      /** The function's name. */
      name: string;
    };

/**
 * Ask for output that matches a schema; the runtime validates it and sets
 * `AiResponse.parsed`.
 *
 * @typeParam S - the output's Zod schema.
 *
 * @stability experimental
 */
export interface AiStructuredOutputSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** A short identifier for the schema (`[a-zA-Z0-9_-]`); some providers require one. */
  name: string;
  /** The output's schema. */
  schema: S;
  /** Ask the provider to hold the output to the schema exactly. */
  strict?: boolean;
}

/**
 * One text/reasoning/tool request (`AiService.forUser(...).respond`).
 *
 * @typeParam S - the structured output's Zod schema, when one is asked for.
 *
 * @stability experimental
 */
export interface AiResponseRequest<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** The provider's model id. */
  model: string;
  /** System-level instructions. */
  instructions?: string;
  /** A prompt, or the conversation so far. */
  input: string | AiInputItem[];
  /** Tools the model may call. */
  tools?: AiTool[];
  /** Whether, and which, tool the model must call. */
  toolChoice?: AiToolChoice;
  /** Ask for output matching a schema. */
  structuredOutput?: AiStructuredOutputSpec<S>;
  /** Reasoning effort and summary, for a model that reasons. */
  reasoning?: {
    /** How hard the model thinks (one of the model's `reasoningEfforts`). */
    effort?: AiReasoningEffort;
    /** Whether, and how fully, to return a reasoning summary. */
    summary?: 'auto' | 'concise' | 'detailed';
  };
  /** The most output tokens; clamped by the deployment's and the model's caps. */
  maxOutputTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /**
   * Chain onto an earlier response instead of resending history. Only for a
   * provider that stores responses — one declaring
   * `supportsPreviousResponseId: false` (Anthropic) refuses it with
   * `AI_CAPABILITY_UNSUPPORTED`; send the full history as `input` instead.
   */
  previousResponseId?: string;
  /** Free-form string tags passed to the provider. */
  metadata?: Record<string, string>;
  /**
   * Keyed by provider id (`{ openai: { ... } }`). The escape hatch for a
   * provider feature this contract does not model; an adapter reads only its
   * own key and ignores the rest, so one request stays portable.
   */
  providerOptions?: Record<string, Record<string, unknown>>;
}

/**
 * A web-search citation on a message: `text.slice(startIndex, endIndex)` is what it supports.
 *
 * @stability experimental
 */
export interface AiUrlCitation {
  /** The source. */
  url: string;
  /** The source's title. */
  title: string;
  /** Start of the cited span in the message text. */
  startIndex: number;
  /** End (exclusive) of the cited span. */
  endIndex: number;
}

/**
 * A message the model produced.
 *
 * @stability experimental
 */
export interface AiMessageOutputItem {
  /** Discriminator. */
  type: 'message';
  /** The message text. */
  text: string;
  /** Web sources the text cites (hosted `web_search`), in the provider's order. */
  citations?: AiUrlCitation[];
}

/**
 * `web_search`: what was searched and the sources consulted.
 *
 * @stability experimental
 */
export interface AiWebSearchCallResult {
  /** The queries run. */
  queries: string[];
  /** The sources consulted. */
  sources: Array<{
    /** The source's URL. */
    url: string;
  }>;
}

/**
 * `file_search`: the queries run and the chunks retrieved (when the provider returned them).
 *
 * @stability experimental
 */
export interface AiFileSearchCallResult {
  /** The queries run. */
  queries: string[];
  /** The chunks retrieved. */
  results: Array<{
    /** The provider's file id. */
    fileId?: string;
    /** The file's name. */
    filename?: string;
    /** Relevance score. */
    score?: number;
    /** The chunk's text. */
    text?: string;
  }>;
}

/**
 * `code_interpreter`: the code run and what it printed or drew.
 *
 * @stability experimental
 */
export interface AiCodeInterpreterCallResult {
  /** The code run, when the provider reported it. */
  code: string | null;
  /** The provider's sandbox id. */
  containerId: string;
  /** What the code printed or drew. */
  outputs: Array<
    | {
        /** Printed output. */
        type: 'logs';
        /** The text printed. */
        logs: string;
      }
    | {
        /** A drawn image. */
        type: 'image';
        /** Where the provider serves it. */
        url: string;
      }
  >;
}

/**
 * `image_generation`: the generated image.
 *
 * `image` holds the raw BYTES between the adapter and the facade ONLY — the
 * facade's hosted-output settler (`runtime/ai-hosted-outputs.ts`) always
 * removes it before a response leaves the runtime, so no API response, SSE
 * frame or `ai_runs.output` row ever carries image data inline.
 * `storageObjectId` is the user-owned storage object the image was persisted
 * as, or `null` when it could not be stored — `storageError` then says why.
 *
 * @stability experimental
 */
export interface AiImageGenerationCallResult {
  /** The storage object the image was saved as; `null` when it could not be stored. */
  storageObjectId: string | null;
  /** Set when the image was generated but could not be stored. */
  storageError?: 'AI_STORAGE_UNAVAILABLE';
  /** The image's MIME type. */
  mimeType?: string;
  /** The prompt as the provider rewrote it. */
  revisedPrompt?: string;
  /** The size generated. */
  size?: string;
  /** The quality generated. */
  quality?: string;
  /** The bytes, between adapter and facade only (see above). */
  image?: AiBinaryPayload;
}

/**
 * `mcp`: one of the three things a remote MCP server contributes to a response.
 *
 * @stability experimental
 */
export type AiMcpCallResult =
  | {
      /** A tool call on the server. */
      kind: 'call';
      /** The server's label. */
      serverLabel: string;
      /** The tool called. */
      name: string;
      /** The arguments, as JSON text. */
      arguments: string;
      /** The tool's output. */
      output: string | null;
      /** The call's error. */
      error: string | null;
    }
  | {
      /** The server's tool listing. */
      kind: 'list_tools';
      /** The server's label. */
      serverLabel: string;
      /** The tools the server offers. */
      tools: Array<{
        /** The tool's name. */
        name: string;
        /** What it does. */
        description?: string;
      }>;
      /** The listing's error. */
      error: string | null;
    }
  | {
      /** A call waiting for the caller's approval. */
      kind: 'approval_request';
      /** The server's label. */
      serverLabel: string;
      /** The tool to be called. */
      name: string;
      /** The arguments, as JSON text. */
      arguments: string;
    };

/**
 * Result shape per hosted tool type.
 *
 * @stability experimental
 */
export interface AiHostedToolResults {
  /** `web_search`. */
  web_search: AiWebSearchCallResult;
  /** `file_search`. */
  file_search: AiFileSearchCallResult;
  /** `code_interpreter`. */
  code_interpreter: AiCodeInterpreterCallResult;
  /** `image_generation`. */
  image_generation: AiImageGenerationCallResult;
  /** `mcp`. */
  mcp: AiMcpCallResult;
}

/**
 * A provider-executed tool call, discriminated by `tool`.
 *
 * @stability experimental
 */
export type AiHostedToolCallItem = {
  [T in AiHostedToolType]: {
    /** Discriminator. */
    type: 'hosted_tool_call';
    /** The provider's id for this output item. */
    id?: string;
    /** Which hosted tool. */
    tool: T;
    /** Provider status, e.g. `in_progress`, `searching`, `completed`, `failed`. */
    status: string;
    /** The tool's result, when it has one. */
    result?: AiHostedToolResults[T];
  };
}[AiHostedToolType];

/**
 * One item of a response's output.
 *
 * @stability experimental
 */
export type AiOutputItem =
  | AiMessageOutputItem
  | AiReasoningItem
  | {
      /** A function call the caller is to execute. */
      type: 'function_call';
      /** The provider's call id. */
      callId: string;
      /** The function's name. */
      name: string;
      /** The arguments, as the JSON text the model produced. */
      arguments: string;
    }
  | AiHostedToolCallItem;

/**
 * Token accounting of one response, as the provider reported it.
 *
 * @stability experimental
 */
export interface AiUsage {
  /** Input tokens. */
  inputTokens?: number;
  /** Output tokens (including reasoning). */
  outputTokens?: number;
  /** Reasoning tokens, a subset of the output. */
  reasoningTokens?: number;
  /** Input tokens served from the provider's cache. */
  cachedInputTokens?: number;
}

/**
 * Why a response ended.
 *
 * @stability experimental
 */
export type AiFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

/**
 * One completed response.
 *
 * @typeParam T - the parsed structured output's type.
 *
 * @stability experimental
 */
export interface AiResponse<T = unknown> {
  /** The provider's response id (the `previousResponseId` of a follow-up). */
  id: string;
  /** Provider id. */
  provider: string;
  /** Model id. */
  model: string;
  /** The output items, in order. */
  output: AiOutputItem[];
  /** Every `message` item's text, concatenated in order. */
  outputText: string;
  /** Present only when the request carried `structuredOutput`, already validated. */
  parsed?: T;
  /** Token accounting. */
  usage: AiUsage;
  /** Why it ended. */
  finishReason: AiFinishReason;
  /** The provider's request id, for support tickets. */
  providerRequestId?: string;
}

/**
 * Streaming events. A well-formed stream starts with `response.created`, ends
 * with exactly one of `response.completed` or `error`, and the concatenation
 * of its `output_text.delta` events equals the completed response's
 * `outputText` (the conformance kit asserts all three).
 *
 * @stability experimental
 */
export type AiStreamEvent =
  | {
      /** The response started. */
      type: 'response.created';
      /** Its id. */
      id: string;
    }
  | {
      /** More message text. */
      type: 'output_text.delta';
      /** The new text. */
      delta: string;
    }
  | {
      /** More reasoning summary. */
      type: 'reasoning_summary.delta';
      /** The new text. */
      delta: string;
    }
  | {
      /** More of a function call's arguments. */
      type: 'function_call.arguments.delta';
      /** The call. */
      callId: string;
      /** The new JSON text. */
      delta: string;
    }
  | {
      /** One output item is complete. */
      type: 'output_item.done';
      /** The item. */
      item: AiOutputItem;
    }
  | {
      /** The response completed. */
      type: 'response.completed';
      /** The whole response. */
      response: AiResponse;
    }
  | {
      /** The response failed. */
      type: 'error';
      /** The failure's code. */
      code: AiErrorCode;
      /** A message safe to show. */
      message: string;
    };

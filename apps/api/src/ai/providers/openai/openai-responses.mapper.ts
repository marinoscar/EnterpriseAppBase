// =============================================================================
// Our Responses types <-> OpenAI Responses API (issue #426, epic #419)
// =============================================================================
//
// Pure functions, no I/O: `toOpenAiRequest` builds the SDK request body from
// an `AiResponseRequest`, `fromOpenAiResponse` turns the SDK's `Response`
// back into an `AiResponse`. The stream mapper reuses both, so a streamed
// and a non-streamed call cannot disagree about what a response means.
//
// PHASE 1 REFUSALS (AI_CAPABILITY_UNSUPPORTED), each a later story's scope:
//   - an image/file part that names only a `storageObjectId` (resolving a
//     storage object into provider-readable bytes is the Phase 2 "file
//     inputs" story; a `url` passes straight through);
//   - a hosted tool (web_search, file_search, ...: the Phase 2 "hosted
//     tools" story);
//   - a reasoning `effort` for a model the classifier KNOWS does not reason
//     (or an effort it does not offer). An unclassified model (`null`) is
//     passed through — an administrator may have enabled it knowing more
//     than this table does, and OpenAI's own 400 is then the answer.
// A malformed request (a media part with neither `url` nor
// `storageObjectId`, a non-text part in an assistant message) is
// AI_INVALID_REQUEST instead: nothing a later story adds would make it valid.
// =============================================================================

import type {
  EasyInputMessage,
  FunctionTool,
  Response as OpenAiSdkResponse,
  ResponseCreateParamsBase,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ToolChoiceFunction,
  ToolChoiceOptions,
} from 'openai/resources/responses/responses';

import { AiError } from '../../core/ai-error';
import type { AiModelCapabilities } from '../../core/capabilities';
import { parseStructured, toJsonSchema } from '../../core/structured-output';
import type {
  AiContentPart,
  AiFinishReason,
  AiInputItem,
  AiOutputItem,
  AiResponse,
  AiResponseRequest,
  AiTool,
  AiToolChoice,
  AiUsage,
} from '../../core/types/responses.types';
import { mapOpenAiResponseFailure, OPENAI_PROVIDER_ID } from './openai-errors';

/** The request body minus `stream`, which the port sets. */
export type OpenAiRequestBody = Omit<ResponseCreateParamsBase, 'stream'>;

function unsupported(message: string, details: Record<string, unknown>): AiError {
  return new AiError('AI_CAPABILITY_UNSUPPORTED', message, {
    details: { provider: OPENAI_PROVIDER_ID, ...details },
  });
}

function invalid(message: string, details: Record<string, unknown> = {}): AiError {
  return new AiError('AI_INVALID_REQUEST', message, {
    details: { provider: OPENAI_PROVIDER_ID, ...details },
  });
}

// ---- request ----------------------------------------------------------------

/** `data:` URLs carry inline bytes; OpenAI takes those as `file_data`, not `file_url`. */
function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

function toContentPart(part: AiContentPart): ResponseInputContent {
  switch (part.type) {
    case 'text':
      return { type: 'input_text', text: part.text };

    case 'image':
      if (part.url) {
        return { type: 'input_image', image_url: part.url, detail: part.detail ?? 'auto' };
      }
      if (part.storageObjectId) {
        throw unsupported('Image inputs from stored files are not supported yet; pass a url.', {
          part: 'image',
        });
      }
      throw invalid('An image part needs a url.', { part: 'image' });

    case 'file':
      if (part.url) {
        return isDataUrl(part.url)
          ? { type: 'input_file', file_data: part.url, filename: part.filename ?? 'file' }
          : { type: 'input_file', file_url: part.url, ...(part.filename ? { filename: part.filename } : {}) };
      }
      if (part.storageObjectId) {
        throw unsupported('File inputs from stored files are not supported yet; pass a url.', {
          part: 'file',
        });
      }
      throw invalid('A file part needs a url.', { part: 'file' });
  }
}

function toInputItem(item: AiInputItem): ResponseInputItem {
  if (item.type === 'function_call_output') {
    return { type: 'function_call_output', call_id: item.callId, output: item.output };
  }

  // The Responses API reads an assistant turn as OUTPUT text, so it cannot
  // carry `input_*` parts; the string form is the one it accepts.
  if (item.role === 'assistant') {
    if (item.content.some((part) => part.type !== 'text')) {
      throw invalid('An assistant message may contain only text parts.', { role: 'assistant' });
    }

    const message: EasyInputMessage = {
      type: 'message',
      role: 'assistant',
      content: item.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    };

    return message;
  }

  const message: EasyInputMessage = {
    type: 'message',
    role: item.role,
    content: item.content.map(toContentPart),
  };

  return message;
}

function toTool(tool: AiTool): FunctionTool {
  if (tool.type !== 'function') {
    throw unsupported(`Hosted tool "${tool.type}" is not supported yet.`, { tool: tool.type });
  }

  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.parameters),
    strict: tool.strict ?? true,
  };
}

function toToolChoice(choice: AiToolChoice): ToolChoiceOptions | ToolChoiceFunction {
  return typeof choice === 'string' ? choice : { type: 'function', name: choice.name };
}

function toReasoning(
  req: AiResponseRequest,
  caps: AiModelCapabilities | null,
): OpenAiRequestBody['reasoning'] | undefined {
  const reasoning = req.reasoning;

  if (!reasoning || (reasoning.effort === undefined && reasoning.summary === undefined)) {
    return undefined;
  }

  const known = caps !== null;
  const reasons = !known || caps.capabilities.includes('reasoning');

  if (!reasons) {
    // Not a reasoning model: a summary is a harmless no-op, an effort is not.
    if (reasoning.effort !== undefined) {
      throw unsupported(`Model "${req.model}" does not support reasoning effort.`, {
        model: req.model,
        capability: 'reasoning',
      });
    }

    return undefined;
  }

  if (
    reasoning.effort !== undefined &&
    known &&
    caps.reasoningEfforts &&
    !caps.reasoningEfforts.includes(reasoning.effort)
  ) {
    throw unsupported(`Model "${req.model}" does not offer reasoning effort "${reasoning.effort}".`, {
      model: req.model,
      capability: 'reasoning',
      effort: reasoning.effort,
    });
  }

  return {
    ...(reasoning.effort !== undefined ? { effort: reasoning.effort } : {}),
    ...(reasoning.summary !== undefined ? { summary: reasoning.summary } : {}),
  };
}

/**
 * Builds the OpenAI request body for `req`.
 *
 * `caps` is the model's capabilities as classified (or `null` when
 * unclassified); it only gates `reasoning`. `providerOptions.openai` is
 * shallow-merged LAST — the escape hatch for `background`, `store`,
 * `service_tier`, ... — except `stream`, which belongs to the port.
 *
 * Throws `AiError` (never an SDK error): see the file header.
 */
export function toOpenAiRequest(
  req: AiResponseRequest,
  caps: AiModelCapabilities | null,
): OpenAiRequestBody {
  const body: OpenAiRequestBody = {
    model: req.model,
    input: typeof req.input === 'string' ? req.input : req.input.map(toInputItem),
  };

  if (req.instructions !== undefined) body.instructions = req.instructions;
  if (req.tools && req.tools.length > 0) body.tools = req.tools.map(toTool);
  if (req.toolChoice !== undefined) body.tool_choice = toToolChoice(req.toolChoice);

  if (req.structuredOutput) {
    body.text = {
      format: {
        type: 'json_schema',
        name: req.structuredOutput.name,
        schema: toJsonSchema(req.structuredOutput.schema),
        strict: req.structuredOutput.strict ?? true,
      },
    };
  }

  const reasoning = toReasoning(req, caps);
  if (reasoning) body.reasoning = reasoning;

  if (req.maxOutputTokens !== undefined) body.max_output_tokens = req.maxOutputTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.previousResponseId !== undefined) body.previous_response_id = req.previousResponseId;
  if (req.metadata !== undefined) body.metadata = req.metadata;

  const { stream: _stream, ...escapeHatch } = req.providerOptions?.[OPENAI_PROVIDER_ID] ?? {};

  return { ...body, ...(escapeHatch as Partial<OpenAiRequestBody>) };
}

// ---- response ---------------------------------------------------------------

/** OpenAI output item types that are a provider-executed (hosted) tool call. */
function isHostedToolCall(type: string): boolean {
  return type.endsWith('_call') && type !== 'function_call';
}

/**
 * Maps one SDK output item. `null` for an item type this contract does not
 * model (it is dropped, never guessed at).
 */
export function fromOpenAiOutputItem(item: ResponseOutputItem): AiOutputItem | null {
  switch (item.type) {
    case 'message':
      return {
        type: 'message',
        text: item.content
          .map((part) => (part.type === 'output_text' ? part.text : ''))
          .join(''),
      };

    case 'reasoning':
      return { type: 'reasoning', summary: item.summary.map((part) => part.text) };

    case 'function_call':
      return {
        type: 'function_call',
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      };

    default: {
      if (!isHostedToolCall(item.type)) return null;

      const status = 'status' in item && typeof item.status === 'string' ? item.status : 'unknown';

      return { type: 'hosted_tool_call', tool: item.type, status };
    }
  }
}

function hasRefusal(output: ResponseOutputItem[]): boolean {
  return output.some(
    (item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'),
  );
}

function finishReasonOf(resp: OpenAiSdkResponse, output: AiOutputItem[]): AiFinishReason {
  if (resp.status === 'failed' || resp.status === 'cancelled') return 'error';

  if (resp.status === 'incomplete') {
    return resp.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'length';
  }

  if (hasRefusal(resp.output)) return 'content_filter';
  if (output.some((item) => item.type === 'function_call')) return 'tool_calls';

  return 'stop';
}

function usageOf(resp: OpenAiSdkResponse): AiUsage {
  const usage = resp.usage;

  if (!usage) return {};

  const out: AiUsage = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };

  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  const cached = usage.input_tokens_details?.cached_tokens;

  if (typeof reasoning === 'number') out.reasoningTokens = reasoning;
  if (typeof cached === 'number') out.cachedInputTokens = cached;

  return out;
}

export interface FromOpenAiResponseOptions {
  /** The originating request; its `structuredOutput` drives `parsed`. */
  request: AiResponseRequest;
  /** The `x-request-id` OpenAI answered with. */
  providerRequestId?: string | null;
}

/**
 * Maps a finished SDK `Response` to an `AiResponse`.
 *
 * A `failed` response is an error, not a result: it throws the `AiError` its
 * body's error code means. When the request asked for structured output and
 * the model finished its turn (no pending tool call), the text is validated
 * with `parseStructured` — invalid JSON or a schema mismatch throws
 * `AI_STRUCTURED_OUTPUT_INVALID`.
 */
export function fromOpenAiResponse(
  resp: OpenAiSdkResponse,
  opts: FromOpenAiResponseOptions,
): AiResponse {
  const providerRequestId = opts.providerRequestId ?? undefined;

  if (resp.status === 'failed') {
    throw mapOpenAiResponseFailure(resp.error, providerRequestId);
  }

  const output = resp.output
    .map(fromOpenAiOutputItem)
    .filter((item): item is AiOutputItem => item !== null);

  const outputText = output
    .map((item) => (item.type === 'message' ? item.text : ''))
    .join('');

  const finishReason = finishReasonOf(resp, output);

  const result: AiResponse = {
    id: resp.id,
    provider: OPENAI_PROVIDER_ID,
    model: resp.model,
    output,
    outputText,
    usage: usageOf(resp),
    finishReason,
  };

  if (providerRequestId) result.providerRequestId = providerRequestId;

  if (opts.request.structuredOutput && finishReason !== 'tool_calls') {
    result.parsed = parseStructured(opts.request.structuredOutput.schema, outputText);
  }

  return result;
}

// Test-only builders for OpenAI Responses API payloads (issue #426).
//
// They produce the JSON OpenAI actually sends — trimmed to the fields the
// adapter reads — so the mapper specs and the mocked HTTP transport speak
// the same wire format. Not imported by production code.

import type { Response as OpenAiSdkResponse, ResponseOutputItem } from 'openai/resources/responses/responses';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;

  return `${prefix}_${counter.toString().padStart(6, '0')}`;
}

export function messageItem(text: string, extra: { refusal?: string } = {}): ResponseOutputItem {
  return {
    id: nextId('msg'),
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [
      ...(text ? [{ type: 'output_text' as const, text, annotations: [] }] : []),
      ...(extra.refusal ? [{ type: 'refusal' as const, refusal: extra.refusal }] : []),
    ],
  } as ResponseOutputItem;
}

export function reasoningItem(summary: string[]): ResponseOutputItem {
  return {
    id: nextId('rs'),
    type: 'reasoning',
    summary: summary.map((text) => ({ type: 'summary_text' as const, text })),
  } as ResponseOutputItem;
}

export function functionCallItem(name: string, args: string, callId = nextId('call')): ResponseOutputItem {
  return {
    id: nextId('fc'),
    type: 'function_call',
    call_id: callId,
    name,
    arguments: args,
    status: 'completed',
  } as ResponseOutputItem;
}

export interface ResponseFixtureOptions {
  id?: string;
  model?: string;
  output?: ResponseOutputItem[];
  status?: OpenAiSdkResponse['status'];
  incompleteReason?: 'max_output_tokens' | 'content_filter';
  error?: { code: string; message: string } | null;
  usage?: Partial<{
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
  }> | null;
}

/** A Responses API `Response` object, as JSON. */
export function responseFixture(opts: ResponseFixtureOptions = {}): OpenAiSdkResponse {
  const output = opts.output ?? [messageItem('Hello!')];
  const usage =
    opts.usage === null
      ? null
      : {
          input_tokens: opts.usage?.input_tokens ?? 12,
          input_tokens_details: { cached_tokens: opts.usage?.cached_tokens ?? 0, cache_write_tokens: 0 },
          output_tokens: opts.usage?.output_tokens ?? 7,
          output_tokens_details: { reasoning_tokens: opts.usage?.reasoning_tokens ?? 0 },
          total_tokens: (opts.usage?.input_tokens ?? 12) + (opts.usage?.output_tokens ?? 7),
        };

  return {
    id: opts.id ?? nextId('resp'),
    object: 'response',
    created_at: 1_760_000_000,
    model: opts.model ?? 'gpt-4o-2024-08-06',
    status: opts.status ?? 'completed',
    error: opts.error ?? null,
    incomplete_details: opts.incompleteReason ? { reason: opts.incompleteReason } : null,
    instructions: null,
    metadata: {},
    output,
    parallel_tool_calls: true,
    temperature: 1,
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    usage,
  } as unknown as OpenAiSdkResponse;
}

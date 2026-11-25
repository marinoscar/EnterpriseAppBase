// Test-only builders for Chat Completions payloads (issue #448).
//
// The JSON an OpenAI-compatible server sends for `POST /chat/completions`,
// trimmed to the fields the mapper reads, plus the chunk sequence the same
// answer streams as. Not imported by production code.

import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions/completions';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;

  return `${prefix}-${counter.toString().padStart(6, '0')}`;
}

/**
 * A tool call in a chat completion fixture.
 *
 * @stability experimental
 */
export interface ChatToolCallFixture {
  /** The call id; generated when absent. */
  id?: string;
  /** The function name. */
  name: string;
  /** The JSON-encoded arguments. */
  arguments: string;
}

/**
 * What {@link chatCompletionFixture} builds a chat completion from.
 *
 * @stability experimental
 */
export interface ChatCompletionFixtureOptions {
  /** The model that answers; a default model when absent. */
  model?: string;
  /** The assistant text. */
  content?: string | null;
  /** A refusal instead of text. */
  refusal?: string | null;
  /** Tool calls the assistant made. */
  toolCalls?: ChatToolCallFixture[];
  /** The finish reason; derived from the content when absent. */
  finishReason?: ChatCompletion.Choice['finish_reason'];
  /** The usage block; plausible counts when absent, none for `null`. */
  usage?: ChatCompletion['usage'] | null;
  /** The completion id; generated when absent. */
  id?: string;
}

/**
 * A Chat Completions answer built from `opts`.
 *
 * @stability experimental
 */
export function chatCompletionFixture(opts: ChatCompletionFixtureOptions = {}): ChatCompletion {
  const toolCalls = (opts.toolCalls ?? []).map((call) => ({
    id: call.id ?? nextId('call'),
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments },
  }));

  return {
    id: opts.id ?? nextId('chatcmpl'),
    object: 'chat.completion',
    created: 1_700_000_000,
    model: opts.model ?? 'llama3.1:8b',
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: opts.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
        message: {
          role: 'assistant',
          content: opts.content === undefined ? 'Hello!' : opts.content,
          refusal: opts.refusal ?? null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(opts.usage === null
      ? {}
      : { usage: opts.usage ?? { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }),
  };
}

/**
 * The chunks `completion` streams as: the content in `chunkSize`-character
 * deltas, each tool call's arguments likewise (its id and name in the first
 * fragment), the finish reason on the last choice chunk, and — when
 * `includeUsage` — a final choice-less usage chunk.
 *
 * @stability experimental
 */
export function chatChunksFor(completion: ChatCompletion, chunkSize = 4, includeUsage = true): ChatCompletionChunk[] {
  const choice = completion.choices[0];
  const base = { id: completion.id, object: 'chat.completion.chunk' as const, created: completion.created, model: completion.model };
  const chunks: ChatCompletionChunk[] = [];
  const push = (delta: ChatCompletionChunk.Choice.Delta, finish: ChatCompletionChunk.Choice['finish_reason'] = null) =>
    chunks.push({ ...base, choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }] });

  push({ role: 'assistant', content: '' });

  const content = choice.message.content ?? '';

  for (let i = 0; i < content.length; i += chunkSize) push({ content: content.slice(i, i + chunkSize) });

  (choice.message.tool_calls ?? []).forEach((call, index) => {
    if (call.type !== 'function') return;

    push({ tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] });

    for (let i = 0; i < call.function.arguments.length; i += chunkSize) {
      push({ tool_calls: [{ index, function: { arguments: call.function.arguments.slice(i, i + chunkSize) } }] });
    }
  });

  push({}, choice.finish_reason);

  if (includeUsage && completion.usage) chunks.push({ ...base, choices: [], usage: completion.usage });

  return chunks;
}

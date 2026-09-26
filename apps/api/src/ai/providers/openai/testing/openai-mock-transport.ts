// A mocked OpenAI HTTP API for tests (issue #426). Not imported by production code.
//
// Injected into the real SDK as its `fetch` (`new OpenAI({ fetch })`, via
// `OpenAiClientFactory`'s options), so tests exercise the SDK's own request
// building, error classes and SSE parsing — only the network is fake. No new
// dependency (no nock/MockAgent): the SDK accepts a `fetch`, and Node's global
// `Response`/`ReadableStream` build the replies.
//
// Behaviour:
//   - `Authorization: Bearer <key>` not in `validKeys` -> 401 `invalid_api_key`
//     whose message echoes the key, exactly as OpenAI does, so redaction
//     tests have something to catch;
//   - `GET /models` -> the configured model list;
//   - `POST /responses` -> whatever `respond(body)` returns: a Responses API
//     object (streamed as SSE when the body says `stream: true`), an HTTP
//     error, a network failure, or a raw SSE script;
//   - `previous_response_id` must name a response this server issued, or it
//     answers 404 like OpenAI would.

import type { Response as OpenAiSdkResponse, ResponseStreamEvent } from 'openai/resources/responses/responses';

import type { OpenAiFetch } from '../openai-client.factory';
import { streamEventsFor } from './openai-fixtures';

export interface MockSseFrame {
  /** SSE `event:` name; OpenAI names every frame after its `type`. */
  event?: string;
  data: unknown;
}

export type MockReply =
  | { kind: 'response'; response: OpenAiSdkResponse; chunkSize?: number }
  | { kind: 'error'; status: number; error: Record<string, unknown>; headers?: Record<string, string> }
  | { kind: 'network' }
  /** A hand-written SSE script. `hang` keeps the connection open after the last frame until aborted. */
  | { kind: 'sse'; frames: MockSseFrame[]; hang?: boolean };

export interface RecordedRequest {
  method: string;
  path: string;
  apiKey: string | null;
  headers: Headers;
  body: Record<string, unknown> | undefined;
  signal: AbortSignal | undefined;
}

export interface OpenAiMockServerOptions {
  validKeys: string[];
  models?: string[];
  respond?(body: Record<string, unknown>): MockReply;
}

function json(status: number, payload: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function abortError(): Error {
  const err = new Error('This operation was aborted');

  err.name = 'AbortError';

  return err;
}

function sseResponse(frames: MockSseFrame[], headers: Record<string, string>, hang: boolean, signal?: AbortSignal): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        const lines = [
          ...(frame.event ? [`event: ${frame.event}`] : []),
          `data: ${typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data)}`,
        ];

        controller.enqueue(encoder.encode(`${lines.join('\n')}\n\n`));
      }

      if (!hang) {
        controller.close();

        return;
      }

      const onAbort = () => {
        try {
          controller.error(abortError());
        } catch {
          // already closed
        }
      };

      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

/** Frames for a Responses API event list, named the way OpenAI names them. */
export function framesFor(events: ResponseStreamEvent[]): MockSseFrame[] {
  return events.map((event) => ({ event: event.type, data: event }));
}

export class OpenAiMockServer {
  readonly requests: RecordedRequest[] = [];

  private readonly validKeys: Set<string>;
  private readonly models: string[];
  private readonly issuedResponseIds = new Set<string>();
  private requestCounter = 0;
  private respondFn: (body: Record<string, unknown>) => MockReply;
  private readonly queued: MockReply[] = [];

  constructor(opts: OpenAiMockServerOptions) {
    this.validKeys = new Set(opts.validKeys);
    this.models = opts.models ?? ['gpt-4o', 'gpt-4o-mini', 'o3', 'text-embedding-3-small'];
    this.respondFn = opts.respond ?? (() => ({ kind: 'network' }));
  }

  /** Replaces the `/responses` responder. */
  respondWith(fn: (body: Record<string, unknown>) => MockReply): void {
    this.respondFn = fn;
  }

  /** Answers the next `/responses` call with `reply`, ahead of the responder. */
  enqueue(reply: MockReply): void {
    this.queued.push(reply);
  }

  /** Requests made to `path` (e.g. `/v1/responses`). */
  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((req) => req.path === path);
  }

  readonly fetch: OpenAiFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const auth = headers.get('authorization');
    const apiKey = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined;
    const signal = init?.signal ?? undefined;

    this.requests.push({ method: init?.method ?? 'GET', path: url.pathname, apiKey, headers, body, signal });

    if (signal?.aborted) throw abortError();

    this.requestCounter += 1;
    const replyHeaders = { 'x-request-id': `req_mock_${this.requestCounter}` };

    if (!apiKey || !this.validKeys.has(apiKey)) {
      return json(
        401,
        {
          error: {
            message: `Incorrect API key provided: ${apiKey}. You can find your API key at https://platform.openai.com/account/api-keys.`,
            type: 'invalid_request_error',
            param: null,
            code: 'invalid_api_key',
          },
        },
        replyHeaders,
      );
    }

    if (url.pathname.endsWith('/models') && (init?.method ?? 'GET') === 'GET') {
      return json(
        200,
        {
          object: 'list',
          data: this.models.map((id, index) => ({ id, object: 'model', created: 1_700_000_000 + index, owned_by: 'openai' })),
        },
        replyHeaders,
      );
    }

    if (url.pathname.endsWith('/responses') && init?.method === 'POST' && body) {
      const previous = body.previous_response_id;

      if (typeof previous === 'string' && !this.issuedResponseIds.has(previous)) {
        return json(
          404,
          {
            error: {
              message: `Previous response with id '${previous}' not found.`,
              type: 'invalid_request_error',
              param: 'previous_response_id',
              code: 'previous_response_not_found',
            },
          },
          replyHeaders,
        );
      }

      const reply = this.queued.shift() ?? this.respondFn(body);

      switch (reply.kind) {
        case 'network':
          throw new TypeError('fetch failed');

        case 'error':
          return json(reply.status, { error: reply.error }, { ...replyHeaders, ...(reply.headers ?? {}) });

        case 'sse':
          return sseResponse(reply.frames, replyHeaders, reply.hang ?? false, signal);

        case 'response':
          this.issuedResponseIds.add(reply.response.id);

          return body.stream === true
            ? sseResponse(framesFor(streamEventsFor(reply.response, reply.chunkSize)), replyHeaders, false, signal)
            : json(200, reply.response, replyHeaders);
      }
    }

    return json(404, { error: { message: 'Not found', type: 'invalid_request_error', param: null, code: null } }, replyHeaders);
  };
}

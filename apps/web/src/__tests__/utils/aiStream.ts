/**
 * A hand-driven `POST /ai/responses/stream` for tests — issue #434.
 *
 * The default MSW handler answers the whole stream at once; to prove that
 * text renders INCREMENTALLY and that Stop really stops, a test needs to hold
 * the stream open and release frames one at a time. `controlledAiStream()`
 * installs a handler whose body is a `ReadableStream` the test pushes SSE
 * frames into, and records every request (body, headers, abort signal).
 */
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { toSseBody } from '../mocks/fixtures/ai';
import type { AiStreamEvent } from '../../services/ai';

export interface CapturedAiRequest {
  body: Record<string, unknown>;
  headers: Headers;
  signal: AbortSignal;
}

export interface ControlledAiStream {
  requests: CapturedAiRequest[];
  /** Send frames on the most recent stream. */
  push: (...events: AiStreamEvent[]) => void;
  /** End the most recent stream. */
  close: () => void;
}

export function controlledAiStream(): ControlledAiStream {
  const encoder = new TextEncoder();
  const requests: CapturedAiRequest[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  server.use(
    http.post('*/api/ai/responses/stream', async ({ request }) => {
      requests.push({
        body: (await request.json()) as Record<string, unknown>,
        headers: request.headers,
        signal: request.signal,
      });
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      });
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }),
  );

  return {
    requests,
    push: (...events) => {
      try {
        controller?.enqueue(encoder.encode(toSseBody(events)));
      } catch {
        // The stream was already closed or cancelled (the client aborted).
      }
    },
    close: () => {
      try {
        controller?.close();
      } catch {
        // Already closed or cancelled.
      }
    },
  };
}

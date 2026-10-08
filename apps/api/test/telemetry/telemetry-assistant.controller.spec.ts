import { PassThrough } from 'node:stream';

import { GUARDS_METADATA } from '@nestjs/common/constants';

import {
  TELEMETRY_ERROR_REASONS,
  TelemetryAiEnabledGuard,
  TelemetryHttpError,
} from '@marinoscar/platform-api/telemetry';
import type { TelemetryAssistantEmit } from '@marinoscar/platform-contract/telemetry';

import { AiError } from '@marinoscar/platform-api/ai';
import { AI_SSE_HEADERS } from '@marinoscar/platform-api/ai';
import { RBAC_EXTENSION_KEY, PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../../src/common/constants/roles.constants';
import { telemetryControllers } from '../../src/platform/telemetry/telemetry.config';

// The assistant controller as the app configured it (#703): the app's own
// `@Auth()` through the host port, the package's TelemetryAiEnabledGuard.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TelemetryAssistantController = telemetryControllers.TelemetryAssistantController as new (...args: any[]) => any;

/** What the controller hands the service: the disconnect signal and the frame writer. */
interface TelemetryAssistantStreamOptions {
  signal?: AbortSignal;
  emit: TelemetryAssistantEmit;
}

/** A minimal Fastify reply over a fake ServerResponse that records what is written. */
function fakeReply() {
  const raw = Object.assign(new PassThrough(), {
    headers: {} as Record<string, unknown>,
    statusCode: 0,
    socket: null,
    writeHead(status: number, headers: Record<string, unknown>) {
      raw.statusCode = status;
      raw.headers = headers;
      return raw;
    },
    flushHeaders: jest.fn(),
  });
  const chunks: string[] = [];
  raw.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  const reply = {
    raw,
    hijack: jest.fn(),
    getHeaders: jest.fn(() => ({ 'x-request-id': 'req-1', 'content-type': 'application/json' })),
  };

  return { reply, raw, text: () => chunks.join('') };
}

describe('TelemetryAssistantController', () => {
  const handler = TelemetryAssistantController.prototype.stream;

  it('requires BOTH telemetry:query and ai:use (all-of)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([PERMISSIONS.TELEMETRY_QUERY, PERMISSIONS.AI_USE]);
    expect(Reflect.getMetadata('swagger/apiExtension', handler)?.[RBAC_EXTENSION_KEY]).toMatchObject({
      permissions: ['telemetry:query', 'ai:use'],
    });
  });

  it('is behind the AI kill switch (class-level TelemetryAiEnabledGuard)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TelemetryAssistantController)).toContain(TelemetryAiEnabledGuard);
  });

  it("the kill switch is the AI port's assertEnabled: the app's own 403 AI_DISABLED passes through unchanged", async () => {
    const off = new AiError('AI_DISABLED', 'AI features are disabled');
    const guard = new TelemetryAiEnabledGuard({ assertEnabled: jest.fn().mockRejectedValue(off) } as never);
    await expect(guard.canActivate()).rejects.toBe(off);

    const on = new TelemetryAiEnabledGuard({ assertEnabled: jest.fn().mockResolvedValue(undefined) } as never);
    await expect(on.canActivate()).resolves.toBe(true);
  });

  it('streams the service events as `event:`/`data:` frames with the SSE headers', async () => {
    const service = {
      stream: jest.fn(async (_u: string, _i: unknown, opts: TelemetryAssistantStreamOptions) => {
        opts.emit('step', { index: 0, tool: 'list_tables', durationMs: 4 });
        opts.emit('answer', { sql: 'SELECT 1', explanation: 'One.', report: null });
        opts.emit('done', {});
      }),
    };
    const { reply, raw, text } = fakeReply();
    const controller = new TelemetryAssistantController(service as never);

    await controller.stream({ question: 'q' } as never, 'user-1', reply as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(reply.hijack).toHaveBeenCalledTimes(1);
    expect(raw.statusCode).toBe(200);
    expect(raw.headers).toMatchObject({ ...AI_SSE_HEADERS, 'x-request-id': 'req-1' });
    expect(raw.writableEnded).toBe(true);
    expect(text()).toBe(
      'event: step\ndata: {"index":0,"tool":"list_tables","durationMs":4}\n\n' +
        'event: answer\ndata: {"sql":"SELECT 1","explanation":"One.","report":null}\n\n' +
        'event: done\ndata: {}\n\n',
    );
    expect(service.stream).toHaveBeenCalledWith('user-1', { question: 'q' }, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('rethrows a precondition failure before anything is written (a JSON error)', async () => {
    const refusal = new TelemetryHttpError(TELEMETRY_ERROR_REASONS.ASSISTANT_DISABLED, 'off');
    const service = { stream: jest.fn().mockRejectedValue(refusal) };
    const { reply, text } = fakeReply();
    const controller = new TelemetryAssistantController(service as never);

    await expect(controller.stream({ question: 'q' } as never, 'user-1', reply as never)).rejects.toBe(refusal);
    expect(reply.hijack).not.toHaveBeenCalled();
    expect(text()).toBe('');
  });
});

// The adapters run in a plain Node process (#991): built with the
// `create*Adapter` factories, no DI, no registry. Without a tracer no span is
// started; with one, every call runs inside one `ai.provider.call` span; the
// logger receives the per-call debug line and never the key.

import {
  AI_SPAN_KIND_CLIENT,
  AI_SPAN_STATUS_ERROR,
  AI_SPAN_STATUS_OK,
  AiError,
  type AiLogger,
  type AiSpanOptions,
  type AiSpanStatus,
  type AiTracer,
} from '../src/index';
import { createAnthropicAdapter, AnthropicClientFactory, AnthropicProviderAdapter } from '../src/anthropic/index';
import { createGeminiAdapter, GeminiProviderAdapter } from '../src/gemini/index';
import {
  AzureOpenAiProviderAdapter,
  createAzureOpenAiAdapter,
  createOpenAiAdapter,
  createOpenAiCompatibleAdapter,
  OpenAiClientFactory,
  OpenAiCompatibleProviderAdapter,
  OpenAiProviderAdapter,
} from '../src/openai/index';
import { AnthropicMockServer } from '../src/anthropic/testing/index';
import { messageItem, OpenAiMockServer, responseFixture } from '../src/openai/testing/index';

const VALID_KEY = 'sk-proj-VALID-abcdefghijklmnop';

interface RecordedSpan {
  name: string;
  options?: AiSpanOptions;
  attributes: Record<string, unknown>;
  status?: AiSpanStatus;
  ended: boolean;
}

function recordingTracer(): { tracer: AiTracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer: AiTracer = {
    startSpan: (name, options) => {
      const record: RecordedSpan = { name, options, attributes: { ...(options?.attributes ?? {}) }, ended: false };
      spans.push(record);

      return {
        setAttribute: (key, value) => {
          record.attributes[key] = value;
        },
        setStatus: (status) => {
          record.status = status;
        },
        end: () => {
          record.ended = true;
        },
      };
    },
  };

  return { tracer, spans };
}

function recordingLogger(): { logger: AiLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (...args: unknown[]) => void lines.push(JSON.stringify(args));

  return { logger: { debug: push, log: push, warn: push, error: push }, lines };
}

function openAiServer(): OpenAiMockServer {
  return new OpenAiMockServer({
    validKeys: [VALID_KEY],
    respond: () => ({ kind: 'response', response: responseFixture({ output: [messageItem('Hello from the mock!')] }) }),
  });
}

describe('create*Adapter', () => {
  it('builds each adapter with no options at all', () => {
    expect(createOpenAiAdapter()).toBeInstanceOf(OpenAiProviderAdapter);
    expect(createOpenAiCompatibleAdapter()).toBeInstanceOf(OpenAiCompatibleProviderAdapter);
    expect(createAzureOpenAiAdapter()).toBeInstanceOf(AzureOpenAiProviderAdapter);
    expect(createAnthropicAdapter()).toBeInstanceOf(AnthropicProviderAdapter);
    expect(createGeminiAdapter()).toBeInstanceOf(GeminiProviderAdapter);
    expect(createOpenAiAdapter().id).toBe('openai');
  });

  it('answers a call with no logger and no tracer wired', async () => {
    const server = openAiServer();
    const adapter = createOpenAiAdapter({ clients: new OpenAiClientFactory({ fetch: server.fetch }) });

    const response = await adapter.responses.create({ model: 'gpt-4o', input: 'Hi' }, { apiKey: VALID_KEY, requestId: 'r1' });

    expect(response.outputText).toBe('Hello from the mock!');
  });

  it('runs a call inside one ai.provider.call span and logs the call without the key', async () => {
    const server = openAiServer();
    const { tracer, spans } = recordingTracer();
    const { logger, lines } = recordingLogger();
    const adapter = createOpenAiAdapter({ clients: new OpenAiClientFactory({ fetch: server.fetch }), tracer, logger });

    await adapter.responses.create({ model: 'gpt-4o', input: 'Hi' }, { apiKey: VALID_KEY, requestId: 'r2' });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: 'ai.provider.call',
      options: { kind: AI_SPAN_KIND_CLIENT },
      attributes: { 'ai.provider': 'openai', 'ai.model': 'gpt-4o', 'ai.status': 'ok' },
      status: { code: AI_SPAN_STATUS_OK },
      ended: true,
    });
    expect(lines.join('\n')).toContain('AI provider call');
    expect(lines.join('\n')).not.toContain(VALID_KEY);
  });

  it('maps a rejected key to AI_KEY_INVALID and marks the span as an error (Anthropic)', async () => {
    const server = new AnthropicMockServer({ validKeys: [VALID_KEY] });
    const { tracer, spans } = recordingTracer();
    const adapter = createAnthropicAdapter({ clients: new AnthropicClientFactory({ fetch: server.fetch }), tracer });

    await expect(adapter.listModels({ apiKey: 'sk-ant-WRONG-0000000000', requestId: 'r3' })).rejects.toBeInstanceOf(AiError);
    expect(spans[0]).toMatchObject({
      attributes: { 'ai.provider': 'anthropic', 'ai.status': 'AI_KEY_INVALID' },
      status: { code: AI_SPAN_STATUS_ERROR, message: 'AI_KEY_INVALID' },
      ended: true,
    });
  });
});

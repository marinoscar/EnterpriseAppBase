// Runs the #424 conformance kit against the OpenAI adapter (issue #426).
//
// The transport is MOCKED: `OpenAiMockServer.fetch` is injected into the real
// SDK, so the SDK's request building, error classes and SSE parsing all run —
// only the network is fake. No scenario is skipped.

import type { Response as OpenAiSdkResponse } from 'openai/resources/responses/responses';

import { AiProviderRegistry } from '../../core/provider-registry';
import { describeAiProviderConformance } from '../../testing/conformance';
import { OpenAiClientFactory } from './openai-client.factory';
import { OpenAiProviderAdapter } from './openai.adapter';
import { functionCallItem, messageItem, responseFixture } from './testing/openai-fixtures';
import { MockReply, OpenAiMockServer } from './testing/openai-mock-transport';

const VALID_KEY = 'sk-proj-conformance-valid-000000';
const INVALID_KEY = 'sk-proj-conformance-revoked-0000';
const MODEL = 'gpt-4o-2024-08-06';
const BROKEN_MODEL = 'gpt-4o-broken';

function reply(response: OpenAiSdkResponse): MockReply {
  return { kind: 'response', response, chunkSize: 5 };
}

/**
 * Answers the kit's canonical requests the way the real API would: a JSON
 * document for a json_schema format, a function call when a function tool
 * is offered, a final answer once the tool's output comes back, and a 500
 * for the "broken" model.
 */
function respond(body: Record<string, unknown>): MockReply {
  if (body.model === BROKEN_MODEL) {
    return { kind: 'error', status: 500, error: { message: 'The server had an error.', type: 'server_error', param: null, code: null } };
  }

  const input = Array.isArray(body.input) ? (body.input as Array<{ type?: string }>) : [];
  const format = (body.text as { format?: { type?: string } } | undefined)?.format;

  if (format?.type === 'json_schema') {
    return reply(responseFixture({ model: MODEL, output: [messageItem(JSON.stringify({ city: 'Paris', population: 2_100_000 }))] }));
  }

  if (input.some((item) => item.type === 'function_call_output')) {
    return reply(responseFixture({ model: MODEL, output: [messageItem('It is 21°C and sunny in Paris.')] }));
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    return reply(responseFixture({ model: MODEL, output: [functionCallItem('get_weather', '{"city":"Paris"}')] }));
  }

  return reply(responseFixture({ model: MODEL, output: [messageItem('Hello there, it is lovely to meet you!')] }));
}

describeAiProviderConformance('OpenAiProviderAdapter (mocked transport)', () => {
  const server = new OpenAiMockServer({
    validKeys: [VALID_KEY],
    models: [MODEL, 'gpt-4o-mini', 'o3', 'text-embedding-3-small', 'whisper-1'],
    respond,
  });

  return {
    adapter: new OpenAiProviderAdapter(new AiProviderRegistry(), new OpenAiClientFactory({ fetch: server.fetch })),
    ctx: { apiKey: VALID_KEY, requestId: 'conformance-openai' },
    fixtures: {
      invalidApiKey: INVALID_KEY,
      expectedModelIds: [MODEL, 'o3'],
      classify: {
        known: [MODEL, 'gpt-5', 'o3-mini', 'gpt-image-1', 'whisper-1', 'text-embedding-3-large'],
        unknown: ['davinci-002', 'not-an-openai-model'],
      },
      responses: {
        model: MODEL,
        // Hosted tools are Phase 2 (#420).
        unsupportedRequest: { model: MODEL, input: 'search the web', tools: [{ type: 'web_search' }] },
        failingRequest: { model: BROKEN_MODEL, input: 'anything' },
      },
    },
  };
});

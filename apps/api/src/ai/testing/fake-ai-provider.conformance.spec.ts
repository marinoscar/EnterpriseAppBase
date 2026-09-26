import { AiResponseRequest } from '../core/types/responses.types';
import { describeAiProviderConformance } from './conformance';
import { FakeAiProvider, FakeAiScriptedResponse } from './fake-ai-provider';

/**
 * Answers the kit's canonical requests the way a real model would. The
 * failing model throws a RAW error on purpose: the fake must wrap it, exactly
 * as a real adapter must wrap an SDK error.
 */
function conformanceScript(req: AiResponseRequest): FakeAiScriptedResponse {
  if (req.model === 'fake-broken') {
    throw new Error('socket hang up');
  }

  if (req.structuredOutput) {
    return { outputText: JSON.stringify({ city: 'Paris', population: 2_100_000 }) };
  }

  const input = Array.isArray(req.input) ? req.input : [];

  if (input.some((item) => item.type === 'function_call_output')) {
    return { outputText: 'It is 21°C and sunny in Paris.' };
  }

  if (req.tools?.some((tool) => tool.type === 'function')) {
    return {
      output: [{ type: 'function_call', callId: 'call_fake_1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
    };
  }

  return { outputText: 'Hello there, it is lovely to meet you!' };
}

describeAiProviderConformance('FakeAiProvider', () => ({
  adapter: new FakeAiProvider({
    models: ['fake-model', 'fake-model-mini'],
    validKeys: ['fake-valid-key'],
    responses: conformanceScript,
  }),
  ctx: { apiKey: 'fake-valid-key', requestId: 'conformance-1' },
  fixtures: {
    invalidApiKey: 'fake-invalid-key',
    expectedModelIds: ['fake-model'],
    classify: { known: ['fake-model', 'fake-model-mini'], unknown: ['some-other-model'] },
    responses: {
      model: 'fake-model',
      // The fake declares no hosted tools.
      unsupportedRequest: { model: 'fake-model', input: 'search the web', tools: [{ type: 'web_search' }] },
      failingRequest: { model: 'fake-broken', input: 'anything' },
    },
  },
}));

describeAiProviderConformance('FakeAiProvider without a responses port', () => ({
  adapter: new FakeAiProvider({ responsesPort: false }),
  ctx: { apiKey: 'any-key', requestId: 'conformance-2' },
  fixtures: {
    invalidApiKey: '',
    classify: { known: ['fake-model'], unknown: ['nope'] },
  },
}));

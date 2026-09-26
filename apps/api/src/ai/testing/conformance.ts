// =============================================================================
// AI provider conformance kit (issue #424, epic #419)
// =============================================================================
//
// ONE Jest suite every provider adapter runs, so "implements
// AiProviderAdapter" means the same thing for every provider — including a
// fork's own. Usage, from a `*.conformance.spec.ts`:
//
//   describeAiProviderConformance('OpenAI adapter', () => ({
//     adapter: new OpenAiAdapter(registry, { fetch: mockedFetch }),
//     ctx: { apiKey: 'sk-valid', requestId: 'conf-1' },
//     fixtures: { invalidApiKey: 'sk-bad', classify: {...}, responses: {...} },
//   }));
//
// The kit owns the REQUESTS (`conformanceRequests()`, the canonical schema
// and tool below are exported so a mocked HTTP layer can answer them); the
// fixtures own what only the provider knows (which keys and model ids exist,
// which request it cannot serve, which request makes it fail). `factory` runs
// before EVERY test, so a stateful mock starts clean each time, and the
// optional `arrange(scenario)` hook runs before each scenario's calls for a
// mock that needs to queue a specific reply.
//
// Real network is never required; adapters run this against a mocked
// transport (#426).
// =============================================================================

import { z } from 'zod';

import { AiError, isAiErrorCode } from '../core/ai-error';
import { aiModelCapabilitiesSchema } from '../core/capabilities';
import { AiCallContext, AiProviderAdapter } from '../core/provider-adapter.interface';
import { defineTool } from '../core/tools';
import { AiOutputItem, AiResponse, AiResponseRequest, AiStreamEvent } from '../core/types/responses.types';

export type AiConformanceScenario =
  | 'listModels'
  | 'listModels.invalidKey'
  | 'verifyKey.valid'
  | 'verifyKey.invalid'
  | 'classifyModel'
  | 'responses.text'
  | 'responses.stream'
  | 'responses.structured'
  | 'responses.toolCall'
  | 'responses.toolResult'
  | 'responses.unsupported'
  | 'responses.invalidKey'
  | 'responses.providerError'
  | 'responses.streamProviderError';

export interface AiConformanceFixtures {
  /** A key the provider rejects. */
  invalidApiKey: string;
  /** Ids `listModels` must include (a subset is fine). */
  expectedModelIds?: string[];
  classify: {
    /** Ids `classifyModel` must classify (schema-valid capabilities). */
    known: string[];
    /** Ids `classifyModel` must return `null` for. */
    unknown: string[];
  };
  /** Required when the adapter carries a `responses` port. */
  responses?: {
    /** A model supporting text, streaming, structured output and function tools. */
    model: string;
    /** A request the provider must refuse with `AI_CAPABILITY_UNSUPPORTED`. */
    unsupportedRequest: AiResponseRequest;
    /** A request that makes the provider fail (e.g. a mocked 500 / socket error). */
    failingRequest: AiResponseRequest;
  };
  /** Runs before each scenario's calls — for a mocked transport that queues replies. */
  arrange?(scenario: AiConformanceScenario): void | Promise<void>;
}

export interface AiConformanceSubject {
  adapter: AiProviderAdapter;
  /** A context carrying a VALID key. */
  ctx: AiCallContext;
  fixtures: AiConformanceFixtures;
}

export interface AiConformanceOptions {
  /** Scenarios to skip, with the reason in the caller's comment. */
  skip?: AiConformanceScenario[];
}

// ---- The canonical requests ------------------------------------------------------

export const CONFORMANCE_TEXT_PROMPT = 'Reply with a short friendly greeting.';
export const CONFORMANCE_STRUCTURED_PROMPT = 'What is the capital of France and roughly how many people live there?';
export const CONFORMANCE_TOOL_PROMPT = 'What is the weather in Paris right now? Use the tool.';

/** The structured-output schema the kit requests. */
export const conformanceStructuredSchema = z.object({
  city: z.string(),
  population: z.number().int(),
});

/** The function tool the kit offers. */
export const conformanceWeatherTool = defineTool({
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => ({ city, temperatureC: 21, conditions: 'sunny' }),
});

export function conformanceRequests(model: string) {
  return {
    text: { model, input: CONFORMANCE_TEXT_PROMPT, maxOutputTokens: 64 } satisfies AiResponseRequest,
    structured: {
      model,
      input: CONFORMANCE_STRUCTURED_PROMPT,
      structuredOutput: { name: 'city_facts', schema: conformanceStructuredSchema, strict: true },
    } satisfies AiResponseRequest,
    toolCall: {
      model,
      input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: CONFORMANCE_TOOL_PROMPT }] }],
      tools: [conformanceWeatherTool.tool],
      toolChoice: 'required',
    } satisfies AiResponseRequest,
    toolResult: (previousResponseId: string, callId: string, output: string): AiResponseRequest => ({
      model,
      previousResponseId,
      input: [{ type: 'function_call_output', callId, output }],
      tools: [conformanceWeatherTool.tool],
    }),
  };
}

// ---- helpers ------------------------------------------------------------------------

async function expectAiError(run: () => Promise<unknown>, code?: string): Promise<AiError> {
  let caught: unknown;

  try {
    await run();
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(AiError);

  if (code) {
    expect((caught as AiError).code).toBe(code);
  }

  return caught as AiError;
}

async function collect(stream: AsyncIterable<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

function messageText(output: AiOutputItem[]): string {
  return output
    .filter((item): item is Extract<AiOutputItem, { type: 'message' }> => item.type === 'message')
    .map((item) => item.text)
    .join('');
}

function expectWellFormedResponse(response: AiResponse, adapter: AiProviderAdapter): void {
  expect(typeof response.id).toBe('string');
  expect(response.id.length).toBeGreaterThan(0);
  expect(response.provider).toBe(adapter.id);
  expect(typeof response.model).toBe('string');
  expect(Array.isArray(response.output)).toBe(true);
  expect(typeof response.usage).toBe('object');
  expect(['stop', 'length', 'tool_calls', 'content_filter', 'error']).toContain(response.finishReason);
  expect(response.outputText).toBe(messageText(response.output));
}

// ---- The suite ------------------------------------------------------------------------

export function describeAiProviderConformance(
  name: string,
  factory: () => AiConformanceSubject | Promise<AiConformanceSubject>,
  options: AiConformanceOptions = {},
): void {
  const skip = new Set(options.skip ?? []);

  describe(`AI provider conformance: ${name}`, () => {
    let subject: AiConformanceSubject;

    const scenario = (id: AiConformanceScenario, title: string, fn: () => Promise<void>) => {
      const register = skip.has(id) ? it.skip : it;

      register(`[${id}] ${title}`, async () => {
        await subject.fixtures.arrange?.(id);
        await fn();
      });
    };

    const invalidCtx = (): AiCallContext => ({ ...subject.ctx, apiKey: subject.fixtures.invalidApiKey });

    beforeEach(async () => {
      subject = await factory();
    });

    it('declares a stable id and a display name', () => {
      expect(subject.adapter.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(subject.adapter.displayName.length).toBeGreaterThan(0);
    });

    scenario('listModels', 'listModels returns model ids', async () => {
      const models = await subject.adapter.listModels(subject.ctx);

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      for (const model of models) {
        expect(typeof model.id).toBe('string');
        expect(model.id.length).toBeGreaterThan(0);
      }

      const ids = models.map((model) => model.id);

      for (const expected of subject.fixtures.expectedModelIds ?? []) {
        expect(ids).toContain(expected);
      }
    });

    scenario('listModels.invalidKey', 'listModels with a rejected key fails as AiError', async () => {
      await expectAiError(() => subject.adapter.listModels(invalidCtx()));
    });

    scenario('verifyKey.valid', 'verifyKey accepts a valid key', async () => {
      await expect(subject.adapter.verifyKey(subject.ctx)).resolves.toMatchObject({ ok: true });
    });

    scenario('verifyKey.invalid', 'verifyKey answers (not throws) AI_KEY_INVALID for a rejected key', async () => {
      const result = await subject.adapter.verifyKey(invalidCtx());

      expect(result.ok).toBe(false);
      expect(result.code).toBe('AI_KEY_INVALID');
    });

    scenario('classifyModel', 'classifyModel returns schema-valid capabilities or null', async () => {
      const { known, unknown } = subject.fixtures.classify;

      expect(known.length).toBeGreaterThan(0);

      for (const id of known) {
        const caps = subject.adapter.classifyModel(id);

        expect(caps).not.toBeNull();
        expect(aiModelCapabilitiesSchema.safeParse(caps).success).toBe(true);
      }

      for (const id of unknown) {
        expect(subject.adapter.classifyModel(id)).toBeNull();
      }
    });

    describe('responses port', () => {
      const port = () => {
        const responses = subject.adapter.responses;
        const fixture = subject.fixtures.responses;

        if (!responses || !fixture) {
          throw new Error('unreachable: guarded by hasPort()');
        }

        return { responses, fixture, requests: conformanceRequests(fixture.model) };
      };

      // Registration of the tests below cannot depend on `subject` (it does not
      // exist at collection time), so each test checks port presence itself.
      const whenPort = (fn: () => Promise<void>) => async () => {
        if (!subject.adapter.responses) {
          return;
        }

        expect(subject.fixtures.responses).toBeDefined();
        await fn();
      };

      it('has create and stream when the port is present', () => {
        if (!subject.adapter.responses) {
          return;
        }

        expect(typeof subject.adapter.responses.create).toBe('function');
        expect(typeof subject.adapter.responses.stream).toBe('function');
      });

      scenario('responses.text', 'create returns outputText', whenPort(async () => {
        const { responses, requests } = port();
        const response = await responses.create(requests.text, subject.ctx);

        expectWellFormedResponse(response, subject.adapter);
        expect(response.outputText.length).toBeGreaterThan(0);
        expect(response.finishReason).toBe('stop');
      }));

      scenario('responses.stream', 'stream yields created … completed in order, deltas equal final text', whenPort(async () => {
        const { responses, requests } = port();
        const events = await collect(responses.stream(requests.text, subject.ctx));

        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events[0].type).toBe('response.created');

        const last = events[events.length - 1];
        expect(last.type).toBe('response.completed');
        expect(events.filter((e) => e.type === 'response.completed')).toHaveLength(1);
        expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
        expect(events.filter((e) => e.type === 'response.created')).toHaveLength(1);

        const completed = (last as Extract<AiStreamEvent, { type: 'response.completed' }>).response;
        const created = events[0] as Extract<AiStreamEvent, { type: 'response.created' }>;
        const deltas = events
          .filter((e): e is Extract<AiStreamEvent, { type: 'output_text.delta' }> => e.type === 'output_text.delta')
          .map((e) => e.delta)
          .join('');

        expectWellFormedResponse(completed, subject.adapter);
        expect(completed.id).toBe(created.id);
        expect(completed.outputText.length).toBeGreaterThan(0);
        expect(deltas).toBe(completed.outputText);
      }));

      scenario('responses.structured', 'structured output returns parsed data that passes the schema', whenPort(async () => {
        const { responses, requests } = port();
        const response = await responses.create(requests.structured, subject.ctx);

        expectWellFormedResponse(response, subject.adapter);
        expect(response.parsed).toBeDefined();
        expect(conformanceStructuredSchema.safeParse(response.parsed).success).toBe(true);
        expect(response.parsed).toEqual(conformanceStructuredSchema.parse(JSON.parse(response.outputText)));
      }));

      scenario('responses.toolCall', 'function tool call round-trip', whenPort(async () => {
        const { responses, requests } = port();

        const first = await responses.create(requests.toolCall, subject.ctx);

        expectWellFormedResponse(first, subject.adapter);
        expect(first.finishReason).toBe('tool_calls');

        const call = first.output.find(
          (item): item is Extract<AiOutputItem, { type: 'function_call' }> => item.type === 'function_call',
        );

        expect(call).toBeDefined();
        expect(call?.name).toBe(conformanceWeatherTool.tool.name);
        expect(call?.callId.length).toBeGreaterThan(0);

        const args = conformanceWeatherTool.parseArguments(call!.arguments);
        expect(args.success).toBe(true);

        const result = await conformanceWeatherTool.execute(
          args.success ? args.data : { city: '' },
          { userId: 'conformance-user', requestId: subject.ctx.requestId },
        );

        await subject.fixtures.arrange?.('responses.toolResult');

        const second = await responses.create(
          requests.toolResult(first.id, call!.callId, JSON.stringify(result)),
          subject.ctx,
        );

        expectWellFormedResponse(second, subject.adapter);
        expect(second.finishReason).toBe('stop');
        expect(second.outputText.length).toBeGreaterThan(0);
        expect(second.output.some((item) => item.type === 'function_call')).toBe(false);
      }));

      scenario('responses.unsupported', 'an unsupported capability surfaces as AI_CAPABILITY_UNSUPPORTED', whenPort(async () => {
        const { responses, fixture } = port();

        await expectAiError(() => responses.create(fixture.unsupportedRequest, subject.ctx), 'AI_CAPABILITY_UNSUPPORTED');
      }));

      scenario('responses.invalidKey', 'a rejected key surfaces as AI_KEY_INVALID', whenPort(async () => {
        const { responses, requests } = port();

        await expectAiError(() => responses.create(requests.text, invalidCtx()), 'AI_KEY_INVALID');
      }));

      scenario('responses.providerError', 'a provider failure surfaces as AiError, never a raw error', whenPort(async () => {
        const { responses, fixture } = port();

        await expectAiError(() => responses.create(fixture.failingRequest, subject.ctx));
      }));

      scenario('responses.streamProviderError', 'a streamed provider failure is an AiError or an error event', whenPort(async () => {
        const { responses, fixture } = port();
        const events: AiStreamEvent[] = [];
        let thrown: unknown;

        try {
          for await (const event of responses.stream(fixture.failingRequest, subject.ctx)) {
            events.push(event);
          }
        } catch (err) {
          thrown = err;
        }

        expect(events.some((e) => e.type === 'response.completed')).toBe(false);

        if (thrown !== undefined) {
          expect(thrown).toBeInstanceOf(AiError);
        } else {
          const last = events[events.length - 1];

          expect(last?.type).toBe('error');
          expect(isAiErrorCode((last as Extract<AiStreamEvent, { type: 'error' }>).code)).toBe(true);
        }
      }));
    });
  });
}

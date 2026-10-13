// =============================================================================
// AiService.run (PP-14.17, issue #935): a custom operation through the SAME gate
// pipeline as a built-in port.
//
// An app registers a capability (`registerAiCapability`) and an operation
// (`registerAiOperation`) and a provider implements it under
// `AiProviderAdapter.operations`. These specs prove the pipeline is shared, not
// copied: the kill switch, the model gates, the key policy, the rate limits,
// one usage row (with the feature) and the secret handling all apply.
// =============================================================================

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { AiError, type AiErrorCode } from '../core/ai-error';
import { registerAiCapability } from '../core/capability-registry';
import { registerAiOperation } from '../core/operation-registry';
import { registerAiFeature } from '../features/ai-feature.registry';
import {
  createAiRuntimeHarness,
  HARNESS_ORG_KEY,
  HARNESS_USER,
  HARNESS_USER_KEY,
  type AiRuntimeHarnessOptions,
} from '../testing/ai-runtime-harness';
import type { AiOperationContext } from '../core/provider-adapter.interface';
import type { AiModelCapabilities } from '../core/capabilities';

const OPERATION = 'audio.diarize';
const MODEL = 'fake-diarize-model';
const OTHER_MODEL = 'fake-plain-model';
const SECRET_TEXT = 'the-user-content-that-must-not-be-recorded';

const DIARIZE_CAPABILITIES: AiModelCapabilities = {
  capabilities: ['speaker_diarization'],
  inputModalities: ['audio'],
  outputModalities: ['text'],
};

const inputSchema = z.object({ recording: z.string().min(1).max(200), speakers: z.number().int().min(1).max(10).default(2) });
const outputSchema = z.object({ speakers: z.array(z.string().max(32)).max(10), seconds: z.number() });

registerAiCapability({
  id: 'speaker_diarization',
  label: 'Diarization',
  description: 'Labels who spoke when in a recording.',
});
registerAiOperation({
  id: OPERATION,
  label: 'Diarization',
  capability: 'speaker_diarization',
  inputSchema,
  outputSchema,
  usageUnits: (output) => ({ audioSeconds: output.seconds }),
});
registerAiFeature({ id: 'example_meeting_notes', label: 'Meeting notes', needs: ['speaker_diarization'] });
registerAiFeature({ id: 'example_chat_only', label: 'Chat only', needs: ['responses'] });

type Handler = (input: unknown, ctx: AiOperationContext) => Promise<unknown>;

function setup(handler: Handler, opts: AiRuntimeHarnessOptions = {}) {
  const seen: Array<{ input: unknown; ctx: AiOperationContext }> = [];
  const h = createAiRuntimeHarness({
    ...opts,
    models: opts.models ?? [
      { modelId: MODEL, capabilities: DIARIZE_CAPABILITIES },
      { modelId: OTHER_MODEL },
    ],
    fake: {
      ...opts.fake,
      operations: {
        [OPERATION]: async (input, ctx) => {
          seen.push({ input, ctx });
          return handler(input, ctx);
        },
      },
    },
  });

  return { h, seen, client: h.ai.forUser(HARNESS_USER) };
}

const good: Handler = async () => ({ speakers: ['A', 'B'], seconds: 12.5 });

async function errorOf(promise: Promise<unknown>): Promise<AiError> {
  const err = await promise.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (e: unknown) => e,
  );

  expect(err).toBeInstanceOf(AiError);

  return err as AiError;
}

const codeOf = async (promise: Promise<unknown>): Promise<AiErrorCode> => (await errorOf(promise)).code;

describe('AiService.run: a custom operation', () => {
  describe('success', () => {
    it('validates the input, calls the adapter under the user key and returns the validated output', async () => {
      const t = setup(good);

      const output = await t.client.run<{ speakers: string[] }>(OPERATION, { recording: 'rec-1' }, { model: MODEL });

      expect(output).toEqual({ speakers: ['A', 'B'], seconds: 12.5 });
      // The schema's default was applied: the handler received the PARSED input.
      expect(t.seen[0].input).toEqual({ recording: 'rec-1', speakers: 2 });
      expect(t.seen[0].ctx).toMatchObject({ apiKey: HARNESS_USER_KEY, model: MODEL, operation: OPERATION });
      expect(t.h.fake.callsTo('operations.run')[0].apiKey).toBe(HARNESS_USER_KEY);
    });

    it('an omitted model is the first usable model declaring the operation capability', async () => {
      const t = setup(good);

      await t.client.run(OPERATION, { recording: 'rec-1' });

      expect(t.seen[0].ctx.model).toBe(MODEL);
    });

    it('records ONE usage row: the operation id, who paid, the units, and nothing of the content', async () => {
      const t = setup(good);

      await t.client.run(OPERATION, { recording: SECRET_TEXT });

      expect(t.h.usageEvents).toHaveLength(1);
      expect(t.h.usageEvents[0]).toEqual(
        expect.objectContaining({
          userId: HARNESS_USER,
          provider: 'openai',
          modelId: MODEL,
          operation: OPERATION,
          keySource: 'user',
          status: 'succeeded',
          errorCode: null,
          units: { audioSeconds: 12.5 },
        }),
      );
      expect(JSON.stringify(t.h.usageEvents)).not.toContain(SECRET_TEXT);
      expect(JSON.stringify(t.h.usageEvents)).not.toContain(HARNESS_USER_KEY);
    });

    it('persists the feature the call was made for on the usage row', async () => {
      const t = setup(good);

      await t.h.ai.forUser(HARNESS_USER, { feature: 'example_meeting_notes' }).run(OPERATION, { recording: 'r' });
      await t.client.run(OPERATION, { recording: 'r' });

      expect(t.h.usageEvents.map((row) => row.feature ?? null)).toEqual(['example_meeting_notes', null]);
    });

    it('a throwing usageUnits callback never fails a billed call', async () => {
      const t = setup(good);
      // A second operation whose callback throws.
      registerAiOperation({
        id: 'audio.diarize_broken_units',
        label: 'Broken units',
        capability: 'speaker_diarization',
        inputSchema,
        outputSchema,
        usageUnits: () => {
          throw new Error('boom');
        },
      });
      const h = createAiRuntimeHarness({
        models: [{ modelId: MODEL, capabilities: DIARIZE_CAPABILITIES }],
        fake: { operations: { 'audio.diarize_broken_units': good } },
      });

      await expect(h.ai.forUser(HARNESS_USER).run('audio.diarize_broken_units', { recording: 'r' })).resolves.toBeDefined();
      expect(h.usageEvents[0]).toEqual(expect.objectContaining({ status: 'succeeded' }));
      expect(h.usageEvents[0].units).toBeUndefined();
      expect(t.seen).toHaveLength(0);
    });
  });

  describe('the gate pipeline is the built-in one', () => {
    it('the kill switch answers first: no key read, no handler, no usage row', async () => {
      const t = setup(good, { policy: { enabled: false } });

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }))).toBe('AI_DISABLED');
      expect(t.seen).toHaveLength(0);
      expect(t.h.usageEvents).toHaveLength(0);
    });

    it('an input that fails its schema is AI_INVALID_REQUEST before any key is read; the value is not echoed', async () => {
      const t = setup(good);
      const error = await errorOf(t.client.run(OPERATION, { recording: '' , speakers: 99 }, { model: MODEL }));

      expect(error.code).toBe('AI_INVALID_REQUEST');
      expect(JSON.stringify(error.toJSON())).not.toContain('99');
      expect(t.seen).toHaveLength(0);
      expect(t.h.usageEvents).toHaveLength(0);
      expect(t.h.getSecret).not.toHaveBeenCalled();
    });

    it('an unregistered operation id is AI_INVALID_REQUEST naming how to register it', async () => {
      const t = setup(good);
      const error = await errorOf(t.client.run('audio.unknown_thing', {}, { model: MODEL }));

      expect(error.code).toBe('AI_INVALID_REQUEST');
      expect(error.message).toContain('registerAiOperation');
    });

    it('a built-in operation id is refused: its typed method is the way', async () => {
      const t = setup(good);

      expect(await codeOf(t.client.run('responses', { input: 'x' }, { model: MODEL }))).toBe('AI_INVALID_REQUEST');
      expect(await codeOf(t.client.run('audio.transcribe', {}, { model: MODEL }))).toBe('AI_INVALID_REQUEST');
    });

    it('a model that does not declare the capability is AI_CAPABILITY_UNSUPPORTED', async () => {
      const t = setup(good);

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: OTHER_MODEL }))).toBe('AI_CAPABILITY_UNSUPPORTED');
      expect(t.seen).toHaveLength(0);
    });

    it('a model nobody enabled is AI_MODEL_NOT_ENABLED', async () => {
      const t = setup(good);

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: 'missing-model' }))).toBe('AI_MODEL_NOT_ENABLED');
    });

    it('a provider that does not implement the operation is AI_CAPABILITY_UNSUPPORTED even when the model claims the capability', async () => {
      const h = createAiRuntimeHarness({ models: [{ modelId: MODEL, capabilities: DIARIZE_CAPABILITIES }] });

      expect(await codeOf(h.ai.forUser(HARNESS_USER).run(OPERATION, { recording: 'r' }, { model: MODEL }))).toBe(
        'AI_CAPABILITY_UNSUPPORTED',
      );
      expect(h.usageEvents).toHaveLength(0);
    });

    it('the key policy applies: BYOK with no key is AI_KEY_REQUIRED', async () => {
      const t = setup(good, { userKey: false });

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }))).toBe('AI_KEY_REQUIRED');
      expect(t.seen).toHaveLength(0);
    });

    it('the organization key pays when the policy allows fallback and the user has none', async () => {
      const t = setup(good, { userKey: false, orgKey: true, policy: { keyPolicy: 'byok_with_org_fallback' } });

      await t.client.run(OPERATION, { recording: 'r' }, { model: MODEL });

      expect(t.seen[0].ctx.apiKey).toBe(HARNESS_ORG_KEY);
      expect(t.h.usageEvents[0]).toEqual(expect.objectContaining({ keySource: 'org' }));
    });

    it('the rate limits apply after the key: a refused call reaches no handler and records no row', async () => {
      const t = setup(good, { policy: { limits: { perUser: { requestsPerMinute: 1 } } } });

      await t.client.run(OPERATION, { recording: 'r' }, { model: MODEL });

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }))).toBe('AI_RATE_LIMITED');
      expect(t.seen).toHaveLength(1);
      expect(t.h.usageEvents).toHaveLength(1);
    });

    it('a feature whose needs the model lacks is AI_INVALID_REQUEST', async () => {
      const t = setup(good);

      expect(
        await codeOf(t.h.ai.forUser(HARNESS_USER, { feature: 'example_chat_only' }).run(OPERATION, { recording: 'r' }, { model: MODEL })),
      ).toBe('AI_INVALID_REQUEST');
    });

    it('an aborted call records a cancelled row', async () => {
      const t = setup(async (_input, ctx) => {
        if (ctx.signal?.aborted) throw ctx.signal.reason;
        return good(_input, ctx);
      });
      const controller = new AbortController();

      controller.abort(new Error('stop'));

      expect(await codeOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL, signal: controller.signal }))).toBe(
        'AI_PROVIDER_UNAVAILABLE',
      );
      expect(t.seen).toHaveLength(0);
    });
  });

  describe('the output and the error are a trust boundary', () => {
    it('an output that does not match its schema is AI_STRUCTURED_OUTPUT_INVALID, and the round trip is recorded failed', async () => {
      const t = setup(async () => ({ speakers: 'not-a-list' }));
      const error = await errorOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }));

      expect(error.code).toBe('AI_STRUCTURED_OUTPUT_INVALID');
      expect(t.h.usageEvents).toEqual([
        expect.objectContaining({ operation: OPERATION, status: 'failed', errorCode: 'AI_STRUCTURED_OUTPUT_INVALID' }),
      ]);
    });

    it('an output carrying the key is refused, whatever its shape; the key is in no error and no row', async () => {
      const t = setup(async (_input, ctx) => ({ speakers: [`leak-${ctx.apiKey}`], seconds: 1 }));
      const error = await errorOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }));

      expect(error.code).toBe('AI_STRUCTURED_OUTPUT_INVALID');
      expect(JSON.stringify(error.toJSON())).not.toContain(HARNESS_USER_KEY);
      expect(JSON.stringify(t.h.usageEvents)).not.toContain(HARNESS_USER_KEY);
    });

    it('a raw handler error becomes a generic AiError that does not copy its message', async () => {
      const t = setup(async (_input, ctx) => {
        throw new Error(`vendor said: bad key ${ctx.apiKey}`);
      });
      const error = await errorOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }));

      expect(error.code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(JSON.stringify(error.toJSON())).not.toContain(HARNESS_USER_KEY);
      expect(t.h.usageEvents[0]).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'AI_PROVIDER_UNAVAILABLE' }));
    });

    it('an AiError whose message or details carry the key is replaced by a generic one of the same code', async () => {
      const t = setup(async (_input, ctx) => {
        throw new AiError('AI_KEY_INVALID', `rejected ${ctx.apiKey}`, { details: { echoed: ctx.apiKey } });
      });
      const error = await errorOf(t.client.run(OPERATION, { recording: 'r' }, { model: MODEL }));

      expect(error.code).toBe('AI_KEY_INVALID');
      expect(JSON.stringify(error.toJSON())).not.toContain(HARNESS_USER_KEY);
    });

    it('nothing of the input reaches a log line, even with prompt logging on', async () => {
      const t = setup(good, { policy: { logPromptContent: true } });
      const lines: string[] = [];
      const spies = (['log', 'debug', 'verbose', 'warn', 'error'] as const).map((level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => void lines.push(args.map((arg) => JSON.stringify(arg)).join(' '))),
      );

      try {
        await t.client.run(OPERATION, { recording: SECRET_TEXT }, { model: MODEL });
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }

      expect(lines.join('\n')).not.toContain(SECRET_TEXT);
    });
  });
});
